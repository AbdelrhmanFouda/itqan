/**
 * The scrap join, and the 2026-08-27 fix: logged scrap is CREDITED against the
 * hourly day-total before anything is distributed. «الإنتاج» carries native
 * scrap now, and the hourly log derives from the same counters — without the
 * credit, a day mixing a native-scrap row with a «لم يُعد بعد» row counted the
 * same scrap twice. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScrap } from "../lib/scrap.ts";

const H = (date: string, machine: string, scrap: number | null) => ({ date, machine, scrap });
const R = (date: string, machine: string, goodUnits: number, scrapUnits: number) =>
  ({ date, machine, goodUnits, scrapUnits });

test("THE DOUBLE-COUNT CASE: a logged row's scrap is credited, not re-distributed", () => {
  // Day total from the hourly log: 100. The morning production row already
  // logged 30 of it natively. The evening row («لم يُعد بعد») must receive
  // only the remaining 70 — the old code gave it the full 100.
  const runs = [R("2026-08-20", "PQ 7 — 100", 500, 30), R("2026-08-20", "PQ 7 — 100", 400, 0)];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ 7 — 100", 100)]);
  assert.deepEqual(out, [0, 70]);
});

test("logged scrap covering the whole total leaves nothing to distribute", () => {
  const runs = [R("2026-08-20", "PQ 7 — 100", 500, 120), R("2026-08-20", "PQ 7 — 100", 400, 0)];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ 7 — 100", 100)]);
  assert.deepEqual(out, [0, 0], "over-credit must clamp at zero, never go negative");
});

test("a day with no logged scrap distributes the full total, proportionally and remainder-exact", () => {
  const runs = [R("2026-08-20", "PQ 7 — 100", 600, 0), R("2026-08-20", "PQ 7 — 100", 300, 0)];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ 7 — 100", 100)]);
  assert.equal(out[0] + out[1], 100, "the split must sum to the day's total");
  assert.ok(out[0] > out[1], "proportional to good units");
});

test("logged scrap on ANOTHER day or machine is not a credit here", () => {
  const runs = [
    R("2026-08-19", "PQ 7 — 100", 500, 40), // other day
    R("2026-08-20", "PQ 5 — 100", 500, 40), // other machine (same tonnage!)
    R("2026-08-20", "PQ 7 — 100", 400, 0),
  ];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ 7 — 100", 100)]);
  assert.deepEqual(out, [0, 0, 100]);
});

test("machine labels join through the same normalizer on both sides", () => {
  const runs = [R("2026-08-20", "pq 7 — 100", 400, 0)];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ  7 — 100", 50)]);
  assert.deepEqual(out, [50]);
});

test("null and non-positive hourly scrap contribute nothing", () => {
  const runs = [R("2026-08-20", "PQ 7 — 100", 400, 0)];
  const out = deriveScrap(runs, [
    H("2026-08-20", "PQ 7 — 100", null),
    H("2026-08-20", "PQ 7 — 100", 0),
  ]);
  assert.deepEqual(out, [0]);
});

test("undated runs neither receive nor credit", () => {
  const runs = [R("", "PQ 7 — 100", 400, 30), R("2026-08-20", "PQ 7 — 100", 400, 0)];
  const out = deriveScrap(runs, [H("2026-08-20", "PQ 7 — 100", 100)]);
  assert.deepEqual(out, [0, 100], "the undated row's scrap is not a credit for the dated day");
});
