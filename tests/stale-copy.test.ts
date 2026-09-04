/**
 * The stale-while-revalidate decision in lib/stale-copy.ts. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeCopy } from "../lib/stale-copy.ts";

const FRESH = 45_000, MAX = 600_000, now = 10_000_000;

test("a young copy is fresh — served with no network", () => {
  assert.deepEqual(judgeCopy({ value: "x", at: now }, now, FRESH, MAX), { state: "fresh", value: "x" });
  assert.deepEqual(judgeCopy({ value: "x", at: now - 45_000 }, now, FRESH, MAX), { state: "fresh", value: "x" });
});

test("a copy past the fresh window but inside the bound is stale — served, then refreshed", () => {
  assert.deepEqual(judgeCopy({ value: "x", at: now - 45_001 }, now, FRESH, MAX), { state: "stale", value: "x" });
  assert.deepEqual(judgeCopy({ value: "x", at: now - 600_000 }, now, FRESH, MAX), { state: "stale", value: "x" });
});

test("no copy, a copy older than the bound, or a copy from the future → none (read and wait)", () => {
  assert.deepEqual(judgeCopy(undefined, now, FRESH, MAX), { state: "none" });
  assert.deepEqual(judgeCopy({ value: "x", at: now - 600_001 }, now, FRESH, MAX), { state: "none" });
  assert.deepEqual(judgeCopy({ value: "x", at: now + 1 }, now, FRESH, MAX), { state: "none" });
});
