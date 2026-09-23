import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";
const AMAZON_TAG = process.env.AMAZON_TAG || ""; // optional affiliate tag
// Optional product images. Set ONE of these keys; the first one found wins.
const SERPER_API_KEY = process.env.SERPER_API_KEY || ""; // serper.dev - Google Shopping listings
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || ""; // serpapi.com - Google Shopping listings
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || ""; // pexels.com - stock photos, not shoppable
const SHOP_GL = process.env.SHOP_GL || process.env.SERPER_GL || "us"; // country code for shopping results
const PRODUCTS_PER_SUGGESTION = 4;
const PRODUCT_PROVIDER = SERPER_API_KEY ? "serper" : SERPAPI_API_KEY ? "serpapi" : PEXELS_API_KEY ? "pexels" : "off";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const client = new Anthropic();

// ---------- Prompt + schema ----------

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

// ---------- Shop links ----------

function shopLinks(query) {
  const q = encodeURIComponent(query);
  const amazon = `https://www.amazon.com/s?k=${q}${AMAZON_TAG ? `&tag=${encodeURIComponent(AMAZON_TAG)}` : ""}`;
  return {
    google: `https://www.google.com/search?tbm=shop&q=${q}`,
    amazon,
  };
}

// ---------- Product lookup (optional) ----------

// Each provider returns raw hits; normalize() maps them to {title, price, source, image, link}.
const PROVIDERS = {
  serper: {
    async fetch(query) {
      const res = await fetch("https://google.serper.dev/shopping", {
        method: "POST",
        headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: SHOP_GL, hl: "en", num: 10 }),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data.shopping) ? data.shopping : [];
    },
    normalize: (p) => ({ title: p.title, price: p.price, source: p.source, image: p.imageUrl, link: p.link }),
  },
  serpapi: {
    async fetch(query) {
      const url = new URL("https://serpapi.com/search.json");
      url.search = new URLSearchParams({
        engine: "google_shopping", q: query, gl: SHOP_GL, hl: "en", num: "10", api_key: SERPAPI_API_KEY,
      }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data.shopping_results) ? data.shopping_results : [];
    },
    normalize: (p) => ({ title: p.title, price: p.price, source: p.source, image: p.thumbnail, link: p.product_link || p.link }),
  },
  pexels: {
    async fetch(query) {
      const url = new URL("https://api.pexels.com/v1/search");
      url.search = new URLSearchParams({ query, per_page: String(PRODUCTS_PER_SUGGESTION), orientation: "portrait" }).toString();
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY }, signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data.photos) ? data.photos : [];
    },
    // Stock photos: no price, "source" is the photographer credit, link goes to the Pexels page.
    normalize: (p) => ({ title: p.alt, price: "", source: p.photographer ? `Photo: ${p.photographer}` : "Pexels", image: p.src?.large || p.src?.medium, link: p.url }),
  },
};

// Returns up to PRODUCTS_PER_SUGGESTION images for a suggestion, or [] when no provider is
// configured or the lookup fails. Never throws: thumbnails are a nice-to-have and must not
// break the core suggestion flow.
async function findProducts(query) {
  const provider = PROVIDERS[PRODUCT_PROVIDER];
  if (!provider || !query) return [];
  try {
    const hits = await provider.fetch(query);
    return hits
      .map(provider.normalize)
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
    console.warn(`${PRODUCT_PROVIDER} lookup failed for "${query}": ${err.message}`);
    return [];
  }
}

const AUDIENCES = new Set(["men", "women", "unisex"]);
const AUDIENCE_WORD = { men: "men's", women: "women's" };

// Prefix the image query with the audience unless the model already did, so stock-photo
// providers stop returning the wrong presentation for the item.
function imageQuery(query, audience) {
  const word = AUDIENCE_WORD[audience];
  if (!word || /\b(men's|women's|mens|womens|male|female)\b/i.test(query)) return query;
  return `${word} ${query}`;
}

async function enrich(suggestion, audience) {
  const query = suggestion.search_query || suggestion.item;
  return { ...suggestion, links: shopLinks(query), products: await findProducts(imageQuery(query, audience)) };
}

// ---------- Claude call ----------

async function analyze({ imageBase64, mediaType, audience, occasion, notes }) {
  const contextLines = [];
  if (audience) contextLines.push(`Audience (who will wear this): ${audience}`);
  if (occasion) contextLines.push(`Occasion: ${occasion}`);
  if (notes) contextLines.push(`Style notes from the user: ${notes}`);
  const userText =
    (contextLines.length ? contextLines.join("\n") + "\n\n" : "") +
    "Analyze this item and suggest three pieces to pair with it.";

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
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

  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation || "The model declined to analyze this image.";
    return { status: 422, body: { error: "refused", message: why } };
  }
  if (response.stop_reason === "max_tokens") {
    return { status: 502, body: { error: "truncated", message: "Response was cut off. Try again." } };
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 502, body: { error: "bad_json", message: "Model returned unparseable output." } };
  }

  if (!parsed.is_clothing) {
    return {
      status: 200,
      body: {
        is_clothing: false,
        message: parsed.not_clothing_reason || "That doesn't look like a clothing item.",
      },
    };
  }

  // User's explicit choice wins; otherwise use what the model inferred from the photo.
  const effectiveAudience = audience || (AUDIENCES.has(parsed.item?.audience) ? parsed.item.audience : "unisex");
  parsed.item.audience = effectiveAudience;

  // Product lookups run in parallel so three searches cost the latency of one.
  const suggestions = await Promise.all(
    (parsed.suggestions || []).slice(0, 3).map((s) => enrich(s, effectiveAudience)),
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

async function swap({ imageBase64, mediaType, audience, occasion, notes, item, current, rejected, category }) {
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SWAP_SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
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

  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation || "The model declined this request.";
    return { status: 422, body: { error: "refused", message: why } };
  }
  if (response.stop_reason === "max_tokens") {
    return { status: 502, body: { error: "truncated", message: "Response was cut off. Try again." } };
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 502, body: { error: "bad_json", message: "Model returned unparseable output." } };
  }

  return {
    status: 200,
    body: {
      suggestion: await enrich(parsed, effectiveAudience),
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    },
  };
}

// ---------- HTTP plumbing ----------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Image too large (max 8 MB)."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Body must be JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const urlPath = new URL(req.url, "http://x").pathname;
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(here, "public", rel));
  if (!file.startsWith(path.join(here, "public"))) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CATEGORIES = new Set(["top", "bottom", "dress", "outerwear", "shoes", "accessory", "other"]);
const strList = (v, max = 10) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max) : [];

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && (req.url === "/api/analyze" || req.url === "/api/swap")) {
    try {
      const body = await readJsonBody(req);
      const { image, mediaType, audience, occasion, notes } = body || {};
      if (typeof image !== "string" || !image) {
        return sendJson(res, 400, { error: "bad_request", message: "Missing image." });
      }
      if (!ALLOWED_MEDIA.has(mediaType)) {
        return sendJson(res, 400, { error: "bad_request", message: "Unsupported image type." });
      }
      const common = {
        imageBase64: image,
        mediaType,
        audience: AUDIENCES.has(audience) ? audience : "",
        occasion: typeof occasion === "string" ? occasion.slice(0, 100) : "",
        notes: typeof notes === "string" ? notes.slice(0, 1000) : "",
      };

      if (req.url === "/api/swap") {
        const { item, current, rejected, category } = body;
        if (!item || typeof item.name !== "string" || !CATEGORIES.has(category)) {
          return sendJson(res, 400, { error: "bad_request", message: "Missing item or category." });
        }
        const result = await swap({
          ...common,
          item: {
            name: item.name.slice(0, 200),
            category: CATEGORIES.has(item.category) ? item.category : "other",
            colors: strList(item.colors),
            style: typeof item.style === "string" ? item.style.slice(0, 100) : "",
            formality: typeof item.formality === "string" ? item.formality.slice(0, 50) : "",
            audience: AUDIENCES.has(item.audience) ? item.audience : "",
          },
          current: strList(current),
          rejected: strList(rejected),
          category,
        });
        return sendJson(res, result.status, result.body);
      }

      const result = await analyze(common);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return sendJson(res, 500, { error: "auth", message: "Server API key is missing or invalid." });
      }
      if (err instanceof Anthropic.RateLimitError) {
        return sendJson(res, 429, { error: "rate_limit", message: "Rate limited. Try again in a moment." });
      }
      if (err instanceof Anthropic.BadRequestError) {
        return sendJson(res, 400, { error: "bad_request", message: err.message });
      }
      if (err instanceof Anthropic.APIError) {
        return sendJson(res, 502, { error: "api", message: `Claude API error ${err.status}: ${err.message}` });
      }
      console.error(err);
      return sendJson(res, err.status || 500, { error: "server", message: err.message || "Server error." });
    }
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end();
});

server.listen(PORT, () => {
  console.log(`Outfit pairer running at http://localhost:${PORT}  (model=${MODEL}, effort=${EFFORT}, products=${PRODUCT_PROVIDER})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set. Put it in .env or export it.");
  }
});
