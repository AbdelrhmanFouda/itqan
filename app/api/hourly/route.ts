import { NextRequest, NextResponse } from "next/server";
import { loadHourlyRows, HOUR_LABELS } from "@/lib/hourly";

// «تسجيل الإنتاج» day view — parsing/model lives in lib/hourly.ts (shared with
// the scrap join in /api/runs and lib/oee-data).

export async function GET(req: NextRequest) {
  try {
    const wantDate = req.nextUrl.searchParams.get("date");
    const rows = await loadHourlyRows();

    const dates = Array.from(new Set(rows.map((r) => r.date))).sort().reverse();
    const date = wantDate || dates[0] || "";
    const day = rows.filter((r) => r.date === date);

    const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
    return NextResponse.json({
      date,
      dates: dates.slice(0, 31),
      hourLabels: HOUR_LABELS,
      rows: day,
      totals: {
        system: sum(day.map((r) => r.systemTotal)),
        actual: sum(day.map((r) => r.actualTotal)),
        scrap: sum(day.map((r) => r.scrap)),
        machines: day.length,
        withActual: day.filter((r) => r.actualTotal !== null).length,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}
