/**
 * «+30 دقيقة» / «−30 دقيقة» — the two late-tap adjustments on a running
 * stoppage: the start was earlier than the tap (owner's rule, 2026-09-07
 * meeting), or the machine came back before it (owner, 2026-09-16). Run with
 * `npm test`.
 *
 * The properties that matter: the step is fixed, the cap is real, and a
 * stoppage that already has its row in «التوقفات» (closed) can never be moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planBackdate, planResumeEarly, BACKDATE_STEP_MIN, BACKDATE_CAP_MIN, MIN_RECORDED_MIN,
} from "../lib/downtime.ts";

const T0 = Date.UTC(2026, 8, 7, 10, 30); // 10:30 — tapped half an hour late

test("one press pulls the start back exactly one step", () => {
  const r = planBackdate({ startedAt: T0, endedAt: null });
  assert.ok(r.ok);
  assert.equal(r.startedAt, T0 - BACKDATE_STEP_MIN * 60_000);
  assert.equal(r.backdatedMin, BACKDATE_STEP_MIN);
});

test("presses accumulate through backdatedMin, not the clock", () => {
  let ev = { startedAt: T0, endedAt: null as number | null, backdatedMin: 0 };
  for (let i = 1; i <= 3; i++) {
    const r = planBackdate(ev);
    assert.ok(r.ok);
    ev = { ...ev, startedAt: r.startedAt, backdatedMin: r.backdatedMin };
  }
  assert.equal(ev.backdatedMin, 90);
  assert.equal(ev.startedAt, T0 - 90 * 60_000);
});

test("the cap allows exactly BACKDATE_CAP_MIN and refuses the press beyond it", () => {
  const atCapMinusOne = {
    startedAt: T0,
    endedAt: null,
    backdatedMin: BACKDATE_CAP_MIN - BACKDATE_STEP_MIN,
  };
  const last = planBackdate(atCapMinusOne);
  assert.ok(last.ok);
  assert.equal(last.backdatedMin, BACKDATE_CAP_MIN);

  const beyond = planBackdate({ startedAt: T0, endedAt: null, backdatedMin: BACKDATE_CAP_MIN });
  assert.ok(!beyond.ok);
  assert.equal(beyond.reason, "backdate_limit");
});

test("a closed stoppage is never moved — its row is already in the sheet", () => {
  const r = planBackdate({ startedAt: T0, endedAt: T0 + 60 * 60_000 });
  assert.ok(!r.ok);
  assert.equal(r.reason, "not_open");
});

test("a negative or missing backdatedMin is treated as zero, never as credit", () => {
  const r = planBackdate({ startedAt: T0, endedAt: null, backdatedMin: -60 });
  assert.ok(r.ok);
  assert.equal(r.backdatedMin, BACKDATE_STEP_MIN);
});

/* ------------- «−30 دقيقة»: it came back before anybody tapped ------------- */

const STARTED = Date.UTC(2026, 8, 16, 8, 0);   // the machine stopped at 08:00
const NOW = Date.UTC(2026, 8, 16, 12, 0);      // somebody remembers at 12:00

test("one press reports the resume one step before now", () => {
  const r = planResumeEarly({ startedAt: STARTED, endedAt: null }, NOW);
  assert.ok(r.ok);
  assert.equal(r.resumedAt, NOW - BACKDATE_STEP_MIN * 60_000);
});

test("presses accumulate from what was reported, not from the clock", () => {
  const first = planResumeEarly({ startedAt: STARTED, endedAt: null }, NOW);
  assert.ok(first.ok);
  // Ten minutes pass before the second press: two presses are still one hour.
  const second = planResumeEarly(
    { startedAt: STARTED, endedAt: null, resumedAt: first.resumedAt },
    NOW + 10 * 60_000,
  );
  assert.ok(second.ok);
  assert.equal(second.resumedAt, NOW - 2 * BACKDATE_STEP_MIN * 60_000);
});

test("the stoppage keeps at least a minute — «التوقفات»!D is validated > 0", () => {
  // Started 40 minutes ago: one press would leave 10 minutes, two would leave none.
  const started = NOW - 40 * 60_000;
  const one = planResumeEarly({ startedAt: started, endedAt: null }, NOW);
  assert.ok(one.ok);
  const two = planResumeEarly({ startedAt: started, endedAt: null, resumedAt: one.resumedAt }, NOW);
  assert.ok(!two.ok);
  assert.equal(two.reason, "too_short");
  assert.ok(one.resumedAt - started >= MIN_RECORDED_MIN * 60_000);
});

test("12 hours back is the ceiling, the same as the backdate's", () => {
  const atCap = {
    startedAt: NOW - (BACKDATE_CAP_MIN + 600) * 60_000,
    endedAt: null,
    resumedAt: NOW - BACKDATE_CAP_MIN * 60_000,
  };
  const beyond = planResumeEarly(atCap, NOW);
  assert.ok(!beyond.ok);
  assert.equal(beyond.reason, "resume_limit");
});

test("a closed stoppage is never adjusted — its row is already in the sheet", () => {
  const r = planResumeEarly({ startedAt: STARTED, endedAt: NOW }, NOW);
  assert.ok(!r.ok);
  assert.equal(r.reason, "not_open");
});

test("a resume reported in the future is pulled back from NOW, never forward", () => {
  const r = planResumeEarly({ startedAt: STARTED, endedAt: null, resumedAt: NOW + 60 * 60_000 }, NOW);
  assert.ok(r.ok);
  assert.equal(r.resumedAt, NOW - BACKDATE_STEP_MIN * 60_000);
});
