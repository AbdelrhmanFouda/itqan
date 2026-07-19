import { NextRequest, NextResponse } from "next/server";
import { getRecords } from "@/lib/sheets";
import { normalizeDate } from "@/lib/dates";

// «تسجيل الإنتاج» — read API for the hourly log (long format: one row per
// machine per day; hours are PIECES). scrap ≈ systemTotal − actualTotal when
// the crew has filled the manually-counted الفعلي column.

const HOUR_KEYS = [
  "h08", "h09", "h10", "h11", "h12", "h13", "h14", "h15", "h16", "h17", "h18", "h19",
  "h20", "h21", "h22", "h23", "h00", "h01", "h02", "h03", "h04", "h05", "h06", "h07",
] as const;
export const HOUR_LABELS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
  "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00",
];

function num(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s || s.includes("غير متاح")) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const wantDate = req.nextUrl.searchParams.get("date"); // YYYY-MM-DD, optional
    const { records } = await getRecords("hourly");

    const rows = records
      .map((r) => {
        const date = normalizeDate(r.date);
        const hours = HOUR_KEYS.map((k) => num(r[k]));
        const logged = hours.filter((h) => h !== null).length;
        const system = num(r.systemTotal) ?? hours.reduce<number>((s, h) => s + (h ?? 0), 0);
        const actual = num(r.actualTotal);
        return {
          row: r.row,
          date,
          shift: (r.shift ?? "").trim(),
          machine: (r.machine ?? "").trim(),
          product: (r.product ?? "").trim(),
          hours,
          hoursLogged: logged,
          systemTotal: logged > 0 ? system : null,
          actualTotal: actual,
          expected: num(r.expected),
          efficiency: num(r.efficiency),
          // The floor model: hourly counters are the system count; الفعلي is the
          // hand-counted result. The gap is (mostly) scrap.
          scrap: logged > 0 && actual !== null ? Math.max(0, system - actual) : null,
        };
      })
      .filter((r) => r.date && r.machine);

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
