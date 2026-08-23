import * as db from "./db.js";
import {
  money, moneyShort, todayStr, escapeHtml, compressImage,
  toast, itemProfit, isThisMonth, parseDate, monthKey, monthLabel, daysSince,
  promptModal, confirmModal,
} from "./util.js";
import { startScanner, cameraSupported } from "./barcode.js";
import * as api from "./api.js";
import * as sync from "./sync.js";
import { icon } from "./icons.js";

// ---- Constants ----
const APP_VERSION = "v9";
const CATEGORIES = ["Clothing", "Shoes", "Accessories", "Knickknacks", "Vintage", "Electronics", "Media", "Car Parts", "Home", "Other"];
const CONDITIONS = ["New with tags", "Like new", "Good", "Fair", "For parts"];
const PLATFORMS = ["eBay", "Poshmark", "Mercari", "Facebook", "Depop", "Etsy", "Whatnot", "Other"];
const STATUSES = ["candidate", "sourced", "listed", "sold", "archived"];
const STATUS_LABEL = {
  candidate: "Maybe (in store)",
  sourced: "Bought",
  listed: "Listed",
  sold: "Sold",
  archived: "Archived",
};
const EXPENSE_CATS = ["Supplies", "Shipping supplies", "Mileage / gas", "Subscriptions", "Sourcing trip", "Other"];

// Aging thresholds (days) that trigger "needs attention" nudges.
const AGE_LIST_IT = 14;   // bought but still not listed
const AGE_STALE = 30;     // listed with no sale — send offers / reprice
const AGE_MAYBE = 14;     // "maybe" saved in store, never decided

const ROUTINE = [
  "Share your Poshmark closet (algorithm boost)",
  "Send offers to watchers & likers",
  "List at least one new item",
  "Answer buyer questions & messages",
];

let settings = { monthlyGoal: 800, defaultPlatform: "eBay" };

// ---- Themes (saved per-device) ----
const THEMES = [
  { id: "standard", name: "Standard", color: "#128a5c", swatch: "#128a5c" },
  { id: "dark", name: "Dark", color: "#161f1a", swatch: "#35b381" },
  { id: "boo", name: "Boo mode", color: "#5b8cff", swatch: "#5b8cff" },
  { id: "cnc", name: "Command & Conquer", color: "#d98a00", swatch: "#d98a00" },
];

function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.setAttribute("data-theme", t.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.color);
}

// In-progress photos for the form currently on screen.
let formPhotos = [];

// ---- Router ----
const view = document.getElementById("view");

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [route, ...rest] = h.split("/");
  return { route: route || "dashboard", param: rest.join("/") };
}

async function render() {
  const { route, param } = parseHash();
  setActiveTab(route);
  // retrigger the view entrance animation
  view.style.animation = "none";
  void view.offsetWidth;
  view.style.animation = "";
  switch (route) {
    case "dashboard": return renderDashboard();
    case "inventory": return renderInventory();
    case "capture": return renderForm(null, { quick: true });
    case "sourcing": return renderSourcing();
    case "insights": return renderInsights();
    case "guide": return renderGuide();
    case "pair": return renderPair(param);
    case "settings": return renderSettings();
    case "item": return renderItemDetail(param);
    case "edit": {
      const [id, preset] = param.split("/");
      return renderForm(id, { preset });
    }
    default: return renderDashboard();
  }
}

function go(hash) { location.hash = hash; }

function setActiveTab(route) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.route === route);
  });
}

document.getElementById("tabbar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) go("#/" + tab.dataset.route);
});

window.addEventListener("hashchange", render);

// ---- Shared business math ----
function expenseAmount(e) { return Number(e.amount) || 0; }

function monthExpenses(expenses) {
  return expenses.filter((e) => isThisMonth(e.date)).reduce((s, e) => s + expenseAmount(e), 0);
}

// The aging nudges that drive the "needs attention" list.
function agingAlerts(items) {
  const alerts = [];
  for (const i of items) {
    if (i.status === "listed") {
      const d = daysSince(i.dateListed || i.dateSourced || i.createdAt);
      if (d != null && d >= AGE_STALE) {
        alerts.push({ item: i, days: d, why: `Listed ${d} days — a quick offer to watchers often gets it sold` });
      }
    } else if (i.status === "sourced") {
      const d = daysSince(i.dateSourced || i.createdAt);
      if (d != null && d >= AGE_LIST_IT) {
        alerts.push({ item: i, days: d, why: `Bought ${d} days ago — ready to list whenever you have a few minutes` });
      }
    } else if (i.status === "candidate") {
      const d = daysSince(i.dateSourced || i.createdAt);
      if (d != null && d >= AGE_MAYBE) {
        alerts.push({ item: i, days: d, why: `A "maybe" from ${d} days ago — still interested, or archive it?` });
      }
    }
  }
  alerts.sort((a, b) => b.days - a.days);
  return alerts;
}

function trimTitle(t, n = 30) {
  t = (t || "your item").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// The single most useful next action — so she never has to decide what to do.
// Priority: list what's already bought (dead stock → cash) → nudge quiet
// listings → clear out "maybes" → all caught up.
function nextAction(items) {
  const byOldest = (a, b) =>
    (parseDate(a.dateSourced || a.createdAt) || 0) - (parseDate(b.dateSourced || b.createdAt) || 0);

  const sourced = items.filter((i) => i.status === "sourced").sort(byOldest);
  if (sourced.length) {
    const it = sourced[0];
    const more = sourced.length - 1;
    return {
      label: "List something you've already bought",
      sub: `"${trimTitle(it.title)}"${more > 0 ? ` and ${more} more are` : " is"} waiting — tap to list it`,
      hash: "#/item/" + it.id,
    };
  }
  const aging = agingAlerts(items).filter((a) => a.item.status === "listed");
  if (aging.length) {
    return {
      label: "Nudge your quiet listings",
      sub: `${aging.length} listing${aging.length > 1 ? "s have" : " has"} gone quiet — a quick offer often gets ${aging.length > 1 ? "them" : "it"} sold`,
      hash: "#/item/" + aging[0].item.id,
    };
  }
  const maybes = items.filter((i) => i.status === "candidate").sort(byOldest);
  if (maybes.length) {
    return {
      label: "Decide on a “maybe”",
      sub: `${maybes.length} item${maybes.length > 1 ? "s are" : " is"} waiting on a yes or no`,
      hash: "#/item/" + maybes[0].id,
    };
  }
  return {
    label: "You're all caught up 💚",
    sub: "Next time you're out and spot something good, just tap Add.",
    hash: "#/capture",
  };
}

function attentionRowsHtml(alerts, limit) {
  return alerts.slice(0, limit).map(({ item, why }) => `
    <div class="attn-row" data-id="${item.id}">
      ${icon("clock")}
      <div class="attn-main">
        <div class="attn-title">${escapeHtml(item.title || "Untitled item")}</div>
        <div class="attn-why">${escapeHtml(why)}</div>
      </div>
      ${icon("chevron", "chev")}
    </div>`).join("");
}

function wireAttentionRows() {
  view.querySelectorAll(".attn-row").forEach((row) => {
    row.onclick = () => go("#/item/" + row.dataset.id);
  });
}

// ---- Dashboard ----
async function renderDashboard() {
  const [items, expenses] = await Promise.all([db.getAllItems(), db.getAllExpenses()]);
  const active = items.filter((i) => i.status !== "archived");

  const counts = {};
  for (const s of STATUSES) counts[s] = items.filter((i) => i.status === s).length;

  const invested = active
    .filter((i) => ["sourced", "listed"].includes(i.status))
    .reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

  const listedValue = active
    .filter((i) => i.status === "listed")
    .reduce((sum, i) => sum + (Number(i.listPrice) || 0), 0);

  const soldItems = items.filter((i) => i.status === "sold");
  const monthSold = soldItems.filter((i) => isThisMonth(i.dateSold || i.updatedAt));
  const monthSalesProfit = monthSold.reduce((s, i) => s + (itemProfit(i) || 0), 0);
  const monthExp = monthExpenses(expenses);
  const monthNet = monthSalesProfit - monthExp;
  const allTimeProfit = soldItems.reduce((s, i) => s + (itemProfit(i) || 0), 0);

  const goal = settings.monthlyGoal || 800;
  const pct = Math.max(0, Math.min(100, Math.round((monthNet / goal) * 100)));

  const alerts = agingAlerts(items);
  const next = nextAction(items);
  const routine = await getRoutineState();
  const routineDone = routine.filter(Boolean).length;

  view.innerHTML = `
    <div class="hero">
      <div class="hero-label">${new Date().toLocaleDateString(undefined, { month: "long" })} profit</div>
      <div class="hero-num">${money(monthNet)}</div>
      <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
      <div class="hero-sub">${pct}% of your ${money(goal)} goal &middot; ${monthSold.length} sold${monthExp ? ` &middot; ${money(monthExp)} expenses` : ""}</div>
    </div>

    <button class="next-card" id="nextAction">
      <div class="next-main">
        <div class="next-kicker">Do this next</div>
        <div class="next-title">${escapeHtml(next.label)}</div>
        <div class="next-sub">${escapeHtml(next.sub)}</div>
      </div>
      ${icon("chevron", "next-chev")}
    </button>

    <div class="stat-grid">
      <div class="stat"><div class="num">${counts.listed}</div><div class="lbl">listed &middot; asking ${moneyShort(listedValue)}</div></div>
      <div class="stat"><div class="num ${counts.sourced ? "warn" : ""}">${counts.sourced}</div><div class="lbl">bought, waiting to be listed</div></div>
      <div class="stat"><div class="num">${money(invested)}</div><div class="lbl">cash tied up in stock</div></div>
      <div class="stat"><div class="num good">${money(allTimeProfit)}</div><div class="lbl">all-time profit &middot; ${counts.sold} sold</div></div>
    </div>

    ${alerts.length ? `
      <div class="card">
        <h2>${icon("clock")} When you have a minute</h2>
        ${attentionRowsHtml(alerts, 3)}
        ${alerts.length > 3 ? `<div class="spacer"></div><button class="btn secondary small" id="moreAlerts">See all ${alerts.length} in Insights</button>` : ""}
      </div>` : ""}

    <div class="card">
      <h2>${icon("check")} Today's selling routine <span class="small muted" style="font-weight:600;margin-left:auto">${routineDone}/${ROUTINE.length}</span></h2>
      ${ROUTINE.map((t, idx) => `
        <div class="routine-row ${routine[idx] ? "done" : ""}" data-idx="${idx}">
          <span class="routine-check">${icon("check")}</span>
          <span class="routine-text">${escapeHtml(t)}</span>
        </div>`).join("")}
    </div>

    ${active.length === 0 ? `
      <div class="empty">
        <div class="big">${icon("box")}</div>
        <p>Welcome! Tap <strong>Add</strong> to save your first item, or import your spreadsheet from Settings.</p>
      </div>` : `
      <div class="section-title">Recently updated</div>
      ${active.slice(0, 4).map(itemRowHtml).join("")}
      <button class="btn secondary" id="goInventory">See all items</button>`}

    <div class="spacer"></div>
    <button class="btn secondary" id="goGuide">${icon("info")} How this works</button>
  `;

  view.querySelector("#nextAction").onclick = () => go(next.hash);
  view.querySelector("#goGuide").onclick = () => go("#/guide");
  const gi = view.querySelector("#goInventory");
  if (gi) gi.onclick = () => go("#/inventory");
  const ma = view.querySelector("#moreAlerts");
  if (ma) ma.onclick = () => go("#/insights");
  wireAttentionRows();
  wireItemRows();

  view.querySelectorAll(".routine-row").forEach((row) => {
    row.onclick = async () => {
      const idx = Number(row.dataset.idx);
      const state = await getRoutineState();
      state[idx] = !state[idx];
      await db.setSetting("routineDate", todayStr());
      await db.setSetting("routineDone", state);
      row.classList.toggle("done", state[idx]);
      const done = state.filter(Boolean).length;
      const counter = view.querySelector(".card h2 .small");
      if (counter) counter.textContent = `${done}/${ROUTINE.length}`;
      if (done === ROUTINE.length) toast("Routine done — nice work! 🎉");
    };
  });
}

async function getRoutineState() {
  const s = await db.getSettings();
  if (s.routineDate !== todayStr() || !Array.isArray(s.routineDone)) return ROUTINE.map(() => false);
  return ROUTINE.map((_, i) => !!s.routineDone[i]);
}

// ---- Inventory list ----
let invFilter = "all";
let invSearch = "";

async function renderInventory() {
  const items = await db.getAllItems();

  view.innerHTML = `
    <label class="field">
      <input type="search" id="invSearch" placeholder="Search title, brand, store…" value="${escapeHtml(invSearch)}" />
    </label>
    <div class="filter-row" id="filters">
      ${["all", ...STATUSES].map((s) => `
        <button class="chip ${invFilter === s ? "active" : ""}" data-filter="${s}">
          ${s === "all" ? "All" : STATUS_LABEL[s]}
        </button>`).join("")}
    </div>
    <div class="small muted" id="invSummary" style="margin:0 4px 10px"></div>
    <div id="invList"></div>
  `;

  view.querySelector("#filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    invFilter = chip.dataset.filter;
    drawList(items);
    view.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === invFilter));
  });

  const search = view.querySelector("#invSearch");
  search.addEventListener("input", () => {
    invSearch = search.value;
    drawList(items);
  });

  drawList(items);
}

function drawList(items) {
  const q = invSearch.trim().toLowerCase();
  let filtered = items;
  if (invFilter !== "all") filtered = filtered.filter((i) => i.status === invFilter);
  if (q) {
    filtered = filtered.filter((i) =>
      [i.title, i.brand, i.store, i.notes, i.category].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }

  const summary = document.getElementById("invSummary");
  if (summary) {
    if (invFilter === "sold") {
      const profit = filtered.reduce((s, i) => s + (itemProfit(i) || 0), 0);
      summary.innerHTML = `${filtered.length} sold &middot; <strong class="${profit >= 0 ? "profit-pos" : "profit-neg"}">${money(profit)}</strong> profit`;
    } else {
      const cost = filtered.reduce((s, i) => s + (Number(i.cost) || 0), 0);
      summary.innerHTML = `${filtered.length} item${filtered.length === 1 ? "" : "s"}${cost ? ` &middot; ${money(cost)} invested` : ""}`;
    }
  }

  const el = document.getElementById("invList");
  if (!filtered.length) {
    el.innerHTML = `<div class="empty"><div class="big">${icon("box")}</div><p>No items here yet.</p></div>`;
    return;
  }
  el.innerHTML = filtered.map(itemRowHtml).join("");
  wireItemRows();
}

function itemAgeFlag(i) {
  if (i.status === "listed") {
    const d = daysSince(i.dateListed || i.dateSourced || i.createdAt);
    if (d != null && d >= AGE_STALE) return `<span class="age-flag">${icon("clock")}${d}d</span>`;
  } else if (i.status === "sourced" || i.status === "candidate") {
    const d = daysSince(i.dateSourced || i.createdAt);
    if (d != null && d >= AGE_LIST_IT) return `<span class="age-flag">${icon("clock")}${d}d</span>`;
  }
  return "";
}

function itemRowHtml(i) {
  const thumb = i.photos && i.photos[0]
    ? `<img class="item-thumb" src="${i.photos[0]}" alt="" loading="lazy" />`
    : `<div class="item-thumb">${icon("camera")}</div>`;
  const profit = itemProfit(i);
  let right = "";
  if (i.status === "sold") {
    const cls = profit >= 0 ? "profit-pos" : "profit-neg";
    right = `<div class="price ${cls}">${profit >= 0 ? "+" : ""}${money(profit)}</div><div class="small muted">profit</div>`;
  } else if (i.listPrice) {
    right = `<div class="price">${money(i.listPrice)}</div><div class="small muted">list</div>`;
  } else if (i.cost) {
    right = `<div class="price muted">${money(i.cost)}</div><div class="small muted">cost</div>`;
  }
  const meta = [i.brand, i.category, i.size].filter(Boolean).join(" · ");
  return `
    <div class="item-row" data-id="${i.id}">
      ${thumb}
      <div class="item-main">
        <div class="item-title">${escapeHtml(i.title || "Untitled item")}</div>
        <div class="item-meta">${escapeHtml(meta) || "&nbsp;"}</div>
        <span class="pill ${i.status}">${STATUS_LABEL[i.status] || i.status}</span> ${itemAgeFlag(i)}
      </div>
      <div class="item-right">${right}</div>
    </div>`;
}

function wireItemRows() {
  view.querySelectorAll(".item-row").forEach((row) => {
    row.onclick = () => go("#/item/" + row.dataset.id);
  });
}

// ---- Item detail ----
async function renderItemDetail(id) {
  const i = await db.getItem(id);
  if (!i) { view.innerHTML = `<div class="empty">Item not found.</div>`; return; }
  const profit = itemProfit(i);

  // Quick next-step action for the item's current stage.
  let quickAction = "";
  if (i.status === "candidate") {
    quickAction = `<button class="btn" id="qaBought">${icon("check")} I bought it</button><div class="spacer"></div>`;
  } else if (i.status === "sourced") {
    quickAction = `<button class="btn" id="qaListed">${icon("tag")} Mark as listed</button><div class="spacer"></div>`;
  } else if (i.status === "listed") {
    quickAction = `<button class="btn" id="qaSold">${icon("dollar")} It sold!</button><div class="spacer"></div>`;
  }

  const held = i.status === "listed" ? daysSince(i.dateListed || i.dateSourced || i.createdAt) : null;

  view.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">${escapeHtml(i.title || "Untitled item")}</h2>
        <span class="pill ${i.status}">${STATUS_LABEL[i.status] || i.status}</span>
      </div>
      ${held != null ? `<div class="small muted" style="margin-top:4px">Listed ${held} day${held === 1 ? "" : "s"} ago${held >= AGE_STALE ? " — time to send offers or reprice" : ""}</div>` : ""}
      ${i.photos && i.photos.length ? `<div class="photo-strip">${i.photos.map((p) => `<div class="photo-thumb"><img src="${p}"/></div>`).join("")}</div>` : ""}
      <div class="spacer"></div>
      ${detailRow("Brand", i.brand)}
      ${detailRow("Category", i.category)}
      ${detailRow("Size", i.size)}
      ${detailRow("Condition", i.condition)}
      ${detailRow("Sourced from", i.store)}
      ${detailRow("Cost", i.cost != null && i.cost !== "" ? money(i.cost) : "")}
      ${detailRow("Listed on", i.platform)}
      ${detailRow("List price", i.listPrice != null && i.listPrice !== "" ? money(i.listPrice) : "")}
      ${i.status === "sold" ? detailRow("Sold for", money(i.soldPrice)) : ""}
      ${i.status === "sold" ? detailRow("Fees + shipping", money((Number(i.fees) || 0) + (Number(i.shipping) || 0))) : ""}
      ${profit != null ? `<div class="row-between" style="margin-top:8px;border-top:1px solid var(--line);padding-top:10px"><strong>Profit</strong><strong class="${profit >= 0 ? "profit-pos" : "profit-neg"}">${money(profit)}</strong></div>` : ""}
      ${i.upc ? detailRow("Barcode", i.upc) : ""}
      ${i.notes ? `<div class="section-title">Notes</div><div>${escapeHtml(i.notes)}</div>` : ""}
    </div>
    ${quickAction}
    ${i.status !== "sold" ? platformsNote(recommendPlatforms({ category: i.category, brand: i.brand, title: i.title, value: Number(i.listPrice) || Number(i.soldPrice) || 0 })) : ""}
    ${i.status !== "sold" ? `<div class="spacer"></div><button class="btn secondary" id="genListing">${icon("sparkle")} Generate eBay listing</button><div id="listingOut"></div><div class="spacer"></div>` : ""}
    <button class="btn secondary" id="editBtn">${icon("edit")} Edit details</button>
    <div class="spacer"></div>
    <button class="btn ghost-danger" id="delBtn">${icon("trash")} Delete</button>
  `;

  view.querySelector("#editBtn").onclick = () => go("#/edit/" + id);

  const qaBought = view.querySelector("#qaBought");
  if (qaBought) qaBought.onclick = async () => {
    const updated = { ...i, status: "sourced", dateSourced: i.dateSourced || todayStr() };
    await db.saveItem(updated);
    sync.onLocalChange("upsert", updated).catch(() => {});
    toast("Moved to Bought");
    renderItemDetail(id);
  };
  const qaListed = view.querySelector("#qaListed");
  if (qaListed) qaListed.onclick = () => go("#/edit/" + id + "/listed");
  const qaSold = view.querySelector("#qaSold");
  if (qaSold) qaSold.onclick = () => go("#/edit/" + id + "/sold");

  const gen = view.querySelector("#genListing");
  if (gen) gen.onclick = async () => {
    const out = view.querySelector("#listingOut");
    if (!api.backendAvailable()) {
      out.innerHTML = `<div class="note-box">Listing writer needs the app hosted online (it uses the AI key). It's live on your deployed app.</div>`;
      return;
    }
    gen.disabled = true;
    out.innerHTML = `<div class="note-box">${icon("sparkle")} Writing an optimized listing…</div>`;
    try {
      let comps = null;
      const q = [i.brand, i.title].filter(Boolean).join(" ") || i.title;
      if (q) { try { comps = await api.ebayComps({ q }); } catch (_) {} }
      const image = (i.photos && i.photos[0]) || "";
      const L = await api.generateListing(
        { title: i.title, brand: i.brand, category: i.category, size: i.size, condition: i.condition, notes: i.notes, cost: i.cost },
        comps, image
      );
      if (L.error) { out.innerHTML = `<div class="note-box">${icon("alert")} ${escapeHtml(L.error)}</div>`; gen.disabled = false; return; }
      out.innerHTML = renderListing(L);
      wireListing(L, i);
    } catch (err) {
      out.innerHTML = `<div class="note-box">${icon("alert")} ${escapeHtml(String(err.message || err))}</div>`;
    }
    gen.disabled = false;
  };

  view.querySelector("#delBtn").onclick = async () => {
    const ok = await confirmModal({
      title: "Delete this item?",
      message: "This removes it on every synced phone and can't be undone.",
    });
    if (ok) {
      await db.deleteItem(id);
      sync.onLocalChange("delete", id).catch(() => {});
      toast("Item deleted");
      go("#/inventory");
    }
  };
}

function detailRow(label, value) {
  if (value == null || value === "") return "";
  return `<div class="detail-row"><span class="dl">${label}</span><span class="dv">${escapeHtml(value)}</span></div>`;
}

// ---- Add / Edit form ----
async function renderForm(id, opts = {}) {
  const editing = !!id;
  const i = editing ? await db.getItem(id) : {
    status: "sourced",
    platform: settings.defaultPlatform,
    dateSourced: todayStr(),
    photos: [],
  };
  if (!i) { view.innerHTML = `<div class="empty">Item not found.</div>`; return; }
  if (opts.preset && STATUSES.includes(opts.preset)) i.status = opts.preset;
  formPhotos = [...(i.photos || [])];

  view.innerHTML = `
    <h2 style="margin-top:0">${editing ? "Edit item" : "Add an item"}</h2>

    <div class="card">
      <label class="field">
        <span class="lab">Photos</span>
        <div class="btn-row">
          <button class="btn secondary small" id="takePhoto">${icon("camera")} Camera</button>
          <button class="btn secondary small" id="pickPhoto">${icon("image")} Gallery</button>
        </div>
        <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden multiple />
        <input type="file" id="galleryInput" accept="image/*" hidden multiple />
        <div class="photo-strip" id="photoStrip"></div>
      </label>
    </div>

    <label class="field"><span class="lab">Title *</span>
      <input id="f-title" placeholder="e.g. Levi's 501 jeans, men's 34x32" value="${escapeHtml(i.title)}" /></label>

    <div class="grid-2">
      <label class="field"><span class="lab">Brand</span><input id="f-brand" value="${escapeHtml(i.brand)}" /></label>
      <label class="field"><span class="lab">Size</span><input id="f-size" value="${escapeHtml(i.size)}" /></label>
    </div>

    <div class="grid-2">
      <label class="field"><span class="lab">Category</span>
        <select id="f-category">${optList(CATEGORIES, i.category)}</select></label>
      <label class="field"><span class="lab">Condition</span>
        <select id="f-condition">${optList(CONDITIONS, i.condition)}</select></label>
    </div>

    <div class="grid-2">
      <label class="field"><span class="lab">Cost (what you paid)</span>
        <input id="f-cost" type="number" inputmode="decimal" step="0.01" value="${num(i.cost)}" /></label>
      <label class="field"><span class="lab">Sourced from</span>
        <input id="f-store" placeholder="Goodwill on Main" value="${escapeHtml(i.store)}" /></label>
    </div>

    <label class="field"><span class="lab">Status</span>
      <select id="f-status">${STATUSES.map((s) => `<option value="${s}" ${i.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></label>

    <div id="listFields">
      <div class="grid-2">
        <label class="field"><span class="lab">Platform</span>
          <select id="f-platform">${optList(PLATFORMS, i.platform)}</select></label>
        <label class="field"><span class="lab">List price</span>
          <input id="f-listPrice" type="number" inputmode="decimal" step="0.01" value="${num(i.listPrice)}" /></label>
      </div>
    </div>

    <div id="soldFields">
      <div class="grid-2">
        <label class="field"><span class="lab">Sold for</span>
          <input id="f-soldPrice" type="number" inputmode="decimal" step="0.01" value="${num(i.soldPrice)}" /></label>
        <label class="field"><span class="lab">Date sold</span>
          <input id="f-dateSold" type="date" value="${i.dateSold || ""}" /></label>
      </div>
      <div class="grid-2">
        <label class="field"><span class="lab">Selling fees</span>
          <input id="f-fees" type="number" inputmode="decimal" step="0.01" value="${num(i.fees)}" /></label>
        <label class="field"><span class="lab">Shipping cost</span>
          <input id="f-shipping" type="number" inputmode="decimal" step="0.01" value="${num(i.shipping)}" /></label>
      </div>
    </div>

    <label class="field"><span class="lab">Barcode / UPC</span>
      <div class="btn-row">
        <input id="f-upc" value="${escapeHtml(i.upc)}" placeholder="optional" />
        <button class="btn secondary small" id="scanBtn" style="white-space:nowrap">${icon("scan")} Scan</button>
      </div></label>

    <label class="field"><span class="lab">Notes</span>
      <textarea id="f-notes" placeholder="Flaws, measurements, keywords…">${escapeHtml(i.notes)}</textarea></label>

    <button class="btn" id="saveBtn">${icon("check")} Save item</button>
    <div class="spacer"></div>
    <button class="btn secondary" id="cancelBtn">Cancel</button>
    <div class="spacer"></div>
  `;

  drawFormPhotos();
  toggleConditionalFields(i.status);

  const cameraInput = view.querySelector("#cameraInput");
  const galleryInput = view.querySelector("#galleryInput");
  view.querySelector("#takePhoto").onclick = () => cameraInput.click();
  view.querySelector("#pickPhoto").onclick = () => galleryInput.click();
  cameraInput.onchange = (e) => addPhotos(e.target.files);
  galleryInput.onchange = (e) => addPhotos(e.target.files);

  view.querySelector("#f-status").onchange = (e) => toggleConditionalFields(e.target.value);
  view.querySelector("#scanBtn").onclick = () => openScanModal((code) => {
    view.querySelector("#f-upc").value = code;
    toast("Scanned: " + code);
  });
  view.querySelector("#cancelBtn").onclick = () => history.back();

  if (opts.preset === "sold") {
    const sp = view.querySelector("#f-soldPrice");
    setTimeout(() => sp && sp.focus(), 100);
  }

  view.querySelector("#saveBtn").onclick = async () => {
    const title = view.querySelector("#f-title").value.trim();
    if (!title) { toast("Please add a title"); return; }
    const status = view.querySelector("#f-status").value;
    const updated = {
      ...i,
      title,
      brand: view.querySelector("#f-brand").value.trim(),
      size: view.querySelector("#f-size").value.trim(),
      category: view.querySelector("#f-category").value,
      condition: view.querySelector("#f-condition").value,
      cost: numVal("#f-cost"),
      store: view.querySelector("#f-store").value.trim(),
      status,
      platform: view.querySelector("#f-platform").value,
      listPrice: numVal("#f-listPrice"),
      soldPrice: numVal("#f-soldPrice"),
      dateSold: view.querySelector("#f-dateSold").value || (status === "sold" ? todayStr() : ""),
      fees: numVal("#f-fees"),
      shipping: numVal("#f-shipping"),
      upc: view.querySelector("#f-upc").value.trim(),
      notes: view.querySelector("#f-notes").value.trim(),
      photos: formPhotos,
    };
    // Track when it first went up for sale — powers days-to-sell and stale alerts.
    if (["listed", "sold"].includes(status) && !updated.dateListed) updated.dateListed = todayStr();
    await db.saveItem(updated);
    sync.onLocalChange("upsert", updated).catch(() => {});
    toast(editing ? "Saved" : "Item added");
    go("#/item/" + updated.id);
  };
}

function toggleConditionalFields(status) {
  const showList = ["listed", "sold"].includes(status);
  const showSold = status === "sold";
  view.querySelector("#listFields").style.display = showList ? "" : "none";
  view.querySelector("#soldFields").style.display = showSold ? "" : "none";
}

async function addPhotos(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    try {
      const dataUrl = await compressImage(f);
      formPhotos.push(dataUrl);
    } catch (err) {
      toast("Couldn't read that photo — try the camera instead");
    }
  }
  drawFormPhotos();
}

function drawFormPhotos() {
  const strip = view.querySelector("#photoStrip");
  if (!strip) return;
  strip.innerHTML = formPhotos.map((p, idx) => `
    <div class="photo-thumb">
      <img src="${p}" />
      <button class="rm" data-idx="${idx}">×</button>
    </div>`).join("");
  strip.querySelectorAll(".rm").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      formPhotos.splice(Number(b.dataset.idx), 1);
      drawFormPhotos();
    };
  });
}

// ---- Sourcing helper (in-store) ----
async function renderSourcing() {
  view.innerHTML = `
    <h2 style="margin-top:0">Sourcing helper</h2>
    <p class="muted small">Quick checks while you're in the store — all of this works with no signal.</p>

    <div class="card">
      <h2>${icon("dollar")} Will it flip? Profit calculator</h2>
      <div class="grid-2">
        <label class="field"><span class="lab">Buy it for</span>
          <input id="sc-cost" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 5" /></label>
        <label class="field"><span class="lab">Sell it for</span>
          <input id="sc-sell" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 35" /></label>
      </div>
      <label class="field"><span class="lab">Platform (sets typical fees)</span>
        <select id="sc-plat">
          <option value="0.1335">eBay (~13.35%)</option>
          <option value="0.20">Poshmark (20% over $15)</option>
          <option value="0.10">Mercari (~10%)</option>
          <option value="0">Local / no fee</option>
        </select></label>
      <div class="note-box" id="sc-result">Enter a buy and sell price to see your take-home.</div>
    </div>

    <div class="card">
      <h2>${icon("search")} Is it a gem? Look it up</h2>
      <label class="field"><span class="lab">Barcode or keywords</span>
        <div class="btn-row">
          <input id="sc-upc" placeholder="scan, or type brand + item" />
          <button class="btn secondary small" id="sc-scan" style="white-space:nowrap">${icon("scan")} Scan</button>
        </div></label>
      <div class="btn-row">
        <button class="btn" id="sc-lookup">${icon("search")} Check prices</button>
        <button class="btn secondary" id="sc-photo" style="white-space:nowrap">${icon("camera")} Photo</button>
      </div>
      <input type="file" id="sc-photo-input" accept="image/*" capture="environment" hidden />
      <div id="sc-results"></div>
      <div class="spacer"></div>
      <button class="btn outline" id="sc-save">${icon("plus")} Save as "Maybe"</button>
    </div>
  `;

  const calc = () => {
    const cost = parseFloat(view.querySelector("#sc-cost").value) || 0;
    const sell = parseFloat(view.querySelector("#sc-sell").value) || 0;
    const feeRate = parseFloat(view.querySelector("#sc-plat").value) || 0;
    const box = view.querySelector("#sc-result");
    if (!sell) { box.textContent = "Enter a buy and sell price to see your take-home."; return; }
    const fees = sell * feeRate;
    const profit = sell - cost - fees;
    const margin = sell ? Math.round((profit / sell) * 100) : 0;
    const verdict = profit >= 15 && margin >= 50 ? "✅ Strong flip"
      : profit >= 8 ? "🟡 Decent — worth it if cheap/light to ship"
      : "🔴 Thin margin — be careful";
    box.innerHTML = `Take-home after ~${money(fees)} fees: <strong>${money(profit)}</strong> (${margin}% margin)<br>${verdict}`;
  };
  ["#sc-cost", "#sc-sell"].forEach((s) => view.querySelector(s).addEventListener("input", calc));
  view.querySelector("#sc-plat").addEventListener("change", calc);

  let lastLookup = null; // remember the latest result for "Save as Maybe"

  view.querySelector("#sc-scan").onclick = () => openScanModal((code) => {
    view.querySelector("#sc-upc").value = code;
    runLookup();
  });

  view.querySelector("#sc-lookup").onclick = runLookup;

  const photoInput = view.querySelector("#sc-photo-input");
  view.querySelector("#sc-photo").onclick = () => photoInput.click();
  photoInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) runPhotoLookup(file);
  };

  async function runLookup() {
    const text = view.querySelector("#sc-upc").value.trim();
    const box = view.querySelector("#sc-results");
    if (!text) { toast("Scan or type something first"); return; }
    if (!api.backendAvailable()) {
      box.innerHTML = noBackendNote();
      return;
    }
    const isBarcode = /^\d{8,14}$/.test(text);
    box.innerHTML = `<div class="note-box">${icon("search")} Checking prices…</div>`;
    try {
      const result = isBarcode
        ? await api.gemCheck({ kind: "barcode", code: text })
        : await api.gemCheck({ kind: "text", query: text });
      lastLookup = result;
      box.innerHTML = renderLookupResult(result);
    } catch (err) {
      lastLookup = null;
      box.innerHTML = lookupErrorNote(err);
    }
  }

  async function runPhotoLookup(file) {
    const box = view.querySelector("#sc-results");
    if (!api.backendAvailable()) { box.innerHTML = noBackendNote(); return; }
    box.innerHTML = `<div class="note-box">${icon("camera")} Compressing photo and appraising…</div>`;
    try {
      const dataUrl = await compressImage(file, 1024, 0.75);
      const hint = view.querySelector("#sc-upc").value.trim();
      const result = await api.gemCheck({ kind: "photo", photoDataUrl: dataUrl, query: hint });
      result._photo = dataUrl;
      lastLookup = result;
      box.innerHTML = renderLookupResult(result);
    } catch (err) {
      lastLookup = null;
      box.innerHTML = lookupErrorNote(err);
    }
  }

  view.querySelector("#sc-save").onclick = async () => {
    const text = view.querySelector("#sc-upc").value.trim();
    const cost = parseFloat(view.querySelector("#sc-cost").value) || null;
    const ai = lastLookup && lastLookup.ai;
    const comps = lastLookup && lastLookup.comps;
    const product = lastLookup && lastLookup.product;
    const item = {
      title: (ai && ai.suggestedTitle) || (product && product.title) || text || "Maybe item — add details",
      brand: (ai && ai.brand) || (product && product.brand) || "",
      category: (ai && ai.category) || "",
      status: "candidate",
      upc: /^\d{8,14}$/.test(text) ? text : "",
      cost,
      listPrice: comps && comps.median ? Math.round(comps.median) : (ai ? Math.round((ai.estLow + ai.estHigh) / 2) : null),
      dateSourced: todayStr(),
      notes: ai ? `AI est ${money(ai.estLow)}–${money(ai.estHigh)} (${ai.confidence}). ${ai.notes || ""}` : "",
      photos: lastLookup && lastLookup._photo ? [lastLookup._photo] : [],
    };
    const saved = await db.saveItem(item);
    sync.onLocalChange("upsert", saved).catch(() => {});
    toast('Saved to "Maybe" list');
    go("#/edit/" + saved.id);
  };
}

function noBackendNote() {
  return `<div class="note-box">${icon("cloudOff")} Price lookups need the app to be hosted online (not opened as a local file).
    Once it's deployed with your eBay + AI keys, this will pull live prices. For now, save it as a "Maybe."</div>`;
}

function lookupErrorNote(err) {
  const msg = String(err && err.message || err);
  const keyHint = /not configured|401|403/.test(msg)
    ? "<br>Looks like the eBay/AI keys aren't set up yet — see SETUP.md."
    : "<br>You may be offline or have weak signal. Save it as a \"Maybe\" and try at the car.";
  return `<div class="note-box">${icon("alert")} Couldn't get prices. <span class="muted small">${escapeHtml(msg)}</span>${keyHint}</div>`;
}

function renderLookupResult(result) {
  const parts = [];
  const ai = result.ai;
  const comps = result.comps;
  const product = result.product;

  if (product && product.found) {
    parts.push(`<div class="row-between"><strong>${escapeHtml(product.title || product.brand)}</strong></div>`);
  }
  if (ai) {
    parts.push(`
      <div class="card" style="margin:8px 0;box-shadow:none">
        <div><strong>${escapeHtml(ai.itemName || "Item")}</strong> ${ai.brand ? "· " + escapeHtml(ai.brand) : ""}</div>
        <div class="price profit-pos">AI estimate: ${money(ai.estLow)} – ${money(ai.estHigh)}</div>
        <div class="small muted">confidence: ${escapeHtml(ai.confidence)}${ai.notes ? " · " + escapeHtml(ai.notes) : ""}</div>
      </div>`);
  }
  if (comps && comps.count) {
    parts.push(`
      <div class="card" style="margin:8px 0;box-shadow:none">
        <div><strong>eBay active listings</strong> <span class="small muted">(${comps.count} found — asking prices)</span></div>
        <div class="price">${money(comps.low)} &nbsp;·&nbsp; <span class="profit-pos">${money(comps.median)} typical</span> &nbsp;·&nbsp; ${money(comps.high)}</div>
        <div class="small muted">Asking ≠ sold. Confirm with the eBay app's "Sold" filter.</div>
      </div>`);
  } else if (comps) {
    parts.push(`<div class="small muted">No active eBay matches found.</div>`);
  }

  // Verdict against the cost typed in the calculator, if any.
  const cost = parseFloat(view.querySelector("#sc-cost").value) || 0;
  const target = (comps && comps.median) || (ai ? (ai.estLow + ai.estHigh) / 2 : 0);
  if (target) {
    const net = target * (1 - 0.1335) - cost; // eBay fee assumption
    const verdict = net >= 15 ? "✅ Looks like a flip" : net >= 8 ? "🟡 Marginal" : "🔴 Probably skip";
    parts.push(`<div class="note-box">If it sells around ${money(target)}, take-home after eBay fees${cost ? " and your " + money(cost) + " cost" : ""}: <strong>${money(net)}</strong><br>${verdict}</div>`);
  }
  if (result.cached) parts.push(`<div class="small muted center">(cached result)</div>`);

  // Where to sell it
  const rec = recommendPlatforms({
    category: ai && ai.category,
    brand: (ai && ai.brand) || (product && product.brand),
    title: (ai && (ai.itemName || ai.suggestedTitle)) || (product && product.title) || view.querySelector("#sc-upc").value,
    value: target,
  });
  parts.push(platformsNote(rec));
  return parts.join("");
}

// ---- Generated eBay listing UI ----
function renderListing(L) {
  const specifics = (L.itemSpecifics || []).map((s) =>
    `<div class="detail-row"><span class="dl">${escapeHtml(s.name)}</span><span class="dv">${escapeHtml(s.value)}</span></div>`).join("");
  return `
    <div class="card" style="margin-top:10px">
      <div class="section-title" style="margin-top:0">Optimized title (${(L.title || "").length}/80)</div>
      <input id="lst-title" value="${escapeHtml(L.title)}" readonly />
      <div class="spacer"></div>
      <button class="btn secondary small" id="cp-title">${icon("copy")} Copy title</button>

      <div class="section-title">Suggested price</div>
      <div class="price profit-pos">${money(L.suggestedPrice)}</div>

      <div class="section-title">Item specifics</div>
      ${specifics || '<div class="small muted">—</div>'}

      <div class="section-title">Description</div>
      <textarea id="lst-desc" readonly style="min-height:150px">${escapeHtml(L.description)}</textarea>
      <div class="spacer"></div>
      <button class="btn secondary small" id="cp-desc">${icon("copy")} Copy description</button>

      ${L.categorySuggestion ? `<div class="small muted" style="margin-top:8px">Category: ${escapeHtml(L.categorySuggestion)}</div>` : ""}
      <div class="spacer"></div>
      <button class="btn" id="save-listing">${icon("check")} Save to item + set price</button>
      <div class="spacer"></div>
      <a class="btn outline" href="https://www.ebay.com/sl/sell" target="_blank" rel="noopener" style="text-decoration:none">${icon("external")} Open eBay to list</a>
      <div class="small muted center" style="margin-top:6px">Paste the title &amp; description, set Best Offer, then mark this item "Listed."</div>
    </div>`;
}

function copyToClipboard(text, label) {
  const done = () => toast(label + " copied");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => toast("Select the text and copy manually"));
  } else {
    toast("Select the text and copy manually");
  }
}

function wireListing(L, item) {
  view.querySelector("#cp-title").onclick = () => copyToClipboard(L.title, "Title");
  view.querySelector("#cp-desc").onclick = () => copyToClipboard(L.description, "Description");
  view.querySelector("#save-listing").onclick = async () => {
    const updated = {
      ...item,
      listingTitle: L.title,
      listingDescription: L.description,
      listingSpecifics: L.itemSpecifics,
      listPrice: (item.listPrice != null && item.listPrice !== "") ? item.listPrice : Math.round(L.suggestedPrice),
    };
    await db.saveItem(updated);
    sync.onLocalChange("upsert", updated).catch(() => {});
    toast("Saved to item");
    go("#/item/" + item.id);
  };
}

// ---- "Where should I list this?" suggester (no API needed) ----
function recommendPlatforms({ category, brand, title, value } = {}) {
  const text = `${brand || ""} ${title || ""}`.toLowerCase();
  const cat = (category || "").toLowerCase();
  const recs = [];
  const add = (name, why) => { if (!recs.find((r) => r.name === name)) recs.push({ name, why }); };

  const streetVintage = /(champion|carhartt|levi|adidas|nike|harley|vintage|y2k|band tee|jersey|starter|patagonia|north face|dickies|grail|streetwear)/.test(text);
  const luxury = /(coach|gucci|louis|vuitton|chanel|prada|burberry|michael kors|kate spade|dooney|fendi|versace|ysl|saint laurent|tory burch|hermes)/.test(text);

  if (cat.includes("car")) {
    add("Facebook Marketplace", "heavy/bulky — local pickup, no shipping or fees");
    add("eBay", "huge parts audience; include the part/fitment number");
  } else if (cat.includes("cloth") || cat.includes("shoe") || cat.includes("accessor")) {
    if (luxury) { add("eBay", "best for designer resale + buyer protection"); add("Poshmark", "strong designer community; send offers to likers"); }
    else if (streetVintage) { add("Depop", "Gen-Z, vintage & streetwear sell fast here"); add("Poshmark", "active fashion community + sharing"); }
    else { add("Poshmark", "everyday clothing moves well with daily sharing"); add("Mercari", "easy general resale, low fees"); }
    if (cat.includes("shoe")) add("eBay", "sneakers have deep demand on eBay");
  } else if (cat.includes("electronic")) {
    add("eBay", "best prices + buyer protection for electronics");
    add("Facebook Marketplace", "for large/local items to skip shipping");
  } else if (cat.includes("media")) {
    add("eBay", "books, games & media have steady demand");
    add("Whatnot", "cards/games do great in live auctions");
  } else if (cat.includes("vintage")) {
    add("Etsy", "true vintage (20+ yrs) is Etsy's lane");
    add("eBay", "broad vintage demand + sold-price history");
  } else if (cat.includes("home")) {
    add("Facebook Marketplace", "furniture/decor — local pickup avoids shipping");
    add("eBay", "for small, shippable decor");
  } else if (cat.includes("knick")) {
    add("eBay", "collectible/quirky items find niche buyers");
    add("Facebook Marketplace", "low-value or heavy pieces — sell local");
  } else {
    add("eBay", "widest reach and the best price reference");
  }

  if (value && value < 12 && !cat.includes("cloth") && !cat.includes("shoe")) {
    add("Facebook Marketplace", "low value — selling local avoids fees eating the profit");
  }
  return recs.slice(0, 2);
}

function platformsNote(rec) {
  if (!rec.length) return "";
  const lines = rec.map((r) => `<strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(r.why)}`).join("<br>");
  return `<div class="note-box">${icon("pin")} <strong>Best places to list:</strong><br>${lines}</div>`;
}

// ---- Barcode scan modal ----
async function manualBarcode(onCode, message) {
  const code = await promptModal({
    title: "Type the barcode",
    message: message || "No camera available here — type or paste the number.",
    placeholder: "e.g. 012345678905",
    inputMode: "numeric",
    okLabel: "Use it",
  });
  if (code) onCode(code);
}

function openScanModal(onCode) {
  if (!cameraSupported()) {
    manualBarcode(onCode);
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "scan-overlay";
  overlay.innerHTML = `
    <div class="scanner-box"><video id="scanVideo" muted playsinline></video></div>
    <p class="center" style="color:#fff;margin:0">Point at the barcode</p>
    <button class="btn secondary" id="scanCancel">Cancel</button>
  `;
  document.body.appendChild(overlay);
  const videoEl = overlay.querySelector("#scanVideo");

  let controller = { stop() {} };
  const close = () => { controller.stop(); overlay.remove(); };
  overlay.querySelector("#scanCancel").onclick = close;

  startScanner(videoEl, (code) => { close(); onCode(code); }, () => {
    close();
    manualBarcode(onCode, "Couldn't open the camera (check camera permission in your browser settings). Type the number instead.");
  }).then((c) => (controller = c));
}

// ---- Insights ----
async function renderInsights() {
  const [items, expenses] = await Promise.all([db.getAllItems(), db.getAllExpenses()]);
  const sold = items.filter((i) => i.status === "sold");
  const alerts = agingAlerts(items);

  // Monthly net series (sales profit − expenses), last 6 calendar months.
  const now = new Date();
  const series = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    series.push({ key: monthKey(d), label: monthLabel(monthKey(d)), value: 0 });
  }
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  for (const i of sold) {
    const d = parseDate(i.dateSold || i.updatedAt);
    if (!d) continue;
    const k = monthKey(d);
    if (byKey[k]) byKey[k].value += itemProfit(i) || 0;
  }
  for (const e of expenses) {
    const d = parseDate(e.date);
    if (!d) continue;
    const k = monthKey(d);
    if (byKey[k]) byKey[k].value -= expenseAmount(e);
  }

  // KPIs
  const daysToSell = sold
    .map((i) => {
      const a = parseDate(i.dateListed || i.dateSourced || i.createdAt);
      const b = parseDate(i.dateSold);
      return a && b ? Math.max(0, Math.round((b - a) / 86400000)) : null;
    })
    .filter((d) => d != null);
  const avgDays = daysToSell.length ? Math.round(daysToSell.reduce((a, b) => a + b, 0) / daysToSell.length) : null;
  const avgProfit = sold.length ? sold.reduce((s, i) => s + (itemProfit(i) || 0), 0) / sold.length : null;
  const soldCost = sold.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const soldProfit = sold.reduce((s, i) => s + (itemProfit(i) || 0), 0);
  const roi = soldCost > 0 ? Math.round((soldProfit / soldCost) * 100) : null;
  const cutoff = Date.now() - 90 * 86400000;
  const sold90 = sold.filter((i) => { const d = parseDate(i.dateSold || i.updatedAt); return d && d.getTime() >= cutoff; }).length;
  const listedNow = items.filter((i) => i.status === "listed").length;
  const sellThrough = (sold90 + listedNow) > 0 ? Math.round((sold90 / (sold90 + listedNow)) * 100) : null;

  const monthExp = monthExpenses(expenses);

  view.innerHTML = `
    <h2 style="margin-top:0">Business insights</h2>

    <div class="card">
      <h2>${icon("chart")} Net profit by month</h2>
      <div class="chart-wrap">${chartSvg(series)}</div>
      <div class="small muted">Sold-item profit minus expenses, by the month it sold.</div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="num">${avgDays != null ? avgDays + "d" : "—"}</div><div class="lbl">avg time to sell</div></div>
      <div class="stat"><div class="num good">${avgProfit != null ? money(avgProfit) : "—"}</div><div class="lbl">avg profit per sale</div></div>
      <div class="stat"><div class="num ${roi != null && roi < 100 ? "warn" : "good"}">${roi != null ? roi + "%" : "—"}</div><div class="lbl">return on what you spend</div></div>
      <div class="stat"><div class="num">${sellThrough != null ? sellThrough + "%" : "—"}</div><div class="lbl">sell-through (90 days)</div></div>
    </div>

    ${breakdownCard("What sells best", icon("tag"), groupProfit(sold, "category"))}
    ${breakdownCard("Best platforms", icon("external"), groupProfit(sold, "platform"))}
    ${breakdownCard("Best stores to source", icon("pin"), groupProfit(sold, "store"))}

    ${alerts.length ? `
      <div class="card">
        <h2>${icon("clock")} When you have a minute (${alerts.length})</h2>
        ${attentionRowsHtml(alerts, 10)}
      </div>` : ""}

    <div class="card">
      <h2>${icon("receipt")} Expenses <span class="small muted" style="font-weight:600;margin-left:auto">${money(monthExp)} this month</span></h2>
      <div class="grid-2">
        <label class="field"><span class="lab">Amount</span>
          <input id="ex-amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" /></label>
        <label class="field"><span class="lab">Category</span>
          <select id="ex-cat">${EXPENSE_CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span class="lab">Date</span>
          <input id="ex-date" type="date" value="${todayStr()}" /></label>
        <label class="field"><span class="lab">Note</span>
          <input id="ex-note" placeholder="poly mailers, gas…" /></label>
      </div>
      <button class="btn small" id="ex-add">${icon("plus")} Add expense</button>
      <div class="spacer"></div>
      <div id="ex-list">${expenseListHtml(expenses)}</div>
    </div>

    ${taxCardHtml(items, expenses)}
  `;

  wireAttentionRows();
  wireItemRows();

  view.querySelector("#ex-add").onclick = async () => {
    const amount = parseFloat(view.querySelector("#ex-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    const exp = {
      amount,
      category: view.querySelector("#ex-cat").value,
      note: view.querySelector("#ex-note").value.trim(),
      date: view.querySelector("#ex-date").value || todayStr(),
    };
    const saved = await db.saveExpense(exp);
    sync.onLocalChange("upsert", saved).catch(() => {});
    toast("Expense added");
    renderInsights();
  };

  wireExpenseList();
  wireTaxCard(items, expenses);
}

function wireExpenseList() {
  view.querySelectorAll(".rm-exp").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const ok = await confirmModal({ title: "Delete this expense?", message: "" });
      if (!ok) return;
      await db.deleteExpense(id);
      sync.onLocalChange("delete", id).catch(() => {});
      toast("Expense deleted");
      renderInsights();
    };
  });
}

function expenseListHtml(expenses) {
  if (!expenses.length) return `<div class="small muted">No expenses yet. Track mailers, gas, subscriptions — they come off your profit (and your taxes).</div>`;
  return expenses.slice(0, 8).map((e) => `
    <div class="exp-row">
      <div class="exp-main">
        <div class="exp-title">${escapeHtml(e.category || "Expense")}${e.note ? ` <span class="muted">· ${escapeHtml(e.note)}</span>` : ""}</div>
        <div class="exp-meta">${escapeHtml(e.date || "")}</div>
      </div>
      <div class="exp-amt">−${money(e.amount)}</div>
      <button class="rm-exp" data-id="${e.id}" aria-label="Delete expense">${icon("trash")}</button>
    </div>`).join("")
    + (expenses.length > 8 ? `<div class="small muted center" style="margin-top:6px">+ ${expenses.length - 8} older</div>` : "");
}

// Group sold items and return top rows for a breakdown card.
function groupProfit(sold, field) {
  const map = new Map();
  for (const i of sold) {
    const key = (i[field] || "").trim();
    if (!key) continue;
    const g = map.get(key) || { label: key, profit: 0, count: 0, cost: 0 };
    g.profit += itemProfit(i) || 0;
    g.cost += Number(i.cost) || 0;
    g.count++;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.profit - a.profit).slice(0, 5);
}

function breakdownCard(title, iconHtml, rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.profit), 1);
  return `
    <div class="card">
      <h2>${iconHtml} ${escapeHtml(title)}</h2>
      ${rows.map((r) => `
        <div class="break-row">
          <div class="break-lbl">${escapeHtml(r.label)}<div class="break-sub">${r.count} sold</div></div>
          <div class="break-bar"><div class="break-fill" style="width:${Math.max(3, Math.round((Math.max(r.profit, 0) / max) * 100))}%"></div></div>
          <div class="break-val ${r.profit >= 0 ? "" : "profit-neg"}">${money(r.profit)}</div>
        </div>`).join("")}
    </div>`;
}

// Single-series monthly bar chart (inline SVG, theme-aware via CSS classes).
function chartSvg(series) {
  const W = 340, H = 168, padL = 8, padR = 8, top = 26, bottom = 22;
  const plotH = H - top - bottom;
  const vals = series.map((s) => s.value);
  let max = Math.max(0, ...vals);
  let min = Math.min(0, ...vals);
  if (max === 0 && min === 0) max = 1;
  const range = max - min;
  const y = (v) => top + ((max - v) / range) * plotH;
  const y0 = y(0);
  const slot = (W - padL - padR) / series.length;
  const barW = Math.min(34, Math.round(slot * 0.55));
  const lastIdx = series.length - 1;

  const bars = series.map((s, idx) => {
    const x = padL + slot * idx + (slot - barW) / 2;
    let h = Math.abs(y(s.value) - y0);
    if (s.value !== 0 && h < 2) h = 2;
    const ry = s.value >= 0 ? y0 - h : y0;
    const cls = s.value >= 0 ? "bar-pos" : "bar-neg";
    // Negative bars hang below the baseline, so their value label sits just
    // above the baseline where the slot is guaranteed to be empty.
    const labelY = s.value >= 0 ? ry - 6 : y0 - 6;
    const cx = x + barW / 2;
    const showVal = s.value !== 0 || idx === lastIdx;
    return `
      <g>
        <title>${s.label}: ${money(s.value)}</title>
        ${h > 0 ? `<rect class="${cls}" x="${x.toFixed(1)}" y="${ry.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="4"/>` : ""}
        ${showVal ? `<text class="v-lbl ${idx === lastIdx ? "now" : ""}" x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${moneyShort(s.value)}</text>` : ""}
        <text class="m-lbl" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${s.label}</text>
      </g>`;
  }).join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net profit by month">
    <line class="axis" x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}"/>
    ${bars}
  </svg>`;
}

// ---- Tax summary ----
function taxTotalsForYear(items, expenses, year) {
  const sold = items.filter((i) => {
    if (i.status !== "sold") return false;
    const d = parseDate(i.dateSold || i.updatedAt);
    return d && d.getFullYear() === year;
  });
  const exps = expenses.filter((e) => { const d = parseDate(e.date); return d && d.getFullYear() === year; });
  const gross = sold.reduce((s, i) => s + (Number(i.soldPrice) || 0), 0);
  const cogs = sold.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const fees = sold.reduce((s, i) => s + (Number(i.fees) || 0), 0);
  const shipping = sold.reduce((s, i) => s + (Number(i.shipping) || 0), 0);
  const other = exps.reduce((s, e) => s + expenseAmount(e), 0);
  return { sold, exps, gross, cogs, fees, shipping, other, net: gross - cogs - fees - shipping - other };
}

function taxYears(items, expenses) {
  const years = new Set([new Date().getFullYear()]);
  for (const i of items) { const d = parseDate(i.dateSold); if (d && i.status === "sold") years.add(d.getFullYear()); }
  for (const e of expenses) { const d = parseDate(e.date); if (d) years.add(d.getFullYear()); }
  return [...years].sort((a, b) => b - a);
}

function taxCardHtml(items, expenses) {
  const years = taxYears(items, expenses);
  const year = years[0];
  return `
    <div class="card" id="taxCard">
      <h2>${icon("calendar")} Tax-time summary
        <select id="tax-year" style="width:auto;margin-left:auto;padding:6px 10px;font-size:14px">${years.map((y) => `<option>${y}</option>`).join("")}</select>
      </h2>
      <div id="tax-body">${taxBodyHtml(taxTotalsForYear(items, expenses, year))}</div>
      <div class="spacer"></div>
      <button class="btn secondary small" id="tax-export">${icon("download")} Export tax spreadsheet (.csv)</button>
      <div class="small muted" style="margin-top:6px">Everything an accountant asks for: gross sales, cost of goods, fees, shipping, and other expenses.</div>
    </div>`;
}

function taxBodyHtml(t) {
  return `
    <div class="tax-row"><span>Gross sales (${t.sold.length} items)</span><span class="tv">${money(t.gross)}</span></div>
    <div class="tax-row"><span>Cost of goods sold</span><span class="tv">−${money(t.cogs)}</span></div>
    <div class="tax-row"><span>Platform fees</span><span class="tv">−${money(t.fees)}</span></div>
    <div class="tax-row"><span>Shipping</span><span class="tv">−${money(t.shipping)}</span></div>
    <div class="tax-row"><span>Other expenses (${t.exps.length})</span><span class="tv">−${money(t.other)}</span></div>
    <div class="tax-row total"><span>Net profit</span><span class="tv ${t.net >= 0 ? "profit-pos" : "profit-neg"}">${money(t.net)}</span></div>`;
}

function wireTaxCard(items, expenses) {
  const sel = view.querySelector("#tax-year");
  const body = view.querySelector("#tax-body");
  if (!sel) return;
  sel.onchange = () => { body.innerHTML = taxBodyHtml(taxTotalsForYear(items, expenses, Number(sel.value))); };
  view.querySelector("#tax-export").onclick = () => {
    const year = Number(sel.value);
    const t = taxTotalsForYear(items, expenses, year);
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = [["type", "date", "title/category", "note/platform", "sold for", "cost", "fees", "shipping", "expense", "net"].join(",")];
    for (const i of t.sold) {
      rows.push([
        "sale", i.dateSold || "", i.title || "", i.platform || "",
        Number(i.soldPrice) || 0, Number(i.cost) || 0, Number(i.fees) || 0, Number(i.shipping) || 0, "",
        (itemProfit(i) || 0).toFixed(2),
      ].map(esc).join(","));
    }
    for (const e of t.exps) {
      rows.push(["expense", e.date || "", e.category || "", e.note || "", "", "", "", "", expenseAmount(e), (-expenseAmount(e)).toFixed(2)].map(esc).join(","));
    }
    rows.push(["total", year, "", "", t.gross, t.cogs, t.fees, t.shipping, t.other, t.net.toFixed(2)].map(esc).join(","));
    download(`flipping-friend-taxes-${year}.csv`, rows.join("\n"), "text/csv");
    toast("Tax spreadsheet downloaded");
  };
}

// ---- Simple guide (plain-language, works offline) ----
function renderGuide() {
  view.innerHTML = `
    <h2 style="margin-top:0">How this works</h2>
    <p class="muted">You don't have to do it all. Even five minutes keeps things moving — the app
      remembers everything so you don't have to.</p>

    <div class="card guide-card">
      <h2>${icon("camera")} When you're out</h2>
      <p class="small">Spot something good? Tap <strong>Add</strong> (the green ➕), snap a photo, and save.
        You can fill in the details later at home.</p>
      <p class="small">Not sure it's worth buying? Open <strong>Sourcing</strong> → <strong>Check prices</strong>.
        It's built to work even with bad store signal.</p>
    </div>

    <div class="card guide-card">
      <h2>${icon("bulb")} Got five minutes at home?</h2>
      <p class="small">Open the app and look at the <strong>“Do this next”</strong> card at the top.
        It tells you the one most useful thing to do right now. Just do that one thing.</p>
      <p class="small">Usually it's listing something you already bought. Tap the item →
        <strong>Generate eBay listing</strong> to have it write the title and description for you →
        copy, paste into eBay, then tap <strong>Mark as listed</strong>.</p>
    </div>

    <div class="card guide-card">
      <h2>${icon("check")} Once a day, if you can (2 min)</h2>
      <p class="small">Tap through <strong>Today's selling routine</strong> on the home screen —
        share your Poshmark closet, send a few offers. That little bit of daily activity is what
        keeps sales coming in. Missed a day? Totally fine.</p>
    </div>

    <div class="card guide-card">
      <h2>${icon("cloudCheck")} It's all backed up</h2>
      <p class="small">Everything syncs between your phone and your husband's automatically.
        You never have to remember to save, and nothing is lost if a phone dies.</p>
    </div>

    <p class="muted small center">That's the whole thing. Come back whenever you can —
      no pressure, no streaks to keep up.</p>
    <button class="btn" id="guideDone">Got it</button>
    <div class="spacer"></div>
  `;
  view.querySelector("#guideDone").onclick = () => go("#/dashboard");
}

// ---- Device pairing via setup link ----
// A configured device shares a #/pair/<code> link (project URL + anon key +
// email to prefill — never the password). Opening it configures this device;
// the user only types the password. Kills the copy-paste setup entirely.
function b64urlEncode(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return JSON.parse(atob(s));
}

async function renderPair(param) {
  try {
    const p = b64urlDecode(param);
    if (!p.u || !p.k) throw new Error("bad link");
    await sync.saveConfig(p.u, p.k);
    if (p.e) await db.setSetting("syncEmail", p.e);
    toast("Connected! Now just sign in.");
    go("#/settings");
  } catch (_) {
    view.innerHTML = `
      <div class="empty">
        <div class="big">${icon("cloudOff")}</div>
        <p>This setup link didn't work — it may have gotten cut off in the text.
           Ask for a fresh one, or set up sync by hand in Settings.</p>
      </div>
      <button class="btn secondary" onclick="location.hash='#/settings'">Open Settings</button>`;
  }
}

// ---- Settings ----
async function renderSettings() {
  settings = await db.getSettings(); // pick up values written outside this screen (e.g. pairing)
  const [items, expenses] = await Promise.all([db.getAllItems(), db.getAllExpenses()]);
  const syncCfg = await sync.isConfigured();
  const syncUser = syncCfg ? await sync.currentUser() : null;
  view.innerHTML = `
    <h2 style="margin-top:0">Settings</h2>

    <div class="card">
      <label class="field"><span class="lab">Monthly profit goal</span>
        <input id="set-goal" type="number" inputmode="decimal" value="${settings.monthlyGoal}" /></label>
      <label class="field"><span class="lab">Default selling platform</span>
        <select id="set-plat">${optList(PLATFORMS, settings.defaultPlatform)}</select></label>
      <button class="btn small" id="saveSettings">Save settings</button>
    </div>

    <div class="card">
      <h2>${icon("sparkle")} Appearance</h2>
      <p class="small muted">Saved on this device only — pick your own look.</p>
      <div class="theme-grid">
        ${THEMES.map((t) => `
          <button class="theme-opt ${(settings.theme || "standard") === t.id ? "active" : ""}" data-theme-id="${t.id}">
            <span class="swatch" style="background:${t.swatch}"></span>${escapeHtml(t.name)}
          </button>`).join("")}
      </div>
    </div>

    <div class="card">
      <h2>${icon("box")} Your data (${items.length} items, ${expenses.length} expenses)</h2>
      <p class="small muted">Everything is stored privately on this phone. Back it up regularly, and use this to move it to a new phone.</p>
      <button class="btn secondary" id="exportJson">${icon("download")} Export backup (.json)</button>
      <div class="spacer"></div>
      <button class="btn secondary" id="exportCsv">${icon("download")} Export spreadsheet (.csv)</button>
      <div class="spacer"></div>
      <button class="btn secondary" id="importBtn">${icon("upload")} Import backup / spreadsheet</button>
      <input type="file" id="importFile" accept=".json,.csv" hidden />
    </div>

    <div class="card">
      <h2>${icon("cloud")} Cloud sync (share across devices)</h2>
      ${syncCardHtml(syncCfg, syncUser)}
    </div>

    <div class="card">
      <h2>${icon("activity")} Device check-up</h2>
      <p class="small muted">If the app misbehaves on a phone, this shows why. Tap copy and text it over.</p>
      <div id="diagBody" class="small muted">Checking…</div>
      <div class="spacer"></div>
      <button class="btn secondary small" id="diagCopy">${icon("copy")} Copy report</button>
    </div>

    <div class="card">
      <h2>${icon("download")} Install</h2>
      <p class="small muted">Add Flipping Friend to the home screen so it opens like a real app and works offline. On iPhone: Share → "Add to Home Screen". On Android: menu → "Install app".</p>
      <button class="btn outline" id="installBtn" hidden>Install app</button>
    </div>

    <div class="card">
      <h2>${icon("alert")} Danger zone</h2>
      <button class="btn ghost-danger" id="clearBtn">Delete ALL items</button>
    </div>
    <div class="center small muted">Flipping Friend &middot; ${APP_VERSION}</div>
  `;

  view.querySelector("#saveSettings").onclick = async () => {
    settings.monthlyGoal = parseFloat(view.querySelector("#set-goal").value) || 800;
    settings.defaultPlatform = view.querySelector("#set-plat").value;
    await db.setSetting("monthlyGoal", settings.monthlyGoal);
    await db.setSetting("defaultPlatform", settings.defaultPlatform);
    toast("Settings saved");
  };

  view.querySelectorAll(".theme-opt").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.themeId;
      settings.theme = id;
      applyTheme(id);
      await db.setSetting("theme", id);
      view.querySelectorAll(".theme-opt").forEach((x) =>
        x.classList.toggle("active", x.dataset.themeId === id));
      toast("Theme: " + (THEMES.find((t) => t.id === id) || {}).name);
    };
  });

  view.querySelector("#exportJson").onclick = () => exportJson(items, expenses);
  view.querySelector("#exportCsv").onclick = () => exportCsv(items);
  const importFile = view.querySelector("#importFile");
  view.querySelector("#importBtn").onclick = () => importFile.click();
  importFile.onchange = (e) => importData(e.target.files[0]);

  view.querySelector("#clearBtn").onclick = async () => {
    const ok = await confirmModal({
      title: "Delete ALL items permanently?",
      message: "Export a backup first if you're not sure. This can't be undone.",
      okLabel: "Delete everything",
    });
    if (ok) {
      await db.clearItems();
      toast("All items deleted");
      render();
    }
  };

  wireSyncCard(syncCfg, syncUser);
  renderDiagnostics(items, expenses);

  // Install prompt (Android/Chrome)
  if (deferredPrompt) {
    const ib = view.querySelector("#installBtn");
    ib.hidden = false;
    ib.onclick = async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      ib.hidden = true;
    };
  }
}

// ---- Diagnostics (the "why doesn't it work on her phone" panel) ----
async function renderDiagnostics(items, expenses) {
  const body = view.querySelector("#diagBody");
  if (!body) return;
  const rows = [];
  const add = (k, v, ok) => rows.push({ k, v, ok });

  const ua = navigator.userAgent;
  const browser =
    /iPhone|iPad/.test(ua) ? "iPhone/iPad " + (/CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : "Safari")
    : /Android/.test(ua) ? "Android " + (/Firefox/.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : "Chrome")
    : "Desktop";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  add("Phone / browser", browser);
  add("Installed as app", standalone ? "yes" : "no — running in the browser", standalone);
  add("Online right now", navigator.onLine ? "yes" : "no", navigator.onLine);

  try {
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
    if (persisted != null) add("Data protected from cleanup", persisted ? "yes" : "no — browser may clear it", persisted);
  } catch (_) {}
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.usage != null) add("Storage used", (est.usage / 1048576).toFixed(1) + " MB");
  } catch (_) {}

  add("Items on this phone", String(items.length));
  add("Expenses on this phone", String(expenses.length));
  add("Camera available", cameraSupported() ? "yes" : "no", cameraSupported());
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    add("Offline mode ready", reg ? "yes" : "no", !!reg);
  } catch (_) {}

  const st = sync.getStatus();
  const stText = { off: "not set up", signedout: "set up, but signed out", ok: "working", syncing: "syncing", error: "ERROR", offline: "waiting for signal" }[st.state] || st.state;
  add("Cloud sync", stText, st.state === "ok");
  if (st.lastSyncAt) add("Last successful sync", new Date(st.lastSyncAt).toLocaleString());
  if (st.pending) add("Changes waiting to upload", String(st.pending), false);
  if (st.lastError) add("Last sync error", st.lastError, false);
  add("Phone clock", new Date().toLocaleString());
  add("App version", APP_VERSION);

  body.classList.remove("muted");
  body.innerHTML = rows.map((r) => `
    <div class="diag-row"><span class="dk">${escapeHtml(r.k)}</span>
      <span class="dv ${r.ok === true ? "ok" : r.ok === false ? "bad" : ""}">${escapeHtml(r.v)}</span></div>`).join("");

  const copyBtn = view.querySelector("#diagCopy");
  if (copyBtn) copyBtn.onclick = () =>
    copyToClipboard(rows.map((r) => `${r.k}: ${r.v}`).join("\n"), "Report");
}

// ---- Cloud sync UI ----
function syncCardHtml(configured, user) {
  if (!configured) {
    return `
      <p class="small muted">Connect a free Supabase project so you and your wife share one
        live inventory. Paste the two values from your project (see SETUP-SYNC.md).</p>
      <label class="field"><span class="lab">Project URL</span>
        <input id="sy-url" placeholder="https://xxxx.supabase.co" /></label>
      <label class="field"><span class="lab">Anon public key</span>
        <input id="sy-key" placeholder="eyJ..." /></label>
      <button class="btn" id="sy-connect">Connect</button>`;
  }
  if (!user) {
    return `
      <p class="small muted">Connected. Sign in with your household login — <strong>use the same
        email + password on every device</strong>; it's the simplest and just as safe.</p>
      <label class="field"><span class="lab">Email</span>
        <input id="sy-email" type="email" autocomplete="username" value="${escapeHtml(settings.syncEmail || "")}" /></label>
      <label class="field"><span class="lab">Password</span>
        <input id="sy-pass" type="password" autocomplete="current-password" /></label>
      <button class="btn" id="sy-signin">Sign in &amp; sync</button>
      <div class="spacer"></div>
      <button class="btn secondary small" id="sy-reset">Use a different project</button>`;
  }
  const st = sync.getStatus();
  const lastLine = st.lastSyncAt
    ? `Last synced ${new Date(st.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${st.pending ? ` · ${st.pending} waiting to upload` : ""}`
    : (st.pending ? `${st.pending} changes waiting to upload` : "Will sync automatically");
  return `
    <div class="note-box">${icon("cloudCheck")} Syncing as <strong>${escapeHtml(user.email)}</strong>. It
      syncs by itself every minute the app is open, and whenever you come back to it.</div>
    <div class="small muted" style="margin-top:8px">${escapeHtml(lastLine)}</div>
    ${st.lastError ? `<div class="small" style="color:var(--danger);margin-top:6px">Last error: ${escapeHtml(st.lastError)}</div>` : ""}
    <div class="spacer"></div>
    <button class="btn" id="sy-now">${icon("refresh")} Sync now</button>
    <div class="spacer"></div>
    <button class="btn secondary" id="sy-pair">${icon("copy")} Copy setup link for another device</button>
    <div class="small muted" style="margin:6px 2px 0">Text it to the other phone or laptop — open it there,
      type the password, done. No copy-pasting keys.</div>
    <div class="spacer"></div>
    <button class="btn secondary" id="sy-repair">${icon("refresh")} Repair sync (merge everything)</button>
    <div class="small muted" style="margin:6px 2px 0">Devices showing different items? This re-uploads and
      re-downloads everything and merges it. Safe — nothing gets deleted.</div>
    <div class="spacer"></div>
    <button class="btn secondary small" id="sy-out">Sign out</button>`;
}

function wireSyncCard(configured, user) {
  if (!configured) {
    const btn = view.querySelector("#sy-connect");
    if (btn) btn.onclick = async () => {
      const url = view.querySelector("#sy-url").value.trim();
      const key = view.querySelector("#sy-key").value.trim();
      if (!url || !key) { toast("Paste both values"); return; }
      await sync.saveConfig(url, key);
      toast("Connected — now sign in");
      renderSettings();
    };
    return;
  }
  if (!user) {
    const si = view.querySelector("#sy-signin");
    if (si) si.onclick = async () => {
      const email = view.querySelector("#sy-email").value.trim();
      const pass = view.querySelector("#sy-pass").value;
      if (!email || !pass) { toast("Enter email and password"); return; }
      si.disabled = true; si.textContent = "Signing in…";
      try {
        await sync.signIn(email, pass);
        await sync.seedOutboxFromLocal();
        const { changed } = await sync.fullSync();
        toast(`Synced — ${changed || 0} updates pulled`);
        renderSettings();
      } catch (err) {
        toast("Sign-in failed: " + (err.message || err));
        si.disabled = false; si.textContent = "Sign in & sync";
      }
    };
    const rst = view.querySelector("#sy-reset");
    if (rst) rst.onclick = async () => {
      await sync.saveConfig("", "");
      renderSettings();
    };
    return;
  }
  const pair = view.querySelector("#sy-pair");
  if (pair) pair.onclick = async () => {
    const { url, key } = await sync.getConfig();
    const s = await db.getSettings();
    const link = location.origin + location.pathname + "#/pair/" +
      b64urlEncode({ u: url, k: key, e: s.syncEmail || "" });
    copyToClipboard(link, "Setup link");
  };
  const rep = view.querySelector("#sy-repair");
  if (rep) rep.onclick = async () => {
    const ok = await confirmModal({
      title: "Repair sync?",
      message: "Re-uploads everything on this device and re-downloads everything from the cloud, then merges the two (newest edit of each item wins). Nothing gets deleted. Run it on each device.",
      okLabel: "Repair",
      danger: false,
    });
    if (!ok) return;
    rep.disabled = true; rep.textContent = "Repairing…";
    try {
      const { changed } = await sync.repairSync();
      toast(`Repair done — ${changed || 0} records merged in`);
      renderSettings();
    } catch (err) {
      toast("Repair failed: " + (err.message || err));
      rep.disabled = false; rep.innerHTML = `${icon("refresh")} Repair sync (merge everything)`;
    }
  };
  const now = view.querySelector("#sy-now");
  if (now) now.onclick = async () => {
    now.disabled = true; now.textContent = "Syncing…";
    try {
      const { changed } = await sync.fullSync();
      toast(`Synced — ${changed || 0} updates`);
      render();
    } catch (err) {
      toast("Sync error: " + (err.message || err));
      now.disabled = false; now.innerHTML = `${icon("refresh")} Sync now`;
    }
  };
  const out = view.querySelector("#sy-out");
  if (out) out.onclick = async () => {
    await sync.signOut();
    toast("Signed out");
    renderSettings();
  };
}

// ---- Header sync chip ----
const syncChip = document.getElementById("syncChip");

function updateSyncChip(st) {
  if (!syncChip) return;
  if (st.state === "off") { syncChip.hidden = true; return; }
  syncChip.hidden = false;
  let cls = "", ic = "cloud", label = "";
  if (st.state === "signedout") { cls = "pending"; ic = "cloudOff"; label = "Sign in"; }
  else if (st.state === "syncing") { cls = "syncing"; ic = "refresh"; label = "Syncing…"; }
  else if (st.state === "error") { cls = "error"; ic = "cloudAlert"; label = "Sync issue"; }
  else if (st.state === "offline") { cls = ""; ic = "cloudOff"; label = st.pending ? `${st.pending} queued` : "Offline"; }
  else if (st.pending > 0) { cls = "pending"; ic = "cloud"; label = `${st.pending} to sync`; }
  else { cls = "ok"; ic = "cloudCheck"; label = "Synced"; }
  syncChip.className = "sync-chip " + cls;
  syncChip.innerHTML = `${icon(ic)}<span>${label}</span>`;
}

if (syncChip) syncChip.onclick = async () => {
  const st = sync.getStatus();
  if (st.state === "off" || st.state === "signedout") { go("#/settings"); return; }
  try {
    const { changed } = await sync.fullSync();
    toast(changed ? `Synced — ${changed} updates` : "Everything is up to date");
    if (changed) rerenderIfSafe();
  } catch (err) {
    toast("Sync error: " + (err.message || err));
  }
};

document.getElementById("settingsBtn").onclick = () => go("#/settings");

// Re-render after background sync — but never while the user is typing in a form.
function rerenderIfSafe() {
  const { route } = parseHash();
  if (["dashboard", "inventory", "insights", "item"].includes(route)) render();
}

// ---- Import / export ----
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson(items, expenses) {
  download(`flipping-friend-backup-${todayStr()}.json`, JSON.stringify({ version: 2, items, expenses }, null, 2), "application/json");
  toast("Backup downloaded");
}

const CSV_COLS = ["title", "brand", "size", "category", "condition", "status", "store", "cost", "platform", "listPrice", "soldPrice", "dateSold", "fees", "shipping", "upc", "notes"];
function exportCsv(items) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const rows = [CSV_COLS.join(",")];
  for (const i of items) rows.push(CSV_COLS.map((c) => esc(i[c])).join(","));
  download(`flipping-friend-${todayStr()}.csv`, rows.join("\n"), "text/csv");
  toast("Spreadsheet downloaded");
}

async function importData(file) {
  if (!file) return;
  const text = await file.text();
  try {
    let items, expenses = [];
    if (file.name.endsWith(".json")) {
      const data = JSON.parse(text);
      items = Array.isArray(data) ? data : data.items;
      expenses = (data && data.expenses) || [];
    } else {
      items = parseCsv(text);
    }
    if ((!Array.isArray(items) || !items.length) && !expenses.length) { toast("No items found in file"); return; }
    items = items || [];
    for (const it of items) {
      it.id = undefined; // assign fresh ids to avoid clobbering
      if (!it.status) it.status = "sourced";
      if (!it.photos) it.photos = [];
    }
    const n = await db.bulkPutItems(items);
    for (const it of items) sync.onLocalChange("upsert", it).catch(() => {});
    let ne = 0;
    for (const ex of expenses) {
      ex.id = undefined;
      const saved = await db.saveExpense(ex);
      sync.onLocalChange("upsert", saved).catch(() => {});
      ne++;
    }
    toast(`Imported ${n} items${ne ? ` + ${ne} expenses` : ""}`);
    render();
  } catch (err) {
    toast("Could not read that file");
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj = {};
    header.forEach((h, idx) => { obj[h] = cells[idx] != null ? cells[idx] : ""; });
    return obj;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ---- small helpers ----
function optList(arr, selected) {
  const list = selected && !arr.includes(selected) ? [...arr, selected] : arr;
  return `<option value=""></option>` + list.map((o) => `<option value="${escapeHtml(o)}" ${o === selected ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
}
function num(v) { return v == null || v === "" ? "" : v; }
function numVal(sel) {
  const v = view.querySelector(sel).value;
  return v === "" ? null : parseFloat(v);
}

// ---- PWA install + service worker ----
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

// ---- boot ----
(async function init() {
  settings = await db.getSettings();
  applyTheme(settings.theme || "standard");
  if (!location.hash) location.hash = "#/dashboard";
  render();

  // Ask the browser to protect our data from automatic cleanup (Android especially).
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}

  // Status chip + automatic background sync (visibility, reconnect, every minute).
  sync.onStatus(updateSyncChip);
  sync.startAutoSync(() => rerenderIfSafe());
})();
