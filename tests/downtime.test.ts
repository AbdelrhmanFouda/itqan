/**
 * Downtime distribution — the maths that turns captured stoppages into the
 * per-run downtime the OEE engine consumes. Run with `npm test`.
 *
 * The property that matters: minutes are never silently lost. Everything either
 * lands on a run or is reported as unallocated, because computeOEE() clamps a
 * run's downtime to its planned minutes and would otherwise swallow the excess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distributeDowntime, downtimeKey, downtimeCsv, isStaleOpen,
  summarizeDowntime, countsTowardDowntime, splitAcrossFactoryDays, addDaysISO,
  type DowntimeRun, type DowntimeCountable,
} from "../lib/downtime.ts";
import { factoryDayEnd, factoryDay } from "../lib/dates.ts";

const run = (date: string, machine: string, plannedMin = 720, downtimeMin = 0): DowntimeRun =>
  ({ date, machine, plannedMin, downtimeMin });

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("a single run takes the whole day's downtime", () => {
  const runs = [run("2026-08-07", "PQ 7 — 100")];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 90]]);
  const r = distributeDowntime(runs, byKey);
  assert.deepEqual(r.perRun, [90]);
  assert.equal(r.unallocatedMin, 0);
  assert.equal(r.runsTouched, 1);
});

test("two shifts on one machine split it, and the split is remainder-exact", () => {
  const runs = [run("2026-08-07", "PQ 7 — 100"), run("2026-08-07", "PQ 7 — 100")];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 101]]);
  const r = distributeDowntime(runs, byKey);
  assert.equal(sum(r.perRun), 101, "no minute invented or lost");
  assert.equal(r.unallocatedMin, 0);
});

test("no run ever exceeds its own planned minutes (the computeOEE clamp)", () => {
  // 900 minutes of stoppage against a single 720-minute shift.
  const runs = [run("2026-08-07", "PQ 7 — 100", 720)];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 900]]);
  const r = distributeDowntime(runs, byKey);
  assert.equal(r.perRun[0], 720, "capped at planned");
  assert.equal(r.unallocatedMin, 180, "the excess is REPORTED, not dropped");
  assert.equal(sum(r.perRun) + r.unallocatedMin, 900);
});

test("headroom already used by sheet-logged downtime is respected", () => {
  const runs = [run("2026-08-07", "PQ 7 — 100", 720, 700)]; // only 20 min of room
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 50]]);
  const r = distributeDowntime(runs, byKey);
  assert.equal(r.perRun[0], 20);
  assert.equal(r.unallocatedMin, 30);
});

test("downtime lands only on its own machine and its own day", () => {
  const runs = [
    run("2026-08-07", "PQ 5 — 100"),
    run("2026-08-07", "PQ 7 — 100"), // same tonnage, different machine
    run("2026-08-06", "PQ 7 — 100"), // same machine, different day
  ];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 60]]);
  const r = distributeDowntime(runs, byKey);
  assert.deepEqual(r.perRun, [0, 60, 0], "PQ 5 and the previous day are untouched");
});

test("machine labels join through the shared normalizer, not by raw equality", () => {
  // The workbook's labels carry stray whitespace; both sides normalize.
  const runs = [run("2026-08-07", "  PQ 7   —  100 ")];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 45]]);
  assert.equal(distributeDowntime(runs, byKey).perRun[0], 45);
});

test("captured downtime with no production row is reported, not discarded", () => {
  const runs = [run("2026-08-07", "PQ 7 — 100")];
  const byKey = new Map([
    [downtimeKey("2026-08-07", "PQ 7 — 100"), 30],
    [downtimeKey("2026-08-07", "PQ 9 — 140"), 75], // nobody logged production
  ]);
  const r = distributeDowntime(runs, byKey);
  assert.equal(r.perRun[0], 30);
  assert.equal(r.unallocatedMin, 75);
});

test("undated runs are skipped rather than mis-joined", () => {
  const runs = [run("", "PQ 7 — 100")];
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 30]]);
  const r = distributeDowntime(runs, byKey);
  assert.deepEqual(r.perRun, [0]);
  assert.equal(r.unallocatedMin, 30);
});

test("empty input is a no-op", () => {
  const r = distributeDowntime([], new Map());
  assert.deepEqual(r.perRun, []);
  assert.equal(r.unallocatedMin, 0);
});

/* ---------------------- unclosed stoppages (follow-up A) ------------------ */

test("a stoppage is only stale once its OWN factory day has ended", () => {
  const today = "2026-08-07";
  assert.equal(isStaleOpen({ endedAt: null, date: "2026-08-06" }, today), true);
  assert.equal(isStaleOpen({ endedAt: null, date: "2026-08-07" }, today), false, "still today");
  assert.equal(isStaleOpen({ endedAt: 1, date: "2026-08-06" }, today), false, "already closed");
  assert.equal(isStaleOpen({ endedAt: null, date: "" }, today), false, "no date to judge by");
});

test("a 02:00 stoppage is NOT stale — it belongs to the previous day's shift", () => {
  // 00:00Z on the 8th = 02:00 Cairo, which factoryDay() files under the 7th.
  const at = Date.parse("2026-08-08T00:00:00Z");
  assert.equal(factoryDay(at), "2026-08-07");
  assert.equal(isStaleOpen({ endedAt: null, date: "2026-08-07" }, factoryDay(at)), false);
  // …and once the shift rolls over at 08:00 Cairo, it IS stale.
  const next = Date.parse("2026-08-08T06:00:00Z");
  assert.equal(factoryDay(next), "2026-08-08");
  assert.equal(isStaleOpen({ endedAt: null, date: "2026-08-07" }, factoryDay(next)), true);
});

/**
 * The two tests that used to live here asserted that a reconstructed close was
 * CAPPED at 08:00 the next morning. That rule was removed on 2026-08-17: a shift
 * ending does not restart the machine, and capping there was deleting 87% of the
 * captured minutes (21 of 37 stoppages run past 08:00). They are replaced by the
 * test below, which pins the opposite property.
 */
test("A STOPPAGE IS NOT ENDED BY THE SHIFT ENDING", () => {
  // A press that stops at 22:00 and is still stopped at 14:00 the next day was
  // down for sixteen hours, not the ten that remained in its shift. Both
  // readings are computed the same way — end minus start — and the shift
  // boundary is simply not in the arithmetic.
  const started = Date.parse("2026-08-07T20:00:00Z"); // 22:00 Cairo
  const closedNextAfternoon = Date.parse("2026-08-08T12:00:00Z"); // 14:00 Cairo
  const minutes = Math.round((closedNextAfternoon - started) / 60000);
  assert.equal(minutes, 16 * 60, "the full sixteen hours");

  // What the old cap would have recorded, kept as the number NOT to produce.
  const shiftEnd = factoryDayEnd("2026-08-07"); // 08:00 Cairo on the 8th
  assert.equal(new Date(shiftEnd).toISOString(), "2026-08-08T06:00:00.000Z");
  assert.equal(Math.round((shiftEnd - started) / 60000), 10 * 60);
  assert.ok(minutes > Math.round((shiftEnd - started) / 60000),
    "the true duration must exceed what the shift-end cap would have kept");
});

test("factoryDayEnd still answers, and still refuses a bad date", () => {
  // No longer used to cap a stoppage, but it is what defines the 08:00→08:00
  // factory day, so the boundary itself is still worth pinning.
  assert.equal(new Date(factoryDayEnd("2026-08-07")).toISOString(), "2026-08-08T06:00:00.000Z");
  assert.equal(factoryDayEnd("not-a-date"), 0);
});

/* ---------------------- the tally, added 2026-08-14 ----------------------- */
/**
 * `summarizeDowntime` is the arithmetic that turns «التوقفات» rows into the
 * three maps every consumer reads. It was extracted from the Firestore loader
 * unchanged, precisely so the migration could prove the two stores produced
 * identical totals — which they did: 17,253 minutes over 30 day+machine keys
 * and 6 reasons, before and after.
 */

const ev = (
  date: string, machine: string, reason: string, minutes: number, estimated = false,
): DowntimeCountable => ({ date, machine, reason, minutes, estimated });

test("countsTowardDowntime refuses a row that cannot inform a number", () => {
  assert.equal(countsTowardDowntime(ev("2026-08-09", "PQ 7 — 100", "Setup", 30)), true);
  // A zero is the failure this system keeps producing: «التوقفات»!D is
  // validated > 0 for the same reason this is.
  assert.equal(countsTowardDowntime(ev("2026-08-09", "PQ 7 — 100", "Setup", 0)), false);
  // No date or no machine → it cannot be joined to a run, so counting it in the
  // headline while it is absent from every per-machine figure would make two
  // views of the same month disagree.
  assert.equal(countsTowardDowntime(ev("", "PQ 7 — 100", "Setup", 30)), false);
  assert.equal(countsTowardDowntime(ev("2026-08-09", "", "Setup", 30)), false);
});

test("summarizeDowntime totals by day+machine and by reason", () => {
  const t = summarizeDowntime([
    ev("2026-08-09", "PQ 7 — 100", "Setup", 30),
    ev("2026-08-09", "PQ 7 — 100", "Mold change", 45),
    ev("2026-08-09", "PQ 5 — 100", "Setup", 20),
    ev("2026-08-10", "PQ 7 — 100", "Setup", 10),
  ]);
  assert.equal(t.byKey.get(downtimeKey("2026-08-09", "PQ 7 — 100")), 75);
  assert.equal(t.byKey.get(downtimeKey("2026-08-09", "PQ 5 — 100")), 20, "PQ 5 and PQ 7 are both 100 t — never merged");
  assert.equal(t.byKey.get(downtimeKey("2026-08-10", "PQ 7 — 100")), 10);
  assert.equal(t.byReason.get("Setup"), 60);
  assert.equal(t.byReason.get("Mold change"), 45);
  assert.equal(t.counted.length, 4);
});

test("the dominant reason of a day is the one with the MOST minutes", () => {
  // A run with no reason of its own inherits this, so the Bottleneck Board can
  // name a cause. It must be the biggest loss, not the first or last logged.
  const t = summarizeDowntime([
    ev("2026-08-09", "PQ 7 — 100", "Setup", 10),
    ev("2026-08-09", "PQ 7 — 100", "Nozzle burn", 90),
    ev("2026-08-09", "PQ 7 — 100", "Setup", 15),
  ]);
  assert.equal(t.dominantByKey.get(downtimeKey("2026-08-09", "PQ 7 — 100")), "Nozzle burn");
  assert.equal(t.byReason.get("Setup"), 25, "the Pareto still keeps both at full fidelity");
});

test("estimated minutes are counted AND kept separable", () => {
  // A reconstruction may inform Availability, but it must never be reported as
  // if somebody had measured it.
  const t = summarizeDowntime([
    ev("2026-08-09", "PQ 7 — 100", "Other", 100, true),
    ev("2026-08-09", "PQ 5 — 100", "Other", 40, false),
  ]);
  assert.equal(t.estimatedMin, 100);
  assert.equal(t.estimatedCount, 1);
  assert.equal([...t.byReason.values()].reduce((a, b) => a + b, 0), 140, "both still count");
});

test("uncountable rows change no total, and a blank reason groups as Other", () => {
  const t = summarizeDowntime([
    ev("2026-08-09", "PQ 7 — 100", "Setup", 30),
    ev("2026-08-09", "PQ 7 — 100", "Setup", 0),        // mis-tap
    ev("", "PQ 7 — 100", "Setup", 999),                 // undated
    ev("2026-08-09", "", "Setup", 999),                 // no machine
    ev("2026-08-09", "PQ 5 — 100", "", 12),             // «سبب التوقف» left blank
  ]);
  assert.equal(t.byKey.get(downtimeKey("2026-08-09", "PQ 7 — 100")), 30);
  assert.equal(t.byReason.get("Setup"), 30);
  assert.equal(t.byReason.get("Other"), 12, "an unrecorded reason groups, but adds nothing invented");
  assert.equal(t.counted.length, 2);
});

test("summarizeDowntime feeds distributeDowntime without any glue", () => {
  // The whole point of the shape: what the loader produces is what the join
  // consumes, in all three paths (oee-data, /api/runs, jobs).
  const t = summarizeDowntime([
    ev("2026-08-09", "PQ 7 — 100", "Setup", 60),
    ev("2026-08-09", "PQ 7 — 100", "Nozzle burn", 30),
  ]);
  const spread = distributeDowntime([run("2026-08-09", "PQ 7 — 100")], t.byKey);
  assert.equal(spread.perRun[0], 90);
  assert.equal(spread.unallocatedMin, 0);
});

/* --------------- splitting a stoppage across factory days ------------------ */

test("a stoppage that fits its factory day stays whole", () => {
  // 10:00 start (offset 120 past 08:00), 600 min — ends 20:00, same day.
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", 600, 600), [
    { date: "2026-08-20", minutes: 600 },
  ]);
});

test("THE OWNER'S CASE: a multi-day stoppage lands on every day it covered", () => {
  // Started 22:00 (offset 840) — 600 min left in the day; 900 min total.
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", 22 * 60, 900), [
    { date: "2026-08-20", minutes: 600 },
    { date: "2026-08-21", minutes: 300 },
  ]);
  // Three full days from exactly 08:00.
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", 480, 3000), [
    { date: "2026-08-20", minutes: 1440 },
    { date: "2026-08-21", minutes: 1440 },
    { date: "2026-08-22", minutes: 120 },
  ]);
});

test("a 02:00 start belongs to the tail of its factory day, not the head", () => {
  // 02:00 → offset 1080, only 360 min left before 08:00 ends the day.
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", 120, 500), [
    { date: "2026-08-20", minutes: 360 },
    { date: "2026-08-21", minutes: 140 },
  ]);
});

test("slices always sum to the row's minutes — column D stays the truth", () => {
  for (const [clock, min] of [[480, 1], [1439, 1440], [0, 4321], [1000, 26629]] as const) {
    const total = splitAcrossFactoryDays("2026-08-31", clock, min)
      .reduce((s, p) => s + p.minutes, 0);
    assert.equal(total, min);
  }
});

test("no start clock ⇒ no split — guessing would move minutes invisibly", () => {
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", null, 2000), [
    { date: "2026-08-20", minutes: 2000 },
  ]);
});

test("nothing to split yields nothing", () => {
  assert.deepEqual(splitAcrossFactoryDays("", 480, 100), []);
  assert.deepEqual(splitAcrossFactoryDays("2026-08-20", 480, 0), []);
});

test("addDaysISO crosses months and years like a calendar", () => {
  assert.equal(addDaysISO("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysISO("2026-02-28", 1), "2026-03-01");
});

test("slices feed summarizeDowntime: a spanning stoppage raises BOTH days", () => {
  const e = { date: "2026-08-20", machine: "PQ 12 — 180", reason: "Maintenance", minutes: 900 };
  const parts = splitAcrossFactoryDays(e.date, 22 * 60, e.minutes)
    .map((p) => ({ ...e, date: p.date, minutes: p.minutes }));
  const t = summarizeDowntime(parts);
  assert.equal(t.byKey.get(downtimeKey("2026-08-20", "PQ 12 — 180")), 600);
  assert.equal(t.byKey.get(downtimeKey("2026-08-21", "PQ 12 — 180")), 300);
  assert.equal(t.byReason.get("Maintenance"), 900, "the reason total is unchanged by the split");
});

test("CSV quotes separators and carries a BOM for Excel", () => {
  const csv = downtimeCsv(
    [{
      id: "x", date: "2026-08-07", machine: "PQ 7 — 100", reason: "Other",
      minutes: 12, startedAt: Date.UTC(2026, 7, 7, 9, 0), endedAt: Date.UTC(2026, 7, 7, 9, 12),
      createdBy: "a@b.com",
    }],
    () => 'أخرى, "خاصة"',
  );
  assert.ok(csv.startsWith("﻿"), "BOM so Excel reads Arabic correctly");
  assert.ok(csv.includes('"أخرى, ""خاصة"""'), "comma and quotes escaped");
  assert.ok(csv.includes("PQ 7 — 100"));
  assert.ok(csv.trimEnd().split("\r\n").length === 2);
});
