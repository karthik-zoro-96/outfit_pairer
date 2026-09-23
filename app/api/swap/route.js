import { swap } from "../../../lib/stylist.js";
import { commonFields, readBody, run, swapFields } from "../../../lib/request.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  const read = await readBody(req);
  if (read.response) return read.response;
  const parsed = commonFields(read.body);
  if (parsed.response) return parsed.response;
  const extra = swapFields(read.body);
  if (extra.response) return extra.response;
  return run(() => swap({ ...parsed.common, ...extra.extra }));
}
