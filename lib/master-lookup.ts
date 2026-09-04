/**
 * Locating a product's row in «الرئيسي» — by NAME, and only by name.
 *
 * Everything in the workbook joins on the product name (Master column C).
 * The mould code (column D) is NOT an identity: eleven codes repeat, because
 * customers number their own tool sets from 1 — «عدسه شفاف» of المصرية الذكية
 * is code 6 and so is «زراير» of مينا صبحي's work order. On 2026-09-04 the job
 * detail route still matched "code OR name, first row wins", and for five of
 * the ten live work orders that returned another customer's product: job
 * 3/1/26 «زراير» (code 6) was shown «عدسه شفاف»'s weight, material, cavities
 * and defects, and its edit-standard button would have written to that row.
 * ITQAN-CONTEXT.md had said it since August: *never join jobs to Master on
 * mold code.* This module is where that rule now lives.
 *
 * Pure, zero imports; pinned by tests/master-lookup.test.ts with the live
 * job/Master pairs of that day.
 */

export type NamedRow = { row: number; name?: string | null };

/**
 * The join key for a product name — the SAME folding as moldKey() in
 * lib/mold-number.ts (Arabic-Indic digits → Latin, filler → "", lowercase,
 * whitespace collapsed). Copied rather than imported on purpose: a module
 * Node's test runner loads directly may import nothing (the trade every pure
 * module here makes), and tests/master-lookup.test.ts asserts the two
 * functions agree on the values that matter.
 */
export function nameKey(name: string | undefined | null): string {
  const s = String(name ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
  const lower = s.toLowerCase();
  return FILLER.has(lower) ? "" : lower;
}
const FILLER = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);
const moldKey = nameKey;

export type MasterMatch<T> =
  | { ok: true; row: T; ambiguous: false }
  | { ok: false; reason: "no_name" | "not_found" | "identity_mismatch"; hits: T[] };

/**
 * The single Master row that owns `name`.
 *
 * - `preferRow`: a row number the caller holds from an earlier read. If that
 *   row still carries the name, it wins — a colleague inserting rows above it
 *   moves a product without renaming it, and the fresh row is what we want.
 * - Otherwise every row whose name folds to the same key is collected; exactly
 *   one is a match, several are `identity_mismatch` (26 names were duplicated
 *   on 2026-08-27 — «سماعة اريون» twice, the رشاش families…), none is
 *   `not_found`. A match is never guessed from a duplicated name, because the
 *   caller may be about to WRITE to it.
 *
 * Both sides fold through moldKey(): Arabic-Indic digits, case, and whitespace
 * — «زراير» carries a trailing tab from the dropdown and one-sided trimming
 * would break the match.
 */
export function masterRowByName<T extends NamedRow>(
  rows: readonly T[],
  name: string | null | undefined,
  preferRow?: number,
): MasterMatch<T> {
  const key = moldKey(name);
  if (!key) return { ok: false, reason: "no_name", hits: [] };
  if (preferRow !== undefined) {
    const kept = rows.find((r) => r.row === preferRow && moldKey(r.name) === key);
    if (kept) return { ok: true, row: kept, ambiguous: false };
  }
  const hits = rows.filter((r) => moldKey(r.name) === key);
  if (hits.length === 1) return { ok: true, row: hits[0], ambiguous: false };
  if (hits.length === 0) return { ok: false, reason: "not_found", hits };
  return { ok: false, reason: "identity_mismatch", hits };
}

/**
 * The row to DISPLAY for a product: first matching row, plus whether the
 * name is duplicated — the same "first row wins, say so" rule as the sheet's
 * VLOOKUP and lib/jobs.ts. For a read the first row is still useful (the
 * page flags the ambiguity); for a write use masterRowByName(), which refuses.
 */
export function masterRowForDisplay<T extends NamedRow>(
  rows: readonly T[],
  name: string | null | undefined,
): { row: T | null; ambiguous: boolean } {
  const key = moldKey(name);
  if (!key) return { row: null, ambiguous: false };
  let first: T | null = null;
  let n = 0;
  for (const r of rows) {
    if (moldKey(r.name) !== key) continue;
    n++;
    if (!first) first = r;
  }
  return { row: first, ambiguous: n > 1 };
}
