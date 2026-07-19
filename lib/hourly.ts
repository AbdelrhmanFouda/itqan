import { getRecords } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";

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
  hours: (number | null)[]; hoursLogged: number;
  systemTotal: number | null; actualTotal: number | null;
  expected: number | null; scrap: number | null;
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

export async function loadHourlyRows(): Promise<HourlyRow[]> {
  const { records } = await getRecords("hourly");
  return records
    .map((r) => {
      const date = normalizeDate(r.date);
      const hours = HOUR_KEYS.map((k) => num(r[k]));
      const logged = hours.filter((h) => h !== null).length;
      const system = num(r.systemTotal) ?? hours.reduce<number>((s, h) => s + (h ?? 0), 0);
      const actual = num(r.actualTotal);
      const expected = num(r.expected);
      const effSystem = logged > 0 && expected !== null && expected > 0 ? system / expected : null;
      const effActual = actual !== null && expected !== null && expected > 0 ? actual / expected : null;
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
        expected,
        effSystem,
        effActual,
        efficiency: effActual ?? effSystem,
        scrap: logged > 0 && actual !== null ? Math.max(0, system - actual) : null,
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
