/**
 * Every call a page makes to /api, checked against the guards.
 *
 * A guarded route answers 401 to a plain fetch(), and most pages turn a 401
 * into an empty list — the page then says "no jobs" / "no moulds" as if that
 * were the truth. Six pages were switched from fetch to authedFetch on
 * 2026-08-28 for exactly that reason. This test walks every .tsx under
 * app/, components/ and context/ and asserts:
 *
 *  - a plain fetch("/api/…") only ever targets an OPEN endpoint, or carries
 *    its own Authorization header (the assistant and storage pages mint the
 *    token themselves);
 *  - every authedFetch() targets /api.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// The endpoints a browser may call WITHOUT a token — the documented open reads
// (tests/api-guards.test.ts) plus the two public front-door endpoints.
// TEN left this list on 2026-09-23 (the customer portal's phase 0b, then the
// review pass that closed the faults log and the OEE set) — see
// GUARDED_PREFIXES below. What is left carries no factory data at all.
const OPEN_PREFIXES = [
  "/api/public/showcase", "/api/contact", "/api/health", "/api/warm",
];

// Endpoints that MUST be called with a token — a plain fetch here is the
// 2026-08-28 bug coming back.
const GUARDED_PREFIXES = [
  "/api/jobs", "/api/storage", "/api/downtime", "/api/reports", "/api/ai-review", "/api/inquiries",
  "/api/molds", "/api/sheet/clients", "/api/sheet/master", "/api/sheet/jobs", "/api/sheet/production",
  "/api/sheet/downtime", "/api/agent", "/api/stock", "/api/changeover",
  // The faults log and the OEE set, closed on the 2026-09-23 review pass:
  // every fault row names a product and a registry machine label, and the OEE
  // body carries one entry per machine WITH its label — the machine count the
  // owner's rule of 2026-09-20 keeps off public surfaces — plus product names
  // in standardsGap/suspects. (A recording's bytes: guarded since 2026-09-09.)
  "/api/issues", "/api/oee", "/api/sheet/issues",
  // Closed 2026-09-23 (customer portal, phase 0b): the run rows carry the
  // operator's name; the registry carries the machine count; the product and
  // mould views pair 502 product names with a real client name.
  "/api/runs", "/api/machines",
  "/api/sheet/products", "/api/sheet/molds", "/api/sheet/machines",
  // «بوابة العملاء» (2026-09-23). Every portal route is guarded by the
  // customer's own account document; a token-less fetch answers 401 and the
  // portal would show a buyer an empty order list as if that were the truth.
  "/api/portal",
  // The staff side of the same feature (2026-09-23): the review queue, the
  // preview and the two decisions. Sales-only, so a token-less fetch answers
  // 401 and the page would show an empty queue as if nothing were waiting.
  "/api/requests",
  // «إنشاء حساب عميل» (2026-10-07): owner/manager only. A token-less call
  // answers 401 and the dialog would say the login could not be created.
  "/api/customers",
];

type Call = { file: string; line: number; url: string; authed: boolean; ownToken: boolean };

function sources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) out.push([path.relative(ROOT, p).replace(/\\/g, "/"), fs.readFileSync(p, "utf8")]);
    }
  };
  for (const d of ["app", "components", "context"]) walk(path.join(ROOT, d));
  return out;
}

/** Every fetch(…) / authedFetch(…) whose first argument is a string literal. */
function calls(): Call[] {
  const out: Call[] = [];
  // Two shapes: fetch("/api/…") / authedFetch("/api/…"), and — since 2026-09-10 —
  // timedJson(fetch, "/api/…") / timedJson(authedFetch, "/api/…"), the bounded
  // form every page load uses now (components/dashboard/last-seen.ts).
  const re = /\b(?:timedJson(?:<[^>]*>)?\(\s*(authedFetch|fetch)\s*,|(authedFetch|fetch)\()\s*(["'`])([^"'`]*)/g;
  for (const [file, src] of sources()) {
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const fn = m[1] ?? m[2];
      const url = m[4].split("${")[0]; // a template's literal prefix
      const line = src.slice(0, m.index).split("\n").length;
      // The storage page attaches `Authorization: Bearer` by hand; the
      // assistant page posts the token in the body as `idToken` (the agent
      // route verifies it from there). Either counts as carrying a token.
      const window = src.slice(m.index, m.index + 400);
      out.push({ file, line, url, authed: fn === "authedFetch", ownToken: /Authorization|idToken:/.test(window) });
    }
  }
  return out;
}

const CALLS = calls();

test("the walk found the pages (sanity)", () => {
  assert.ok(CALLS.length >= 30, `only ${CALLS.length} calls found`);
  assert.ok(CALLS.some((c) => c.file.startsWith("app/dashboard/")));
  assert.ok(CALLS.some((c) => c.file.startsWith("components/")));
});

test("every plain fetch to /api targets an open endpoint or carries its own token", () => {
  for (const c of CALLS) {
    if (c.authed || !c.url.startsWith("/api/")) continue;
    const open = OPEN_PREFIXES.some((p) => c.url === p || c.url.startsWith(p + "/") || c.url.startsWith(p + "?"));
    assert.ok(
      open || c.ownToken,
      `${c.file}:${c.line} fetches ${c.url} without a token — use authedFetch`,
    );
  }
});

test("no guarded endpoint is ever called with a plain, token-less fetch", () => {
  for (const c of CALLS) {
    if (c.authed || c.ownToken) continue;
    for (const p of GUARDED_PREFIXES) {
      assert.equal(
        c.url === p || c.url.startsWith(p + "/") || c.url.startsWith(p + "?"), false,
        `${c.file}:${c.line}: ${c.url} is guarded — a plain fetch gets 401 and the page shows an empty list`,
      );
    }
  }
});

test("every authedFetch targets /api", () => {
  for (const c of CALLS) {
    if (!c.authed) continue;
    assert.ok(c.url.startsWith("/api/"), `${c.file}:${c.line}: authedFetch(${c.url})`);
  }
});

test("the pages that read Master for the mould number use the guarded route with a token", () => {
  // The register, production and quality pages (2026-09-04); the jobs list and
  // the job detail joined them in cleanup batch 7 — the detail was the last
  // page reading the «الاسطمبات» formula view CLAUDE.md warns about.
  const users = CALLS.filter((c) => c.url === "/api/molds");
  assert.ok(users.length >= 3, `expected the register + production + quality, found ${users.length}`);
  for (const c of users) assert.ok(c.authed, `${c.file}:${c.line} must use authedFetch for /api/molds`);
  const files = new Set(users.map((c) => c.file));
  for (const f of ["components/dashboard/molds-register.tsx", "app/dashboard/production/page.tsx", "app/dashboard/quality/page.tsx", "app/dashboard/jobs/[id]/page.tsx"]) {
    assert.ok(files.has(f), `${f} does not read /api/molds`);
  }
});

test("the pages switched to authedFetch on 2026-09-23 still use it", () => {
  // Phase 0b of the customer portal closed /api/runs, /api/machines and
  // /api/sheet/products. Every page that read them had to gain a token in the
  // same change — a plain fetch now gets 401, and each of these pages turns a
  // failed read into "nothing here", which on a factory screen reads as truth.
  const expected: [string, string][] = [
    ["app/dashboard/page.tsx", "/api/runs"],
    ["app/dashboard/finance/page.tsx", "/api/runs"],
    ["app/dashboard/production/page.tsx", "/api/runs"],
    ["app/dashboard/quality/page.tsx", "/api/runs"],
    ["app/dashboard/page.tsx", "/api/machines"],
    ["app/dashboard/machines/page.tsx", "/api/machines"],
    ["app/dashboard/machines/[id]/page.tsx", "/api/machines/"],
    ["app/dashboard/downtime/page.tsx", "/api/machines"],
    ["app/dashboard/issues/page.tsx", "/api/machines"],
    // 2026-10-07: the issues log went mould-first and reads Master through the
    // guarded register route instead of the «المنتجات» view.
    ["app/dashboard/issues/page.tsx", "/api/molds"],
    ["app/dashboard/production/page.tsx", "/api/machines"],
    ["app/dashboard/quality/page.tsx", "/api/machines"],
    ["app/dashboard/jobs/[id]/page.tsx", "/api/machines"],
  ];
  for (const [f, url] of expected) {
    const c = CALLS.find((x) => x.file === f && x.url === url);
    assert.ok(c, `${f} no longer calls ${url}`);
    assert.ok(c!.authed || c!.ownToken, `${f}: ${url} lost its token`);
  }
});

test("the pages switched to authedFetch on 2026-08-28 still use it", () => {
  const byFile = (f: string, url: string) => CALLS.find((c) => c.file === f && c.url === url);
  for (const [f, url] of [
    ["app/dashboard/jobs/page.tsx", "/api/jobs"],
    ["app/dashboard/finance/page.tsx", "/api/jobs"],
    ["app/dashboard/sales/page.tsx", "/api/jobs"],
    ["app/dashboard/jobs/[id]/page.tsx", "/api/jobs/"],
    ["app/dashboard/storage/page.tsx", "/api/storage"],
    ["app/dashboard/reports/page.tsx", "/api/reports"],
  ]) {
    const c = byFile(f, url);
    assert.ok(c, `${f} no longer calls ${url}`);
    assert.ok(c!.authed || c!.ownToken, `${f}: ${url} lost its token`);
  }
});
