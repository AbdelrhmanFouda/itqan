/**
 * Date normalization — run with `npm test` (Node's built-in runner; Node 22
 * strips the types, so there is no test dependency to install).
 *
 * Every literal below is a value that was actually read out of the workbook
 * through the bridge on 2026-08-09, not an invented example.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDate, monthOf, latinDigits, factoryDay,
  parseClockMinutes, formatClock, factoryDayInstant, factoryDaySpan,
} from "../lib/dates.ts";

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

test("factoryDay follows the 08:00 shift start, not the calendar", () => {
  // Cairo = UTC+2, so 06:00Z is 08:00 Cairo — the first moment of 7 August.
  const iso = (s: string) => Date.parse(s);
  assert.equal(factoryDay(iso("2026-08-07T06:00:00Z")), "2026-08-07"); // 08:00 Cairo
  assert.equal(factoryDay(iso("2026-08-07T12:00:00Z")), "2026-08-07"); // 14:00 Cairo
  assert.equal(factoryDay(iso("2026-08-07T21:59:00Z")), "2026-08-07"); // 23:59 Cairo
  // 02:00 Cairo on the 8th is still the shift that STARTED 08:00 on the 7th.
  assert.equal(factoryDay(iso("2026-08-08T00:00:00Z")), "2026-08-07"); // 02:00 Cairo
  assert.equal(factoryDay(iso("2026-08-08T04:59:00Z")), "2026-08-07"); // 06:59 Cairo
  // 08:00 Cairo on the 8th rolls over.
  assert.equal(factoryDay(iso("2026-08-08T06:00:00Z")), "2026-08-08");
  // Just before the roll-over, still the 7th.
  assert.equal(factoryDay(iso("2026-08-08T05:59:00Z")), "2026-08-07");
});

test("monthOf groups August correctly", () => {
  assert.equal(monthOf(normalizeDate("01/08 /2026")), "2026-08");
  assert.equal(monthOf(normalizeDate("8/7/2026")), "2026-08");
  assert.equal(monthOf(""), "");
});

/* ------------------- «التوقفات» E/F — clock times ------------------------- */

test("SHEETS DROPS THE LEADING ZERO on a time cell", () => {
  // The write says "08:00" and the read says "8:00". Every value below came
  // back out of «التوقفات» on 2026-08-14 after the app itself wrote it — the
  // same trap as the 8:00/9:00 hour headers in «تسجيل الإنتاج». Miss it and a
  // stoppage's start time silently fails to parse.
  assert.equal(parseClockMinutes("8:00"), 8 * 60);
  assert.equal(parseClockMinutes("0:54"), 54);
  assert.equal(parseClockMinutes("1:31"), 91);
  assert.equal(parseClockMinutes("6:07"), 367);
  // …and the padded form still works, because a hand-typed cell may have it.
  assert.equal(parseClockMinutes("08:00"), 480);
  assert.equal(parseClockMinutes("19:28"), 19 * 60 + 28);
  assert.equal(parseClockMinutes("23:59"), 1439);
});

test("parseClockMinutes accepts what a person might type", () => {
  assert.equal(parseClockMinutes("١٤:٣٠"), 870, "Arabic-Indic digits");
  assert.equal(parseClockMinutes("14:30:45"), 870, "stray seconds");
  assert.equal(parseClockMinutes(" 14:30 "), 870);
  assert.equal(parseClockMinutes("2:30 PM"), 870);
  assert.equal(parseClockMinutes("2:30 pm"), 870);
  assert.equal(parseClockMinutes("12:15 AM"), 15, "midnight is hour 0");
  assert.equal(parseClockMinutes("12:15 PM"), 735, "noon stays 12");
  assert.equal(parseClockMinutes("0.5"), 720, "a cell stored as a fraction of a day");
});

test("parseClockMinutes returns null rather than a wrong number", () => {
  // null and 0 must not be confused: 0 is midnight, null is "no time given",
  // and «بداية التوقف» is an OPTIONAL column.
  for (const v of ["", "   ", "غير متاح / N/A", "-", "hello", "25:00", "12:99", "930", null, undefined]) {
    assert.equal(parseClockMinutes(v as string), null, `${v} should not parse`);
  }
  assert.equal(parseClockMinutes("00:00"), 0, "midnight is 0, not null");
});

test("formatClock reads the Cairo clock, and round-trips a parsed time", () => {
  assert.equal(formatClock(Date.parse("2026-08-09T17:28:00Z")), "19:28"); // UTC+2
  assert.equal(formatClock(Date.parse("2026-08-09T06:00:00Z")), "08:00");
  assert.equal(formatClock(0), "", "no timestamp, no time");
  const at = factoryDayInstant("2026-08-09", parseClockMinutes("19:28"));
  assert.equal(formatClock(at), "19:28");
});

test("a time before 08:00 belongs to the NEXT calendar day", () => {
  // The factory day runs 08:00 → 08:00, so 02:00 on the «2026-08-09» row really
  // happened on the 10th. Filing it on the 9th would put it before its shift.
  const eight = factoryDayInstant("2026-08-09", 8 * 60);
  const two = factoryDayInstant("2026-08-09", 2 * 60);
  assert.equal(formatClock(eight), "08:00");
  assert.equal(formatClock(two), "02:00");
  assert.ok(two > eight, "02:00 comes after 08:00 within one factory day");
  assert.equal((two - eight) / 3600000, 18);
  assert.equal(factoryDayInstant("nonsense", 480), 0);
  assert.equal(factoryDayInstant("2026-08-09", null), 0);
});

test("factoryDaySpan: an end of «8:00» after an evening start is NEXT morning", () => {
  // The exact shape of an estimated close: capped at the end of the factory
  // day, which is 08:00 — the one time that is both the first and the last
  // minute of the day. 23 of the 37 rows migrated on 2026-08-14 looked like
  // this, and resolving the two times independently ended them 12 hours before
  // they started.
  const { startedAt, endedAt } = factoryDaySpan("2026-08-09", parseClockMinutes("19:28"), parseClockMinutes("8:00"));
  assert.ok(endedAt > startedAt, "an end can never precede its own start");
  // «زمن التوقف» on that row is 751; the clock columns are minute-precision, so
  // the reconstruction is 752 and the second is the discarded remainder. The
  // minutes column stays the number anything computes from — this pair is
  // context for a human reading the row.
  assert.equal(Math.round((endedAt - startedAt) / 60000), 752);
});

test("factoryDaySpan leaves an ordinary same-shift stoppage alone", () => {
  const a = factoryDaySpan("2026-08-09", parseClockMinutes("19:26"), parseClockMinutes("19:40"));
  assert.equal(Math.round((a.endedAt - a.startedAt) / 60000), 14);
  // Across midnight, already handled by the 08:00 rollover.
  const b = factoryDaySpan("2026-08-12", parseClockMinutes("23:30"), parseClockMinutes("1:00"));
  assert.equal(Math.round((b.endedAt - b.startedAt) / 60000), 90);
  // A mis-tap stays a mis-tap and does not become a 24-hour stoppage.
  const c = factoryDaySpan("2026-08-12", parseClockMinutes("10:00"), parseClockMinutes("10:00"));
  assert.equal(c.endedAt - c.startedAt, 0);
  // A missing time is 0, not an invented instant.
  const d = factoryDaySpan("2026-08-12", null, parseClockMinutes("10:00"));
  assert.equal(d.startedAt, 0);
  assert.ok(d.endedAt > 0);
});
