/**
 * «+30 دقيقة» — backdating a running stoppage's start (owner's rule,
 * 2026-09-07 meeting). Run with `npm test`.
 *
 * The properties that matter: the step is fixed, the cap is real, and a
 * stoppage that already has its row in «التوقفات» (closed) can never be moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planBackdate, BACKDATE_STEP_MIN, BACKDATE_CAP_MIN,
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
