/**
 * ageLabel (lib/format.ts) — the «الأرقام من قبل …» line the floor pages show
 * when the server served a copy older than a minute (2026-09-09, speed).
 * Latin digits in both languages, by construction. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, hasArabicDigits } from "../lib/format.ts";

test("seconds under a minute, then minutes, then hours", () => {
  assert.equal(ageLabel(0, false), "0 s");
  assert.equal(ageLabel(45_000, false), "45 s");
  assert.equal(ageLabel(90_000, false), "2 min");
  assert.equal(ageLabel(29 * 60_000, false), "29 min");
  assert.equal(ageLabel(3 * 3_600_000, false), "3 h");
});

test("Arabic wording, Latin digits", () => {
  assert.equal(ageLabel(45_000, true), "45 ثانية");
  assert.equal(ageLabel(5 * 60_000, true), "5 دقيقة");
  assert.equal(ageLabel(2 * 3_600_000, true), "2 ساعة");
  for (const ms of [0, 45_000, 5 * 60_000, 2 * 3_600_000]) assert.equal(hasArabicDigits(ageLabel(ms, true)), false);
});

test("a negative or absurd age is never shown as such", () => {
  assert.equal(ageLabel(-5000, false), "0 s");
});
