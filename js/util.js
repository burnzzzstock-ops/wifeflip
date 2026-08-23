// Small shared helpers.

export function money(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "−$" : "$") + abs;
}

export function moneyShort(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "−$" : "$";
  if (Math.abs(v) >= 1000) return sign + (Math.abs(v) / 1000).toFixed(1) + "k";
  return sign + Math.abs(v).toFixed(0);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Compress an image File/Blob to a small JPEG data URL.
// Default ~1000px longest edge keeps photos sharp but tiny — the same trick
// that makes any future AI lookup cheap on cell data.
// Tries createImageBitmap first (handles more formats, incl. some HEIC paths),
// then falls back to <img> decoding.
export async function compressImage(file, maxEdge = 1000, quality = 0.7) {
  const draw = (source, width, height) => {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(source, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };

  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const out = draw(bmp, bmp.width, bmp.height);
      bmp.close && bmp.close();
      return out;
    } catch (_) { /* fall through to <img> path */ }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try { resolve(draw(img, img.naturalWidth, img.naturalHeight)); }
      catch (err) { reject(err); }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo format couldn't be read on this phone."));
    };
    img.src = url;
  });
}

// Rough size of a data URL in KB (for showing the user how lean photos are).
export function dataUrlKB(dataUrl) {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4 / 1024);
}

let _toastTimer = null;
export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// Profit for a sold item; null if not enough info.
export function itemProfit(item) {
  if (item.status !== "sold" || item.soldPrice == null) return null;
  const revenue = Number(item.soldPrice) || 0;
  const cost = Number(item.cost) || 0;
  const fees = Number(item.fees) || 0;
  const shipping = Number(item.shipping) || 0;
  return revenue - cost - fees - shipping;
}

// Is a date (ms or yyyy-mm-dd) within the current calendar month?
export function isThisMonth(dateVal) {
  if (!dateVal) return false;
  const d = typeof dateVal === "number" ? new Date(dateVal) : new Date(dateVal + "T00:00:00");
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// Parse a date value that may be ms-since-epoch or "yyyy-mm-dd". null if absent/invalid.
export function parseDate(dateVal) {
  if (!dateVal) return null;
  const d = typeof dateVal === "number" ? new Date(dateVal) : new Date(dateVal + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

// "2026-07" style key for grouping by calendar month.
export function monthKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

// Whole days from a date (ms or yyyy-mm-dd) to now. null if no date.
export function daysSince(dateVal) {
  const d = parseDate(dateVal);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// ---- In-app modal dialogs (replaces prompt()/confirm(), which are unreliable
// in installed PWAs and look terrible). Both return promises. ----
function buildModal(inner) {
  const wrap = document.createElement("div");
  wrap.className = "modal-overlay";
  wrap.innerHTML = `<div class="modal-card">${inner}</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

export function promptModal({ title, message = "", placeholder = "", value = "", okLabel = "OK", inputMode = "text" }) {
  return new Promise((resolve) => {
    const wrap = buildModal(`
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p class="small muted" style="margin:6px 0 0">${escapeHtml(message)}</p>` : ""}
      <input class="modal-input" inputmode="${inputMode}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
      <div class="modal-actions">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn" data-act="ok">${escapeHtml(okLabel)}</button>
      </div>`);
    const input = wrap.querySelector(".modal-input");
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-act="cancel"]').onclick = () => done(null);
    wrap.querySelector('[data-act="ok"]').onclick = () => done(input.value.trim() || null);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value.trim() || null); });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    setTimeout(() => input.focus(), 50);
  });
}

export function confirmModal({ title, message = "", okLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const wrap = buildModal(`
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p class="small muted" style="margin:6px 0 0">${escapeHtml(message)}</p>` : ""}
      <div class="modal-actions">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? "danger" : ""}" data-act="ok">${escapeHtml(okLabel)}</button>
      </div>`);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-act="cancel"]').onclick = () => done(false);
    wrap.querySelector('[data-act="ok"]').onclick = () => done(true);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
  });
}
