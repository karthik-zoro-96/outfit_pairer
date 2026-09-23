import Anthropic from "@anthropic-ai/sdk";

export const AUDIENCES = new Set(["men", "women", "unisex"]);

const AUDIENCE_WORD = { men: "men's", women: "women's" };
const PRODUCTS_PER_SUGGESTION = 4;

const SYSTEM_PROMPT = `You are a personal stylist. The user sends a photo of one clothing item they own
(or are considering), optionally with an occasion and style notes.

Your job:
1. Identify the item: what it is, its dominant colors, pattern, style, formality, and who
   it is cut for (audience: men, women, or unisex). If the user states an audience, use it.
   Otherwise infer from the cut, sizing cues, and styling; default to unisex when unclear.
2. Recommend exactly THREE complementary pieces that pair well with it. Each must be a
   different category from the photographed item and from each other (e.g. if the photo is
   a shirt, suggest pants, shoes, and a jacket - not three shirts).
3. Each suggestion must name a concrete, shoppable item with a specific color, cut, and one
   distinguishing detail such as material, sole, collar, or wash, e.g. "slim-fit dark indigo
   raw denim jeans", "white leather low-top sneakers with gum sole", or "black nylon bomber
   jacket with ribbed collar". Never vague phrases like "something neutral" or bare
   two-word items like "black jeans".
4. The search_query field is what a shopper would type into Google Shopping or Amazon to
   find that exact piece. Keep it 3-8 words, start with "men's" or "women's" when the
   audience is not unisex, and include the color plus the distinguishing detail. No brand
   names unless the user asked for one.
5. Respect the occasion and style notes if given. If the notes mention constraints
   (budget, colors they avoid, body type, gender presentation), honor them.
6. Every hex field is the single dominant color of that piece as a 6-digit lowercase hex
   string with a leading #, e.g. "#1c1c1c" for black or "#f4f1ea" for off-white. Pick a
   realistic fabric shade, not a pure primary.

If the photo does not clearly show a clothing item, shoe, or accessory, set is_clothing to
false, explain briefly in not_clothing_reason, and leave the other fields with empty or
placeholder values.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    is_clothing: { type: "boolean" },
    not_clothing_reason: { type: "string" },
    item: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, e.g. 'navy pinstripe oxford shirt'" },
        category: {
          type: "string",
          enum: ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "other"],
        },
        colors: { type: "array", items: { type: "string" } },
        hex: { type: "string", description: "Dominant color as #rrggbb" },
        pattern: { type: "string" },
        style: { type: "string", description: "e.g. casual, smart casual, streetwear, preppy" },
        formality: { type: "string", enum: ["casual", "smart casual", "business", "formal"] },
        audience: { type: "string", enum: ["men", "women", "unisex"] },
      },
      required: ["name", "category", "colors", "hex", "pattern", "style", "formality", "audience"],
      additionalProperties: false,
    },
    suggestions: {
      type: "array",
      description: "Exactly three complementary pieces.",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Concrete shoppable item with color and cut" },
          category: {
            type: "string",
            enum: ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "other"],
          },
          why: { type: "string", description: "One sentence on why it pairs well" },
          search_query: { type: "string" },
          hex: { type: "string", description: "Dominant color as #rrggbb" },
        },
        required: ["item", "category", "why", "search_query", "hex"],
        additionalProperties: false,
      },
    },
  },
  required: ["is_clothing", "not_clothing_reason", "item", "suggestions"],
  additionalProperties: false,
};

const SUGGESTION_SCHEMA = OUTPUT_SCHEMA.properties.suggestions.items;

const SWAP_SYSTEM_PROMPT = `You are a personal stylist. The user photographed one clothing item and was given three
pairing suggestions. They rejected one and want a single replacement.

Rules:
- Stay in the same category as the rejected piece.
- Do not repeat the rejected piece or anything close to it, and do not repeat any item
  already in the current set. Offer a genuinely different direction: another color, cut,
  material, or level of formality that still pairs with the photographed item.
- Name a concrete, shoppable item with color, cut, and one distinguishing detail such as
  material, sole, collar, or wash.
- search_query is 3-8 words a shopper would type into Google Shopping or Amazon, starting
  with "men's" or "women's" when the audience is not unisex, including the color and the
  distinguishing detail. No brand names unless the user asked.
- hex is the dominant color of the new piece as a 6-digit lowercase hex with a leading #.
- Respect the occasion and style notes if given.`;

function settings() {
  const serper = process.env.SERPER_API_KEY || "";
  const serpapi = process.env.SERPAPI_API_KEY || "";
  const pexels = process.env.PEXELS_API_KEY || "";
  return {
    model: process.env.CLAUDE_MODEL || "claude-sonnet-5",
    effort: process.env.CLAUDE_EFFORT || "medium",
    amazonTag: process.env.AMAZON_TAG || "",
    shopGl: process.env.SHOP_GL || process.env.SERPER_GL || "us",
    serper,
    serpapi,
    pexels,
    provider: serper ? "serper" : serpapi ? "serpapi" : pexels ? "pexels" : "off",
  };
}

function shopLinks(query, amazonTag) {
  const q = encodeURIComponent(query);
  const amazon = `https://www.amazon.com/s?k=${q}${amazonTag ? `&tag=${encodeURIComponent(amazonTag)}` : ""}`;
  return {
    google: `https://www.google.com/search?tbm=shop&q=${q}`,
    amazon,
  };
}

function imageQuery(query, audience) {
  const word = AUDIENCE_WORD[audience];
  if (!word || /\b(men's|women's|mens|womens|male|female)\b/i.test(query)) return query;
  return `${word} ${query}`;
}

async function findProducts(query, cfg) {
  if (cfg.provider === "off" || !query) return [];
  try {
    const hits = await fetchHits(query, cfg);
    return hits
      .map((hit) => normalizeHit(hit, cfg.provider))
      .filter((p) => typeof p.image === "string" && /^https:\/\//.test(p.image) && typeof p.link === "string")
      .slice(0, PRODUCTS_PER_SUGGESTION)
      .map((p) => ({
        title: String(p.title || "").slice(0, 140),
        price: typeof p.price === "string" ? p.price : "",
        source: String(p.source || "").slice(0, 60),
        image: p.image,
        link: p.link,
      }));
  } catch (err) {
    console.warn(`${cfg.provider} lookup failed for "${query}": ${err.message}`);
    return [];
  }
}

async function fetchHits(query, cfg) {
  if (cfg.provider === "serper") {
    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": cfg.serper, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: cfg.shopGl, hl: "en", num: 10 }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.shopping) ? data.shopping : [];
  }
  if (cfg.provider === "serpapi") {
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google_shopping", q: query, gl: cfg.shopGl, hl: "en", num: "10", api_key: cfg.serpapi,
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.shopping_results) ? data.shopping_results : [];
  }
  const url = new URL("https://api.pexels.com/v1/search");
  url.search = new URLSearchParams({ query, per_page: String(PRODUCTS_PER_SUGGESTION), orientation: "portrait" }).toString();
  const res = await fetch(url, { headers: { Authorization: cfg.pexels }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.photos) ? data.photos : [];
}

function normalizeHit(p, provider) {
  if (provider === "serper") return { title: p.title, price: p.price, source: p.source, image: p.imageUrl, link: p.link };
  if (provider === "serpapi") return { title: p.title, price: p.price, source: p.source, image: p.thumbnail, link: p.product_link || p.link };
  return { title: p.alt, price: "", source: p.photographer ? `Photo: ${p.photographer}` : "Pexels", image: p.src?.large || p.src?.medium, link: p.url };
}

async function enrich(suggestion, audience, cfg) {
  const query = suggestion.search_query || suggestion.item;
  return { ...suggestion, links: shopLinks(query, cfg.amazonTag), products: await findProducts(imageQuery(query, audience), cfg) };
}

function readModelJson(response) {
  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation || "The model declined to analyze this image.";
    return { status: 422, body: { error: "refused", message: why } };
  }
  if (response.stop_reason === "max_tokens") {
    return { status: 502, body: { error: "truncated", message: "Response was cut off. Try again." } };
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return { parsed: JSON.parse(text), response };
  } catch {
    return { status: 502, body: { error: "bad_json", message: "Model returned unparseable output." } };
  }
}

export async function analyze({ imageBase64, mediaType, audience, occasion, notes }) {
  const cfg = settings();
  const contextLines = [];
  if (audience) contextLines.push(`Audience (who will wear this): ${audience}`);
  if (occasion) contextLines.push(`Occasion: ${occasion}`);
  if (notes) contextLines.push(`Style notes from the user: ${notes}`);
  const userText =
    (contextLines.length ? contextLines.join("\n") + "\n\n" : "") +
    "Analyze this item and suggest three pieces to pair with it.";

  const response = await new Anthropic().messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: cfg.effort,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const read = readModelJson(response);
  if (read.body) return read;

  const parsed = read.parsed;
  if (!parsed.is_clothing) {
    return {
      status: 200,
      body: {
        is_clothing: false,
        message: parsed.not_clothing_reason || "That doesn't look like a clothing item.",
      },
    };
  }

  const effectiveAudience = audience || (AUDIENCES.has(parsed.item?.audience) ? parsed.item.audience : "unisex");
  parsed.item.audience = effectiveAudience;

  const suggestions = await Promise.all(
    (parsed.suggestions || []).slice(0, 3).map((s) => enrich(s, effectiveAudience, cfg)),
  );

  return {
    status: 200,
    body: {
      is_clothing: true,
      item: parsed.item,
      suggestions,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    },
  };
}

export async function swap({ imageBase64, mediaType, audience, occasion, notes, item, current, rejected, category }) {
  const cfg = settings();
  const effectiveAudience = audience || item.audience || "unisex";
  const lines = [
    `Photographed item: ${item.name} (${item.category}; colors: ${(item.colors || []).join(", ")}; ${item.style}, ${item.formality}).`,
    `Audience (who will wear this): ${effectiveAudience}`,
    `Category to replace: ${category}.`,
    `Rejected so far in this category: ${rejected.map((r) => `"${r}"`).join(", ")}.`,
    `Other pieces currently in the set (keep the new piece compatible with these): ${current.map((c) => `"${c}"`).join(", ")}.`,
  ];
  if (occasion) lines.push(`Occasion: ${occasion}`);
  if (notes) lines.push(`Style notes from the user: ${notes}`);
  lines.push("Give me one replacement.");

  const response = await new Anthropic().messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system: SWAP_SYSTEM_PROMPT,
    output_config: {
      effort: cfg.effort,
      format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: lines.join("\n") },
        ],
      },
    ],
  });

  const read = readModelJson(response);
  if (read.body) {
    if (read.body.error === "refused" && !response.stop_details?.explanation) {
      read.body.message = "The model declined this request.";
    }
    return read;
  }

  return {
    status: 200,
    body: {
      suggestion: await enrich(read.parsed, effectiveAudience, cfg),
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    },
  };
}
