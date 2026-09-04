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
