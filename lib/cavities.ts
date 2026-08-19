/**
 * Reading «الرئيسي» H — the cavity count.
 *
 * Zero imports so Node's test runner can load it directly, the same trade
 * lib/hour-shape.ts, lib/run-join.ts and lib/downtime.ts make.
 *
 * It lived in lib/sheet-import.ts until the paper-photo import was removed on
 * 2026-08-19. It was never really part of that feature: the cavity count is how
 * Master describes a mould, and lib/jobs.ts uses it to turn ordered kilos into
 * pieces.
 */

/**
 * Master's H column is not always a bare number. Real values include `8`,
 * `4+4`, `2 وش&2 كفر` (a two-part mould: two of one part and two of another per
 * shot) and `1 طقم`. A mould that fires two different parts has BOTH counts,
 * and the pieces per shot is their sum — reading only the first number
 * undercounts such a mould by half.
 *
 * Returns 0 for a blank or «غير متاح / N/A», which callers must treat as
 * "no cavity count", never as zero cavities.
 */
export function sumCavities(v: unknown): number {
  const s = String(v ?? "");
  const a = s.match(/^[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
  const b = s.match(/[+&]\s*([0-9]+(?:\.[0-9]+)?)/);
  return (a ? Number(a[1]) : 0) + (b ? Number(b[1]) : 0);
}
