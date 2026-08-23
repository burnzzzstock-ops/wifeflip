// Talks to our small backend (serverless functions under /api) that safely hold
// the eBay + AI keys. Designed to be low-data: barcode/text lookups are tiny,
// and photo lookups send a compressed image only when asked.

import * as db from "./db.js";

// Same-origin backend when served over http(s); empty when opened as a local file.
const API_BASE =
  location.protocol.startsWith("http") ? "/api" : "";

export function backendAvailable() {
  return API_BASE !== "";
}

async function postJSON(path, body, signal) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`(${res.status}) ${text || res.statusText}`);
  }
  return res.json();
}

async function getJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`(${res.status}) ${res.statusText}`);
  return res.json();
}

// Look up active eBay asking prices by UPC or keywords.
export function ebayComps({ gtin, q }) {
  const params = new URLSearchParams();
  if (gtin) params.set("gtin", gtin);
  if (q) params.set("q", q);
  return getJSON("/ebay-comps?" + params.toString());
}

// Look up product info from a barcode (UPC/EAN).
export function upcLookup(code) {
  return getJSON("/upc?code=" + encodeURIComponent(code));
}

// AI photo valuation. dataUrl is a compressed JPEG data URL.
export function estimatePhoto(dataUrl, hint) {
  return postJSON("/estimate", { image: dataUrl, hint: hint || "" });
}

// Generate a keyword-optimized eBay listing for an item.
export function generateListing(item, comps, image) {
  return postJSON("/listing", { item, comps: comps || null, image: image || "" });
}

// High-level "is it a gem?" check. Tries cheapest signals first, caches results.
// kind: "barcode" | "text" | "photo". Returns a normalized result object.
export async function gemCheck({ kind, code, query, photoDataUrl }) {
  const cacheKey =
    kind === "barcode" ? "upc:" + code :
    kind === "text" ? "q:" + (query || "").toLowerCase().trim() :
    null; // photos aren't cached (each is unique)

  if (cacheKey) {
    const cached = await db.getCachedLookup(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const result = { kind, product: null, comps: null, ai: null };

  if (kind === "barcode") {
    try { result.product = await upcLookup(code); } catch (_) {}
    const q = result.product && result.product.title ? result.product.title : null;
    result.comps = await ebayComps(q ? { q } : { gtin: code });
  } else if (kind === "text") {
    result.comps = await ebayComps({ q: query });
  } else if (kind === "photo") {
    result.ai = await estimatePhoto(photoDataUrl, query);
    // Chain into comps using the AI's suggested search terms.
    const q = result.ai && (result.ai.suggestedTitle || result.ai.itemName);
    if (q) {
      try { result.comps = await ebayComps({ q }); } catch (_) {}
    }
  }

  if (cacheKey) await db.setCachedLookup(cacheKey, result);
  return result;
}
