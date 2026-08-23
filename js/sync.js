// Shared cloud sync via Supabase. Local IndexedDB stays the instant source of
// truth on each device; changes flow to a shared cloud table and back.
//
// Design: per-record last-write-wins by `updatedAt`. Local edits go into an
// outbox and upload when online; incoming changes are applied with the remote
// timestamp. Items and expenses share one cloud table — expense records carry
// doc:"expense" and an "exp-" id prefix, and pull() routes them to the right
// local store. Works offline — sync resumes when signal returns.
//
// Reliability: sync runs automatically when the app becomes visible again
// (installed PWAs resume from memory and can otherwise go days without a
// launch-time sync), every 60s while open and signed in, and on reconnect.
// Status is observable so the UI can show synced / pending / error instead of
// failing silently.

import * as db from "./db.js";

const CDN = "https://esm.sh/@supabase/supabase-js@2";
const TABLE = "items";
const AUTO_SYNC_MS = 60 * 1000;

let client = null;
let createClientFn = null;
let syncing = false;

// ---- Observable status ----
const status = {
  state: "off",      // off | signedout | ok | syncing | error | offline
  pending: 0,        // outbox entries waiting to upload
  lastSyncAt: null,  // ms timestamp of last successful full sync
  lastError: null,
};
const listeners = new Set();

export function onStatus(cb) { listeners.add(cb); cb({ ...status }); }
export function getStatus() { return { ...status }; }
export function getLastError() { return status.lastError; }

async function refreshStatus(patch = {}) {
  Object.assign(status, patch);
  try { status.pending = (await db.outboxAll()).length; } catch (_) {}
  if (!navigator.onLine && status.state !== "off" && status.state !== "signedout") {
    status.state = "offline";
  }
  for (const cb of listeners) { try { cb({ ...status }); } catch (_) {} }
}

async function loadLib() {
  if (createClientFn) return createClientFn;
  const mod = await import(/* @vite-ignore */ CDN);
  createClientFn = mod.createClient;
  return createClientFn;
}

export async function getConfig() {
  const s = await db.getSettings();
  return { url: s.supabaseUrl || "", key: s.supabaseKey || "" };
}

export async function isConfigured() {
  const { url, key } = await getConfig();
  return !!(url && key);
}

export async function saveConfig(url, key) {
  await db.setSetting("supabaseUrl", url.trim());
  await db.setSetting("supabaseKey", key.trim());
  client = null; // force re-init with new creds
  await refreshStatus({ state: (url && key) ? "signedout" : "off", lastError: null });
}

async function getClient() {
  if (client) return client;
  const { url, key } = await getConfig();
  if (!url || !key) throw new Error("Cloud sync isn't configured yet.");
  const createClient = await loadLib();
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export async function currentUser() {
  try {
    const c = await getClient();
    const { data } = await c.auth.getUser();
    return data.user || null;
  } catch (_) {
    return null;
  }
}

export async function signIn(email, password) {
  const c = await getClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await db.setSetting("syncEmail", email); // prefill future sign-ins on this device
  await refreshStatus({ state: "ok", lastError: null });
}

export async function signOut() {
  try {
    const c = await getClient();
    await c.auth.signOut();
  } catch (_) {}
  await refreshStatus({ state: "signedout" });
}

// Record a local change for upload. Call after a successful local save/delete.
// Works for items and expenses alike (expense objects carry doc:"expense").
export async function onLocalChange(op, idOrRecord) {
  if (op === "upsert") {
    await db.outboxAdd("upsert", idOrRecord.id, idOrRecord);
  } else {
    await db.outboxAdd("delete", idOrRecord, null);
  }
  await refreshStatus();
  if (navigator.onLine && (await isConfigured())) {
    fullSync().catch(() => {});
  }
}

// Upload everything currently in the local DB (used on first enable).
export async function seedOutboxFromLocal() {
  const items = await db.getAllItems();
  for (const it of items) await db.outboxAdd("upsert", it.id, it);
  const expenses = await db.getAllExpenses();
  for (const ex of expenses) await db.outboxAdd("upsert", ex.id, ex);
  await refreshStatus();
}

// Push pending outbox entries to the cloud.
//
// The cloud `updated_at` column is the PULL WATERMARK — it must reflect when a
// row LANDED in the cloud, not when the record was last edited. (It used to be
// the edit time; a device that had synced recently would then skip older-edited
// records uploaded later by the other device — the "two phones show different
// item counts" bug.) Stamps are forced above our last-seen cloud watermark so
// clock skew can't hide an upload either. Conflict resolution ("which edit
// wins") uses the record's own updatedAt inside `data`, in pull().
export async function flush() {
  const c = await getClient();
  const pending = await db.outboxAll();
  if (!pending.length) return;
  const s = await db.getSettings();
  let stamp = Math.max(Date.now(), (Number(s.syncLastTs) || 0) + 1);
  for (const entry of pending) {
    let res;
    if (entry.op === "delete") {
      res = await c.from(TABLE).upsert({
        id: entry.id, data: null, deleted: true, updated_at: stamp++,
      });
    } else {
      const rec = entry.item;
      res = await c.from(TABLE).upsert({
        id: rec.id, data: rec, deleted: false, updated_at: stamp++,
      });
    }
    if (res.error) throw new Error(res.error.message);
    await db.outboxDelete(entry.id);
  }
}

function isExpenseRow(row) {
  return (row.data && row.data.doc === "expense") || String(row.id).startsWith("exp-");
}

// Pull changes newer than our last sync and apply them locally.
// Returns the number of records changed locally.
export async function pull() {
  const c = await getClient();
  const s = await db.getSettings();
  const since = s.syncLastTs || 0;

  const { data, error } = await c
    .from(TABLE)
    .select("*")
    .gt("updated_at", since)
    .order("updated_at", { ascending: true });
  if (error) throw new Error(error.message);

  let changed = 0;
  let maxTs = since;
  for (const row of data || []) {
    maxTs = Math.max(maxTs, row.updated_at);
    const expense = isExpenseRow(row);
    const local = expense ? await db.getExpense(row.id) : await db.getItem(row.id);
    if (row.deleted) {
      if (local) {
        if (expense) await db.deleteExpenseRaw(row.id);
        else await db.deleteItemRaw(row.id);
        changed++;
      }
    } else if (!local || (local.updatedAt || 0) < ((row.data && row.data.updatedAt) || row.updated_at)) {
      if (expense) await db.putExpenseRaw(row.data);
      else await db.putItemRaw(row.data);
      changed++;
    }
  }
  if (maxTs > since) await db.setSetting("syncLastTs", maxTs);
  return changed;
}

// Full re-sync from scratch: re-upload everything on this device and re-pull
// everything from the cloud, merging by each record's own edit time. Heals any
// divergence between devices — including rows missed by the old edit-time
// watermark bug. Safe: never deletes anything on its own.
export async function repairSync() {
  await db.setSetting("syncLastTs", 0);
  await seedOutboxFromLocal();
  return fullSync();
}

// Full sync: push local changes, then pull remote ones.
export async function fullSync() {
  if (syncing) return { skipped: true };
  syncing = true;
  await refreshStatus({ state: "syncing" });
  try {
    await flush();
    const changed = await pull();
    await refreshStatus({ state: "ok", lastError: null, lastSyncAt: Date.now() });
    return { changed };
  } catch (err) {
    await refreshStatus({ state: "error", lastError: String(err.message || err) });
    throw err;
  } finally {
    syncing = false;
  }
}

// ---- Automatic background sync ----
// onChanged(changedCount) fires after any auto-sync that pulled new data,
// so the UI can re-render with fresh records.
let autoStarted = false;
export async function startAutoSync(onChanged) {
  if (autoStarted) return;
  autoStarted = true;

  const ready = async () =>
    navigator.onLine && (await isConfigured()) && (await currentUser());

  const run = async () => {
    try {
      if (!(await ready())) { await refreshStatus(); return; }
      const { changed } = await fullSync();
      if (changed && onChanged) onChanged(changed);
    } catch (_) { /* status already reflects the error */ }
  };

  window.addEventListener("online", run);
  window.addEventListener("offline", () => refreshStatus());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") run();
  }, AUTO_SYNC_MS);

  // Initial state for the status chip, then a first sync.
  if (await isConfigured()) {
    await refreshStatus({ state: (await currentUser()) ? "ok" : "signedout" });
  } else {
    await refreshStatus({ state: "off" });
  }
  run();
}
