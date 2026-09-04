/**
 * Number and date locales — DIGITS ARE ALWAYS LATIN (owner's word, 2026-09-04:
 * "write the numbers always in english").
 *
 * Until then Arabic mode formatted through the plain ar-EG locale, which renders
 * Arabic-Indic digits and separators («٩٢٬٤٢٣٫٦٧»). ar-EG-u-nu-latn is the same locale
 * with the Unicode numbering-system extension `nu=latn`: Latin digits and
 * separators (92,423.67) while day and month NAMES stay Arabic
 * («الجمعة، 4 سبتمبر»). Verified in Node's ICU:
 *
 *   ar-EG            ٩٢٬٤٢٣٫٥٦٧   ٤‏/٩‏/٢٠٢٦   الجمعة، ٤ سبتمبر   ١٢٫٧٪
 *   ar-EG-u-nu-latn  92,423.567   4‏/9‏/2026   الجمعة، 4 سبتمبر   12.7%
 *
 * Every toLocaleString / toLocaleDateString in the app takes its Arabic locale
 * from here; tests/latin-digits.test.ts pins that no bare ar-EG literal is left
 * anywhere and that this locale really yields Latin digits. Zero imports, so
 * the test runner loads it directly. lib/dates.ts (also import-free) repeats
 * the literal with a comment pointing here — the test checks they agree.
 */

/** Arabic locale, Latin digits. */
export const LOCALE_AR = "ar-EG-u-nu-latn";
/** English locale used for numbers. */
export const LOCALE_EN = "en-US";

/** The number locale for the current language. */
export const numLocale = (isAr: boolean): string => (isAr ? LOCALE_AR : LOCALE_EN);

/** An integer with thousands separators, Latin digits in both languages. */
export const fmtInt = (n: number, isAr: boolean): string =>
  Math.round(Number(n) || 0).toLocaleString(numLocale(isAr));

/** True when a string still carries Arabic-Indic or Persian digits. */
export const hasArabicDigits = (s: string): boolean => /[٠-٩۰-۹]/.test(s);
