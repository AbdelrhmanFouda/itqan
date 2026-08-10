/**
 * The run-join rules — shared by lib/oee-data.ts, app/api/runs and lib/jobs.ts.
 * Run with `npm test`.
 *
 * These exist because the Overview tile once reported "Downtime (this month) = 0"
 * while /performance reported the real merged figure, for the same runs on the
 * same day. The cause was three code paths each deciding for themselves what a
 * run's machine key, planned minutes and stub-ness were. The tests below pin the
 * two failure modes that produce a silent zero rather than an error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHIFT_MIN, buildShiftLengthIndex, machineKeyOf, resolvePlannedMin,
  plannedMinSource, isStubRun, latinDigits,
} from "../lib/run-join.ts";
import { latinDigits as datesLatinDigits } from "../lib/dates.ts";
import { distributeDowntime, downtimeKey } from "../lib/downtime.ts";

const REGISTRY = [
  { code: "PQ 7", name: "100", shiftLength: "720" },
  { code: "PQ 5", name: "100", shiftLength: "720" },
  { code: "PQ 10", name: "150", shiftLength: "600" },
  { code: "PQ 3", name: "280", shiftLength: "" }, // no shift length — must not index
];

/* ------------------------- the copied digit fold -------------------------- */

test("run-join's latinDigits matches lib/dates, so the copy cannot drift", () => {
  for (const s of ["٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹", "PQ ٧ — ١٠٠", "PQ 7 — 100", ""]) {
    assert.equal(latinDigits(s), datesLatinDigits(s), `mismatch for ${JSON.stringify(s)}`);
  }
});

/* ------------------------------ machine key ------------------------------- */

test("the machine code wins over the tonnage — two machines share 100 t", () => {
  assert.equal(machineKeyOf("PQ 7 — 100", "100"), "PQ 7 — 100");
  assert.equal(machineKeyOf("", "100"), "100");
  assert.equal(machineKeyOf(undefined, undefined), "—");
  // Arabic-Indic digits fold, so a hand-typed label still joins.
  assert.equal(machineKeyOf("", "١٠٠"), "100");
});

/* ---------------------------- planned minutes ----------------------------- */

test("the registry is indexed by label, bare code and tonnage", () => {
  const idx = buildShiftLengthIndex(REGISTRY);
  assert.equal(idx.get("pq 7 — 100"), 720);
  assert.equal(idx.get("pq 10"), 600);
  assert.equal(idx.get("150"), 600);
  // A registry row with no shift length contributes nothing.
  assert.equal(idx.get("pq 3"), undefined);
});

test("planned time falls back: own column → registry → default", () => {
  const idx = buildShiftLengthIndex(REGISTRY);
  assert.equal(resolvePlannedMin(480, "PQ 7 — 100", "100", idx), 480);
  assert.equal(plannedMinSource(480, "PQ 7 — 100", "100", idx), "column");

  assert.equal(resolvePlannedMin(0, "PQ 10 — 150", "150", idx), 600);
  assert.equal(plannedMinSource(0, "PQ 10 — 150", "150", idx), "registry");

  assert.equal(resolvePlannedMin(0, "PQ 99 — 999", "999", idx), DEFAULT_SHIFT_MIN);
  assert.equal(plannedMinSource(0, "PQ 99 — 999", "999", idx), "default");
});

/**
 * THE BUG THAT STARTED THIS. «الإنتاج» has no planned-minutes column, so every
 * run arrives with ownPlannedMin = 0. distributeDowntime() only gives a run
 * `plannedMin − downtimeMin` of headroom, so skipping the fallback leaves zero
 * headroom everywhere: the captured minutes all come back as `unallocatedMin`,
 * every run still reads 0, and nothing anywhere reports an error.
 */
test("without the planned-minutes fallback the whole join silently yields zero", () => {
  const idx = buildShiftLengthIndex(REGISTRY);
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 90]]);
  const rawRun = { date: "2026-08-07", machine: "PQ 7 — 100", downtimeMin: 0 };

  const naive = distributeDowntime([{ ...rawRun, plannedMin: 0 }], byKey);
  assert.equal(naive.perRun[0], 0, "plannedMin 0 places nothing");
  assert.equal(naive.unallocatedMin, 90, "and the minutes are only reported, not shown");

  const correct = distributeDowntime(
    [{ ...rawRun, plannedMin: resolvePlannedMin(0, "PQ 7 — 100", "100", idx) }],
    byKey,
  );
  assert.equal(correct.perRun[0], 90);
  assert.equal(correct.unallocatedMin, 0);
});

/* -------------------------------- stubs ----------------------------------- */

test("a stub row is one with nothing logged at all", () => {
  assert.equal(isStubRun({}), true);
  assert.equal(isStubRun({ goodUnits: "  ", scrapUnits: "", downtimeMin: undefined }), true);
  assert.equal(isStubRun({ goodUnits: "0" }), false, "a logged zero is data, not a stub");
  assert.equal(isStubRun({ downtimeMin: "30" }), false);
});

/**
 * Holding stubs out of the spread is what keeps the totals equal. An empty row
 * still carries planned minutes, so if one page lets it absorb a share of the
 * day's stoppage and another does not, the same metric prints two numbers.
 */
test("including a stub row moves minutes onto a run that reports nothing", () => {
  const byKey = new Map([[downtimeKey("2026-08-07", "PQ 7 — 100"), 120]]);
  const real = { date: "2026-08-07", machine: "PQ 7 — 100", plannedMin: 720, downtimeMin: 0 };
  const stub = { ...real };

  const heldOut = distributeDowntime([real], byKey);
  const included = distributeDowntime([real, stub], byKey);

  assert.equal(heldOut.perRun[0], 120);
  assert.equal(included.perRun[0], 60, "the stub takes half");
  assert.notEqual(heldOut.perRun[0], included.perRun[0]);
  // Both place every minute — the disagreement is in WHERE, which is exactly
  // what makes a per-run table and a page total tell different stories.
  assert.equal(heldOut.unallocatedMin, 0);
  assert.equal(included.unallocatedMin, 0);
});

/* --------------------------- the whole invariant --------------------------- */

/**
 * What the Overview tile and /performance each compute: the sum of every run's
 * downtime for the month. Given the same runs, the same key and the same planned
 * minutes, the two must land on the same number.
 */
test("summing per-run downtime reproduces the day's captured total", () => {
  const idx = buildShiftLengthIndex(REGISTRY);
  const rows = [
    { date: "2026-08-07", machineCode: "PQ 7 — 100", machine: "100", goodUnits: "1200" },
    { date: "2026-08-07", machineCode: "PQ 7 — 100", machine: "100", goodUnits: "900" },
    { date: "2026-08-07", machineCode: "PQ 10 — 150", machine: "150", goodUnits: "400" },
    { date: "2026-08-07", machineCode: "PQ 5 — 100", machine: "100" }, // stub — no numbers
  ];
  const byKey = new Map([
    [downtimeKey("2026-08-07", "PQ 7 — 100"), 150],
    [downtimeKey("2026-08-07", "PQ 10 — 150"), 45],
  ]);

  const live = rows.filter((r) => !isStubRun(r));
  const spread = distributeDowntime(
    live.map((r) => {
      const mk = machineKeyOf(r.machineCode, r.machine);
      return { date: r.date, machine: mk, plannedMin: resolvePlannedMin(0, mk, r.machine, idx), downtimeMin: 0 };
    }),
    byKey,
  );

  const total = spread.perRun.reduce((a, b) => a + b, 0);
  assert.equal(total, 195, "every captured minute lands on a run");
  assert.equal(spread.unallocatedMin, 0);
  assert.equal(spread.perRun[2], 45, "PQ 10's stoppage stays on PQ 10");
  // PQ 7's 150 min split across its two runs, and NOT onto the PQ 5 stub.
  assert.equal(spread.perRun[0] + spread.perRun[1], 150);
});
