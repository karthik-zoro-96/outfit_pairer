import { analyze } from "../../../lib/stylist.js";
import { commonFields, readBody, run } from "../../../lib/request.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  const read = await readBody(req);
  if (read.response) return read.response;
  const parsed = commonFields(read.body);
  if (parsed.response) return parsed.response;
  return run(() => analyze(parsed.common));
}
