/**
 * Sheet date normalization — pure, no I/O.
 *
 * Google Sheets hands dates back as display text whose shape depends on the
 * spreadsheet locale: "6/30/2026" (US), "30/6/2026" (day-first), ISO, or even
 * a raw serial number. Supervisors also type dates by hand, sometimes with
 * Arabic-Indic digits. Everything downstream (month filter, trends) needs one
 * canonical form, so: normalizeDate(anything) → "YYYY-MM-DD" | "" (unparseable).
 */

const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Arabic-Indic / Extended (Persian) digits → ASCII. */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d);
}

const pad2 = (x: number) => String(x).padStart(2, "0");

function ymd(y: number, m: number, d: number): string {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Normalize a sheet cell to ISO "YYYY-MM-DD", or "" when it can't be read.
 *
 * Accepted: ISO (y-m-d, y/m/d), slash/dot/dash dates (m/d/y or d/m/y), and
 * Excel/Sheets serial numbers.
 *
 * ── Disambiguating d/m from m/d ──────────────────────────────────────────
 * Whichever part exceeds 12 settles it. When BOTH are ≤ 12 the workbook holds
 * two genuinely different conventions in the same column, and zero-padding is
 * what tells them apart. Verified against «الإنتاج» and «تسجيل الإنتاج» on
 * 2026-08-09:
 *
 *   "01/08 /2026" … "04/08 /2026"   hand-typed TEXT, zero-padded  → DAY-first
 *   "8/5/2026" … "8/8/2026"         real dates RENDERED by Sheets → MONTH-first
 *
 * Those two groups are consecutive days (1–4 Aug, then 5–8 Aug), so the reading
 * is not a guess: the padded group continues into 30/06, 13/07, 19/07 … where
 * the first part exceeds 12, and the unpadded group continues the calendar from
 * where the padded one stops. The crew types dd/mm and Sheets renders m/d/yyyy
 * unpadded in this spreadsheet's locale — a cell Sheets could not parse (note
 * the stray space) stays as the typist's day-first text.
 *
 * So: a zero-padded leading part means the crew typed it → day-first. An
 * unpadded ambiguous pair came from Sheets' own renderer → month-first.
 *
 * Reading the underlying serial instead would remove the guesswork entirely,
 * but the bridge returns displayValues only and redeploying it is out of scope.
 */
export function normalizeDate(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return "";
  let s = latinDigits(String(raw).trim());
  if (!s) return "";
  // Invisible bidi marks (LRM/RLM/ALM) sneak into cells on RTL sheets.
  s = s.replace(/[‎‏؜]/g, "");
  // Strip a trailing time part ("6/30/2026 14:00" / ISO "T…").
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?$/, "").trim();
  // Sheets date formats sometimes render stray spaces around separators
  // ("14/07 /2026" was observed live) — collapse them so the patterns match.
  s = s.replace(/\s*([/.\-])\s*/g, "$1");

  // ISO-ish: 2026-06-30 / 2026/6/30
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);

  // a/b/yyyy with slash, dash or dot
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return ymd(y, b, a); // day-first
    if (b > 12 && a <= 12) return ymd(y, a, b); // month-first
    // Ambiguous — fall back to the padding tell documented above.
    return m[1].length === 2 ? ymd(y, b, a) : ymd(y, a, b);
  }

  // a/b/yy → 20yy
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = 2000 + +m[3];
    if (a > 12 && b <= 12) return ymd(y, b, a);
    if (b > 12 && a <= 12) return ymd(y, a, b);
    return m[1].length === 2 ? ymd(y, b, a) : ymd(y, a, b);
  }

  // Excel/Sheets serial (days since 1899-12-30). 30000≈1982, 60000≈2064.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 30000 && serial < 60000) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      const d = new Date(ms);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  return "";
}

/** "2026-06-30" → "2026-06"; "" stays "". */
export function monthOf(iso: string): string {
  return iso ? iso.slice(0, 7) : "";
}

/* --------------------------- the factory's day ---------------------------- */

/** Cairo is UTC+2 year-round (Egypt dropped DST again in 2015 → reinstated 2023;
 *  the workbook's own timestamps are UTC+2, so we match it rather than the host). */
const CAIRO_OFFSET_MIN = 120;
/** The floor's day starts at 08:00 — «تسجيل الإنتاج» runs its 24 hour columns
 *  08:00 → 07:00 on ONE dated row, so 02:00 belongs to the PREVIOUS date. */
export const FACTORY_DAY_START_HOUR = 8;

/**
 * The production date a moment belongs to, as the floor counts it: Cairo time
 * shifted back by the 08:00 start, formatted "YYYY-MM-DD".
 *
 * A stoppage logged at 02:00 on 8 Aug is part of the shift that began 08:00 on
 * 7 Aug, so it must join to the 7 Aug production rows — using the calendar date
 * would file it against a day the crew never worked.
 */
export function factoryDay(at: Date | number = Date.now()): string {
  const ms = typeof at === "number" ? at : at.getTime();
  const shifted = ms + CAIRO_OFFSET_MIN * 60000 - FACTORY_DAY_START_HOUR * 3600000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Display an ISO date in the reader's locale (falls back to the raw string). */
export function formatDate(iso: string, lang: "ar" | "en"): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}
