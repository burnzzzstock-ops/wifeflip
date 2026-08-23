// Shared cloud sync via Supabase. Local IndexedDB stays the instant source of
// truth on each device; changes flow to a shared cloud table and back.
//
// This standalone wife build is pre-wired to the existing legacy Flipping Friend
// Supabase project using its browser-safe publishable key. The user's password is
// never embedded here. Local IndexedDB remains the instant source of truth.

import * as db from "./db.js";

const CDN = "https://esm.sh/@supabase/supabase-js@2";
const TABLE = "items";
const AUTO_SYNC_MS = 60 * 1000;
const DEFAULT_SUPABASE_URL = "https://phwgtbflswzinwzdgjwk.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_1P1ht27bgTELwiqL2vZAIg_d6_e8Pv_";

let client = null;
let createClientFn = null;
let syncing = false;

const status = {
  state: "off",
  pending: 0,
  lastSyncAt: null,
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
  return {
    url: s.supabaseUrl || DEFAULT_SUPABASE_URL,
    key: s.supabaseKey || DEFAULT_SUPABASE_KEY,
  };
}

export async function isConfigured() {
  const { url, key } = await getConfig();
  return !!(url && key);
}

export async function saveConfig(url, key) {
  await db.setSetting("supabaseUrl", url.trim());
  await db.setSetting("supabaseKey", key.trim());
  client = null;
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
  await db.setSetting("syncEmail", email);
  await refreshStatus({ state: "ok", lastError: null });
}

export async function signOut() {
  try {
    const c = await getClient();
    await c.auth.signOut();
  } catch (_) {}
  await refreshStatus({ state: "signedout" });
}

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

export async function seedOutboxFromLocal() {
  const items = await db.getAllItems();
  for (const it of items) await db.outboxAdd("upsert", it.id, it);
  const expenses = await db.getAllExpenses();
  for (const ex of expenses) await db.outboxAdd("upsert", ex.id, ex);
  await refreshStatus();
}

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

export async function repairSync() {
  await db.setSetting("syncLastTs", 0);
  await seedOutboxFromLocal();
  return fullSync();
}

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
    } catch (_) {}
  };

  window.addEventListener("online", run);
  window.addEventListener("offline", () => refreshStatus());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") run();
  }, AUTO_SYNC_MS);

  if (await isConfigured()) {
    await refreshStatus({ state: (await currentUser()) ? "ok" : "signedout" });
  } else {
    await refreshStatus({ state: "off" });
  }
  run();
}
