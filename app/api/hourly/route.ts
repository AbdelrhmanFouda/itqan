import { NextRequest, NextResponse } from "next/server";
import { loadHourlyRows, HOUR_LABELS } from "@/lib/hourly";
import { getRecords, type SheetRecord } from "@/lib/sheets";
import { buildShiftLengthIndex, latinDigits } from "@/lib/run-join";

// «تسجيل الإنتاج» day view — parsing/model lives in lib/hourly.ts (shared with
// the scrap join in /api/runs and lib/oee-data).
//
// The machines REGISTRY is read alongside it for one reason: a shift-total row
// (one cell holding the whole shift) makes the sheet's «المتوقع» one hour's
// expectation, because that formula multiplies by COUNT of the filled cells.
// The registry's «طول الوردية» is the real answer to "how long did this machine
// run", and it is the same index OEE's planned time already uses — one source,
// not a second opinion.

export async function GET(req: NextRequest) {
  try {
    const wantDate = req.nextUrl.searchParams.get("date");
    // Best-effort: a registry that is briefly unreachable costs the efficiency
    // badge on shift-total rows, never the page.
    const machinesTab = await getRecords("machines").catch(() => ({ records: [] as SheetRecord[] }));
    const lenByKey = buildShiftLengthIndex(machinesTab.records);
    const normKey = (x: string) => latinDigits(x ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const shiftMinutesFor = (machine: string) => lenByKey.get(normKey(machine)) ?? null;

    const rows = await loadHourlyRows({
      fresh: req.nextUrl.searchParams.get("fresh") === "1",
      shiftMinutesFor,
    });

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
