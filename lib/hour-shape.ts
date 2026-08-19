/**
 * What SHAPE a «تسجيل الإنتاج» row's 24 hour cells are in.
 *
 * Zero imports, so Node's test runner can load it directly — the same trade
 * lib/downtime.ts, lib/oee.ts and lib/run-join.ts make. lib/hourly.ts re-exports
 * it, so callers keep importing from one place.
 *
 * Derived from the cells themselves. There is deliberately NO sheet column for
 * this and the crew is never asked: a column would be one more thing to fill in
 * wrongly, and the cells already say it.
 */

/**
 *  - `hourly`     genuine hour-by-hour readings that DIFFER. 13/07/2026
 *                 PQ 4 — 138 reads 805 at 08:00 and 1225 at 09:00.
 *  - `flat`       one constant repeated across the cells. 09/08/2026 زراير is
 *                 1062 eleven times. It LOOKS hourly and carries no
 *                 hour-to-hour information at all — the typist multiplied the
 *                 mean by the cavity count and filled it across. Verified
 *                 across all ten rows of 09/08; it is how the sheet has always
 *                 been filled.
 *  - `shiftTotal` ONE cell holding the whole shift — the shape that arrives
 *                 when the crew types سستم and فعلي instead of 24 numbers.
 *  - `empty`      no hour cells at all.
 *
 * ⚠ Only `hourly` can answer "what happened at 14:00?". The other two must
 * never be averaged into an hour-of-day view beside it.
 */
export type HourShape = "empty" | "shiftTotal" | "flat" | "hourly";

/**
 * Distinct VALUES, not merely how many cells are filled: a constant repeated
 * eleven times is not eleven hours of information, and treating it as such is
 * what would let a flat row masquerade as a measured hour-by-hour day.
 */
export function hourShapeOf(hours: readonly (number | null)[]): HourShape {
  const filled: number[] = [];
  for (const h of hours) if (h !== null && h !== undefined) filled.push(h);
  if (filled.length === 0) return "empty";
  if (filled.length === 1) return "shiftTotal";
  return new Set(filled).size === 1 ? "flat" : "hourly";
}

/** True only where a row can answer "what happened at 14:00?". */
export const hasHourDetail = (s: HourShape): boolean => s === "hourly";
