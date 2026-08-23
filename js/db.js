// Local-first storage for Flipping Friend.
// Everything lives in the browser's IndexedDB on the phone — no account, works offline.

const DB_NAME = "flipping-friend";
const DB_VERSION = 4;
const STORE_ITEMS = "items";
const STORE_SETTINGS = "settings";
const STORE_LOOKUPS = "lookups"; // cached comp/AI results, keyed by lookup key
const STORE_QUEUE = "queue";     // lookups captured offline, run when back online
const STORE_OUTBOX = "outbox";   // local changes waiting to sync to the cloud
const STORE_EXPENSES = "expenses"; // business expenses (supplies, mileage, fees…)

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_LOOKUPS)) {
        db.createObjectStore(STORE_LOOKUPS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_EXPENSES)) {
        db.createObjectStore(STORE_EXPENSES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function uid() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---- Items ----
export async function getAllItems() {
  const store = await tx(STORE_ITEMS, "readonly");
  const items = await reqToPromise(store.getAll());
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items;
}

export async function getItem(id) {
  const store = await tx(STORE_ITEMS, "readonly");
  return reqToPromise(store.get(id));
}

// Timestamps must always move forward, even if a phone's clock is behind —
// last-write-wins sync would otherwise silently drop that phone's edits.
export function nextTimestamp(prev) {
  return Math.max(Date.now(), (Number(prev) || 0) + 1);
}

export async function saveItem(item) {
  if (!item.id) {
    item.id = uid();
    item.createdAt = Date.now();
  }
  item.updatedAt = nextTimestamp(item.updatedAt);
  const store = await tx(STORE_ITEMS, "readwrite");
  await reqToPromise(store.put(item));
  return item;
}

export async function deleteItem(id) {
  const store = await tx(STORE_ITEMS, "readwrite");
  return reqToPromise(store.delete(id));
}

// Raw writes used when applying changes pulled FROM the cloud — these must not
// touch updatedAt (we keep the remote timestamp) and must not re-queue an outbox entry.
export async function putItemRaw(item) {
  const store = await tx(STORE_ITEMS, "readwrite");
  return reqToPromise(store.put(item));
}

export async function deleteItemRaw(id) {
  const store = await tx(STORE_ITEMS, "readwrite");
  return reqToPromise(store.delete(id));
}

// ---- Sync outbox (local changes pending upload) ----
export async function outboxAdd(op, id, item) {
  const store = await tx(STORE_OUTBOX, "readwrite");
  // keyed by item id so repeated edits collapse to the latest pending op
  return reqToPromise(store.put({ id, op, item: item || null, ts: Date.now() }));
}

export async function outboxAll() {
  const store = await tx(STORE_OUTBOX, "readonly");
  return reqToPromise(store.getAll());
}

export async function outboxDelete(id) {
  const store = await tx(STORE_OUTBOX, "readwrite");
  return reqToPromise(store.delete(id));
}

export async function bulkPutItems(items) {
  const store = await tx(STORE_ITEMS, "readwrite");
  for (const it of items) {
    if (!it.id) it.id = uid();
    if (!it.createdAt) it.createdAt = Date.now();
    if (!it.updatedAt) it.updatedAt = Date.now();
    store.put(it);
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(items.length);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function clearItems() {
  const store = await tx(STORE_ITEMS, "readwrite");
  return reqToPromise(store.clear());
}

// ---- Expenses ----
// Stored separately from items, but ride the same sync pipeline: each record
// carries doc:"expense" and an "exp-" id prefix so sync can route it.
export async function getAllExpenses() {
  const store = await tx(STORE_EXPENSES, "readonly");
  const rows = await reqToPromise(store.getAll());
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || 0) - (a.updatedAt || 0));
  return rows;
}

export async function saveExpense(exp) {
  if (!exp.id) {
    exp.id = "exp-" + uid();
    exp.createdAt = Date.now();
  }
  exp.doc = "expense";
  exp.updatedAt = nextTimestamp(exp.updatedAt);
  const store = await tx(STORE_EXPENSES, "readwrite");
  await reqToPromise(store.put(exp));
  return exp;
}

export async function deleteExpense(id) {
  const store = await tx(STORE_EXPENSES, "readwrite");
  return reqToPromise(store.delete(id));
}

export async function getExpense(id) {
  const store = await tx(STORE_EXPENSES, "readonly");
  return reqToPromise(store.get(id));
}

// Raw writes for sync (keep remote timestamps, no outbox echo).
export async function putExpenseRaw(exp) {
  const store = await tx(STORE_EXPENSES, "readwrite");
  return reqToPromise(store.put(exp));
}

export async function deleteExpenseRaw(id) {
  const store = await tx(STORE_EXPENSES, "readwrite");
  return reqToPromise(store.delete(id));
}

// ---- Settings ----
const DEFAULT_SETTINGS = {
  monthlyGoal: 800,
  defaultPlatform: "eBay",
};

export async function getSettings() {
  const store = await tx(STORE_SETTINGS, "readonly");
  const rows = await reqToPromise(store.getAll());
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key, value) {
  const store = await tx(STORE_SETTINGS, "readwrite");
  return reqToPromise(store.put({ key, value }));
}

// ---- Lookup cache (comps / AI estimates), keyed by upc or query ----
const LOOKUP_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function getCachedLookup(key) {
  const store = await tx(STORE_LOOKUPS, "readonly");
  const row = await reqToPromise(store.get(key));
  if (!row) return null;
  if (Date.now() - row.cachedAt > LOOKUP_TTL_MS) return null;
  return row.data;
}

export async function setCachedLookup(key, data) {
  const store = await tx(STORE_LOOKUPS, "readwrite");
  return reqToPromise(store.put({ key, data, cachedAt: Date.now() }));
}

// ---- Offline lookup queue ----
export async function queueLookup(entry) {
  entry.id = uid();
  entry.queuedAt = Date.now();
  const store = await tx(STORE_QUEUE, "readwrite");
  await reqToPromise(store.put(entry));
  return entry;
}

export async function getQueue() {
  const store = await tx(STORE_QUEUE, "readonly");
  return reqToPromise(store.getAll());
}

export async function dequeue(id) {
  const store = await tx(STORE_QUEUE, "readwrite");
  return reqToPromise(store.delete(id));
}
