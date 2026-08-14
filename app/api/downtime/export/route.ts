import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { downtimeCsv, countsTowardDowntime } from "@/lib/downtime";
import { loadDowntimeRecords } from "@/lib/downtime-data";
import { downtimeReasonAr } from "@/lib/prod-meta";

/**
 * CSV export of the stoppage log.
 *
 * It was built when downtime lived only in Firestore, so the data could never
 * be trapped there. That job is done — «التوقفات» is the store now — and this
 * reads the SHEET, so an export can never disagree with what the dashboard
 * shows. It stays because a spreadsheet of one month, openable in Excel with
 * its Arabic intact, is still the easiest thing to hand somebody.
 *
 * Guarded like the read half of /api/downtime (the rows carry «سُجل بواسطة»).
 * `?month=YYYY-MM` narrows the export; omit it for everything.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const month = req.nextUrl.searchParams.get("month");
    const events = (await loadDowntimeRecords())
      .filter(countsTowardDowntime)                        // rows that carry minutes
      .filter((e) => !month || e.date.startsWith(month))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt));

    const name = `itqan-downtime${month ? `-${month}` : ""}.csv`;
    return new NextResponse(downtimeCsv(events, downtimeReasonAr), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
