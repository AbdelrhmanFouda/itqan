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
 * Accepted: ISO (y-m-d, y/m/d), slash/dot/dash dates (m/d/y or d/m/y —
 * disambiguated by whichever part exceeds 12; ties assume MONTH-FIRST, the
 * observed Sheets locale), and Excel/Sheets serial numbers.
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
    return ymd(y, a, b); // ambiguous → month-first (matches the sheet's US locale)
  }

  // a/b/yy → 20yy
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = 2000 + +m[3];
    if (a > 12 && b <= 12) return ymd(y, b, a);
    return ymd(y, a, b);
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

/** Display an ISO date in the reader's locale (falls back to the raw string). */
export function formatDate(iso: string, lang: "ar" | "en"): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}
