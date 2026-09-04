/**
 * The system from every view — who can open what, pinned as ONE table.
 *
 * tests/roles.test.ts checks the invariants (landing pages, the worker's set,
 * production ≠ quality). This file pins the WHOLE matrix, cell by cell, and
 * then checks the things around it that a role change silently depends on:
 *
 *  - every dashboard page on disk is governed by a NAV entry of its OWN, so no
 *    page rides the overview prefix by accident (CLAUDE.md: "a new page added
 *    without a NAV entry is reachable by production and quality");
 *  - every NAV href has a page on disk;
 *  - the layout has an icon and a label for every NAV key (a missing case
 *    renders an empty sidebar row);
 *  - each role's sidebar is exactly the set of pages it can open.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ALL_ROLES, REQUESTABLE_ROLES, NAV, navFor, canAccess, landingFor, hasFullAccess,
  type Role, type NavKey,
} from "../lib/roles.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

/* ------------------------------- the matrix ------------------------------- */

// Who may OPEN each page. owner + manager open everything (hasFullAccess).
// Change this table and lib/roles.ts together — a change here is a decision
// about what a person in the factory gets to see, not housekeeping.
const MATRIX: Record<NavKey, Role[]> = {
  overview:    ["owner", "manager", "production", "quality"],
  finance:     ["owner", "manager", "finance"],
  quality:     ["owner", "manager", "quality"],
  sales:       ["owner", "manager", "sales"],
  machines:    ["owner", "manager", "maintenance"],
  // worker added 2026-09-04 (owner's word): the floor reads the mould number.
  molds:       ["owner", "manager", "worker"],
  products:    ["owner", "manager", "sales"],
  jobs:        ["owner", "manager", "production", "sales"],
  production:  ["owner", "manager", "production"],
  downtime:    ["owner", "manager", "production", "worker", "maintenance"],
  storage:     ["owner", "manager", "storage"],
  issues:      ["owner", "manager", "production", "quality", "worker", "maintenance"],
  performance: ["owner", "manager", "production", "quality"],
  assistant:   ["owner", "manager", "production", "quality", "worker"],
  reports:     ["owner", "manager", "finance"],
  clients:     ["owner", "manager", "sales"],
  approvals:   ["owner", "manager"],
};

const hrefOf = (key: NavKey) => NAV.find((n) => n.key === key)!.href;

test("the matrix names every NAV key and nothing else", () => {
  assert.deepEqual(Object.keys(MATRIX).sort(), NAV.map((n) => n.key).sort());
});

test("every cell of the matrix: canAccess agrees, for every role and every page", () => {
  for (const key of Object.keys(MATRIX) as NavKey[]) {
    for (const role of ALL_ROLES) {
      const expected = MATRIX[key].includes(role);
      assert.equal(
        canAccess(role, hrefOf(key)), expected,
        `${role} ${expected ? "should" : "should NOT"} open ${hrefOf(key)}`,
      );
    }
  }
});

test("every role's sidebar is exactly the pages it can open, in NAV order", () => {
  for (const role of ALL_ROLES) {
    const sidebar = navFor(role).map((n) => n.key);
    const allowed = NAV.filter((n) => canAccess(role, n.href)).map((n) => n.key);
    assert.deepEqual(sidebar, allowed, `${role}: sidebar and access disagree`);
    assert.deepEqual(
      sidebar,
      NAV.map((n) => n.key).filter((k) => MATRIX[k].includes(role)),
      `${role}: sidebar and the matrix disagree`,
    );
  }
});

test("owner and manager see every page; every other role sees a strict subset", () => {
  for (const role of ALL_ROLES) {
    if (hasFullAccess(role)) assert.equal(navFor(role).length, NAV.length);
    else assert.ok(navFor(role).length < NAV.length, `${role} sees everything`);
  }
});

test("every role lands inside its own matrix row", () => {
  for (const role of ALL_ROLES) {
    const key = NAV.find((n) => n.href === landingFor(role))?.key;
    assert.ok(key, `${role} lands on a route with no NAV entry`);
    assert.ok(MATRIX[key!].includes(role), `${role} lands on ${key}, which it cannot open`);
  }
});

test("pages that name a client, a quantity or a stock are closed to the floor", () => {
  // The worker sees the floor's pages and the mould register — never the
  // order book, the warehouse, the money or the customer list.
  for (const key of ["jobs", "clients", "storage", "finance", "sales", "reports", "products", "machines", "performance", "quality", "overview", "approvals"] as NavKey[]) {
    assert.equal(MATRIX[key].includes("worker"), false, `worker was given ${key}`);
  }
  assert.deepEqual(MATRIX.molds.filter((r) => !hasFullAccess(r)), ["worker"]);
});

test("approvals belongs to owner and manager only — no requestable role but manager", () => {
  for (const role of REQUESTABLE_ROLES) {
    assert.equal(canAccess(role, "/dashboard/approvals"), role === "manager", role);
  }
});

/* ------------------------- the pages on disk ------------------------------ */

/** Every app/dashboard/**\/page.tsx as a route ("/dashboard/jobs/[id]"). */
function dashboardRoutes(): string[] {
  const base = path.join(ROOT, "app", "dashboard");
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${route}/${e.name}`);
      else if (e.name === "page.tsx") out.push(route || "/dashboard");
    }
  };
  walk(base, "/dashboard");
  return out.sort();
}

/** The NAV entry that governs a route — longest prefix, same as canAccess(). */
function governing(route: string) {
  return NAV
    .filter((n) => route === n.href || route.startsWith(n.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

test("every dashboard page on disk is governed by a NAV entry of its own — never by the overview prefix", () => {
  for (const route of dashboardRoutes()) {
    const entry = governing(route);
    assert.ok(entry, `${route} has no NAV entry`);
    if (route !== "/dashboard") {
      assert.notEqual(entry.key, "overview", `${route} is governed by the overview prefix — add a NAV entry for it`);
    }
  }
});

test("every NAV href has a page on disk", () => {
  const routes = new Set(dashboardRoutes());
  for (const n of NAV) assert.ok(routes.has(n.href), `${n.href} (${n.key}) has no page.tsx`);
});

test("a route with no NAV entry is opened only by roles holding the overview prefix — documented, and still true", () => {
  // Pre-existing shape of canAccess(): the overview entry's href "/dashboard"
  // prefixes every dashboard path. Nothing on disk relies on it (the test
  // above), but the behaviour itself is pinned so a change to it is noticed.
  for (const role of ALL_ROLES) {
    assert.equal(canAccess(role, "/dashboard/there-is-no-such-page"), MATRIX.overview.includes(role), role);
  }
});

/* --------------------------- the layout ---------------------------------- */

test("the dashboard layout has an icon and a label for every NAV key", () => {
  const layout = fs.readFileSync(path.join(ROOT, "app", "dashboard", "layout.tsx"), "utf8");
  const iconBlock = layout.slice(layout.indexOf("const ICON"), layout.indexOf("export default function"));
  for (const n of NAV) {
    assert.ok(new RegExp(`\\b${n.key}: `).test(iconBlock), `ICON has no entry for ${n.key}`);
    assert.ok(layout.includes(`case "${n.key}":`), `navLabel has no case for ${n.key}`);
  }
});
