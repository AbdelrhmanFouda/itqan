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
  | "prodSales"   // requireRole(req, ["production", "sales"]): the request queue (owner, 2026-09-23)
  | "storage"     // requireRole(req, ["storage"]): storage + owner/manager
  | "production"  // requireRole(req, ["production"]): the mould plan (2026-09-30)
  | "token"       // verifies the ID token itself (verifyIdToken + roleFor)
  // ---- the customer portal (2026-09-23). A customer is an ACCOUNT KIND, not
  // a role: these three admit ONLY an account with a customers/{uid} document,
  // and requireRole admits only an account with a role — so neither guard can
  // ever let the other's callers through, in either direction.
  | "customer"         // requireCustomer(req): approved AND linked to a client
  | "customerAccount"  // requireCustomerAccount(req): any status (the /me card)
  | "customerRegister" // verifies the ID token itself + an IP limiter; NO role lookup
  | "public"      // the contact form: unauthenticated by nature, rate-limited
  | "conditional" // sheet/[entity]: open for OPEN_READS, guarded otherwise
  // ---- the Claude connector (2026-09-28). Claude is not a Firebase user, so
  // it carries a token the site sealed itself (lib/mcp-auth.ts), owner-only.
  | "connector"   // mcp: verifies the sealed access token + the owner email, before the body
  | "oauth";      // mcp/oauth/register + token: stateless OAuth, no factory data in reach

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const ROUTES: Record<string, Partial<Record<Method, Kind>>> = {
  "agent":               { GET: "token", POST: "token" },
  "ai-review":           { GET: "guard" },
  "contact":             { POST: "public" },
  // «إنشاء حساب عميل» (2026-10-07): the owner makes a customer's login
  // himself. It creates a Firebase account and writes the access link, so it
  // is owner + manager ONLY — never a bare requireRole(req), which would let
  // every approved role mint customer logins. tests/portal-access.test.ts
  // pins what it may log, return and store.
  "customers":           { POST: "owner" },
  "downtime":            { GET: "guard", POST: "guard", PATCH: "guard" },
  "downtime/export":     { GET: "guard" },
  "downtime/reclassify": { GET: "owner", POST: "owner" },
  // The one-time OAuth handshake for the Sheets API transport (2026-09-10):
  // connect only redirects to Google with the public client id; callback
  // shows the consenting person their own refresh token, once. No data.
  "google/callback":     { GET: "open" },
  "google/connect":      { GET: "open" },
  // Which build is serving — a commit hash and a region, no data (2026-09-10).
  "health":              { GET: "open" },
  "inquiries":           { GET: "sales" },
  // CLOSED 2026-09-23 (review pass). Every fault row carries «المنتج» — a real
  // product name — and «الماكينة», the registry label, so the open list served
  // the machine COUNT as well. The only caller already held a token.
  "issues":              { GET: "guard", POST: "guard" },
  // Voice notes (2026-09-09): editing a row verifies its identity first;
  // the bytes of a recording are a worker's voice — signed-in staff only.
  "issues/[row]":        { PATCH: "guard" },
  "issues/audio":        { GET: "guard" },
  "jobs":                { GET: "guard", POST: "guard" },
  "jobs/[id]":           { GET: "guard", PATCH: "guard", DELETE: "guard" },
  // CLOSED 2026-09-23 (customer portal, phase 0b). The registry — every press,
  // its tonnage and the product standing in it — answered anyone with no
  // token, and with it the machine COUNT that the owner's rule of 2026-09-20
  // keeps off every public surface. The notes are a fitter's own words.
  // The Claude connector (2026-09-28): the MCP endpoint answers only a token
  // sealed by the owner's own approval; approve is the owner's sign-in step;
  // register and token hand out and redeem those seals and read no sheet.
  "mcp":                 { POST: "connector" },
  "mcp/oauth/approve":   { POST: "owner" },
  "mcp/oauth/register":  { POST: "oauth" },
  "mcp/oauth/token":     { POST: "oauth" },
  "machines":            { GET: "guard", POST: "guard" },
  "machines/[id]":       { GET: "guard", PATCH: "guard", DELETE: "guard" },
  "machines/[id]/notes": { GET: "guard", POST: "guard" },
  // Master for the register (2026-09-04): any approved role may read AND
  // edit — the worker was given the page the same day, and the owner opened
  // editing to everyone.
  "molds":               { GET: "guard", PATCH: "guard" },
  // CLOSED 2026-09-23 (review pass). Not "four percentages": the body carries
  // one entry per machine WITH its registry label (hence the count), the
  // bottleneck machines, and product names in standardsGap/suspects.
  "oee":                 { GET: "guard" },
  // «بوابة العملاء» (2026-09-23). Everything a buyer can see is decided by the
  // LINK on their own customers/{uid} document — never by anything in the
  // request — so no handler here may accept a client name, and none may fall
  // back to requireRole. tests/portal-access.test.ts pins both.
  "portal/me":           { GET: "customerAccount" },
  "portal/orders":       { GET: "customer" },
  "portal/products":     { GET: "customer" },
  "portal/register":     { POST: "customerRegister" },
  "portal/requests":     { POST: "customer" },
  "portal/requests/[reqId]": { PATCH: "customer" },
  // «المخزون» (2026-10-05): the stock the factory holds for THIS customer,
  // filtered by the same link and answered through one pinned whitelist
  // (lib/customer-stock.ts). GET only — the file imports no storage writer.
  "portal/stock":        { GET: "customer" },
  "public/showcase":     { GET: "open" },
  // «خطة الاسطمبات» (2026-09-30): production + owner/manager. The rows name
  // clients and orders, and a confirmed change rewrites a work order's
  // machine — never a bare requireRole(req), which would include the worker.
  "changeover":          { GET: "production", POST: "production" },
  // The STAFF side of «بوابة العملاء» (2026-09-23). Sales + owner/manager, by
  // the owner's decision 6 — never a bare requireRole(req), which would hand
  // the queue and the «موافقة» button to production, quality and the worker.
  // A row here names a customer and one tap on it creates a work order.
  "requests":                     { GET: "prodSales" },
  "requests/[reqId]/approve":     { POST: "prodSales" },
  "requests/[reqId]/preview":     { GET: "prodSales" },
  "requests/[reqId]/reject":      { POST: "prodSales" },
  "reports":             { GET: "guard", POST: "guard" },
  "reports/[id]":        { GET: "guard", DELETE: "guard" },
  "reports/draft":       { GET: "guard" },
  // CLOSED 2026-09-23 (customer portal, phase 0b). publicRun() serves
  // `operator` — the name of the person who ran the shift — on every one of
  // ~1,000 rows, and the production and quality pages print that column, so
  // dropping the field was not open to us. A staff name is a person, not an
  // operational read.
  "runs":                { GET: "guard", POST: "guard" },
  "runs/[id]":           { DELETE: "guard" },
  "sheet/[entity]":      { GET: "conditional", PATCH: "guard" },
  // The production side's warehouse view (2026-09-09): stocks, clients and
  // order quantities — guarded like /api/storage and /api/jobs. Read-only by
  // construction: the file has no POST, and adding one here is a decision.
  "stock":               { GET: "guard" },
  "storage":             { GET: "guard", POST: "storage" },
  // Warms the instance's copies of the core tabs after sign-in (2026-09-10);
  // answers {ok:true} at once, returns no data.
  "warm":                { GET: "open" },
};

// The documented open reads — CLAUDE.md, "API auth": the list is EXHAUSTIVE,
// and a read not on it is either guarded or it is a leak. sheet/[entity] is
// the conditional one (lib/open-reads.ts, whose set is empty since 2026-09-23).
//
// Four left this list on 2026-09-23 (customer portal, phase 0b): machines,
// machines/[id], machines/[id]/notes and runs. Two more left it the same day,
// on the review pass: the faults log (every row names a product and a registry
// machine label) and the OEE set (one entry per machine WITH its label — so
// the machine COUNT — plus product names in standardsGap/suspects). What
// remains carries NO factory data at all: the OAuth handshake, the health and
// warm probes, and the showcase, which is three counts.
const DOCUMENTED_OPEN = ["google/callback", "google/connect", "health", "public/showcase", "warm"];

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
      const guarded = /require(?:Role|Customer|CustomerAccount)\(\s*req\b/.test(body);
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
        case "prodSales":
          assert.ok(/requireRole\(\s*req\s*,\s*\[\s*"production"\s*,\s*"sales"\s*\]\s*\)/.test(body), `${where}: must call requireRole(req, ["production", "sales"])`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "storage":
          assert.ok(/requireRole\(\s*req\s*,\s*\[\s*"storage"\s*\]\s*\)/.test(body), `${where}: must call requireRole(req, ["storage"])`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "production":
          assert.ok(/requireRole\(\s*req\s*,\s*\[\s*"production"\s*\]\s*\)/.test(body), `${where}: must call requireRole(req, ["production"])`);
          assert.ok(denies, `${where}: must return g.deny`);
          break;
        case "customer":
          assert.ok(/requireCustomer\(\s*req\s*\)/.test(body), `${where}: must call requireCustomer(req)`);
          assert.ok(denies, `${where}: must return g.deny`);
          assert.equal(/requireRole\(/.test(body), false, `${where}: a customer route must never fall back to a staff role`);
          break;
        case "customerAccount":
          assert.ok(/requireCustomerAccount\(\s*req\s*\)/.test(body), `${where}: must call requireCustomerAccount(req)`);
          assert.ok(denies, `${where}: must return g.deny`);
          assert.equal(/requireRole\(/.test(body), false, `${where}: a customer route must never fall back to a staff role`);
          break;
        case "customerRegister":
          // The one portal route that runs BEFORE customers/{uid} exists, so
          // it can use neither customer guard. It verifies the token itself
          // and writes to the uid IN that token, behind an IP limiter.
          assert.ok(/verifyIdToken\(/.test(body), `${where}: must verify the ID token`);
          assert.ok(/rateLimited\(/.test(body), `${where}: self sign-up is a public create target — rate-limit it`);
          assert.equal(/requireRole\(/.test(body), false, `${where}: a customer has no role to look up`);
          assert.equal(/roleFor\(/.test(body), false, `${where}: a customer has no role to look up`);
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
        case "connector": {
          const tokenAt = body.search(/verifyConnectorToken\(/);
          assert.ok(tokenAt >= 0, `${where}: must verify the connector token`);
          assert.ok(/isOwnerEmail\(/.test(body), `${where}: the connector is owner-only`);
          const readAt = body.search(/req\.(json|text|formData)\(\)/);
          assert.ok(readAt < 0 || tokenAt < readAt, `${where}: reads the body before the token`);
          assert.equal(guarded, false, `${where}: Claude has no Firebase session to guard with`);
          break;
        }
        case "oauth":
          assert.equal(guarded, false, `${where}: OAuth endpoints are reached before any sign-in`);
          assert.equal(/@\/lib\/(sheets|mcp-tools|storage|jobs|oee-data|stock-data)"/.test(FILES[route]), false,
            `${where}: an OAuth endpoint must not import a data loader`);
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
      if (method === "GET" || !["guard", "owner", "sales", "prodSales", "storage", "production", "customer", "customerAccount", "customerRegister"].includes(kind)) continue;
      const body = hs[method];
      // Whatever this route's guard is — a role, a customer document, or the
      // token verification the register route does itself — it must be the
      // first thing that can fail.
      const guardAt = body.search(/require(?:Role|Customer|CustomerAccount)\(|verifyIdToken\(/);
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

test("the reads closed on 2026-09-23 for the customer portal stay closed", () => {
  // The portal tells a buyer they see only their own products. These four
  // answered ANYONE: the product list paired with a real client name, the
  // machine registry and its count, and every shift row with its operator's
  // name on it. Reopening one makes that promise theatre.
  assert.equal(ROUTES["runs"].GET, "guard", "run rows carry the operator's name");
  assert.equal(ROUTES["machines"].GET, "guard", "the registry and its count");
  assert.equal(ROUTES["machines/[id]"].GET, "guard");
  assert.equal(ROUTES["machines/[id]/notes"].GET, "guard", "a fitter's own words");
});

test("the showcase endpoint serves counts only — no names", () => {
  const src = FILES["public/showcase"];
  assert.equal(/records|names|clients\.map|molds\.map/.test(src), false, "the public showcase must not serialise names");
  assert.ok(/getPublicShowcase\(/.test(src));
});
