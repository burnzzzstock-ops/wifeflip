// Serverless function: generate a keyword-optimized eBay listing for an item.
// Uses Claude to produce a Cassini-friendly title, item specifics, an honest
// description, and a competitive price (informed by comps when provided).
// Requires env var: ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    itemSpecifics: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, value: { type: "string" } },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    description: { type: "string" },
    suggestedPrice: { type: "number" },
    categorySuggestion: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["title", "itemSpecifics", "description", "suggestedPrice", "categorySuggestion", "keywords"],
  additionalProperties: false,
};

const PROMPT =
  "You are an expert eBay seller and listing optimizer. Write a listing that maximizes " +
  "search visibility (eBay's Cassini algorithm) and conversion.\n" +
  "- title: MAX 80 characters. Front-load the most-searched keywords in this order: " +
  "Brand + Item Type + Key Features + Size/Color + Condition. No filler, no ALL-CAPS gimmicks, " +
  "no punctuation spam.\n" +
  "- itemSpecifics: fill the structured attributes buyers filter by (Brand, Type, Department, " +
  "Size, Color, Material, Style, etc.). Only include ones you can reasonably infer; omit unknowns.\n" +
  "- description: clean, scannable, honest. Note condition and what to check for flaws, and include " +
  "a line reminding the seller to add exact measurements. Short lines, skimmable.\n" +
  "- suggestedPrice: a competitive Buy-It-Now price in USD, informed by the comps if given " +
  "(at or slightly below median to move it; enable Best Offer for flexibility).\n" +
  "- categorySuggestion: the best eBay category path.\n" +
  "- keywords: extra search terms.\n" +
  "Be accurate and conservative. If unsure what the item is, say so in the description. " +
  "Respond with ONLY a JSON object, no prose or markdown fences.";

function extractJSON(text) {
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("Model did not return JSON.");
}

export default async function handler(req, res) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "AI key not configured (set ANTHROPIC_API_KEY)." });
      return;
    }
    const body = req.body || {};
    const item = body.item || {};
    const comps = body.comps || null;
    const image = body.image || "";

    const facts = [
      item.title && `Item: ${item.title}`,
      item.brand && `Brand: ${item.brand}`,
      item.category && `Category: ${item.category}`,
      item.size && `Size: ${item.size}`,
      item.condition && `Condition: ${item.condition}`,
      item.notes && `Seller notes: ${item.notes}`,
      item.cost != null && item.cost !== "" && `Seller's cost: $${item.cost}`,
      comps && comps.median && `eBay active comps — low $${comps.low}, median $${comps.median}, high $${comps.high}`,
    ].filter(Boolean).join("\n");

    const content = [];
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    content.push({ type: "text", text: PROMPT + "\n\nWhat we know:\n" + (facts || "(little info — infer from the photo)") });

    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      res.status(200).json({ error: "Could not generate a listing for this item.", refused: true });
      return;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = extractJSON(textBlock ? textBlock.text : "");
    if (parsed.title && parsed.title.length > 80) parsed.title = parsed.title.slice(0, 80);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
