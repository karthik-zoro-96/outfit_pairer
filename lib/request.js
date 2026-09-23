import Anthropic from "@anthropic-ai/sdk";
import { AUDIENCES } from "./stylist.js";

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CATEGORIES = new Set(["top", "bottom", "dress", "outerwear", "shoes", "accessory", "other"]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const strList = (v, max = 10) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max) : [];

function json(body, status) {
  return Response.json(body, { status });
}

export function errorResponse(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return json({ error: "auth", message: "Server API key is missing or invalid." }, 500);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return json({ error: "rate_limit", message: "Rate limited. Try again in a moment." }, 429);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return json({ error: "bad_request", message: err.message }, 400);
  }
  if (err instanceof Anthropic.APIError) {
    return json({ error: "api", message: `Claude API error ${err.status}: ${err.message}` }, 502);
  }
  console.error(err);
  return json({ error: "server", message: err.message || "Server error." }, err.status || 500);
}

export async function readBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) {
    return { response: json({ error: "bad_request", message: "Image too large (max 8 MB)." }, 413) };
  }
  try {
    const body = await req.json();
    if (typeof body?.image === "string" && body.image.length > MAX_BODY_BYTES) {
      return { response: json({ error: "bad_request", message: "Image too large (max 8 MB)." }, 413) };
    }
    return { body };
  } catch {
    return { response: json({ error: "bad_request", message: "Body must be JSON." }, 400) };
  }
}

export function commonFields(body) {
  const { image, mediaType, audience, occasion, notes } = body || {};
  if (typeof image !== "string" || !image) {
    return { response: json({ error: "bad_request", message: "Missing image." }, 400) };
  }
  if (!ALLOWED_MEDIA.has(mediaType)) {
    return { response: json({ error: "bad_request", message: "Unsupported image type." }, 400) };
  }
  return {
    common: {
      imageBase64: image,
      mediaType,
      audience: AUDIENCES.has(audience) ? audience : "",
      occasion: typeof occasion === "string" ? occasion.slice(0, 100) : "",
      notes: typeof notes === "string" ? notes.slice(0, 1000) : "",
    },
  };
}

export function swapFields(body) {
  const { item, current, rejected, category } = body || {};
  if (!item || typeof item.name !== "string" || !CATEGORIES.has(category)) {
    return { response: json({ error: "bad_request", message: "Missing item or category." }, 400) };
  }
  return {
    extra: {
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
    },
  };
}

export async function run(work) {
  try {
    const result = await work();
    return json(result.body, result.status);
  } catch (err) {
    return errorResponse(err);
  }
}
