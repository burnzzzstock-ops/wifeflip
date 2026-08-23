# 🪙 Flipping Friend

A simple phone app to help run a thrift-and-flip reselling business: track what you buy and
sell, see your profit toward a monthly goal, and make smart buy/no-buy calls while you're out
sourcing — even with no cell signal.

Built as an installable **PWA** (Progressive Web App): it lives on the phone's home screen,
opens like a normal app, and works **offline**. Phase 1 needs **no accounts and no internet**.

---

## What it does today

- **📊 Home dashboard** — net profit this month (sales minus expenses) vs. your goal, cash invested
  in stock, all-time profit, a **"needs attention"** list (stale listings, unlisted buys), and a
  **daily selling routine** checklist (share closet, send offers, list one item).
- **📦 Inventory** — every item with photos, brand, size, condition, cost, list price, sold price,
  fees; automatic profit per item. Search, filter by status, and aging badges on slow movers.
- **➕ Quick add** — snap photos (auto-compressed to stay small), scan a barcode, fill the basics.
  One-tap **"I bought it" / "Mark as listed" / "It sold!"** actions move items through the pipeline.
- **🔍 Sourcing helper** — an in-store, no-signal toolkit:
  - **"Will it flip?" calculator** — enter buy + sell price, pick a platform, see take-home after
    fees and a quick verdict.
  - **Barcode scan** + save an item as a **"Maybe"** to research later.
- **📈 Insights** — net profit by month chart, avg days-to-sell, avg profit per sale, ROI,
  90-day sell-through, what sells best (category / platform / store), **expense tracking**
  (supplies, mileage, subscriptions…), and a **tax-time summary** with a one-tap CSV export.
- **⚙️ Settings** — monthly goal, themes, **export a backup** (.json) or **spreadsheet** (.csv),
  **import** your existing spreadsheet, cloud sync, and a **device check-up** panel that shows
  exactly what's wrong when a phone misbehaves (copy + text it over).

All data is stored **locally first** (in the browser's IndexedDB) and works offline. With cloud
sync connected (see `SETUP-SYNC.md`), both phones share one live inventory: it syncs automatically
every minute the app is open, whenever you come back to it, and when signal returns — with a
sync status chip in the header.

---

## How to run it

Because it's a plain static web app, you can host it anywhere that serves files.

### Quick local test
```bash
# from this folder
python3 -m http.server 8080
# then open http://localhost:8080 on your computer
```

### Put it on her phone (recommended: free hosting)
1. Deploy the folder to any static host — **Netlify**, **Vercel**, **GitHub Pages**, or
   **Cloudflare Pages** all have free tiers. (Netlify: drag-and-drop this folder onto
   app.netlify.com. GitHub Pages: enable Pages on this repo.)
2. Open the resulting URL on her phone.
3. **Install it:** iPhone (Safari) → Share → *Add to Home Screen*. Android (Chrome) → menu →
   *Install app*.
4. It now runs offline from the home screen.

> Barcode scanning uses the phone's camera on-device (no data). Live scanning works in Chrome on
> Android today; on iPhone it currently falls back to typing the number. Tell me which phone she
> uses and I'll tune this.

---

## Project layout
```
index.html              app shell
manifest.webmanifest    PWA install config
service-worker.js       offline caching
css/styles.css          styles
js/app.js               app logic, screens, router
js/db.js                local database (IndexedDB) + lookup cache/queue
js/util.js              money/date/image-compression helpers
js/barcode.js           on-device barcode scanning (iPhone + Android)
js/api.js               client for the price-lookup backend
js/zxing.min.js         vendored barcode scanner (offline, iPhone Safari)
api/ebay-comps.js       backend: eBay active-listing price comps
api/upc.js              backend: barcode → product lookup
api/estimate.js         backend: AI photo appraisal (Claude)
icons/                  app icons
docs/research.md        platform & selling-strategy research (read this!)
SETUP.md                click-by-click: keys + deploy
```

---

## Phase 2 — the gem-finder (built ✅)

In the **Sourcing** tab:
- **🔎 Check prices** — scan a barcode or type keywords → product info + eBay active price range
  (low / median / high) + a flip verdict against your cost.
- **📸 Photo** — for no-barcode items, snap a photo → AI identifies it and estimates a resale range,
  then pulls matching eBay listings. The photo is compressed first (~10–40× less data).
- Results are **cached for a week** and the lookup ladder runs cheapest-first to save data.

This needs a small backend (in `/api`) to safely hold the eBay + Claude keys, plus free hosting.
**Follow [`SETUP.md`](SETUP.md)** for the click-by-click (eBay key → Claude key → deploy on Vercel).
Barcode scanning works on **iPhone Safari** via a bundled scanner.

## Roadmap

- **Phase 3 — Sell faster.** AI-written, keyword-optimized eBay titles/descriptions; one-tap eBay
  listing creation; a daily Poshmark checklist (share, party, offers-to-likers — advisory, ToS-safe).
- **Optional cloud sync** across devices (Supabase free tier), keeping the offline-first model.

See [`docs/research.md`](docs/research.md) for the findings behind these choices — including why
eBay sold-price data is gated and why Poshmark automation is off the table.
