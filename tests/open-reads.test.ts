/**
 * The open-read allow-list — pinned because /api/sheet/[entity] serves any
 * entity in this set to ANONYMOUS callers. On 2026-08-28 `sheet/jobs` was
 * found serving the full order book (clients + quantities) past the guard on
 * /api/jobs, which is exactly what an entity slipping into — or out of — this
 * set costs, silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_READS, WRITABLE_ENTITIES } from "../lib/open-reads.ts";

test("OPEN_READS is exactly the four documented open operational reads", () => {
  // A change here is a decision to publish or unpublish factory data, not
  // housekeeping. If this assertion is in your way, that decision is being
  // made — say so in the department brief, don't just edit the list.
  assert.deepEqual([...OPEN_READS].sort(), ["issues", "machines", "molds", "products"]);
});

test("the entities that carry client data or PII are NOT open", () => {
  // jobs/production/master name clients and quantities; downtime rows carry a
  // staff email («سُجل بواسطة»); clients is contact details, sales-only.
  for (const entity of ["clients", "jobs", "production", "master", "downtime"]) {
    assert.equal(OPEN_READS.has(entity), false, `"${entity}" must stay guarded`);
  }
});

test("WRITABLE_ENTITIES is exactly the two tabs SheetSection edits", () => {
  // The generic PATCH used to accept all nine ENTITIES keys. Adding one here
  // is a decision to let a generic row write reach that tab past its dedicated
  // route (identity check, diff-only write, duplicate-name refusal).
  assert.deepEqual([...WRITABLE_ENTITIES].sort(), ["clients", "products"]);
});

test("the operational tabs with dedicated write routes are NOT generically writable", () => {
  for (const entity of ["production", "jobs", "master", "molds", "machines", "issues", "downtime"]) {
    assert.equal(WRITABLE_ENTITIES.has(entity), false, `"${entity}" must be written by its own route`);
  }
});
