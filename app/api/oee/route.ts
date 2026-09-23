import { NextRequest, NextResponse } from "next/server";
import { buildOEEData } from "@/lib/oee-data";
import { requireRole } from "@/lib/api-guard";

/**
 * OEE from the sheet's Production tab. All computation lives in
 * lib/oee-data.ts (shared with /api/ai-review so both always agree).
 * Optional ?month=YYYY-MM filters the period.
 *
 * CLOSED 2026-09-23 (customer portal review). "The OEE AGGREGATES — four
 * percentages, no row, no name" was the reasoning for leaving it open; the
 * body is not that. It carries `machines` (one entry per machine, each with
 * its registry label — so the exact machine COUNT the owner's rule of
 * 2026-09-20 keeps off public surfaces), `bottlenecks[].machine`, and
 * `standardsGap[]` / `suspects[]` whose labels fall back to the PRODUCT NAME.
 * Phase 0b guarded /api/runs and /api/machines* for exactly that data; this
 * route was republishing it through another door. Its only caller is
 * /dashboard/performance, plus the AI review, which calls `buildOEEData`
 * directly and is unaffected.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const month = req.nextUrl.searchParams.get("month"); // "YYYY-MM" or null = all
    const data = await buildOEEData(month);
    // The signed-in caller's own browser may reuse it briefly; the fallback
    // below deliberately carries no cache header, so a transient failure is
    // never pinned client-side.
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        overall: null, bottlenecks: [], machines: [], downtime: [], trend: [],
        months: [], readiness: null, standardsGap: [], suspects: [], explain: null,
        runCount: 0, configured: false,
      },
      { status: 200 },
    );
  }
}
