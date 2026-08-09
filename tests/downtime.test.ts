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
import { distributeDowntime, downtimeKey, downtimeCsv, type DowntimeRun } from "../lib/downtime.ts";

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
