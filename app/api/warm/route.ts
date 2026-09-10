import { NextResponse } from "next/server";
import { after } from "next/server";
import { getRecords } from "@/lib/sheets";

/**
 * Warm this instance's copies of the core tabs (2026-09-10, page-speed audit).
 *
 * The dashboard shell calls it once after sign-in. The answer is immediate;
 * the reads run AFTER the response (`after`), all requested in one tick so
 * the bridge layer can fold them into a single `tabs=` round trip when the
 * deployed bridge supports it. By the time the person taps a page, the
 * instance that took this call usually holds what the page needs — a read
 * already in flight is shared with the page's own request (readOnce), and a
 * tab read a moment ago is served from the copy.
 *
 * Order matters when the bridge reads one tab at a time: the production log
 * and the overview need «الماكينات» + «الإنتاج» + «التوقفات» first; Master and
 * the order book follow.
 *
 * Open on purpose: it returns no data at all.
 */
const CORE = ["machines", "production", "downtime", "master", "jobs"];

export async function GET() {
  after(async () => {
    await Promise.all(CORE.map((e) => getRecords(e).catch(() => null)));
  });
  return NextResponse.json({ ok: true, warming: CORE }, { headers: { "Cache-Control": "no-store" } });
}
