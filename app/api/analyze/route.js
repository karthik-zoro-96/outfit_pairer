import { analyze } from "../../../lib/stylist.js";
import { consumeTry } from "../../../lib/rate-limit.js";
import { commonFields, readBody, run } from "../../../lib/request.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  const read = await readBody(req);
  if (read.response) return read.response;
  const parsed = commonFields(read.body);
  if (parsed.response) return parsed.response;
  const limit = consumeTry(req);
  if (limit.response) return limit.response;
  const res = await run(() => analyze(parsed.common));
  const data = await res.json();
  return Response.json(
    { ...data, tries_remaining: limit.remaining },
    { status: res.status, headers: { "Set-Cookie": limit.cookie } },
  );
}
