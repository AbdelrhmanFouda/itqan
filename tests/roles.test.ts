/**
 * Role access rules. Run with `npm test`.
 *
 * The load-bearing test here is the landing invariant: signing in must never
 * drop a user on a page their own role cannot open, or the layout bounces them
 * straight back out. That is exactly the kind of thing a nav change breaks
 * silently, so it is asserted for EVERY role rather than spot-checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_ROLES, REQUESTABLE_ROLES, NAV, navFor, canAccess, landingFor, hasFullAccess,
  type Role, type NavKey,
} from "../lib/roles.ts";

const keysFor = (role: Role): NavKey[] => navFor(role).map((n) => n.key);

/* --------------------------- the landing invariant ------------------------ */

test("every role lands on a page it can actually access", () => {
  for (const role of ALL_ROLES) {
    const landing = landingFor(role);
    assert.equal(
      canAccess(role, landing), true,
      `${role} lands on ${landing} but cannot access it`,
    );
  }
});

test("every landing page is a real NAV entry", () => {
  const hrefs = new Set(NAV.map((n) => n.href));
  for (const role of ALL_ROLES) {
    assert.ok(hrefs.has(landingFor(role)), `${role} lands on an unknown route ${landingFor(role)}`);
  }
});

/* ------------------------------ the new role ------------------------------ */

test("worker exists, is requestable, and is the approval default", () => {
  assert.ok(ALL_ROLES.includes("worker"));
  assert.ok(REQUESTABLE_ROLES.includes("worker"));
  assert.equal(REQUESTABLE_ROLES[0], "worker", "least-privileged role must be the default");
  assert.equal(REQUESTABLE_ROLES[REQUESTABLE_ROLES.length - 1], "manager", "manager stays last");
  assert.ok(!REQUESTABLE_ROLES.includes("owner"), "owner is never requestable");
});

test("worker sees exactly hourly, downtime, issues, assistant", () => {
  assert.deepEqual(keysFor("worker").sort(), ["assistant", "downtime", "hourly", "issues"]);
});

test("worker cannot reach the pages it was not given", () => {
  for (const href of ["/dashboard", "/dashboard/production", "/dashboard/jobs", "/dashboard/performance",
                      "/dashboard/quality", "/dashboard/storage", "/dashboard/reports", "/dashboard/approvals"]) {
    assert.equal(canAccess("worker", href), false, `worker should not access ${href}`);
  }
});

/* -------------------- production and quality have diverged ---------------- */

test("production sees exactly its eight pages", () => {
  assert.deepEqual(
    keysFor("production").sort(),
    ["assistant", "downtime", "hourly", "issues", "jobs", "overview", "performance", "production"],
  );
});

test("quality sees exactly its six pages", () => {
  assert.deepEqual(
    keysFor("quality").sort(),
    ["assistant", "hourly", "issues", "overview", "performance", "quality"],
  );
});

test("production and quality are no longer identical", () => {
  // The whole point of deleting OPS. If this ever passes as equal again,
  // someone has re-welded them.
  assert.notDeepEqual(keysFor("production").sort(), keysFor("quality").sort());
  // Each has something the other does not.
  assert.ok(canAccess("production", "/dashboard/production"));
  assert.equal(canAccess("quality", "/dashboard/production"), false);
  assert.ok(canAccess("quality", "/dashboard/quality"));
  assert.equal(canAccess("production", "/dashboard/quality"), false);
});

test("the pages production and quality lost are really gone", () => {
  for (const href of ["/dashboard/machines", "/dashboard/molds", "/dashboard/products",
                      "/dashboard/storage", "/dashboard/reports"]) {
    assert.equal(canAccess("production", href), false, `production kept ${href}`);
    assert.equal(canAccess("quality", href), false, `quality kept ${href}`);
  }
  assert.equal(canAccess("quality", "/dashboard/jobs"), false, "quality kept jobs");
  assert.equal(canAccess("quality", "/dashboard/downtime"), false, "quality kept downtime");
  // …but both keep overview.
  assert.ok(canAccess("production", "/dashboard"));
  assert.ok(canAccess("quality", "/dashboard"));
});

/* --------------------------- untouched roles ------------------------------ */

test("maintenance, sales, finance and storage are unchanged", () => {
  assert.deepEqual(keysFor("maintenance").sort(), ["downtime", "issues", "machines"]);
  assert.deepEqual(keysFor("sales").sort(), ["clients", "jobs", "products", "sales"]);
  assert.deepEqual(keysFor("finance").sort(), ["finance", "reports"]);
  assert.deepEqual(keysFor("storage").sort(), ["storage"]);
});

/* ------------------------------ full access ------------------------------- */

test("owner and manager keep everything; nobody else gets approvals", () => {
  for (const role of ["owner", "manager"] as Role[]) {
    assert.ok(hasFullAccess(role));
    assert.equal(navFor(role).length, NAV.length);
    assert.ok(canAccess(role, "/dashboard/approvals"));
    assert.ok(canAccess(role, "/dashboard/molds"));
  }
  for (const role of REQUESTABLE_ROLES.filter((r) => r !== "manager")) {
    assert.equal(canAccess(role, "/dashboard/approvals"), false, `${role} can reach approvals`);
  }
});

test("an unknown dashboard route falls back to the overview entry, not to deny", () => {
  // PRE-EXISTING behaviour, documented here because the comment on canAccess
  // ("unknown dashboard route → owner/manager only") is not the whole truth:
  // matching is longest-PREFIX, and the overview entry's href "/dashboard" is a
  // prefix of every "/dashboard/*" path. So a role holding overview inherits any
  // route that has no NAV entry of its own. Every real page does have one, so
  // nothing is exposed today — but a NEW page added without a NAV entry would be
  // reachable by production and quality, not owner/manager only.
  assert.ok(canAccess("owner", "/dashboard/nonexistent"));
  assert.equal(canAccess("production", "/dashboard/nonexistent"), true, "inherits overview");
  assert.equal(canAccess("quality", "/dashboard/nonexistent"), true, "inherits overview");
  // Roles WITHOUT overview — including the new worker — are correctly denied.
  for (const role of ["worker", "sales", "finance", "maintenance", "storage"] as Role[]) {
    assert.equal(canAccess(role, "/dashboard/nonexistent"), false, `${role} reached an unknown route`);
  }
});

test("sub-paths resolve to the longest matching prefix, not to overview", () => {
  // "/dashboard/jobs/7" must be judged by the jobs entry, not by "/dashboard".
  assert.ok(canAccess("production", "/dashboard/jobs/7"));
  assert.equal(canAccess("quality", "/dashboard/jobs/7"), false);
  assert.ok(canAccess("sales", "/dashboard/jobs/7"));
});

test("NAV has no duplicate keys or hrefs", () => {
  assert.equal(new Set(NAV.map((n) => n.key)).size, NAV.length);
  assert.equal(new Set(NAV.map((n) => n.href)).size, NAV.length);
});
