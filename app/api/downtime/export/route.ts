import { NextRequest, NextResponse } from "next/server";
import { getDowntimeEvents } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";
import { downtimeCsv } from "@/lib/downtime";
import { downtimeReasonAr } from "@/lib/prod-meta";

/**
 * CSV export of `downtimeEvents`, built in from day one so the downtime data is
 * never trapped in Firestore: if the owner later decides he does want it in the
 * workbook, he can export it and paste it in himself — no migration to write,
 * and no script touching the sheet.
 *
 * Guarded like the read half of /api/downtime (the rows carry `createdBy`).
 * `?month=YYYY-MM` narrows the export; omit it for everything.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const month = req.nextUrl.searchParams.get("month");
    const events = (await getDowntimeEvents())
      .filter((e) => e.endedAt != null)                    // finished stoppages only
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
