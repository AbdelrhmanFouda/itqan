import { getRecords } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { hourShapeOf, hasHourDetail, type HourShape } from "@/lib/hour-shape";

export { hourShapeOf, hasHourDetail };
export type { HourShape };

/**
 * «تسجيل الإنتاج» — shared loader for the hourly log (long format: one row per
 * machine per day; hour cells are PIECES).
 *
 * Floor model (owner-confirmed):
 *  - hour columns + الأجمالي سستم = the machine counter's numbers
 *  - الأجمالي الفعلي = the products actually TAKEN from the machine (hand count)
 *  - scrap = سستم − فعلي
 *  - efficiency = الفعلي ÷ المتوقع (المتوقع comes from الرئيسي cycle×cavities);
 *    counter-based efficiency is only an approximation until الفعلي is counted.
 *
 * Used by /api/hourly (the viewer page) AND by /api/runs + lib/oee-data, which
 * join the derived scrap onto production runs so Quality is measured site-wide.
 */

export const HOUR_KEYS = [
  "h08", "h09", "h10", "h11", "h12", "h13", "h14", "h15", "h16", "h17", "h18", "h19",
  "h20", "h21", "h22", "h23", "h00", "h01", "h02", "h03", "h04", "h05", "h06", "h07",
] as const;
export const HOUR_LABELS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
  "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00",
];

export type HourlyRow = {
  row: number; date: string; shift: string; machine: string; product: string;
  hours: (number | null)[];
  /**
   * How many of the 24 cells hold a number. A fact about CELLS, deliberately
   * not named `hoursLogged` any more: it was being read as "hours this machine
   * ran", and under the shift-total shape that inference returns 1 for a whole
   * twelve-hour shift. Nothing may derive a duration from this.
   */
  hourCellsFilled: number;
  shape: HourShape;
  /** Planned minutes for this machine, from the machines REGISTRY. */
  shiftMinutes: number | null;
  systemTotal: number | null; actualTotal: number | null;
  expected: number | null; scrap: number | null;
  /** Where `expected` came from, so the UI can decline to show a bad one. */
  expectedSource: "sheet" | "registry" | "none";
  effSystem: number | null; effActual: number | null; efficiency: number | null;
};

function num(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s || s.includes("غير متاح")) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * @param opts.shiftMinutesFor resolves a machine label to its planned minutes.
 *   Supply it from the machines REGISTRY (`buildShiftLengthIndex` in
 *   lib/run-join.ts) — the same source OEE's planned time already uses, and the
 *   ONLY honest answer to "how long did this machine run". Omit it and a
 *   shift-total row simply reports no efficiency, which is correct: without a
 *   real shift length there is nothing to divide by.
 */
export async function loadHourlyRows(
  opts: { fresh?: boolean; shiftMinutesFor?: (machine: string) => number | null } = {},
): Promise<HourlyRow[]> {
  const { records } = await getRecords("hourly", { fresh: opts.fresh });
  return records
    .map((r) => {
      const date = normalizeDate(r.date);
      const hours = HOUR_KEYS.map((k) => num(r[k]));
      const filled = hours.filter((h) => h !== null).length;
      const shape = hourShapeOf(hours);
      const machine = (r.machine ?? "").trim();
      const system = num(r.systemTotal) ?? hours.reduce<number>((s, h) => s + (h ?? 0), 0);
      const actual = num(r.actualTotal);
      const shiftMinutes = opts.shiftMinutesFor?.(machine) ?? null;

      /**
       * «المتوقع» (AD) is `3600 / cycle * cavities * COUNT(D:AA)` — it scales
       * with HOW MANY CELLS ARE FILLED. That is fine while a shift is twelve
       * cells and wrong the moment it is one: a shift-total row makes AD one
       * hour's expectation while AB holds twelve hours of output, so the
       * sheet's own efficiency reads about twelve times too high.
       *
       * So for a shift-total row AD is rescaled from per-cell to the whole
       * shift using the REGISTRY's shift length. Every other shape keeps the
       * sheet's own number untouched, which is what keeps historical rows
       * rendering exactly as they do today.
       */
      const sheetExpected = num(r.expected);
      let expected = sheetExpected;
      let expectedSource: HourlyRow["expectedSource"] = sheetExpected === null ? "none" : "sheet";
      if (shape === "shiftTotal") {
        /**
         * NO EFFICIENCY FOR A SHIFT-TOTAL ROW, and this is a deliberate refusal
         * rather than a gap.
         *
         * Measured on 2026-08-09 with the month simulated in the new shape:
         *  - trusting AD as-is gives 1024%–2628%, because AD scales with
         *    COUNT(D:AA) and that count is now 1;
         *  - rescaling AD by the registry's «طول الوردية» gives 83%–241% —
         *    still exactly TWICE the 24-cell reading on every row.
         *
         * The 2× is the real lesson. «تسجيل الإنتاج» has no shift column: BOTH
         * shifts share one row and are told apart only by which half of the 24
         * cells carries numbers (see CLAUDE.md, paper-sheet finding 3). So a row
         * covers one shift or two, and with a single filled cell there is
         * nothing left to tell which. The registry knows the length of ONE
         * shift, not how many this row holds.
         *
         * Any number here would be a guess between 12 and 24 hours. Availability
         * and Performance on /performance are unaffected and remain correct —
         * they key off «الإنتاج», which DOES carry a shift per row.
         */
        expected = null;
        expectedSource = "none";
      }

      const effSystem = filled > 0 && expected !== null && expected > 0 ? system / expected : null;
      const effActual = actual !== null && expected !== null && expected > 0 ? actual / expected : null;
      return {
        row: r.row,
        date,
        shift: (r.shift ?? "").trim(),
        machine,
        product: (r.product ?? "").trim(),
        hours,
        hourCellsFilled: filled,
        shape,
        shiftMinutes,
        systemTotal: filled > 0 ? system : null,
        actualTotal: actual,
        expected,
        expectedSource,
        effSystem,
        effActual,
        efficiency: effActual ?? effSystem,
        // The PAIR that Quality depends on. One filled cell is enough — this is
        // exactly what must survive the move to two numbers per shift.
        scrap: filled > 0 && actual !== null ? Math.max(0, system - actual) : null,
      };
    })
    .filter((r) => Boolean(r.date) && Boolean(r.machine));
}

/* ------------------------- scrap join for production ------------------------ */

export type ScrapJoinRun = { date: string; machine: string; goodUnits: number; scrapUnits: number };

/**
 * Distribute the hourly-derived scrap (سستم − فعلي) onto production runs that
 * have NO logged scrap of their own. Grouped by day+machine; when a day has
 * several runs (shifts) on one machine, the scrap is split proportionally to
 * their good units (remainder-exact). Returns one derived value per run (0 = none).
 */
export function deriveScrap(runs: ScrapJoinRun[], hourly: HourlyRow[]): number[] {
  const scrapByKey = new Map<string, number>();
  for (const h of hourly) {
    if (h.scrap === null || h.scrap <= 0) continue;
    const k = `${h.date}|${normKey(h.machine)}`;
    scrapByKey.set(k, (scrapByKey.get(k) ?? 0) + h.scrap);
  }

  const groups = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (r.scrapUnits > 0 || !r.date) return; // logged scrap wins; undated rows skip
    const k = `${r.date}|${normKey(r.machine)}`;
    if (!scrapByKey.has(k)) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  const out = new Array<number>(runs.length).fill(0);
  for (const [k, idxs] of groups) {
    const total = scrapByKey.get(k) ?? 0;
    if (total <= 0) continue;
    const goods = idxs.map((i) => Math.max(0, runs[i].goodUnits));
    const sumGood = goods.reduce((a, b) => a + b, 0);
    let assigned = 0;
    idxs.forEach((i, j) => {
      let share =
        j === idxs.length - 1
          ? Math.max(0, total - assigned)
          : sumGood > 0
          ? Math.round((goods[j] / sumGood) * total)
          : Math.round(total / idxs.length);
      if (share < 0) share = 0;
      assigned += share;
      out[i] = share;
    });
  }
  return out;
}
