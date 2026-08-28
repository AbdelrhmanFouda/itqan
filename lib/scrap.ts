/**
 * A production run's scrap — pure, ZERO imports, so Node's test runner can load
 * it directly (the same trade lib/oee.ts, lib/downtime.ts and lib/run-join.ts
 * make).
 *
 * ── Why this file was rewritten on 2026-08-27 ────────────────────────────────
 * Scrap used to be a CROSS-TAB JOIN: «تسجيل الإنتاج» held one row per machine
 * per day, scrap was سستم − الفعلي for that day, and `deriveScrap()` spread the
 * day's total across the day's «الإنتاج» rows in proportion to good units.
 *
 * That tab was REMOVED from the workbook (verified through the bridge the same
 * day: `no_tab`, no rename under any spelling, and — decisively — not one
 * `#REF!` anywhere in the workbook, which is what deleting a referenced tab
 * would have left behind). In its place «الإنتاج» itself gained «الأجمالي سستم»
 * and a FILLED «هالك», so every number the join used to reconstruct now sits on
 * the run's own row.
 *
 * So scrap is no longer joined, distributed, or apportioned. It is read:
 *
 *   1. «هالك» when the crew filled it            → source "logged"
 *   2. else «الأجمالي سستم» − «إنتاج سليم»        → source "system"
 *   3. else nothing is known                     → source "none", 0
 *
 * Rule 2 is what rule 1 is derived FROM in the sheet (هالك = سستم − سليم holds
 * on every one of the 455 filled rows), so the two never disagree — rule 2 only
 * ever covers a row where «هالك» has not been entered yet.
 *
 * ── "none" means UNKNOWN, and is deliberately not zero-with-confidence ───────
 * On the day this landed, 173 of 688 rows read «لم يُعد بعد» (not counted back
 * yet) and 56 read «الفعلي أكبر من العداد» (good exceeds the counter — rule 2
 * would go negative, so it is refused rather than clamped to a fake 0).
 * Both still contribute goodUnits to Quality's denominator as zero scrap, which
 * OVERSTATES quality on those rows. That is a reporting problem, not a maths
 * one: `rowCheck` is carried through to the UI so a reader can see which rows
 * are unconfirmed instead of being told a confident number.
 */

// Behaviour matches latinDigits(): both Arabic-Indic ranges fold to 0-9.
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

/** Sheet display text → number, or null when the cell holds nothing usable. */
function cell(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .trim();
  // «غير متاح / N/A» is deliberate filler for an unknown cell, never a zero.
  if (!s || s.includes("غير متاح") || /n\/?a/i.test(s)) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Where a run's scrap number came from. "none" = not known, NOT "zero scrap". */
export type ScrapSource = "logged" | "system" | "none";

/**
 * The only three cells of an «الإنتاج» row this reads.
 *
 * All three are optional and the row may carry anything else: callers pass a
 * whole `SheetRecord`, whose keys depend on which columns the tab actually has
 * that day. A workbook without «الأجمالي سستم» must still resolve — it just
 * never reaches rule 2.
 */
export type ScrapRow = {
  goodUnits?: unknown;
  scrapUnits?: unknown;
  systemTotal?: unknown;
  [key: string]: unknown;
};

export type ResolvedScrap = { scrapUnits: number; source: ScrapSource };

/**
 * Resolve one run's scrap from its own row. See the rules at the top of the file.
 * Never returns a negative number, and never invents one for a row that has not
 * been counted back yet.
 */
export function resolveScrap(row: ScrapRow): ResolvedScrap {
  const logged = cell(row.scrapUnits);
  if (logged !== null) return { scrapUnits: Math.max(0, logged), source: "logged" };

  const system = cell(row.systemTotal);
  const good = cell(row.goodUnits);
  if (system !== null && good !== null) {
    const diff = system - good;
    // diff < 0 is «الفعلي أكبر من العداد» — the counter is behind the hand
    // count, so the difference is not scrap and must not be reported as one.
    if (diff > 0) return { scrapUnits: diff, source: "system" };
    if (diff === 0) return { scrapUnits: 0, source: "system" };
  }
  return { scrapUnits: 0, source: "none" };
}
