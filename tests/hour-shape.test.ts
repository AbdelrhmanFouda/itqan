/**
 * Telling the three row shapes apart. Run with `npm test`.
 *
 * This exists because they must never be mixed. Only a genuinely hour-by-hour
 * row can answer "what happened at 14:00?" — a flat row (one constant filled
 * across) and a shift-total row (one cell for the whole shift) say nothing
 * about WHEN output happened, and averaging them into an hour-of-day view
 * beside a real one would invent a pattern that is not in the data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hourShapeOf, hasHourDetail } from "../lib/hour-shape.ts";

const pad = (xs: (number | null)[]) => [...xs, ...Array(24 - xs.length).fill(null)];

test("a genuinely hourly row — readings that differ", () => {
  // 13/07/2026 PQ 4 — 138: 805 at 08:00, 1225 at 09:00. Real variation.
  assert.equal(hourShapeOf(pad([805, 1225, 1180, 1200])), "hourly");
  assert.equal(hasHourDetail("hourly"), true);
});

test("A FLAT ROW IS NOT HOURLY, however many cells it fills", () => {
  // 09/08/2026 زراير: 1062 repeated eleven times. Every shift-half of every row
  // on that page holds exactly one distinct value — the typist multiplied the
  // mean by the cavity count and filled it across. Counting cells would call
  // this eleven hours of information; it is one number.
  assert.equal(hourShapeOf(pad(Array(11).fill(1062))), "flat");
  assert.equal(hourShapeOf(pad([652, 652])), "flat");
  assert.equal(hasHourDetail("flat"), false);
});

test("one filled cell is a whole shift, not one hour", () => {
  // The new shape. The single most dangerous misreading in this change: infer
  // "hours ran" from the count and Performance reads ~12x too high.
  assert.equal(hourShapeOf(pad([22609])), "shiftTotal");
  assert.equal(hourShapeOf(pad([0])), "shiftTotal", "a recorded zero still fills a cell");
  assert.equal(hasHourDetail("shiftTotal"), false);
});

test("no cells at all", () => {
  assert.equal(hourShapeOf(Array(24).fill(null)), "empty");
  assert.equal(hourShapeOf([]), "empty");
  assert.equal(hasHourDetail("empty"), false);
});

test("the shape does not depend on WHERE the filled cells are", () => {
  // An evening shift fills the last twelve columns; a morning one the first.
  const evening = [...Array(12).fill(null), ...Array(12).fill(300)];
  assert.equal(hourShapeOf(evening), "flat");
  const eveningTotal = [...Array(12).fill(null), 3600, ...Array(11).fill(null)];
  assert.equal(hourShapeOf(eveningTotal), "shiftTotal");
});

test("zeros are values, not blanks", () => {
  // A logged 0 means "the machine made nothing that hour" and is information.
  // Treating it as blank would turn a stopped hour into a missing one.
  assert.equal(hourShapeOf(pad([0, 0, 0])), "flat");
  assert.equal(hourShapeOf(pad([0, 174, 210])), "hourly");
});
