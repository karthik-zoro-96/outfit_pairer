import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "pairer_tries";
const MAX_AGE = 60 * 60 * 24 * 30;

function maxTries() {
  const n = Number(process.env.PAIRER_MAX_TRIES || 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function secret() {
  return process.env.RATE_LIMIT_SECRET || process.env.ANTHROPIC_API_KEY || "";
}

function ipOf(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function hits() {
  if (!globalThis.__pairerTries) globalThis.__pairerTries = new Map();
  return globalThis.__pairerTries;
}

function sign(n) {
  const body = String(n);
  const key = secret();
  if (!key) return body;
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifiedCount(token) {
  if (!token) return 0;
  const [n, mac] = token.split(".");
  if (!/^\d+$/.test(n || "")) return 0;
  const key = secret();
  if (!key) return Number(n);
  if (!mac) return 0;
  const expected = createHmac("sha256", key).update(n).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 0;
  return Number(n);
}

function cookieToken(req) {
  const raw = req.headers.get("cookie") || "";
  const match = raw.match(/(?:^|; )pairer_tries=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function setCookie(n) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(sign(n))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`;
}

function blocked(used) {
  const max = maxTries();
  return Response.json(
    {
      error: "rate_limit",
      message: `You've used all ${max} tries on this browser.`,
      tries_remaining: 0,
    },
    { status: 429, headers: { "Set-Cookie": setCookie(used) } },
  );
}

// One try is one Claude call: a match or a swap. The signed cookie survives
// a cold start. The in-memory map stops a cleared cookie on this instance.
export function consumeTry(req) {
  const max = maxTries();
  const ip = ipOf(req);
  const used = Math.max(verifiedCount(cookieToken(req)), hits().get(ip) || 0);
  if (used >= max) return { response: blocked(Math.max(used, max)) };
  const next = used + 1;
  hits().set(ip, next);
  return { cookie: setCookie(next), remaining: max - next };
}
