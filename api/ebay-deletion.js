// Serverless function: eBay Marketplace Account Deletion / Closure notification
// endpoint. eBay requires every production keyset to either subscribe to these
// notifications or opt out. Subscribing here enables the keyset instantly.
//
// How eBay verifies it:
//   GET  ?challenge_code=XYZ  -> respond 200 JSON { challengeResponse: sha256(challenge + token + endpoint) }
//   POST (real deletion event) -> respond 200 to acknowledge
//
// We store no eBay user data, so we simply acknowledge POSTs. The verification
// token must match what you enter in eBay's dashboard (env: EBAY_VERIFICATION_TOKEN),
// and the endpoint string must match the URL you register (env: EBAY_DELETION_ENDPOINT,
// defaulting to this app's production URL).

import crypto from "crypto";

const DEFAULT_ENDPOINT = "https://flipping-friend.vercel.app/api/ebay-deletion";

export default function handler(req, res) {
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT || DEFAULT_ENDPOINT;

  if (req.method === "GET") {
    const challenge = req.query && req.query.challenge_code;
    if (!challenge) {
      res.status(400).json({ error: "Missing challenge_code." });
      return;
    }
    if (!token) {
      res.status(500).json({ error: "EBAY_VERIFICATION_TOKEN not configured." });
      return;
    }
    const hash = crypto.createHash("sha256");
    hash.update(String(challenge));
    hash.update(token);
    hash.update(endpoint);
    res.status(200).json({ challengeResponse: hash.digest("hex") });
    return;
  }

  // Real account-deletion notification: acknowledge. (We hold no eBay user data.)
  res.status(200).json({ ok: true });
}
