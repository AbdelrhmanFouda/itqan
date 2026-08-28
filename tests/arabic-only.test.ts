/**
 * The always-Arabic route rule. Run with `npm test`.
 *
 * THE LIST IS EMPTY since 2026-08-28, at the owner's word: forcing the
 * downtime page to Arabic also forced HIM to Arabic (toggle hidden) every
 * time he opened the tab. The worker protection moved to the site-wide
 * DEFAULT language, which is now Arabic — a worker who never touches the
 * toggle sees Arabic everywhere without any route being forced.
 *
 * These tests pin the reversal: nothing is forced, and the mechanism still
 * behaves safely if a route is ever re-added.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isArabicOnlyPath, ARABIC_ONLY } from "../lib/arabic-only.ts";

test("no route is forced to Arabic — the owner reversed the forcing on 2026-08-28", () => {
  assert.deepEqual(ARABIC_ONLY, [], "re-adding a forced route is an owner decision, not housekeeping");
});

test("the downtime page follows the chosen language like every other page", () => {
  for (const p of ["/dashboard/downtime", "/dashboard/downtime/x", "/dashboard",
                   "/dashboard/jobs", "/login", "/"]) {
    assert.equal(isArabicOnlyPath(p), false, `${p} should not be forced`);
  }
});

test("null and empty are safe", () => {
  assert.equal(isArabicOnlyPath(null), false);
  assert.equal(isArabicOnlyPath(undefined), false);
  assert.equal(isArabicOnlyPath(""), false);
});

test("the mechanism still matches by whole path segment if a route returns", () => {
  // Guards the startsWith logic against lookalike-prefix bugs, so re-adding
  // a route later cannot silently catch unrelated pages.
  const was = ARABIC_ONLY.length;
  ARABIC_ONLY.push("/dashboard/downtime");
  try {
    assert.equal(isArabicOnlyPath("/dashboard/downtime"), true);
    assert.equal(isArabicOnlyPath("/dashboard/downtime/x"), true);
    assert.equal(isArabicOnlyPath("/dashboard/downtime-report"), false);
    assert.equal(isArabicOnlyPath("/dashboard/downtimes"), false);
  } finally {
    ARABIC_ONLY.length = was;
  }
});
