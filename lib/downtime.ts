/**
 * PHASE 2 — downtime maths. Pure computation, no I/O (same rule as lib/oee.ts,
 * so it stays unit-testable without Firebase). The fetching half is
 * lib/downtime-data.ts.
 *
 * Downtime is the one piece of factory data that does NOT live in the Google
 * Sheet: «الإنتاج»!J «زمن التوقف» has never been filled once in 417 rows, and
 * the owner ruled the workbook must not gain tabs, columns, formulas or
 * validation. So it is captured on a phone into Firestore `downtimeEvents` and
 * joined onto the sheet's production runs here — exactly the way `deriveScrap()`
 * joins «تسجيل الإنتاج» scrap onto those same runs.
 *
 * The join key is `date | machine`, where machine is the «الماكينات»!J label
 * ("PQ 7 — 100"). Tonnage alone would merge PQ 5 with PQ 7 (both 100 t).
 */

// Kept local (rather than importing lib/dates) so this module has ZERO imports
// and Node's test runner can load it directly — the same trade lib/oee.ts makes.
// Behaviour matches latinDigits(): both Arabic-Indic ranges fold to 0-9.
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const normKey = (s: string | undefined): string =>
  (s ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const downtimeKey = (date: string, machine: string) => `${date}|${normKey(machine)}`;

/** Shape of a stored event, mirrored from lib/db.ts so this module stays pure. */
export type DowntimeEventLike = {
  date: string;
  machine: string;
  reason: string;
  minutes: number;
  startedAt: number;
  endedAt: number | null;
  createdBy: string;
};

export type DowntimeRun = {
  date: string;
  machine: string;
  plannedMin: number;
  /** downtime already on the run (from the sheet column, if it is ever filled). */
  downtimeMin: number;
};

export type DowntimeSpread = {
  /** extra downtime minutes for each run, index-aligned with the input (0 = none). */
  perRun: number[];
  /** minutes that could not be placed because the day's runs had no room left. */
  unallocatedMin: number;
  /** how many runs received downtime. */
  runsTouched: number;
};

/**
 * Spread each day+machine's captured downtime across that day's production runs.
 *
 * Why spread rather than dump it on one run: `computeOEE()` clamps each run's
 * downtime to that run's planned minutes (`Math.min(pm, downtimeMin)`), so
 * assigning a whole day's stoppage to a single 720-minute run would silently
 * discard everything past 720 and understate the loss. Each run therefore only
 * receives up to its remaining headroom (planned − downtime already logged),
 * shared in proportion to that headroom, remainder-exact so the integer split
 * still sums to the captured total.
 *
 * Anything that genuinely does not fit — more downtime than the day had planned
 * minutes, or a stoppage on a machine nobody logged production for, which means
 * the capture or the shift length needs a look — is returned as
 * `unallocatedMin` rather than silently dropped.
 */
export function distributeDowntime(runs: DowntimeRun[], byKey: Map<string, number>): DowntimeSpread {
  const perRun = new Array<number>(runs.length).fill(0);
  let unallocatedMin = 0;
  let runsTouched = 0;

  const groups = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (!r.date) return; // undated rows can't be joined to a day
    const k = downtimeKey(r.date, r.machine);
    if (!byKey.has(k)) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  // Captured days with no production row to attach to — surfaced, not lost.
  for (const [k, minutes] of byKey) if (!groups.has(k)) unallocatedMin += minutes;

  for (const [k, idxs] of groups) {
    const total = byKey.get(k) ?? 0;
    if (total <= 0) continue;
    const room = idxs.map((i) => Math.max(0, runs[i].plannedMin - runs[i].downtimeMin));
    const capacity = room.reduce((a, b) => a + b, 0);
    if (capacity <= 0) { unallocatedMin += total; continue; }

    const placeable = Math.min(total, capacity);
    unallocatedMin += total - placeable;

    let assigned = 0;
    idxs.forEach((i, j) => {
      // The last run mops up the rounding remainder; every share is then capped
      // at that run's own headroom so none can exceed its planned minutes.
      const share = Math.min(
        Math.max(0, j === idxs.length - 1 ? placeable - assigned : Math.round((room[j] / capacity) * placeable)),
        room[j],
      );
      assigned += share;
      if (share > 0) { perRun[i] = share; runsTouched++; }
    });
    // Rounding can leave a little unplaced when the last run hits its cap.
    unallocatedMin += Math.max(0, placeable - assigned);
  }

  return { perRun, unallocatedMin, runsTouched };
}

/* ------------------------------- CSV export ------------------------------- */

const csvCell = (v: unknown): string => {
  const s = String(v ?? "");
  // Quote when the value could break the row, and double any embedded quote.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const DOWNTIME_CSV_HEADERS = [
  "date", "machine", "reason", "reason_ar", "minutes",
  "startedAt", "endedAt", "createdBy",
] as const;

/**
 * Downtime as CSV, so the owner can move this into the workbook himself later
 * if he ever wants it there — the point of keeping it exportable from day one.
 * A UTF-8 BOM is prepended because Excel otherwise renders Arabic as mojibake.
 */
export function downtimeCsv(
  events: DowntimeEventLike[],
  reasonAr: (key: string) => string,
): string {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : "");
  const lines = [DOWNTIME_CSV_HEADERS.join(",")];
  for (const e of events) {
    lines.push([
      e.date, e.machine, e.reason, reasonAr(e.reason), e.minutes,
      iso(e.startedAt), iso(e.endedAt), e.createdBy,
    ].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
