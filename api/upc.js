// Serverless function: look up product info from a barcode (UPC/EAN).
// Uses UPCitemdb's free trial endpoint (no key, ~100 lookups/day). Returns a
// few small fields. If you outgrow the free tier, swap in a paid UPC API key.
// See docs/research.md for options (UPCdatabase.org is the cheapest).

export default async function handler(req, res) {
  try {
    const code = (req.query && req.query.code ? String(req.query.code) : "").trim();
    if (!/^\d{8,14}$/.test(code)) {
      res.status(400).json({ error: "Provide a valid numeric barcode." });
      return;
    }

    const r = await fetch(
      "https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(code),
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) {
      res.status(502).json({ error: `UPC lookup failed (${r.status})`, found: false });
      return;
    }
    const data = await r.json();
    const item = (data.items && data.items[0]) || null;
    if (!item) {
      res.status(200).json({ found: false, code });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=86400");
    res.status(200).json({
      found: true,
      code,
      title: item.title || "",
      brand: item.brand || "",
      category: item.category || "",
      image: (item.images && item.images[0]) || "",
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err), found: false });
  }
}
