/**
 * Recovering from a bridge write that half-applied. Run with `npm test`.
 *
 * The bridge's `updates` action is a bare loop of `setValue`, and `setValue`
 * enforces data validation — so one rejected cell commits everything before it
 * and drops everything after it. These tests pin the two judgements that make
 * the recovery safe rather than merely tidy:
 *
 *   1. which display values can be written back and mean the same thing, and
 *   2. which cells a failed batch actually moved.
 *
 * Getting (1) wrong is the dangerous one: "restoring" 09/08/2026 into a
 * workbook that holds two date conventions can store 8 September, which is the
 * exact shape of the bug that once hid a month of August production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFaithfullyRestorable, planRollback, cellRef, type WriteCell,
} from "../lib/sheet-write.ts";

const cell = (row: number, col: number, value = "x"): WriteCell => ({ row, col, value });

/* ------------------- what can be put back honestly ------------------------ */

test("blank, numbers and plain text restore faithfully", () => {
  for (const v of ["", "   ", "0", "45", "751", "-3", "1,062", "12.5", "98%"]) {
    assert.equal(isFaithfullyRestorable(v), true, `${JSON.stringify(v)} should be restorable`);
  }
  for (const v of ["PQ 7 — 100", "تغيير الاسطمبة", "غير متاح / N/A", "Mold change", "سليم"]) {
    assert.equal(isFaithfullyRestorable(v), true, `${v} should be restorable`);
  }
});

test("A DATE IS NEVER RESTORED — the workbook holds two conventions", () => {
  // Writing "09/08/2026" back could store 8 September rather than 9 August.
  // Every shape below was read out of this workbook at some point.
  for (const v of ["09/08/2026", "8/5/2026", "2026-08-11", "14/07 /2026", "30.06.2026", "1-8-2026"]) {
    assert.equal(isFaithfullyRestorable(v), false, `${v} must NOT be restored`);
  }
});

test("a time is never restored either — Sheets re-renders it", () => {
  // Written "08:00", read back "8:00". Putting the string back is not putting
  // the value back.
  for (const v of ["8:00", "08:00", "19:28", "0:54", "14:30:45", "2:30 PM"]) {
    assert.equal(isFaithfullyRestorable(v), false, `${v} must NOT be restored`);
  }
});

test("a formula string is never re-injected", () => {
  // The bridge's setValue turns "=..." into a LIVE formula. Restoring the
  // display text of a formula cell would replace a computed column with a
  // constant — the failure «أوامر العمل» O:X is one plain value away from.
  assert.equal(isFaithfullyRestorable("=SUM(D5:AA5)"), false);
  assert.equal(isFaithfullyRestorable("'0812"), false, "Sheets' force-text prefix");
});

/* ----------------------- what the failed batch did ------------------------ */

test("cells that did not move were never written", () => {
  // The bridge threw on the third cell, so cells four and five never ran.
  const targets = [cell(2, 1), cell(2, 2), cell(2, 3), cell(2, 4), cell(2, 5)];
  const before = ["", "", "", "", ""];
  const after = ["2026-08-09", "PQ 10 — 150", "", "", ""];
  const plan = planRollback(targets, before, after);
  assert.equal(plan.applied, 2, "only the first two landed");
  assert.equal(plan.restore.length, 2, "both were blank before, so both blank back out");
  assert.deepEqual(plan.restore.map((c) => c.value), ["", ""]);
  assert.equal(plan.stranded.length, 0);
});

test("the real «عطل» failure rolls back completely", () => {
  // 14 August, «التوقفات» row 2: A and B committed, C was refused, D–I dropped.
  // Both landed cells were blank before, so the row goes back to empty and the
  // tab is exactly as it was.
  const targets = [cell(2, 1), cell(2, 2), cell(2, 3), cell(2, 4)];
  const plan = planRollback(
    targets,
    ["", "", "", ""],
    ["09/08/2026", "PQ 10 — 150", "", ""],
  );
  assert.equal(plan.applied, 2);
  assert.equal(plan.stranded.length, 0, "a new row is always fully recoverable");
  assert.deepEqual(plan.restore.map(cellRef), ["R2C1", "R2C2"]);
});

test("overwriting an existing DATE strands it rather than guessing", () => {
  // The case the recovery deliberately refuses. Restoring "8/5/2026" could put
  // back 5 August or 8 May; leaving it and saying so is the honest option.
  const targets = [cell(40, 1), cell(40, 4)];
  const plan = planRollback(targets, ["8/5/2026", "120"], ["2026-09-01", "999"]);
  assert.equal(plan.applied, 2);
  assert.deepEqual(plan.restore.map((c) => [cellRef(c), c.value]), [["R40C4", "120"]]);
  assert.deepEqual(plan.stranded.map(cellRef), ["R40C1"]);
});

test("a clean failure reports nothing to undo", () => {
  const targets = [cell(5, 4), cell(5, 5)];
  const plan = planRollback(targets, ["100", "200"], ["100", "200"]);
  assert.equal(plan.applied, 0);
  assert.equal(plan.restore.length, 0);
  assert.equal(plan.stranded.length, 0);
});

test("an all-numeric row rolls back fully — no date or time columns", () => {
  // The paper import writes hour counts and «الفعلي», none of which is a date
  // or a time, so an update to an EXISTING row is fully recoverable too.
  const targets = [cell(212, 16), cell(212, 17), cell(212, 18), cell(212, 29)];
  const plan = planRollback(
    targets,
    ["652", "652", "648", "22609"],
    ["660", "660", "648", "22609"],
  );
  assert.equal(plan.applied, 2, "the two that actually changed");
  assert.equal(plan.stranded.length, 0);
  assert.deepEqual(plan.restore.map((c) => c.value), ["652", "652"]);
});

test("a short `after` row is treated as blank, not as unchanged", () => {
  // getDisplayValues() returns ragged rows: a trailing empty cell is simply
  // absent. Reading that as "no change" would hide a cell we blanked.
  const targets = [cell(9, 3)];
  const plan = planRollback(targets, ["something"], [undefined as unknown as string]);
  assert.equal(plan.applied, 1);
  assert.deepEqual(plan.restore.map((c) => c.value), ["something"]);
});
