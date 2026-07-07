import { NextRequest, NextResponse } from "next/server";
import { buildOEEData } from "@/lib/oee-data";

/**
 * OEE from the sheet's Production tab. All computation lives in
 * lib/oee-data.ts (shared with /api/ai-review so both always agree).
 * Optional ?month=YYYY-MM filters the period.
 */
export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month"); // "YYYY-MM" or null = all
    const data = await buildOEEData(month);
    return NextResponse.json(data);
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
