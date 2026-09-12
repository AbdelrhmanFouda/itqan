/**
 * Numbers are written in Latin digits in BOTH languages (owner's word,
 * 2026-09-04: "write the numbers always in english").
 *
 * Two halves: the locale in lib/format.ts really renders Latin digits under
 * Node's ICU, and no source file formats through a bare "ar-EG" any more —
 * the static half is what stops the next page from bringing «٩٢٬٤٢٣» back.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOCALE_AR, LOCALE_EN, numLocale, fmtInt, hasArabicDigits } from "../lib/format.ts";
import { latinDigits } from "../lib/dates.ts";
import { latinDigits as moldDigits } from "../lib/mold-number.ts";
import { latinDigits as runJoinDigits } from "../lib/run-join.ts";
import { latinDigits as workOrderDigits } from "../lib/work-orders.ts";
import { downtimeKey } from "../lib/downtime.ts";
import { resolveScrap } from "../lib/scrap.ts";
import { nameKey } from "../lib/master-lookup.ts";
import { itemKey } from "../lib/stock.ts";
import { normalizeText } from "../lib/storage-filter.ts";
import { foldArabic } from "../lib/issues.ts";
import { normalizeArabic } from "../lib/prod-meta.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("the Arabic locale renders Latin digits and separators", () => {
  assert.equal((92423.567).toLocaleString(LOCALE_AR), "92,423.567");
  assert.equal((92423.567).toLocaleString(LOCALE_AR, { maximumFractionDigits: 0 }), "92,424");
  assert.equal((0.127).toLocaleString(LOCALE_AR, { style: "percent", maximumFractionDigits: 1 }).replace(/[‎‏]/g, ""), "12.7%");
  for (const s of [(1234.5).toLocaleString(LOCALE_AR), fmtInt(1234567, true), fmtInt(3165, true)]) {
    assert.equal(hasArabicDigits(s), false, `«${s}» carries Arabic-Indic digits`);
  }
});

test("…while day and month names stay Arabic", () => {
  const d = new Date(2026, 8, 4); // 4 Sep 2026, a Friday
  const s = d.toLocaleDateString(LOCALE_AR, { weekday: "long", day: "numeric", month: "long" });
  assert.ok(s.includes("الجمعة") && s.includes("سبتمبر"), s);
  assert.ok(s.includes("4"), s);
  assert.equal(hasArabicDigits(s), false, s);
});

test("English is unchanged", () => {
  assert.equal(numLocale(false), LOCALE_EN);
  assert.equal(numLocale(true), LOCALE_AR);
  assert.equal(fmtInt(1234567, false), "1,234,567");
  assert.equal(fmtInt(NaN, false), "0");
});

test("no source file formats through a bare \"ar-EG\" any more", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, "utf8");
        const rel = path.relative(ROOT, p).replace(/\\/g, "/");
        if (rel.startsWith("lib/i18n") || rel === "lib/format.ts") continue; // string tables / the definition
        src.split("\n").forEach((line, i) => {
          if (/"ar-EG"/.test(line) || /'ar-EG'/.test(line) || /toLocale\w+\(\s*"ar"\s*[,)]/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
  };
  for (const d of ["app", "components", "lib", "context"]) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, [], "use LOCALE_AR from lib/format.ts");
});

test("lib/dates.ts (import-free) repeats the same locale literal", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib", "dates.ts"), "utf8");
  assert.ok(src.includes(`"${LOCALE_AR}"`), "lib/dates.ts must format Arabic dates with the Latin-digit locale");
});

/* ------------------------- the ten latinDigits copies ---------------------- */

/**
 * Ten modules fold Arabic-Indic and Persian digits to Latin with their own
 * private copy of the rule. The duplication is DELIBERATE: `npm test` loads
 * each of these modules directly with node --test, and tsconfig (moduleResolution
 * bundler, noEmit, no allowImportingTsExtensions) gives no import form that both
 * tsc and node resolve — so a shared lib/digits.ts would break the suite. This
 * corpus is what keeps the ten copies honest: every one of the 20 digit
 * characters must fold the same way lib/dates.ts folds it.
 */
const AR_INDIC = [..."٠١٢٣٤٥٦٧٨٩"];
const PERSIAN = [..."۰۱۲۳۴۵۶۷۸۹"];
const DIGITS = [...AR_INDIC, ...PERSIAN];

test("all ten latinDigits copies agree with lib/dates.ts over the 20 digit characters", () => {
  for (const d of DIGITS) {
    const want = latinDigits(d);
    assert.match(want, /^[0-9]$/, `lib/dates.ts left «${d}» unfolded`);

    assert.equal(moldDigits(d), want, `lib/mold-number.ts on «${d}»`);
    assert.equal(runJoinDigits(d), want, `lib/run-join.ts on «${d}»`);
    assert.equal(workOrderDigits(d), want, `lib/work-orders.ts on «${d}»`);
    // inline copies, reached through the function that owns each one
    assert.equal(downtimeKey("2026-09-10", d), `2026-09-10|${want}`, `lib/downtime.ts on «${d}»`);
    assert.equal(resolveScrap({ scrapUnits: `1${d}` }).scrapUnits, Number(`1${want}`), `lib/scrap.ts on «${d}»`);
    assert.equal(nameKey(d), want, `lib/master-lookup.ts on «${d}»`);
    assert.equal(itemKey(d), want, `lib/stock.ts on «${d}»`);
    assert.equal(normalizeText(d), want, `lib/storage-filter.ts on «${d}»`);
    assert.equal(foldArabic(d), want, `lib/issues.ts on «${d}»`);
  }
});

test("…and on a whole cell, not just single characters", () => {
  assert.equal(latinDigits("٢٠٢٦/٠٩/١٠"), "2026/09/10");
  assert.equal(workOrderDigits("۳۱۰۰ كجم"), "3100 كجم");
  assert.equal(normalizeText("٣ كيلو"), normalizeText("۳ كيلو"));
});

/* ------------------------- the four Arabic folds --------------------------- */

/**
 * Four modules fold an Arabic string to a comparison key, again import-free and
 * again for the node --test reason above: foldArabic (lib/issues.ts),
 * normalizeArabic (lib/prod-meta.ts), normalizeText (lib/storage-filter.ts) and
 * itemKey (lib/stock.ts). They must agree on the orthography, so «إسطمبة» finds
 * «اسطمبه» wherever the user is typing.
 *
 * Two differences are deliberate and therefore NOT in the corpus:
 *   • normalizeArabic uniquely strips bidi/zero-width marks and terminal
 *     punctuation — it matches sheet cells that carry RTL marks (REASON_BY_TEXT).
 *   • foldArabic does not lowercase or collapse whitespace; its callers
 *     lowercase before calling it, so the corpus is already lower-case and
 *     single-spaced.
 */
const FOLD_CORPUS = [
  "إسطمبة", "اسطمبه", "آلة", "ىوم",   // alef / ya / ta-marbuta spellings
  "مسئول", "مؤشر",                     // ئ → ي and ؤ → و
  "تَشْغِيل", "اسـطمبة",                 // harakat and tatweel drop
  "٣ كيلو", "۳ كيلو",                   // Arabic-Indic and Persian digits
  "abs اسود", "m50",                   // Latin passes through
];

test("the four Arabic folds agree on the spellings that matter", () => {
  for (const s of FOLD_CORPUS) {
    const want = normalizeText(s);
    assert.equal(itemKey(s), want, `lib/stock.ts itemKey on «${s}»`);
    assert.equal(normalizeArabic(s), want, `lib/prod-meta.ts normalizeArabic on «${s}»`);
    assert.equal(foldArabic(s).toLowerCase(), want, `lib/issues.ts foldArabic on «${s}»`);
  }
  // the point of the fold, stated once
  for (const fold of [normalizeText, itemKey, normalizeArabic, (x: string) => foldArabic(x).toLowerCase()]) {
    assert.equal(fold("إسطمبة"), fold("اسطمبه"));
    assert.equal(fold("مسئول"), fold("مسيول"));
    assert.equal(fold("مؤشر"), fold("موشر"));
    assert.equal(fold("٣"), fold("۳"));
  }
});
