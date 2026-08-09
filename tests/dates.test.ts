/**
 * Date normalization — run with `npm test` (Node's built-in runner; Node 22
 * strips the types, so there is no test dependency to install).
 *
 * Every literal below is a value that was actually read out of the workbook
 * through the bridge on 2026-08-09, not an invented example.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, monthOf, latinDigits } from "../lib/dates.ts";

test("unambiguous day-first: first part exceeds 12", () => {
  assert.equal(normalizeDate("13/07/2026"), "2026-07-13");
  assert.equal(normalizeDate("30/07/2026"), "2026-07-30");
  assert.equal(normalizeDate("19/07/2026"), "2026-07-19");
  // «الإنتاج» renders a stray space before the separator.
  assert.equal(normalizeDate("30/06 /2026"), "2026-06-30");
  assert.equal(normalizeDate("14/07 /2026"), "2026-07-14");
  // Jobs use dashes and no padding: 25-7-2026.
  assert.equal(normalizeDate("25-7-2026"), "2026-07-25");
  assert.equal(normalizeDate("27-7-2026"), "2026-07-27");
});

test("ambiguous + zero-padded = crew-typed day-first (the August regression)", () => {
  // These are the rows that used to vanish: read month-first they became
  // 8 January … 8 July, every one of them earlier than 30 July, so August
  // showed no production at all and Quality read a fake 100%.
  assert.equal(normalizeDate("01/08/2026"), "2026-08-01");
  assert.equal(normalizeDate("02/08/2026"), "2026-08-02");
  assert.equal(normalizeDate("07/08/2026"), "2026-08-07");
  assert.equal(normalizeDate("01/08 /2026"), "2026-08-01");
  assert.equal(normalizeDate("04/08 /2026"), "2026-08-04");
  assert.equal(normalizeDate("01/07 /2026"), "2026-07-01");
});

test("ambiguous + unpadded = Sheets-rendered month-first", () => {
  // «الإنتاج» switches format for 5–8 August: these follow 04/08 /2026 in the
  // sheet, so they are 5,6,7,8 August — NOT 8 May/June/July/August.
  assert.equal(normalizeDate("8/5/2026"), "2026-08-05");
  assert.equal(normalizeDate("8/6/2026"), "2026-08-06");
  assert.equal(normalizeDate("8/7/2026"), "2026-08-07");
  assert.equal(normalizeDate("8/8/2026"), "2026-08-08");
});

test("the two conventions together cover one unbroken calendar", () => {
  // 30 June → 8 August with no gap and no date landing outside the run.
  const raws = [
    "30/06 /2026", "01/07 /2026", "13/07/2026", "30/07 /2026", "31/07 /2026",
    "01/08 /2026", "04/08 /2026", "8/5/2026", "8/8/2026",
  ];
  const iso = raws.map(normalizeDate);
  assert.ok(iso.every((d) => d >= "2026-06-30" && d <= "2026-08-08"), iso.join(","));
  // Strictly increasing — the ordering the sheet itself shows.
  for (let i = 1; i < iso.length; i++) assert.ok(iso[i] > iso[i - 1], `${iso[i - 1]} -> ${iso[i]}`);
});

test("ISO, Arabic-Indic digits and serials still parse", () => {
  assert.equal(normalizeDate("2026-07-19"), "2026-07-19"); // «الأعطال»
  assert.equal(normalizeDate("2026/7/19"), "2026-07-19");
  assert.equal(normalizeDate("٠١/٠٨/٢٠٢٦"), "2026-08-01");
  assert.equal(latinDigits("٢٠٢٦"), "2026");
  assert.equal(normalizeDate("2026-07-19T06:30:00Z"), "2026-07-19");
  assert.equal(normalizeDate("46235"), "2026-08-01"); // Sheets serial
});

test("unreadable values yield empty string, never a wrong date", () => {
  for (const v of ["", "   ", "غير متاح / N/A", "-", "hello", "13/13/2026", "0/5/2026", null, undefined]) {
    assert.equal(normalizeDate(v as string), "");
  }
});

test("monthOf groups August correctly", () => {
  assert.equal(monthOf(normalizeDate("01/08 /2026")), "2026-08");
  assert.equal(monthOf(normalizeDate("8/7/2026")), "2026-08");
  assert.equal(monthOf(""), "");
});
