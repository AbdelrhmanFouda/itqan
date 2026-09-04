/**
 * The mould number — where «الرئيسي» keeps it, and how to read it.
 *
 * Two places, verified against the live workbook on 2026-09-04 (512 rows):
 *
 *  - **D «كود الاسطمبة»** — filled on 201 rows, always a bare number as the
 *    factory numbers its tooling (50 … 306) or as the customer numbered a set
 *    (001, 01, 1 … for the عداد families, which is why eleven codes repeat).
 *  - **Q «ملاحظات»** — on 26 rows the note IS a mould number, the customer's
 *    own engraved reference: `HD16713`, `KY20176`, `20190R122`, `QH190032`,
 *    `2024QRX097`, `201907`. Twenty-three of those rows also carry a code in
 *    D; **three (r383–385, the دايموند meter parts) have NO code at all** and
 *    the note is the only number the product has.
 *
 * The site shows the number wherever a product is named, so the rule for
 * finding it lives here once — pure, zero imports, unit-tested with the real
 * cell values (tests/mold-number.test.ts) — and every surface (the register,
 * jobs, production, quality) imports it rather than re-deriving it.
 *
 * Reading the notes is deliberately CONSERVATIVE. The column also holds
 * «قديم» / «جديد», a weight derivation («وزن الحبة: 5 قطع = 18 جم»), a
 * material alternative and audit remarks; none of those may ever be shown as a
 * mould number. Two shapes are accepted and nothing else:
 *
 *  1. A LABELLED number — «رقم الاسطمبة HD16713», «كود الاسطمبة: 201907»,
 *     «mold no. QH190032». Any token with a digit counts, because the writer
 *     said what it is.
 *  2. The WHOLE note is one Latin/digit identifier of at least five characters
 *     holding at least four digits (`HD16713`, `201907`). Short numbers («50»),
 *     dates («1-02»), weights («3.6») and slot codes («A17») fail that bar on
 *     purpose — a bare short number in a notes cell could mean anything.
 */

export type MoldNumberSource = "code" | "notes" | "none";

export type MoldNumber = {
  /** What to display: the code, else the number found in the notes, else "". */
  number: string;
  source: MoldNumberSource;
  /** D «كود الاسطمبة» as written (trimmed, Latin digits), "" when blank/filler. */
  code: string;
  /** The identifier found in the notes, "" when the notes hold none. */
  notesNumber: string;
};

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic and Persian digits → Latin. Local copy: this module imports nothing. */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = AR_DIGITS.indexOf(d);
    return String(i >= 0 ? i : FA_DIGITS.indexOf(d));
  });
}

/** «غير متاح / N/A» and its spellings are deliberate filler — read them as blank. */
const FILLER = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);
function clean(v: string | undefined | null): string {
  const s = latinDigits(String(v ?? "")).replace(/\s+/g, " ").trim();
  return FILLER.has(s.toLowerCase()) ? "" : s;
}

// An identifier as the workbook writes them: Latin letters and digits, with
// «-» or «/» allowed inside (a customer's «2024-QRX/097» would still be one token).
const TOKEN = "[A-Za-z0-9][A-Za-z0-9\\-/]*";
// «رقم/كود/نمرة» + optional «ال» + اسطمبة in its spellings (ا/أ/إ, ة/ه), then
// an optional separator, then the token.
const LABEL_AR = new RegExp(`(?:رقم|كود|نمرة)\\s*(?:ال)?[اأإ]سطمب[ةه]?\\s*[:：\\-–]?\\s*(${TOKEN})`);
// «mold/mould/tool» + optional «no./number/#/code», then the token.
const LABEL_EN = new RegExp(`\\b(?:mou?ld|tool)\\s*(?:no\\.?|number|num|#|code|id)?\\s*[:：\\-–]?\\s*(${TOKEN})`, "i");
const BARE = new RegExp(`^${TOKEN}$`);

const hasDigit = (s: string) => /\d/.test(s);
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

/**
 * The mould number written in a notes cell, or "" when the cell holds none.
 * See the module comment for the two shapes accepted.
 */
export function moldNumberFromNotes(notes: string | undefined | null): string {
  const s = clean(notes);
  if (!s) return "";
  const labelled = s.match(LABEL_AR) ?? s.match(LABEL_EN);
  if (labelled && hasDigit(labelled[1])) return labelled[1];
  if (!BARE.test(s) || s.length < 5 || s.length > 24 || digitCount(s) < 4) return "";
  // A token with no letters must be digits only: «2026-07-27» is a date and
  // «1-02» a revision, never a mould number. Letters make it an identifier.
  if (!/[A-Za-z]/.test(s) && !/^\d+$/.test(s)) return "";
  return s;
}

/**
 * A row's mould number from its code and notes cells — the ONE rule every
 * surface uses. The code wins when both exist; the notes number is still
 * returned beside it so a page can show «001 · HD16713» rather than lose the
 * customer's reference.
 */
export function resolveMoldNumber(rec: { code?: string | null; notes?: string | null }): MoldNumber {
  const code = clean(rec.code);
  const notesNumber = moldNumberFromNotes(rec.notes);
  if (code) return { number: code, source: "code", code, notesNumber };
  if (notesNumber) return { number: notesNumber, source: "notes", code: "", notesNumber };
  return { number: "", source: "none", code: "", notesNumber: "" };
}

/** «001 · HD16713» when both exist, else whichever exists, else "". */
export function moldNumberLabel(m: MoldNumber): string {
  if (m.code && m.notesNumber) return `${m.code} · ${m.notesNumber}`;
  return m.number;
}

/**
 * Join key for a product name, the same normalisation the joins in
 * lib/jobs.ts and lib/oee-data.ts use (Arabic digits → Latin, lowercase,
 * collapsed whitespace). Both sides of a comparison must go through it —
 * some names carry a trailing tab («زراير») from the dropdown.
 */
export function moldKey(name: string | undefined | null): string {
  // Filler («غير متاح / N/A») folds to "" — nothing may ever join on it.
  return clean(name).toLowerCase();
}

export type MoldNumberEntry = MoldNumber & {
  /** The product name appears on more than one Master row — the number shown
   *  is the FIRST row's and may belong to a different product with the same
   *  name (26 names were duplicated on 2026-08-27). Say so; never hide it. */
  ambiguous: boolean;
};

/**
 * Product name → its mould number, first Master row wins (the same rule as the
 * sheet's own VLOOKUP and lib/jobs.ts), with `ambiguous` set on names that
 * occur more than once. Rows without a name are skipped.
 */
export function moldNumberIndex(
  rows: Iterable<{ name?: string | null; code?: string | null; notes?: string | null }>,
): Map<string, MoldNumberEntry> {
  const out = new Map<string, MoldNumberEntry>();
  for (const r of rows) {
    const key = moldKey(r.name);
    if (!key) continue;
    const cur = out.get(key);
    if (cur) { cur.ambiguous = true; continue; }
    out.set(key, { ...resolveMoldNumber(r), ambiguous: false });
  }
  return out;
}
