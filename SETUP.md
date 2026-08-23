# Setup guide — getting Flipping Friend online with the gem-finder

This walks you through everything click-by-click. You don't need to code. Total time
~30 minutes, most of it waiting on account confirmations. Everything here is **free**
at your scale.

There are three things to create, then one deploy:

1. A free **eBay developer key** (for live price comps)
2. A **Claude API key** (for the photo "what is this / what's it worth" feature)
3. A free **Vercel** account (hosts the app + safely stores the keys)

> The app already works **without any of this** for tracking inventory. These steps
> only light up the in-store **price lookups**.

---

## 1. eBay developer key (~10 min)

This gives us live eBay asking-price comps.

1. Go to **https://developer.ebay.com** and click **Register** (use your normal eBay
   login). Accept the developer agreement.
2. Open **My Account → Application Keysets**.
3. Click **Create a keyset** for the **Production** environment (not Sandbox).
4. You'll see several values. We need exactly two:
   - **App ID (Client ID)**
   - **Cert ID (Client Secret)**
5. Copy both somewhere safe for step 4. That's it — no extra approval needed for the
   price-comp feature we use.

> Note: eBay's *sold*-price API is restricted and usually denied to small projects, so
> we use the open **active-listings** API (asking prices). It's still a great signal —
> pair it with the eBay app's free "Sold" filter for the final gut-check.

---

## 2. Claude API key (~5 min)

This powers the photo appraisal (snap a no-barcode item → identification + estimate).

1. Go to **https://console.anthropic.com** and sign up / log in.
2. Add a small amount of credit under **Billing** (a few dollars goes a very long way —
   each photo lookup costs well under a cent).
3. Open **API Keys → Create Key**, name it "Flipping Friend", and copy the key
   (starts with `sk-ant-`). You won't be able to see it again, so paste it somewhere
   safe for step 4.

---

## 3 & 4. Deploy on Vercel and add the keys (~10 min)

1. Go to **https://vercel.com** and **Sign up with GitHub** (free "Hobby" plan).
2. Click **Add New → Project**, and **Import** the `Flipping-Friend` repository.
3. Before clicking Deploy, open **Environment Variables** and add these three
   (name on the left, your value on the right):

   | Name | Value |
   |------|-------|
   | `EBAY_APP_ID` | your eBay App ID (Client ID) |
   | `EBAY_CERT_ID` | your eBay Cert ID (Client Secret) |
   | `ANTHROPIC_API_KEY` | your `sk-ant-...` key |

4. Click **Deploy**. After a minute you'll get a URL like
   `https://flipping-friend-xxxx.vercel.app`.
5. Open that URL on your wife's **iPhone in Safari**, then **Share → Add to Home
   Screen**. It now runs like an app and works offline.

That's it. The "🔎 Is it a gem?" lookups and "📸 Photo" appraisal are now live.

---

## Trying it

- **Barcode item** (book, boxed goods, electronics): tap **Scan**, point at the
  barcode → it identifies the product and shows eBay price range + a flip verdict.
- **No barcode** (clothes, knickknacks): tap **Photo**, snap it → AI identifies it and
  estimates a resale range, then pulls matching eBay listings.
- **Just typing**: enter "Coach leather crossbody" and tap **Check prices**.

Results are cached for a week, so re-scanning the same item uses no data.

---

## Costs, realistically

- **eBay API**: free (5,000 calls/day; we use a handful per sourcing trip).
- **Vercel**: free Hobby tier is plenty for two users.
- **Claude (photo lookups)**: pennies. ~$0.005 per photo on the default model. If you
  want to cut that ~40%, tell me and I'll switch the photo model to a cheaper one.
- **UPC lookups**: free tier (100/day). If you scan a lot of barcodes, we can add a
  cheap UPC key — see `docs/research.md`.

If a lookup ever says the keys aren't configured, double-check the three environment
variables in Vercel (Project → Settings → Environment Variables) and redeploy.
