/**
 * Every API route, classified — and checked against its own source.
 *
 * The dashboard's role table is UX; the API guards are the security boundary
 * (CLAUDE.md, "API auth"). The rule there: every MUTATING handler and every
 * read that names a client, a quantity, a stock or a person verifies the
 * Firebase ID token; the open operational reads are an EXHAUSTIVE list, and a
 * read not on it is either guarded or it is a leak — which is exactly how
 * /api/jobs and /api/storage sat open for weeks (2026-08-28).
 *
 * This test reads app/api/**\/route.ts and asserts, per exported handler,
 * that its body does what the table below says. A NEW route file or handler
 * fails until it is classified here — deny-by-default for the audit, the
 * same shape lib/open-reads.ts gives the sheet route.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "app", "api");

type Kind =
  | "open"        // no token — one of the documented open operational reads
  | "guard"       // requireRole(req): any approved role
  | "owner"       // requireRole(req, []): owner + manager only
  | "sales"       // requireRole(req, ["sales"]): sales + owner/manager
  | "token"       // verifies the ID token itself (verifyIdToken + roleFor)
  | "public"      // the contact form: unauthenticated by nature, rate-limited
  | "conditional"; // sheet/[entity]: open for OPEN_READS, guarded otherwise

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const ROUTES: Record<string, Partial<Record<Method, Kind>>> = {
  "agent":               { GET: "token", POST: "token" },
  "ai-review":           { GET: "guard" },
  "contact":             { POST: "public" },
  "downtime":            { GET: "guard", POST: "guard", PATCH: "guard" },
  "downtime/export":     { GET: "guard" },
  "downtime/reclassify": { GET: "owner", POST: "owner" },
  "inquiries":           { GET: "sales" },
  "issues":              { GET: "open", POST: "guard" },
  "jobs":                { GET: "guard", POST: "guard" },
  "jobs/[id]":           { GET: "guard", PATCH: "guard", DELETE: "guard" },
  "machines":            { GET: "open", POST: "guard" },
  "machines/[id]":       { GET: "open", PATCH: "guard", DELETE: "guard" },
  "machines/[id]/notes": { GET: "open", POST: "guard" },
  // Master for the register (2026-09-04): any approved role may read AND
  // edit — the worker was given the page the same day, and the owner opened
  // editing to everyone.
  "molds":               { GET: "guard", PATCH: "guard" },
  "oee":                 { GET: "open" },
  "public/showcase":     { GET: "open" },
  "reports":             { GET: "guard", POST: "guard" },
  "reports/[id]":        { GET: "guard", DELETE: "guard" },
  "reports/draft":       { GET: "guard" },
  "runs":                { GET: "open", POST: "guard" },
  "runs/[id]":           { DELETE: "guard" },
  "sheet/[entity]":      { GET: "conditional", PATCH: "guard" },
  "storage":             { GET: "guard", POST: "token" },
};

// The documented open reads — CLAUDE.md: "Operational reads (sheet molds,
// products, machines, runs, oee, issues) stay open deliberately — that list is
// exhaustive". sheet/[entity] is the conditional one (lib/open-reads.ts).
const DOCUMENTED_OPEN = ["issues", "machines", "machines/[id]", "machines/[id]/notes", "oee", "public/showcase", "runs"];

/* --------------------------------- helpers -------------------------------- */

function routeFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel ? `${rel}/${e.name}` : e.name);
      else if (e.name === "route.ts") out[rel] = fs.readFileSync(p, "utf8");
    }
  };
  walk(API, "");
  return out;
}

/** Exported handlers and their bodies (from the export to the next export / EOF). */
function handlers(src: string): Record<string, string> {
  const re = /export async function (GET|POST|PATCH|PUT|DELETE)\b/g;
  const marks: { m: string; at: number }[] = [];
  for (let x = re.exec(src); x; x = re.exec(src)) marks.push({ m: x[1], at: x.index });
  const out: Record<string, string> = {};
  marks.forEach((k, i) => { out[k.m] = src.slice(k.at, marks[i + 1]?.at ?? src.length); });
  return out;
}

const FILES = routeFiles();

/* --------------------------------- coverage ------------------------------- */

test("every route file on disk is classified, and every classified route exists", () => {
  assert.deepEqual(Object.keys(FILES).sort(), Object.keys(ROUTES).sort());
});

test("every exported handler is classified, and every classified handler is exported", () => {
  for (const [route, src] of Object.entries(FILES)) {
    assert.deepEqual(
      Object.keys(handlers(src)).sort(), Object.keys(ROUTES[route] ?? {}).sort(),
      `${route}: handlers on disk vs the table`,
    );
  }
});

/* ---------------------------------- guards -------------------------------- */

test("each handler does what its classification says", () => {
  for (const [route, kinds] of Object.entries(ROUTES)) {
    const hs = handlers(FILES[route]);
    for (const [method, kind] of Object.entries(kinds) as [Method, Kind][]) {
      const body = hs[method];
      const where = `${method} /api/${route}`;
      const guarded = /requireRole\(\s*req\b/.test(body);
      const denies = /if \("deny" in g\) return g\.deny/.test(body);
      switch (kind) {
        case "guard":
          assert.ok(/requireRole\(\s*req\s*\)/.test(body), `${where}: must call requireRole(req)`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "owner":
          assert.ok(/requireRole\(\s*req\s*,\s*\[\s*\]\s*\)/.test(body), `${where}: must call requireRole(req, [])`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "sales":
          assert.ok(/requireRole\(\s*req\s*,\s*\[\s*"sales"\s*\]\s*\)/.test(body), `${where}: must call requireRole(req, ["sales"])`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "token":
          assert.ok(/verifyIdToken\(/.test(body), `${where}: must verify the ID token`);
          assert.ok(/roleFor\(/.test(body), `${where}: must resolve the role`);
          break;
        case "open":
          assert.equal(guarded, false, `${where}: is documented OPEN but calls requireRole — update DOCUMENTED_OPEN and CLAUDE.md, or the classification`);
          assert.equal(/verifyIdToken\(/.test(body), false, `${where}: is documented OPEN but verifies a token`);
          break;
        case "public":
          assert.ok(/rateLimited\(/.test(body), `${where}: the public endpoint must rate-limit`);
          assert.equal(guarded, false, `${where}: the contact form cannot require a login`);
          break;
        case "conditional":
          assert.ok(/OPEN_READS\.has\(/.test(body), `${where}: must consult OPEN_READS`);
          assert.ok(guarded && denies, `${where}: must guard the non-open branch`);
          break;
      }
    }
  }
});

test("the open reads are exactly the documented ones", () => {
  const open = Object.entries(ROUTES)
    .filter(([, kinds]) => Object.values(kinds).includes("open"))
    .map(([route]) => route)
    .sort();
  assert.deepEqual(open, [...DOCUMENTED_OPEN].sort());
});

test("no mutating handler anywhere is open", () => {
  for (const [route, kinds] of Object.entries(ROUTES)) {
    for (const [method, kind] of Object.entries(kinds) as [Method, Kind][]) {
      if (method === "GET") continue;
      assert.notEqual(kind, "open", `${method} /api/${route} is open`);
      assert.notEqual(kind, "conditional", `${method} /api/${route} is conditional`);
    }
  }
});

test("a mutating handler that is guarded checks the guard BEFORE reading the body", () => {
  // The guard must be the first thing that can fail: a route that parses the
  // request first can be made to do work — or throw — by anyone.
  for (const [route, kinds] of Object.entries(ROUTES)) {
    const hs = handlers(FILES[route]);
    for (const [method, kind] of Object.entries(kinds) as [Method, Kind][]) {
      if (method === "GET" || !["guard", "owner", "sales"].includes(kind)) continue;
      const body = hs[method];
      const guardAt = body.search(/requireRole\(/);
      // The BODY, not the URL: reading route params first is harmless.
      const readAt = body.search(/req\.(json|text|formData)\(\)/);
      if (readAt >= 0) assert.ok(guardAt < readAt, `${method} /api/${route}: reads the request body before the guard`);
    }
  }
});

test("the client-data reads that were found open on 2026-08-28 are guarded", () => {
  assert.equal(ROUTES["jobs"].GET, "guard");
  assert.equal(ROUTES["jobs/[id]"].GET, "guard");
  assert.equal(ROUTES["storage"].GET, "guard");
  assert.equal(ROUTES["reports"].GET, "guard");
  assert.equal(ROUTES["reports/[id]"].GET, "guard");
  assert.equal(ROUTES["downtime"].GET, "guard", "rows carry «سُجل بواسطة», a staff email");
  assert.equal(ROUTES["inquiries"].GET, "sales", "PII");
  assert.equal(ROUTES["molds"].GET, "guard", "Master, deny-by-default since 2026-08-28");
});

test("the showcase endpoint serves counts only — no names", () => {
  const src = FILES["public/showcase"];
  assert.equal(/records|names|clients\.map|molds\.map/.test(src), false, "the public showcase must not serialise names");
  assert.ok(/getPublicShowcase\(/.test(src));
});
