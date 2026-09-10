/**
 * The Sheets API transport's cell addressing (lib/google-sheets-api.ts) —
 * the one place a wrong letter would write into the wrong column. Pure
 * helpers only; the module reads env at load and touches no network here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellA1, colLetter, tabRange } from "../lib/google-sheets-api.ts";

test("column numbers → letters like the sheet shows them", () => {
  assert.equal(colLetter(1), "A");
  assert.equal(colLetter(11), "K");   // «أوامر العمل»!K = الحالة
  assert.equal(colLetter(26), "Z");
  assert.equal(colLetter(27), "AA");
  assert.equal(colLetter(52), "AZ");
  assert.equal(colLetter(53), "BA");
});

test("Arabic tab names are quoted for A1 notation, and a quote inside is doubled", () => {
  assert.equal(tabRange("أوامر العمل"), "'أوامر العمل'");
  assert.equal(tabRange("it's"), "'it''s'");
  assert.equal(cellA1("التوقفات", 15, 4), "'التوقفات'!D15");
});
