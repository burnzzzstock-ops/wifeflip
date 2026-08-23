// Serverless function: look up eBay ACTIVE listing prices by UPC or keywords.
// Uses the free, self-serve Browse API. Returns a compact price summary
// (low / median / high) so the phone downloads only a few KB.
//
// NOTE: eBay's official *sold* price data is gated (Marketplace Insights API,
// whitelist-only). Browse gives current ASKING prices — a strong signal, but
// remember asking != sold. Pair with the eBay app's free "Sold" filter for the
// gold check. See docs/research.md.
//
// Requires env vars: EBAY_APP_ID, EBAY_CERT_ID (from a free eBay developer keyset).

let cachedToken = null;
let cachedTokenExp = 0;

async function getAppToken() {
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) {
    throw new Error("eBay keys not configured (set EBAY_APP_ID and EBAY_CERT_ID).");
  }
  if (cachedToken && Date.now() < cachedTokenExp - 60000) return cachedToken;

  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`eBay auth failed (${res.status}). ${t}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExp = Date.now() + (data.expires_in || 7200) * 1000;
  return cachedToken;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function handler(req, res) {
  try {
    const { gtin, q } = req.query || {};
    if (!gtin && !q) {
      res.status(400).json({ error: "Provide gtin or q." });
      return;
    }

    const token = await getAppToken();
    const params = new URLSearchParams();
    if (gtin) params.set("gtin", String(gtin));
    if (q) params.set("q", String(q));
    params.set("limit", "30");
    params.set("filter", "buyingOptions:{FIXED_PRICE}");

    const url = "https://api.ebay.com/buy/browse/v1/item_summary/search?" + params.toString();
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      res.status(502).json({ error: `eBay search failed (${r.status})`, detail: t.slice(0, 300) });
      return;
    }
    const data = await r.json();
    const items = data.itemSummaries || [];
    const prices = items
      .map((it) => parseFloat(it.price && it.price.value))
      .filter((n) => !isNaN(n) && n > 0);

    const samples = items.slice(0, 5).map((it) => ({
      title: it.title,
      price: it.price ? parseFloat(it.price.value) : null,
      url: it.itemWebUrl,
    }));

    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({
      source: "ebay-active",
      count: prices.length,
      currency: items[0]?.price?.currency || "USD",
      low: prices.length ? Math.min(...prices) : null,
      median: median(prices),
      high: prices.length ? Math.max(...prices) : null,
      samples,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
