/**
 * Reading a photographed paper production sheet into «تسجيل الإنتاج».
 * Pure logic, no imports — unit-testable without Gemini or the bridge.
 *
 * THE PAPER. One page per SHIFT, covering every machine:
 *
 *   الأنتاج اليومي لماكينات الحقن — الوردية المسائية        09/08/2026
 *   # | التاريخ | الماكينة/الكود | المنتج/الاسطمبة | 8:00 … 7:00 | سستم | الفعلي
 *
 * Twelve hour columns labelled 8:00→7:00 on a 12-hour clock.
 *
 * THE SHEET. One row per machine per DAY, with TWENTY-FOUR hour columns
 * (08:00→07:00, indices 3..26). Both shifts share the row: the morning fills the
 * first twelve, the evening the last twelve.
 *
 * So the paper's "8:00" is NOT the sheet's 08:00 on an evening sheet — it is
 * 20:00. Verified against 09/08/2026, where every row carries one value across
 * 09:00–19:00 and a different one across 21:00–07:00.
 *
 * Getting this backwards would file a night's output as a morning's, silently,
 * on the crew's own log. Hence this module, and hence the tests.
 */

/** Which half of the day a paper sheet covers. */
export type Shift = "morning" | "evening";

/**
 * The pre-filled band. «تسجيل الإنتاج» carries per-row formulas in AB/AD/AE and
 * data validation in A/B/C all the way to row 998, and the AF:AG:AH spill is
 * anchored at row 5. A row written INSIDE this band inherits all of that; a row
 * appended after it (which is what `sheet.appendRow()` would do — getLastRow()+1
 * = 999) gets none of it and looks broken forever.
 *
 * So a "new row" here is never an append: it is the next blank row in 5…998.
 * Data ended around row 206 on 2026-08-09, leaving ~776 free. When they run out
 * the band must be extended BY HAND in the sheet — see `bandExhausted`.
 */
export const BAND_FIRST_ROW = 5;
export const BAND_LAST_ROW = 998;

/**
 * The hour field keys of ENTITIES.hourly, in sheet-column order (indices 3..26).
 * Mirrors HOUR_KEYS in lib/hourly.ts — duplicated so this module stays
 * import-free, and asserted equal in the tests.
 */
export const SHEET_HOUR_KEYS = [
  "h08", "h09", "h10", "h11", "h12", "h13", "h14", "h15", "h16", "h17", "h18", "h19",
  "h20", "h21", "h22", "h23", "h00", "h01", "h02", "h03", "h04", "h05", "h06", "h07",
] as const;

export const HOURS_PER_SHIFT = 12;

/** The twelve field keys a shift's paper columns map onto, left-to-right. */
export function shiftHourKeys(shift: Shift): string[] {
  const start = shift === "morning" ? 0 : HOURS_PER_SHIFT;
  return SHEET_HOUR_KEYS.slice(start, start + HOURS_PER_SHIFT) as unknown as string[];
}

/**
 * Which shift a sheet is, from its printed Arabic heading.
 * Returns null when the heading does not say — the caller must then ASK rather
 * than assume, because assuming costs a whole shift of data.
 */
export function detectShift(heading: string): Shift | null {
  const h = (heading || "").replace(/\s+/g, " ");
  if (/مسائ|مساء|ليل/.test(h)) return "evening";
  if (/صباح|نهار/.test(h)) return "morning";
  return null;
}

/* ------------------------------ numbers ---------------------------------- */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

/**
 * A handwritten cell to a number. The crew writes Arabic-Indic numerals, and
 * the model may return them verbatim. Anything that is not a clean number —
 * a dash, «متوقف صيانة» scrawled across the row, an empty cell — becomes null,
 * NEVER zero: a zero is a real reading meaning "the machine made nothing", and
 * inventing one would drag the day's efficiency down for a cell nobody filled.
 */
export function parseCell(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .replace(/[,٬\s]/g, "")
    .trim();
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------- extracted rows ------------------------------- */

/** One machine's line as read off the paper. */
export type ExtractedRow = {
  machine: string;                 // as printed: "PQ 1 — 550"
  product: string;                 // as printed/handwritten
  hours: (number | null)[];        // exactly 12, left-to-right on the paper
  actualTotal: number | null;      // «الأجمالي الفعلي»
};

/** A row already in «تسجيل الإنتاج» that an extracted row might belong to. */
export type SheetRow = { row: number; date: string; machine: string; product: string };

const norm = (s: string | undefined) =>
  (s ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Find the sheet row an extracted line belongs to.
 *
 * Matched on date + machine + PRODUCT, not date + machine. On 09/08/2026 the
 * same machine legitimately has two rows — PQ 12 — 180 ran «عجلة مكنسة» in the
 * morning and «جوان عجلة مكنسة» in the evening. Matching on the machine alone
 * would write a mould-change shift's output onto the previous product's row.
 *
 * Returns the sheet row number, or null when there is none — in which case the
 * caller appends a new row, which is what the sheet itself does.
 */
export function matchSheetRow(
  rows: SheetRow[],
  date: string,
  r: { machine: string; product: string },
): number | null {
  const hit = rows.find(
    (x) => x.date === date && norm(x.machine) === norm(r.machine) && norm(x.product) === norm(r.product),
  );
  return hit ? hit.row : null;
}

/**
 * Master's cavity column is free text: «4+4», «2 وش&2 كفر», «1 طقم», «8».
 * This is the parser `lib/jobs.ts` has always used and which matches what the
 * sheet's own formulas do; it lives here now so the import and the job maths
 * cannot drift into two different answers for the same mould.
 */
export function sumCavities(v: unknown): number {
  const s = String(v ?? "");
  const a = s.match(/^[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
  const b = s.match(/[+&]\s*([0-9]+(?:\.[0-9]+)?)/);
  return (a ? Number(a[1]) : 0) + (b ? Number(b[1]) : 0);
}

/* --------------------- shots → pieces, and hour shape --------------------- */

/**
 * SHOTS vs PIECES. Measured against 09/08/2026: كرسي paper 23 → sheet 23 (×1),
 * كفر شفاف 80 → 160 (×2), زراير 118 → 1062 (×9). Exact integers on three
 * products, each equal to that mould's cavity count in «الرئيسي» H. The paper
 * counts the machine's SHOTS; the sheet counts PIECES.
 *
 * ⚠ Not confirmed in words by whoever types the sheet — the question is written
 * out in `docs/QUESTIONS-SHEET-OWNER.md`. Until it is answered, the multiplier
 * is a per-row EDITABLE field in the preview, defaulted from Master and always
 * shown next to the raw paper reading, so a wrong default is visible before any
 * write rather than after one.
 */
export type ScaleMode = "faithful" | "flatten";

/**
 * Apply the multiplier to a paper row's twelve cells.
 *
 * `faithful` keeps each hour's own reading — the honest transcription.
 * `flatten` writes ONE constant (the mean of the readings) into exactly the
 * cells that had a reading, which is the shape every historical row has: on
 * paper 09/08 reads `١١٨ ١١٨ ١١٩ ١١٩`, in the sheet it is `1062 ×11`. Whoever
 * types the sheet takes a representative rate and fills right.
 *
 * Either way a null stays null: a cell nobody filled must not become a 0, and
 * flatten must not invent an hour the machine did not run.
 */
export function scaleHours(
  hours: (number | null)[], multiplier: number, mode: ScaleMode = "faithful",
): (number | null)[] {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  if (mode === "faithful") {
    return hours.map((h) => (h === null || h === undefined ? null : Math.round(h * m)));
  }
  const filled = hours.filter((h): h is number => h !== null && h !== undefined);
  if (filled.length === 0) return hours.map(() => null);
  const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
  const constant = Math.round(mean * m);
  return hours.map((h) => (h === null || h === undefined ? null : constant));
}

/* --------------------------- free rows in the band ------------------------ */

/**
 * The next `count` blank rows inside the pre-filled band.
 *
 * `occupied` must be built from the IDENTITY and DATA columns only (date /
 * machine / product / the hour cells) — never from AB سستم, which is `=SUM(...)`
 * pre-filled to row 998 and therefore renders "0" on every blank row. Counting
 * that as content would report the band full at row 5 and the feature would
 * refuse to ever add a row.
 */
export function findFreeRows(
  occupied: Set<number>, count: number,
  firstRow = BAND_FIRST_ROW, lastRow = BAND_LAST_ROW,
): { rows: number[]; bandExhausted: boolean } {
  const rows: number[] = [];
  for (let r = firstRow; r <= lastRow && rows.length < count; r++) {
    if (!occupied.has(r)) rows.push(r);
  }
  return { rows, bandExhausted: rows.length < count };
}

/* ------------------------------- the changes ------------------------------ */

/** How a row is being written: onto an existing row, or into a blank one. */
export type WriteMode = "update" | "create";

/**
 * Identity columns A–D. Written ONLY when filling a blank row — on an existing
 * row they are what the match was made on, so rewriting them can only corrupt.
 */
export const IDENTITY_KEYS = ["date", "shift", "machine", "product"] as const;

/**
 * The field→value changes for one extracted row: only this shift's twelve hour
 * cells, plus «الأجمالي الفعلي» — and, on a NEW row only, the four identity
 * columns, because a blank row with no date or machine can never be matched or
 * read again.
 *
 * Deliberately NOT written: «الأجمالي سستم» (27), «المتوقع» (29) and
 * «الكفاءة %» (30) are live formulas. Putting a value in any of them replaces
 * the formula with a frozen number for that row, permanently.
 *
 * A null hour is OMITTED rather than written as "", so a cell the crew left
 * blank is left exactly as the sheet has it instead of being cleared.
 */
export function buildRowChanges(
  shift: Shift,
  r: ExtractedRow,
  mode: WriteMode = "update",
  identity?: { date: string; shift: string; machine: string; product: string },
): Record<string, string> {
  const keys = shiftHourKeys(shift);
  const changes: Record<string, string> = {};
  if (mode === "create" && identity) {
    if (identity.date) changes.date = identity.date;
    if (identity.shift) changes.shift = identity.shift;
    if (identity.machine) changes.machine = identity.machine;
    if (identity.product) changes.product = identity.product;
  }
  keys.forEach((key, i) => {
    const v = r.hours[i];
    if (v !== null && v !== undefined) changes[key] = String(v);
  });
  if (r.actualTotal !== null && r.actualTotal !== undefined) {
    changes.actualTotal = String(r.actualTotal);
  }
  return changes;
}

/** Field keys this module will ever write — the allow-list the writer enforces. */
export function writableKeys(shift: Shift, mode: WriteMode = "update"): Set<string> {
  const keys = [...shiftHourKeys(shift), "actualTotal"];
  if (mode === "create") keys.push(...IDENTITY_KEYS);
  return new Set(keys);
}

/**
 * The last gate before the bridge is called. Every change set goes through this
 * on the SERVER at confirm time, recomputed from the sheet as it is right then —
 * not trusted from the browser, and not carried over from the preview.
 *
 * Returns the offending keys rather than throwing, so the caller can report
 * exactly which row and which column refused and write nothing at all.
 */
export function validateRowChanges(
  changes: Record<string, string>, shift: Shift, mode: WriteMode = "update",
): { ok: true } | { ok: false; bad: string[] } {
  const allowed = writableKeys(shift, mode);
  const bad = Object.keys(changes).filter((k) => !allowed.has(k));
  return bad.length === 0 ? { ok: true } : { ok: false, bad };
}

/** Columns that must NEVER be written, by field key. */
export const FORMULA_KEYS = ["systemTotal", "expected", "efficiency"] as const;
