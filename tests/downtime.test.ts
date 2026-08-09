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
  distributeDowntime, downtimeKey, downtimeCsv, isStaleOpen, estimatedStopMinutes,
  type DowntimeRun,
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

test("an estimated close is capped at the end of its factory day", () => {
  const dayEnd = factoryDayEnd("2026-08-07");         // 08:00 Cairo on the 8th
  assert.equal(new Date(dayEnd).toISOString(), "2026-08-08T06:00:00.000Z");
  // Started 14:00 Cairo (12:00Z) → 18 hours to the end of the shift day.
  const started = Date.parse("2026-08-07T12:00:00Z");
  assert.equal(estimatedStopMinutes(started, dayEnd), 18 * 60);
  // A full 24h shift's worth is the ceiling, never "days since".
  const early = Date.parse("2026-08-07T06:00:00Z");   // 08:00 Cairo, shift start
  assert.equal(estimatedStopMinutes(early, dayEnd), 24 * 60);
});

test("estimatedStopMinutes never returns a negative or a bogus value", () => {
  assert.equal(estimatedStopMinutes(Date.parse("2026-08-09T00:00:00Z"), factoryDayEnd("2026-08-07")), 0);
  assert.equal(estimatedStopMinutes(1, 0), 0, "unparseable day");
  assert.equal(factoryDayEnd("not-a-date"), 0);
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
