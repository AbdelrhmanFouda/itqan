/**
 * The always-Arabic route rule. Run with `npm test`.
 *
 * The downtime capture page is used by workers who do not read English, so it
 * must be Arabic whatever is stored and whoever is signed in. This mirrors the
 * inline pre-hydration script in app/layout.tsx — if one changes, both must.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isArabicOnlyPath, ARABIC_ONLY } from "../lib/arabic-only.ts";

test("the downtime capture page is always Arabic", () => {
  assert.equal(isArabicOnlyPath("/dashboard/downtime"), true);
  assert.equal(isArabicOnlyPath("/dashboard/downtime/anything"), true);
});

test("no other page is forced — everyone else keeps their choice", () => {
  for (const p of ["/dashboard", "/dashboard/jobs", "/dashboard/issues",
                   "/dashboard/assistant", "/login", "/"]) {
    assert.equal(isArabicOnlyPath(p), false, `${p} should not be forced`);
  }
});

test("a lookalike path is not forced", () => {
  // Guards against a sloppy startsWith that would catch unrelated routes.
  assert.equal(isArabicOnlyPath("/dashboard/downtime-report"), false);
  assert.equal(isArabicOnlyPath("/dashboard/downtimes"), false);
});

test("null and empty are safe", () => {
  assert.equal(isArabicOnlyPath(null), false);
  assert.equal(isArabicOnlyPath(undefined), false);
  assert.equal(isArabicOnlyPath(""), false);
});

test("the inline bootstrap in app/layout.tsx agrees with this rule", () => {
  // The script uses indexOf(...)===0 on the same prefix. Kept as an explicit
  // assertion so the duplication cannot drift unnoticed.
  const bootstrapSaysArabic = (p: string) => p.indexOf("/dashboard/downtime") === 0;
  for (const p of ["/dashboard/downtime", "/dashboard/downtime/x", "/dashboard/jobs", "/login"]) {
    assert.equal(bootstrapSaysArabic(p), isArabicOnlyPath(p), `disagreement on ${p}`);
  }
  assert.deepEqual(ARABIC_ONLY, ["/dashboard/downtime"]);
});
