/**
 * What to do after a bridge write that reported failure.
 *
 * ── The hazard ────────────────────────────────────────────────────────────
 * The bridge's `updates` action is a bare loop of `setValue` calls with no
 * try/catch. `setValue` ENFORCES a cell's data validation, so one rejected cell
 * throws out of `doPost` — and the cells written BEFORE it are already
 * committed while every cell after it is silently dropped. The caller gets an
 * HTML error page and no idea that half its write landed.
 *
 * Measured on 2026-08-14: writing «عطل» (a real reason, but not one of the
 * eight in «التوقفات»!C's dropdown) into C2 left row 2 holding a date, a
 * machine, and seven empty cells.
 *
 * ── Why the recovery lives here, and why it is not total ──────────────────
 * The bridge returns DISPLAY VALUES, never the underlying cell. So a snapshot
 * taken before the write is a snapshot of what the cells *looked like*, and
 * writing a display value back is not always the same as putting the old value
 * back. Two shapes in this workbook are actively dangerous to re-inject:
 *
 *   • a date — it holds TWO conventions in one column, so restoring the string
 *     "09/08/2026" could store 8 September. That is the bug that once hid a
 *     month of August production.
 *   • a time — Sheets renders it without the leading zero, so "8:00" goes back
 *     in as something the column may render differently again.
 *
 * A number, a blank, and plain text all restore faithfully. So this module
 * splits the failed write into what can be put back honestly and what cannot,
 * and the caller REPORTS the remainder rather than guessing at it. A wrong
 * value quietly restored is worse than a right one loudly left alone.
 *
 * Zero imports, so Node's test runner can load it directly — the same trade
 * lib/downtime.ts, lib/oee.ts and lib/run-join.ts make.
 */

export type WriteCell = { row: number; col: number; value: string };

/**
 * Can this display value be written back and be certain to store what the cell
 * stored before?
 *
 * Deliberately conservative: anything that Sheets re-interprets on the way in
 * (dates, times, formulas) answers false, and the caller strands it rather than
 * risking a silent corruption.
 */
export function isFaithfullyRestorable(v: string): boolean {
  const s = (v ?? "").trim();
  if (s === "") return true;                      // blank restores to blank, always
  if (s.startsWith("=")) return false;            // would be re-injected as a live formula
  if (s.startsWith("'")) return false;            // Sheets' own "force text" prefix
  // A time — «التوقفات»!E/F and any hh:mm cell. Sheets re-parses and re-renders.
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i.test(s)) return false;
  // A date in any of the shapes this workbook holds, including "14/07 /2026".
  if (/^\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}$/.test(s)) return false;
  // A plain number (including grouped and percent) — restores exactly.
  if (/^-?\d[\d,]*(\.\d+)?%?$/.test(s)) return true;
  // Anything with a digit-separator-digit run in it could still be read as a
  // date by a locale we are not sure of. Text without one is safe.
  if (/\d\s*[/.-]\s*\d/.test(s)) return false;
  return true;
}

export type RollbackPlan = {
  /** Cells our write changed and that we can put back honestly. */
  restore: WriteCell[];
  /** Cells our write changed that we must NOT guess at — reported, not touched. */
  stranded: WriteCell[];
  /** How many of the batch's cells actually landed before the bridge threw. */
  applied: number;
};

/**
 * Work out what a failed batch actually did, and what can be undone.
 *
 * `before` and `after` are the display values of the SAME target cells, read
 * either side of the write. A cell whose value did not move was never written —
 * the throw happened before it — and needs nothing. A cell that moved is one we
 * wrote, and the question is only whether its previous value can be restored.
 *
 * The comparison is on `before` vs `after`, never on "does it now equal what we
 * tried to write": a date we sent as `2026-08-09` comes back rendered
 * `09/08/2026`, so equality against our own payload would report a successful
 * write as an untouched cell.
 *
 * ⚠ A colleague editing one of these exact cells in the seconds between the two
 * reads would be indistinguishable from our own write, and would be rolled back
 * with it. That window is the price of not leaving a half-written row; it is
 * seconds long, and the alternative failure is silent.
 */
export function planRollback(
  targets: WriteCell[],
  before: string[],
  after: string[],
): RollbackPlan {
  const restore: WriteCell[] = [];
  const stranded: WriteCell[] = [];
  let applied = 0;

  for (let i = 0; i < targets.length; i++) {
    const was = before[i] ?? "";
    const now = after[i] ?? "";
    if (was === now) continue; // never written — the bridge threw before it
    applied++;
    if (isFaithfullyRestorable(was)) restore.push({ ...targets[i], value: was });
    else stranded.push({ ...targets[i], value: now });
  }

  return { restore, stranded, applied };
}

/** "row 12 col 3" → "R12C3", for a log line a person can act on. */
export const cellRef = (c: WriteCell): string => `R${c.row}C${c.col}`;
