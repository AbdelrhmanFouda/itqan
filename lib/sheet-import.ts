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
 * The field→value changes for one extracted row: only this shift's twelve hour
 * cells, plus «الأجمالي الفعلي».
 *
 * Deliberately NOT written: «الأجمالي سستم» (27), «المتوقع» (29) and
 * «الكفاءة %» (30) are live formulas. Putting a value in any of them replaces
 * the formula with a frozen number for that row, permanently.
 *
 * A null hour is OMITTED rather than written as "", so a cell the crew left
 * blank is left exactly as the sheet has it instead of being cleared.
 */
export function buildRowChanges(shift: Shift, r: ExtractedRow): Record<string, string> {
  const keys = shiftHourKeys(shift);
  const changes: Record<string, string> = {};
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
export function writableKeys(shift: Shift): Set<string> {
  return new Set([...shiftHourKeys(shift), "actualTotal"]);
}

/** Columns that must NEVER be written, by field key. */
export const FORMULA_KEYS = ["systemTotal", "expected", "efficiency"] as const;
