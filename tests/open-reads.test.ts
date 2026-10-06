/**
 * The open-read allow-list — pinned because /api/sheet/[entity] serves any
 * entity in this set to ANONYMOUS callers. On 2026-08-28 `sheet/jobs` was
 * found serving the full order book (clients + quantities) past the guard on
 * /api/jobs, which is exactly what an entity slipping into — or out of — this
 * set costs, silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_READS, PRODUCTION_ONLY, SALES_ONLY, WRITABLE_ENTITIES, READONLY_FIELDS, readonlyFields } from "../lib/open-reads.ts";
import fs from "node:fs";
import path from "node:path";

test("OPEN_READS is EMPTY — every entity needs a token", () => {
  // A change here is a decision to publish or unpublish factory data, not
  // housekeeping. If this assertion is in your way, that decision is being
  // made — say so in the department brief, don't just edit the list.
  //
  // Moved DELIBERATELY on 2026-09-23 (customer portal, phase 0b): it was
  // ["issues", "machines", "molds", "products"]. `products` and `molds` each
  // answered a token-less caller with 503 product names, 502 of them paired
  // with a real client name; `machines` published the registry and its count.
  // `issues` went the same day, on the review pass: ENTITIES.issues declares
  // `product` and `machine`, so the faults log served real product names and
  // registry labels — and the machine count with them.
  assert.deepEqual([...OPEN_READS].sort(), []);
});

test("the entities that carry client data or PII are NOT open", () => {
  // jobs/production/master name clients and quantities; downtime rows carry a
  // staff email («سُجل بواسطة»); clients is contact details, sales-only.
  // molds/products name the client beside the product (closed 2026-09-23);
  // machines is the registry and its count, which no public surface may show.
  for (const entity of ["clients", "jobs", "production", "master", "downtime", "molds", "products", "machines", "issues", "customerRequests"]) {
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

test("«العملاء»!A «الرقم» can never be written by the generic PATCH", () => {
  // It stopped being a label on 2026-09-23: a customer-portal account stores
  // {no, name} as its link, so renumbering a row by hand through the sheet
  // editor would point an approved buyer at a different company. The route
  // strips these keys; SheetSection renders them as text.
  assert.deepEqual([...readonlyFields("clients")].sort(), ["no"]);
  assert.deepEqual(Object.keys(READONLY_FIELDS).sort(), ["clients"]);
  // Every entity that has read-only fields must still be writable at all —
  // otherwise the list is describing a PATCH that cannot happen.
  for (const entity of Object.keys(READONLY_FIELDS)) {
    assert.ok(WRITABLE_ENTITIES.has(entity), `"${entity}" has read-only fields but is not writable`);
  }
  // An entity with no entry answers an empty set, never undefined — the route
  // iterates this without a null check.
  assert.equal(readonlyFields("products").size, 0);
  assert.equal(readonlyFields("nonesuch").size, 0);
});

/* ------------------------- the sales-only entities ------------------------- */

test("SALES_ONLY is «العملاء» and «طلبات العملاء», and the route uses it", () => {
  // The generic door must not be wider than the dedicated one. /api/requests
  // is sales-only (owner decision 6) and /dashboard/requests is owner+manager+
  // sales — but registering the tab in ENTITIES made /api/sheet/customerRequests
  // serve the same rows, with the buyer's note and the reject reason, to any
  // approved role. Found on the 2026-09-23 review pass.
  assert.deepEqual([...SALES_ONLY].sort(), ["clients", "customerRequests"]);
  for (const entity of SALES_ONLY) {
    assert.equal(OPEN_READS.has(entity), false, `"${entity}" must never also be open`);
  }
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "..", "app", "api", "sheet", "[entity]", "route.ts"), "utf8",
  );
  assert.ok(/SALES_ONLY\.has\(entity\)/.test(src), "the route must consult SALES_ONLY");
  assert.ok(
    src.indexOf("SALES_ONLY.has(entity)") < src.indexOf("OPEN_READS.has(entity)"),
    "the strict branch must be checked before the deny-by-default one",
  );
  // A hand-written entity name in the route is how the two drift apart again.
  assert.equal(/entity === "clients"/.test(src), false, "the strict list lives in lib/open-reads.ts");
});

/* ----------------------- the production-only entities ---------------------- */

test("PRODUCTION_ONLY is the mould plan's two tabs, and the route uses it", () => {
  // /api/changeover is production + owner/manager: its rows name clients,
  // orders and who answered what. Registering the two tabs in ENTITIES made
  // /api/sheet/changeoverAnswers and /api/sheet/changeoverLog serve the same
  // rows to any approved role. Found on the 2026-10-05 review pass.
  assert.deepEqual([...PRODUCTION_ONLY].sort(), ["changeoverAnswers", "changeoverLog"]);
  for (const entity of PRODUCTION_ONLY) {
    assert.equal(OPEN_READS.has(entity), false, `"${entity}" must never also be open`);
    assert.equal(SALES_ONLY.has(entity), false, `"${entity}" cannot be in two strict lists`);
    assert.equal(WRITABLE_ENTITIES.has(entity), false, `"${entity}" is written by /api/changeover only`);
  }
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "..", "app", "api", "sheet", "[entity]", "route.ts"), "utf8",
  );
  assert.ok(/PRODUCTION_ONLY\.has\(entity\)/.test(src), "the route must consult PRODUCTION_ONLY");
  assert.ok(
    src.indexOf("PRODUCTION_ONLY.has(entity)") < src.indexOf("OPEN_READS.has(entity)"),
    "the strict branch must be checked before the deny-by-default one",
  );
});
