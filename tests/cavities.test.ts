/**
 * Reading «الرئيسي» H. Run with `npm test`.
 *
 * Every literal below is a real Master value. The two-part moulds are the point:
 * `4+4` and `2 وش&2 كفر` fire two different parts per shot, and reading only the
 * first number halves the piece count for those moulds.
 *
 * Carried over from tests/sheet-import.test.ts when the paper-photo import was
 * removed — the function outlived the feature it was filed under.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumCavities } from "../lib/cavities.ts";

test("a plain count", () => {
  assert.equal(sumCavities("8"), 8);
  assert.equal(sumCavities(8), 8);
});

test("a two-part mould sums BOTH parts", () => {
  assert.equal(sumCavities("4+4"), 8);
  assert.equal(sumCavities("2 وش&2 كفر"), 4);
});

test("a count with a word after it", () => {
  assert.equal(sumCavities("1 طقم"), 1);
});

test("no count is 0 — which means UNKNOWN, not zero cavities", () => {
  assert.equal(sumCavities(""), 0);
  assert.equal(sumCavities("غير متاح / N/A"), 0);
  assert.equal(sumCavities(null), 0);
  assert.equal(sumCavities(undefined), 0);
});
