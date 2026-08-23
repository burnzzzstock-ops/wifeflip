// Serverless function: AI photo valuation for items without a barcode.
// Takes a COMPRESSED JPEG (the phone shrinks it first, ~80-250KB) and returns a
// structured identification + realistic resale estimate. This is the data-heavy
// path, so it's used only as a fallback to barcode/keyword comps.
//
// Requires env var: ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const SCHEMA = {
  type: "object",
  properties: {
    itemName: { type: "string" },
    brand: { type: "string" },
    category: { type: "string" },
    condition: { type: "string" },
    estLow: { type: "number" },
    estHigh: { type: "number" },
    suggestedTitle: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "string" },
  },
  required: [
    "itemName", "brand", "category", "condition", "estLow", "estHigh",
    "suggestedTitle", "keywords", "confidence", "notes",
  ],
  additionalProperties: false,
};

const PROMPT =
  "You are an expert reseller who appraises thrift-store finds for resale on eBay and Poshmark. " +
  "Identify the item in the photo and estimate its realistic resale value range in USD, based on " +
  "typical recent SOLD prices (not optimistic asking prices). Be conservative and practical. " +
  "If you can't identify it confidently, set confidence to 'low' and give a wide range. " +
  "suggestedTitle: a keyword-front-loaded eBay-style title (brand + item + key features + size/condition). " +
  "keywords: 3-6 search terms a reseller would use to find comparable sold listings. " +
  "notes: one short line on what drives the value or what to check (flaws, authenticity, sizing). " +
  "Respond with ONLY a JSON object matching this shape, no prose, no markdown fences: " +
  '{"itemName":"","brand":"","category":"","condition":"","estLow":0,"estHigh":0,' +
  '"suggestedTitle":"","keywords":[],"confidence":"low|medium|high","notes":""}';

// Pull the first {...} object out of the model text, tolerant of stray prose/fences.
function extractJSON(text) {
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("Model did not return JSON.");
}

export default async function handler(req, res) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "AI key not configured (set ANTHROPIC_API_KEY)." });
      return;
    }
    const body = req.body || {};
    const image = body.image || "";
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) {
      res.status(400).json({ error: "Provide a base64 image data URL (jpeg/png/webp)." });
      return;
    }
    const mediaType = m[1];
    const base64 = m[2];
    const hint = (body.hint || "").toString().slice(0, 200);

    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "disabled" }, // quick, latency-sensitive lookup
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT + (hint ? `\n\nSeller's note: ${hint}` : "") },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      res.status(200).json({ error: "Could not appraise this image.", refused: true });
      return;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = extractJSON(textBlock ? textBlock.text : "");
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
