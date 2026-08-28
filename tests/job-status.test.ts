/**
 * The job-status boundary: «أوامر العمل»!K is a validated dropdown of EXACTLY
 * four Arabic values, and the bridge's `updates` path (setValue) enforces that
 * validation — an unknown value is rejected mid-batch and trips the whole
 * rollback machinery. So `jobStatusToSheet` REFUSES an unknown status instead
 * of passing it through as a guess (the old behaviour, and the live reachable
 * failure named in CLAUDE.md → "Write semantics" §2). Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOB_STATUSES, isJobStatus, jobStatusToSheet, jobStatusFromSheet,
} from "../lib/prod-meta.ts";

// The sheet's own vocabulary, verified live 2026-08-09. If the owner ever
// changes the dropdown, this list changes WITH the sheet, never ahead of it.
const SHEET_K_VALUES = ["لم يبدأ", "جاري التشغيل", "متوقف", "مكتمل"];

test("the four canonical tokens map onto the sheet's four Arabic values, exactly", () => {
  assert.equal(JOB_STATUSES.length, 4);
  assert.deepEqual(JOB_STATUSES.map(jobStatusToSheet), SHEET_K_VALUES);
});

test("isJobStatus accepts exactly the canonical tokens", () => {
  for (const s of JOB_STATUSES) assert.equal(isJobStatus(s), true, s);
  for (const s of ["Quoted", "Delivered", "not started", "IN PRODUCTION", "جاري التشغيل", "", " "]) {
    assert.equal(isJobStatus(s), false, `"${s}" must not count as a writable status`);
  }
});

test("an unknown status can NEVER reach a sheet write — jobStatusToSheet throws", () => {
  // Every one of these written into !K would be rejected by the sheet's own
  // validation mid-batch. Refusing before the write is the whole point.
  for (const s of ["Quoted", "Delivered", "Shipped", "completed", "", "xyz"]) {
    assert.throws(() => jobStatusToSheet(s), /unknown job status/, `"${s}" passed through`);
  }
});

test("the sheet's own Arabic is not a writable input either — no double mapping", () => {
  // The app speaks English tokens internally; a caller holding the Arabic wire
  // value has skipped the boundary, and silently accepting it would hide that.
  for (const ar of SHEET_K_VALUES) {
    assert.throws(() => jobStatusToSheet(ar));
  }
});

test("the refusal names the legal vocabulary, so the error is actionable", () => {
  assert.throws(
    () => jobStatusToSheet("Quoted"),
    (err: Error) =>
      err.message.includes("Quoted") && JOB_STATUSES.every((s) => err.message.includes(s)),
  );
});

test("every canonical token round-trips: app → sheet → app", () => {
  for (const s of JOB_STATUSES) {
    assert.equal(jobStatusFromSheet(jobStatusToSheet(s)), s, `${s} did not survive the round trip`);
  }
});

test("the READ direction still passes unknowns through unchanged", () => {
  // Deliberately asymmetric: legacy English rows ("Quoted", "Delivered") and
  // hand-typed cells must render as themselves on the way IN — the guard is
  // only on the way OUT, where an unknown value would corrupt a validated column.
  assert.equal(jobStatusFromSheet("Quoted"), "Quoted");
  assert.equal(jobStatusFromSheet("Delivered"), "Delivered");
  assert.equal(jobStatusFromSheet("جاري التشغيل"), "In Production");
  assert.equal(jobStatusFromSheet(" مكتمل "), "Completed");
});
