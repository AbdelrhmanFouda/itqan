/**
 * «بوابة العملاء» — the properties that keep a buyer out of the factory, and
 * one company out of another's orders.
 *
 * The portal's whole safety argument is structural rather than procedural, and
 * each of the four pieces is asserted here because each of them is one careless
 * edit away from being untrue:
 *
 *  1. a customer is an ACCOUNT KIND, never a `Role`. Thirty handlers call
 *     `requireRole(req)` with no allow-list; a tenth role would hand a buyer
 *     the order book, the storage log and `DELETE /api/jobs/[id]` on the day
 *     the owner approved them;
 *  2. every portal handler is guarded by the CUSTOMER guards and never falls
 *     back to a role;
 *  3. the client link is never taken from the request — it is read off the
 *     caller's own `customers/{uid}` document, so there is nothing to tamper
 *     with and nothing for a future route to forget to check;
 *  4. the matching rule is exact. `clientKey` is a copy of `nameKey`
 *     (lib/master-lookup.ts), so the two are pinned here value by value — a
 *     drift between them would silently change who matches whom.
 *
 * Mostly source-level, for the same reason tests/api-guards.test.ts is: these
 * are React pages and Next route modules that Node's test runner cannot import.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nameKey } from "../lib/master-lookup.ts";
import { cp } from "../lib/i18n.portal.ts";
import {
  clientKey, clientKeysOf, belongsToCustomer, normalizeClients,
  customerStatusOf, isLinkedCustomer, type ClientLink,
} from "../lib/customer-link.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/**
 * The same file with its comments removed — these modules EXPLAIN the customer
 * split at length, so a check for the word "customer" or "role" has to read the
 * code and not the prose about it.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Every file under a directory (recursive), as repo-relative POSIX paths. */
function filesUnder(rel: string, ext: string[]): string[] {
  const base = path.join(ROOT, rel);
  if (!fs.existsSync(base)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (ext.some((x) => e.name.endsWith(x))) out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
    }
  };
  walk(base);
  return out;
}

/** Exported handlers and their bodies (the same slicing tests/api-guards uses). */
function handlers(src: string): Record<string, string> {
  const re = /export async function (GET|POST|PATCH|PUT|DELETE)\b/g;
  const marks: { m: string; at: number }[] = [];
  for (let x = re.exec(src); x; x = re.exec(src)) marks.push({ m: x[1], at: x.index });
  const out: Record<string, string> = {};
  marks.forEach((k, i) => { out[k.m] = src.slice(k.at, marks[i + 1]?.at ?? src.length); });
  return out;
}

/* ------------------------- 1. not a role, ever ---------------------------- */

test("the Role union never contains \"customer\"", () => {
  const src = read("lib/roles.ts");
  const union = src.slice(src.indexOf("export type Role ="), src.indexOf("export type UserStatus"));
  assert.ok(union.includes("owner"), "the union moved — this test is reading the wrong slice");
  assert.equal(/["']customer["']/.test(union), false, "a customer is an account kind, not a role");
  assert.equal(
    /["']customer["']/.test(code("lib/roles.ts")), false,
    "lib/roles.ts must not name a customer role anywhere — not in ALL_ROLES, NAV or a landing",
  );
});

test("the portal never grants a role, and lib/customers.ts never writes one", () => {
  assert.equal(
    /\brole\b/.test(code("lib/customers.ts")), false,
    "a customer document must carry no role field",
  );
  for (const f of filesUnder("app/api/portal", [".ts"])) {
    assert.equal(/\brole\s*:/.test(code(f)), false, `${f} writes a role`);
  }
});

/* ------------------------ 2. every portal handler ------------------------- */

test("every handler under app/api/portal is guarded by a customer guard", () => {
  const files = filesUnder("app/api/portal", [".ts"]).filter((f) => f.endsWith("route.ts"));
  assert.ok(files.length >= 2, `expected the portal routes, found ${files.length}`);
  for (const f of files) {
    const src = read(f);
    const hs = handlers(src);
    assert.ok(Object.keys(hs).length > 0, `${f} exports no handler`);
    for (const [method, body] of Object.entries(hs)) {
      const where = `${method} ${f}`;
      // The register route is the ONE that runs before customers/{uid} exists,
      // so it verifies the token itself; everything else uses a guard.
      const isRegister = f.includes("/register/");
      if (isRegister) {
        assert.ok(/verifyIdToken\(/.test(body), `${where}: must verify the ID token`);
        assert.ok(/rateLimited\(/.test(body), `${where}: must rate-limit — it is a public create target`);
      } else {
        assert.ok(
          /requireCustomer\(|requireCustomerAccount\(/.test(body),
          `${where}: must call requireCustomer(req) or requireCustomerAccount(req)`,
        );
        assert.ok(/if \("deny" in g\) return g\.deny/.test(body), `${where}: must return g.deny`);
      }
      assert.equal(/requireRole\(/.test(body), false, `${where}: a portal route must never use a staff role`);
      assert.equal(/roleFor\(/.test(body), false, `${where}: a customer has no role to look up`);
    }
  }
});

test("the staff side of the portal is production + sales only (when it exists)", () => {
  // /api/requests arrives with the review-and-approve phase. Written now so
  // that phase cannot land ungated: the screen behind it shows customer email
  // addresses and creates real work orders.
  for (const f of filesUnder("app/api/requests", [".ts"]).filter((x) => x.endsWith("route.ts"))) {
    for (const [method, body] of Object.entries(handlers(read(f)))) {
      assert.ok(
        /requireRole\(\s*req\s*,\s*\[\s*"production"\s*,\s*"sales"\s*\]\s*\)/.test(body),
        `${method} ${f}: must call requireRole(req, ["production", "sales"])`,
      );
    }
  }
});

/* ---------------- 3. the link comes from the document only ---------------- */

test("requireCustomer reads no client name out of the request", () => {
  const src = read("lib/api-guard.ts");
  const at = src.indexOf("async function customerFor");
  assert.ok(at > 0, "customerFor moved — this test is reading nothing");
  const body = src.slice(at);
  // The ONLY thing taken off the request is the Authorization header.
  assert.equal(/req\.json\(|req\.text\(|req\.formData\(/.test(body), false, "the guard must not read the body");
  assert.equal(/searchParams|nextUrl/.test(body), false, "the guard must not read the query string");
  assert.ok(/authorization/i.test(body), "the guard reads the bearer token");
  // …and the link is built from the document the lookup returned.
  assert.ok(/clientKeysOf\(account\.clients\)/.test(body), "clientKeys must come from the document");
});

test("the customer document is read as the caller, bounded, and never cached", () => {
  const src = read("lib/agent-auth.ts");
  const at = src.indexOf("export async function lookupCustomer");
  assert.ok(at > 0, "lookupCustomer is gone");
  const body = src.slice(at, src.indexOf("export function customerDocUrl"));
  assert.ok(/Authorization: `Bearer \$\{idToken\}`/.test(body), "must read as the caller");
  assert.ok(/cache: "no-store"/.test(body), "the link must never be cached — a mis-link must correct at once");
  assert.ok(/AbortSignal\.timeout\(/.test(body), "must be bounded, like every read-path dependency");
  // The role cache exists on purpose; the link must not be added to it.
  assert.equal(/ROLE_CACHE/.test(body), false, "the customer link must not use the role cache");
});

test("ensureProfile never creates a staff profile for a customer", () => {
  const src = read("lib/users.ts");
  const at = src.indexOf("export async function ensureProfile");
  const body = src.slice(at, src.indexOf("async function isCustomerAccount"));
  // Pinned to the uid: a sign-up abandoned in this browser must not suppress
  // the staff profile of whoever signs up next (2026-09-23 review).
  assert.ok(/isPortalSignUp\(params\.uid\)/.test(body), "the sign-up race must be covered, per uid");
  assert.ok(/isCustomerAccount\(params\.uid\)/.test(body), "customers/{uid} must be checked before creating");
  // The check has to sit INSIDE the branch that creates, and before setDoc.
  const branch = body.indexOf("if (!snap.exists())");
  assert.ok(branch > 0 && body.indexOf("isCustomerAccount") > branch, "the check must be in the create branch");
  assert.ok(body.indexOf("isCustomerAccount") < body.indexOf("setDoc("), "the check must run before the write");
});

test("the firestore rules keep the link out of the account's own hands", () => {
  const rules = read("firestore.rules");
  const at = rules.indexOf("match /customers/{uid}");
  assert.ok(at > 0, "the customers block is missing — the owner cannot paste what is not here");
  const block = rules.slice(at, rules.indexOf("}", rules.indexOf("allow update, delete")));
  assert.ok(/allow create:[\s\S]*request\.auth\.uid == uid/.test(block), "create is own-uid only");
  assert.ok(/request\.resource\.data\.status == 'pending'/.test(block), "a new account starts pending");
  assert.ok(/!\('clients' in request\.resource\.data\)/.test(block), "a new account cannot link itself");
  assert.ok(/allow update, delete: if isAdmin\(\)/.test(block), "only an admin may write the link");
});

/* ------------------------- 4. the matching rule --------------------------- */

test("clientKey and nameKey are the same function", () => {
  for (const s of [
    "المصرية الذكية", "المصريه الذكيه للعدادات", "ايداكو ", " ايداكو", "زراير\t", "قاعدة ",
    "رافال", "ABS اسود", "abs اسود", "عدسه ١٢", "عدسه 12", "  two   spaces  ",
    "غير متاح", "غير متاح / N/A", "N/A", "n/a", "-", "—", "", "   ",
  ]) {
    assert.equal(clientKey(s), nameKey(s), `«${s}»`);
  }
  assert.equal(clientKey(null), nameKey(null));
  assert.equal(clientKey(undefined), nameKey(undefined));
});

test("the match is EXACT — the aliases are what bridge the spellings", () => {
  const link: ClientLink = {
    no: 7,
    name: "المصرية الذكية",
    aliases: ["المصريه الذكيه للعدادات", "ايداكو "],
  };
  const keys = clientKeysOf([link]);
  assert.ok(belongsToCustomer("المصرية الذكية", keys));
  assert.ok(belongsToCustomer("  المصرية   الذكية ", keys), "whitespace folds");
  assert.ok(belongsToCustomer("المصريه الذكيه للعدادات", keys), "an approved alias matches");
  assert.ok(belongsToCustomer("ايداكو", keys), "the trailing space on the alias folds away");
  // The things that must NOT match, each of them a real shape in the workbook.
  assert.equal(belongsToCustomer("المصرية", keys), false, "never a substring");
  assert.equal(belongsToCustomer("المصرية الذكية للعدادات المتطورة", keys), false, "never a prefix");
  assert.equal(belongsToCustomer("المصريه الذكيه", keys), false, "never an Arabic search fold (ة/ه)");
  assert.equal(belongsToCustomer("", keys), false);
  assert.equal(belongsToCustomer("غير متاح / N/A", keys), false, "the filler is not a client");
});

test("a blank or filler name never becomes a key", () => {
  const keys = clientKeysOf([
    { no: 0, name: "غير متاح", aliases: ["", "   ", "N/A"] },
    { no: 1, name: "رافال", aliases: [] },
  ]);
  assert.deepEqual([...keys], ["رافال"]);
});

test("a stored clients value is normalised, and junk is dropped", () => {
  assert.deepEqual(normalizeClients([{ no: 7, name: " توشيبا ", aliases: ["العربي", "العربي", " "] }]), [
    { no: 7, name: "توشيبا", aliases: ["العربي"] },
  ]);
  assert.deepEqual(normalizeClients([{ no: "x", name: "رافال" }]), [{ no: 0, name: "رافال", aliases: [] }]);
  for (const junk of [null, undefined, "", 0, {}, [null], [{ name: "" }], [{ aliases: ["x"] }]]) {
    assert.deepEqual(normalizeClients(junk), [], JSON.stringify(junk));
  }
});

test("an unknown status reads as pending, never as approved", () => {
  assert.equal(customerStatusOf("approved"), "approved");
  assert.equal(customerStatusOf("rejected"), "rejected");
  for (const junk of ["pending", "Approved", "APPROVED", "active", "", null, undefined, 1, true, {}]) {
    assert.notEqual(customerStatusOf(junk), "approved", JSON.stringify(junk));
  }
});

test("approved AND linked — either one alone opens nothing", () => {
  const one: ClientLink[] = [{ no: 1, name: "رافال", aliases: [] }];
  assert.ok(isLinkedCustomer({ status: "approved", clients: one }));
  assert.equal(isLinkedCustomer({ status: "approved", clients: [] }), false, "approved but unlinked sees nothing");
  assert.equal(isLinkedCustomer({ status: "pending", clients: one }), false);
  assert.equal(isLinkedCustomer({ status: "rejected", clients: one }), false);
  assert.equal(isLinkedCustomer(null), false);
});

/* ----------------------------- 5. the pages ------------------------------- */

test("every /api call from app/portal carries a token", () => {
  const files = filesUnder("app/portal", [".tsx"]);
  assert.ok(files.length >= 3, `expected the portal pages, found ${files.length}`);
  const re = /\b(?:timedJson(?:<[^>]*>)?\(\s*(authedFetch|fetch)\s*,|(authedFetch|fetch)\()\s*(["'`])([^"'`]*)/g;
  for (const f of files) {
    const src = read(f);
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const fn = m[1] ?? m[2];
      const url = m[4].split("${")[0];
      if (!url.startsWith("/api/")) continue;
      assert.equal(fn, "authedFetch", `${f} fetches ${url} without a token`);
    }
  }
});

test("the portal is not indexed", () => {
  const src = read("app/robots.ts");
  assert.ok(/disallow:\s*\[[^\]]*"\/portal"/.test(src), "/portal must be in the robots Disallow list");
});

test("the portal shell holds no dashboard navigation", () => {
  // Its own light shell, deliberately: no NAV, no role lookup, nothing a buyer
  // could tap into. A stray import of the dashboard's role table here would be
  // the first step back towards "customer is just another role".
  const src = read("app/portal/layout.tsx");
  assert.equal(/navFor\(|canAccess\(|from "@\/lib\/roles"/.test(src), false, "the portal must not read the staff role table");
});

/* ------------------ 6. the request routes (2026-09-23) -------------------- */

test("no portal route takes a client, a company or a row number from the caller", () => {
  // The link is the guard's, read off customers/{uid}. A route that accepted
  // one would put the whole boundary back in the caller's hands — and the
  // request row is addressed by its REFERENCE NUMBER, never by a row number
  // the phone is holding (a colleague inserting a row moves every row below).
  for (const f of filesUnder("app/api/portal", [".ts"]).filter((x) => x.endsWith("route.ts"))) {
    const src = code(f);
    for (const forbidden of [
      /\bb\.client\b/, /\bbody\.client\b/, /\bb\.clientNo\b/, /\bb\.company\b/,
      /searchParams\.get\(\s*["'`]client/, /\bb\.row\b/, /\bb\.sheetRow\b/,
    ]) {
      assert.equal(forbidden.test(src), false, `${f} reads ${forbidden} off the request`);
    }
  }
});

test("a portal route writes to «طلبات العملاء» and to nothing else", () => {
  // Never «أوامر العمل»: a row there is an OPEN ORDER the moment it exists —
  // counted in the open-orders tile and subtracted from «المتاح» on
  // /dashboard/stock before anybody agreed to make it.
  const write = /\b(?:appendRecord|updateRecord|deleteRecord)\(\s*["'`]([^"'`]+)["'`]/g;
  let seen = 0;
  for (const f of filesUnder("app/api/portal", [".ts"])) {
    const src = code(f);
    for (let m = write.exec(src); m; m = write.exec(src)) {
      seen++;
      assert.equal(m[1], "customerRequests", `${f} writes to the ${m[1]} entity`);
    }
    // The tab is created lazily, with the header array the entity reads back.
    if (/ensureTab\(/.test(src)) assert.ok(/ensureTab\(REQUEST_TAB, REQUEST_HEADERS\)/.test(src), `${f}: ensureTab must send REQUEST_HEADERS`);
  }
  assert.ok(seen >= 2, `expected the append and the cancel write, found ${seen}`);
});

test("both customer reads are filtered by the link, server-side", () => {
  const orders = read("app/api/portal/orders/route.ts");
  assert.ok(/ownRequests\(/.test(orders), "«طلبات العملاء» must be filtered by the link");
  assert.ok(/belongsToCustomer\(j\.client, keys\)/.test(orders), "«أوامر العمل»!C must be filtered by the link");
  // Master's client is NOT the filter for orders — a product name held by two
  // Master rows would pull a competitor's order into the answer.
  //
  // MOVED DELIBERATELY on 2026-10-07 (owner's word: the produced count is
  // shown). This used to say the route never mentions `masterClient` at all.
  // It now reads it in exactly ONE place — `uniqueOwner`, which decides whether
  // a shift row with a BLANK client cell may be counted — and still never as
  // the filter: the orders that leave are chosen on the order's own cell alone.
  const ordersCode = code("app/api/portal/orders/route.ts");
  assert.equal(
    ordersCode.split("jobsRead.jobs.filter((j) => belongsToCustomer(j.client, keys))").length - 1, 1,
    "orders are filtered on the ORDER's client cell",
  );
  assert.equal(/\.filter\([^\n]*masterClient/.test(ordersCode), false, "Master's client must never be the filter");
  assert.equal(ordersCode.split("masterClient").length - 1, 1, "Master's client is read once, for uniqueOwner");
  assert.ok(
    ordersCode.includes("uniqueOwner: !j.ambiguous && belongsToCustomer(j.masterClient, keys)"),
    "a blank shift row counts only for a name Master holds once, under this customer",
  );
  const products = read("app/api/portal/products/route.ts");
  assert.ok(/belongsToCustomer\(m\.client, keys\)/.test(products), "Master must be filtered by the link");
});

test("nothing rides along into a customer's answer — the whitelists are the only door", () => {
  const orders = code("app/api/portal/orders/route.ts");
  assert.ok(/portalOrder\(/.test(orders), "orders go through the builder");
  assert.ok(/\.map\(toPortalRequest\)|toPortalRequest\(/.test(orders), "requests go through the builder");
  // A spread of a job or a sheet row would defeat the pinned key sets.
  for (const spread of [/\.\.\.j\b/, /\.\.\.job\b/, /\.\.\.r\b/, /\.\.\.rec\b/, /\.\.\.row\b/]) {
    assert.equal(spread.test(orders), false, `orders spreads ${spread} into the response`);
  }
  // The product list is four fields and nothing Master knows besides.
  const products = code("app/api/portal/products/route.ts");
  for (const leak of ["cycle", "cavities", "material", "defects", "moldCode", "notes", "code"]) {
    assert.equal(
      new RegExp(`\\b${leak}\\s*:`).test(products), false,
      `/api/portal/products serialises ${leak} — that is the factory's knowledge`,
    );
  }
});

test("the cancel route verifies the row's identity inside the write", () => {
  const src = read("app/api/portal/requests/[reqId]/route.ts");
  assert.ok(/expectSupported\(/.test(src), "must ask whether the bridge can check identity");
  assert.ok(/expect: \{ field: "reqId", value: row\.reqId \}/.test(src), "must expect the reference number");
  // The STATE check is read fresh whatever the bridge can do: `expect` pins
  // the row's identity, never its state, so an approved request could be
  // cancelled off a stale copy while its work order stayed open.
  assert.ok(/loadRequests\(\{ fresh: true \}\)/.test(src), "the cancellable check must be made on a fresh read");
  assert.equal(/fresh: !canExpect/.test(src), false, "a cached state check is the 2026-09-23 defect");
  assert.ok(/ownRequests\(/.test(src), "the row must belong to this account");
  assert.ok(/isCancellable\(/.test(src), "only a pending request may be withdrawn");
  assert.ok(/row\.jobCode/.test(src), "a request with a work order against it is not cancellable");
});

test("the submit is capped, limited and replay-proof before it appends", () => {
  const src = read("app/api/portal/requests/route.ts");
  const at = (re: RegExp) => src.search(re);
  assert.ok(at(/rateLimited\(customer\.uid\)/) > 0, "a per-account limiter");
  assert.ok(at(/findReplay\(/) > 0, "a replay key — the bridge is at-least-once");
  assert.ok(at(/MAX_OPEN_REQUESTS/) > 0, "the five-open cap");
  // All three, and the product resolution, must happen BEFORE the row is written.
  for (const re of [/rateLimited\(customer\.uid\)/, /findReplay\(/, /MAX_OPEN_REQUESTS/, /masterRowForPick\(/]) {
    assert.ok(at(re) < at(/appendRecord\(/), `${re} must run before the append`);
  }
  // The notification cannot fail the submit: it is sent after the write, and
  // a request that IS in the tab must never be reported as failed.
  assert.ok(at(/appendRecord\(/) < at(/notify\(/), "the owner is told after the sheet write");
});

test("the notification helper is shared, and the contact form still uses it", () => {
  // Extracted on 2026-09-23. Two copies of the Resend call is how they drift.
  assert.ok(exists("lib/notify.ts"));
  for (const f of ["app/api/contact/route.ts", "app/api/portal/requests/route.ts"]) {
    assert.ok(/from "@\/lib\/notify"/.test(read(f)), `${f} must use the shared helper`);
    assert.equal(/api\.resend\.com/.test(read(f)), false, `${f} still calls Resend itself`);
  }
  // Nothing may mail an outside address: the only recipients are the env list.
  const notify = code("lib/notify.ts");
  assert.ok(/INQUIRY_NOTIFY_TO/.test(notify));
  assert.equal(/customer\.email|to: \[/.test(notify), false, "the recipient list comes from env alone");
});

test("the portal never says «مباشر», and reuses the jobs page's freshness wording", () => {
  // A copy of any age up to the stale window is served at once and refreshed
  // behind, so a customer's first look after a quiet period can be hours old.
  // Claiming "live" on that screen is the one thing that would make staleness
  // read as lying.
  for (const f of [...filesUnder("app/portal", [".tsx"]), ...filesUnder("components/portal", [".tsx"]), "lib/i18n.portal.ts"]) {
    // `code()`, not `read()`: the page's own comment explains the rule.
    assert.equal(code(f).includes("مباشر"), false, `${f} says «مباشر»`);
  }
  // And the age line is the SAME sentence /dashboard/jobs already shows —
  // not a third wording invented here.
  const prod = read("lib/i18n.prod.ts");
  for (const s of [cp.en.home.dataAge, cp.ar.home.dataAge]) {
    assert.ok(prod.includes(s), `«${s}» is not the wording the jobs page uses`);
  }
});

/* ------------------------ 7. «المخزون» (2026-10-05) ------------------------ */

test("the stock route takes nothing from the caller and answers through one builder", () => {
  const f = "app/api/portal/stock/route.ts";
  assert.ok(exists(f), `${f} is missing`);
  // Covered by the walk above ("every handler under app/api/portal is guarded
  // by a customer guard") — asserted, so a rename cannot quietly drop it.
  assert.ok(
    filesUnder("app/api/portal", [".ts"]).filter((x) => x.endsWith("route.ts")).includes(f),
    "the guard walk does not reach the stock route",
  );
  const src = code(f);
  assert.deepEqual(Object.keys(handlers(src)), ["GET"], "the stock route is a read and nothing else");
  assert.ok(/requireCustomer\(\s*req\s*\)/.test(src), "must be guarded by requireCustomer(req)");
  // Nothing in the request names a client: no query string, no body, no params.
  for (const forbidden of [/searchParams/, /nextUrl/, /req\.json\(/, /req\.text\(/, /req\.formData\(/, /\bparams\b/]) {
    assert.equal(forbidden.test(src), false, `${f} reads ${forbidden} off the request`);
  }
  // The link is the guard's, and the answer is the builder's whitelist.
  assert.ok(/const keys = g\.customer\.clientKeys/.test(src), "the link must come from the guard");
  assert.ok(/clientKeys: keys/.test(src), "…and be what the builder filters on");
  assert.ok(/const lines = buildCustomerStock\(/.test(src), "the lines must be built by buildCustomerStock");
  assert.ok(/\{ ok: true, lines, meta:/.test(src), "the answer carries the builder's lines");
  // The storage read itself never reaches the wire: outside the builder call,
  // the route touches only the read's `ok`, `readAt` and `stale`.
  const at = src.indexOf("buildCustomerStock(");
  const outside = src.slice(0, at) + src.slice(src.indexOf("});", at));
  assert.deepEqual(
    [...new Set([...outside.matchAll(/\bdata\.(\w+)/g)].map((m) => m[1]))].sort(),
    ["ok", "readAt", "stale"],
  );
  assert.equal(/\.\.\.data\b/.test(src), false, "the storage read must never be spread into the answer");
  assert.ok(/"Cache-Control": "no-store"/.test(src), "an answer scoped to one account is never cached");
  assert.ok(/status: 503/.test(src) && /read_failed/.test(src), "a failed read is a 503, not an empty stock");
});

test("the stock route can read the store and cannot write to it", () => {
  const src = code("app/api/portal/stock/route.ts");
  assert.ok(/getStorageData\(/.test(src));
  for (const w of ["saveMovement", "updateMovement", "deleteMovement", "refreshStorageLists", "appendRecord", "updateRecord"]) {
    assert.equal(src.includes(w), false, `the stock route must not import ${w}`);
  }
  // …and the rules module is pure: two pure siblings, no reader, no network.
  const rules = code("lib/customer-stock.ts");
  const imports = [...new Set([...rules.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(imports, ["@/lib/customer-link", "@/lib/storage-filter"]);
  assert.equal(/fetch\(|process\.env/.test(rules), false);
  for (const pure of ["lib/customer-link.ts", "lib/storage-filter.ts"]) {
    assert.equal(/^import /m.test(code(pure)), false, `${pure} must stay import-free — the stock rules lean on that`);
  }
});

test("the stock page keeps its snapshot per account, where sign-out clears it", () => {
  const src = read("app/portal/stock/page.tsx");
  assert.ok(src.includes("`itqan.portal.stock.last.${uid}`"), "the snapshot key must carry the uid");
  // The pattern clearLastSeen() removes on sign-out (components/dashboard/last-seen.ts).
  const pattern = /^itqan\..*\.last(\.|$)/;
  assert.ok(read("components/dashboard/last-seen.ts").includes(pattern.source), "clearLastSeen's pattern moved");
  assert.ok(pattern.test("itqan.portal.stock.last.some-uid"));
  // Bounded, remembered, and never blanked by a failed refresh.
  assert.ok(/useRemembered</.test(src));
  assert.ok(src.includes('timedJson<Data>(authedFetch, "/api/portal/stock")'), "the read must be bounded and carry a token");
  assert.ok(/<LoadError/.test(src), "a failed refresh is a line with a retry, above what is already on screen");
  assert.ok(/staleRefetches\.current < 2/.test(src) && /8000/.test(src), "at most two refetches, eight seconds apart");
  assert.ok(/c\.home\.dataAge/.test(src), "the age line is the SAME sentence the orders screen prints");
  // The cards are the prop-driven component — it fetches nothing itself.
  assert.ok(src.includes("<StockView lines={data.lines} lang={lang} />"));
  const view = code("components/portal/stock-view.tsx");
  assert.equal(/fetch\(|authedFetch|useEffect|useRemembered/.test(view), false, "StockView must not fetch");
  // No total across different products, anywhere on the screen.
  assert.equal(
    /\.reduce\(/.test(view) || /\.reduce\(/.test(code("app/portal/stock/page.tsx")), false,
    "the stock screen adds nothing up",
  );
  // A last-movement date has no bound on its age: it carries the year when it is not this year's.
  assert.ok(/formatDateWithYear\(line\.lastIn, lang\)/.test(view) && /formatDateWithYear\(line\.lastOut, lang\)/.test(view));
  assert.equal(/formatDate\(/.test(view), false, "the year-less printer is for due dates, not for stock");
  // A sheet name mixes Arabic and Latin; isolated, its word order does not follow the page's direction.
  assert.equal(view.split("<bdi>{line.item}</bdi>").length - 1, 2, "both card shapes isolate the item name");
  assert.equal(/>\{line\.item\}<\/p>/.test(view), false);
});

test("the portal shell offers the two screens, and only those", () => {
  const src = code("app/portal/layout.tsx");
  assert.ok(src.includes('{ href: "/portal", label: c.nav.orders,'));
  assert.ok(src.includes('{ href: "/portal/stock", label: c.nav.stock,'));
  assert.ok(src.includes('aria-current={tab.active ? "page" : undefined}'), "the active screen is announced");
  assert.ok(/min-h-11/.test(src.slice(src.indexOf("<nav"), src.indexOf("</nav>"))), "44px tap targets");
  assert.equal(cp.ar.nav.orders, "الأوامر");
  assert.equal(cp.ar.nav.stock, "المخزون");
});

test("an order with no quantity says so, and nothing is read out of its notes", () => {
  const src = code("app/portal/page.tsx");
  assert.ok(/c\.home\.qtyPending/.test(src), "the empty quantity line must be replaced by the sentence");
  assert.equal(cp.ar.home.qtyPending, "الكمية لم تُسجَّل بعد");
  assert.equal(cp.en.home.qtyPending, "Quantity not recorded yet");
  assert.equal(/notes/.test(src), false, "the customer screen never touches an order's notes");
});

/* ------------------------ 8. «تم إنتاج» (2026-10-07) ------------------------ */

test("the produced count is ATTRIBUTED — the orders route never reads a staff figure", () => {
  // The owner asked for the count on the customer's screen (2026-10-07). What
  // leaves is lib/customer-progress.ts' answer; a job's own `produced` is by
  // product NAME alone — another client's shifts, and every order of the
  // product, all in one number — and must never be the thing that is sent.
  const src = code("app/api/portal/orders/route.ts");
  assert.ok(/from "@\/lib\/customer-progress"/.test(src), "the route must use the attribution module");
  assert.ok(/const made = attributeProduction\(/.test(src), "the count is built by attributeProduction");
  assert.ok(src.includes("produced: made.get(j.id) ?? null"), "…and that answer is what portalOrder is handed");
  assert.equal(src.split("produced").length - 1, 1, "`produced` appears once: the attributed one");
  for (const staff of [
    /\bj\.produced\b/, /\bjob\.produced\b/, /\.remaining\b/, /\.scrapped\b/, /\brunsFor\b/,
    /\.lastMachine\b/, /\.estHours\b/, /\.cycleSec\b/, /\.cavities\b/,
  ]) {
    assert.equal(staff.test(src), false, `the orders route reads ${staff} — a staff figure`);
  }
  // The customer's OWN orders and the guard's keys go in; nothing off the request.
  assert.ok(/const own = jobsRead\.jobs\.filter\(\(j\) => belongsToCustomer\(j\.client, keys\)\)/.test(src));
  assert.ok(/attributeProduction\(\s*own\.map\(/.test(src), "only the caller's own orders are attributed");
  assert.ok(/jobsRead\.productionRuns,\s*keys,\s*\)/.test(src), "the shift rows and the guard's own keys");
  assert.ok(src.includes("productKey: productKeyOf(j.product)"), "the SAME product key lib/jobs.ts joins on");
  // The shift log is read without downtime and without the registry.
  assert.ok(src.includes("loadJobs({ production: true, downtime: false, machines: false })"));
  // The shift rows themselves never reach the wire — only the builder's keys do.
  assert.equal(/productionRuns/.test(src.slice(src.indexOf("NextResponse.json("))), false);
  // A FAILED READ IS NOT A ZERO (review, 2026-10-07). lib/sheets.ts hands back
  // an EMPTY tab when «الإنتاج» cannot be read, and an empty log attributes 0
  // to every order — «لم يُسجَّل إنتاج بعد» on an order that has thousands made,
  // saved on the device and painted first next time. No shift rows at all means
  // the log was not read: the answers are dropped, so `?? null` sends no number.
  const guard = "if (jobsRead.productionRuns.length === 0) made.clear();";
  assert.equal(src.split(guard).length - 1, 1, "an unread shift log must send null, never 0");
  assert.ok(
    src.indexOf("const made = attributeProduction(") < src.indexOf(guard) &&
    src.indexOf(guard) < src.indexOf("produced: made.get(j.id) ?? null"),
    "…and it is dropped after the attribution, before the orders are built",
  );
});

test("the attribution rules are pure, and the staff rule in lib/jobs.ts is untouched", () => {
  const rules = code("lib/customer-progress.ts");
  const imports = [...new Set([...rules.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(imports, ["@/lib/customer-link"], "one pure sibling and nothing else");
  assert.equal(/fetch\(|process\.env|getRecords|loadJobs/.test(rules), false);
  assert.equal(/^import /m.test(code("lib/customer-link.ts")), false, "lib/customer-link.ts must stay import-free");
  // The boundary is the shift row's OWN client cell.
  assert.ok(/belongsToCustomer\(r\.client, clientKeys\)/.test(rules));

  // lib/jobs.ts: the staff figures are still the name + start-date rule, and
  // the rows handed to the portal are built BESIDE the staff rows — a client
  // field added to those would ride onto /api/jobs/[id] through runsFor().
  const jobs = code("lib/jobs.ts");
  assert.ok(
    jobs.includes("return runs.filter((r) => r.key === key && (!job.startDate || (r.date && r.date >= job.startDate)));"),
    "matches() is the staff rule, unchanged",
  );
  assert.ok(jobs.includes("job.produced = rs.reduce((a, x) => a + x.goodUnits, 0);"));
  assert.ok(jobs.includes("runsFor: (job) => matches(job).sort((a, b) => (a.date > b.date ? -1 : 1)),"));
  const shaped = jobs.slice(jobs.indexOf("const shaped = prodTab.records.map("), jobs.indexOf("const lenByKey"));
  assert.equal(/\bclient\b/.test(shaped), false, "the staff run rows must not gain a client field");
  assert.ok(/productionRuns: shaped\.flatMap\(/.test(jobs), "the portal's rows are built from the same shaped rows");
  assert.ok(jobs.includes("export const productKeyOf = (name: string | undefined): string => normKey(name);"));
});

test("the order card states the count, a capped bar, and nothing about how it was made", () => {
  const src = code("app/portal/page.tsx");
  // One reading of what a card may say — the page does not decide it itself.
  assert.ok(/progressLine\(card\.produced, totalPiecesOf\(card\)\)/.test(src));
  // …nor which total the bar is measured against (review, 2026-10-07): the
  // WORK ORDER's quantity, the typed pieces only where the two agree within
  // rounding. The page used to prefer what was typed, so an order approved for
  // more read 100% and green while it was still running.
  assert.ok(
    src.includes("orderedTotalPieces(card.unit === UNIT_PIECES ? card.qtyAsked : null, card.qtyPieces, card.qtyKg)"),
    "the bar's total comes from orderedTotalPieces()",
  );
  const totalFn = src.slice(src.indexOf("const totalPiecesOf"), src.indexOf("const progressOf"));
  assert.equal(/card\.qtyAsked\s*>\s*0/.test(totalFn), false, "the page must not prefer the typed quantity itself");
  // An old device snapshot has no `produced` key: unknown, never zero.
  assert.ok(src.includes('typeof o.produced === "number"'), "a missing count must read as null");
  for (const k of ["producedOf", "producedOnly", "producedNone", "producedNote"]) {
    assert.ok(new RegExp(`c\\.home\\.${k}\\b`).test(src), `the page must print cp.home.${k}`);
  }
  assert.equal(src.split("c.home.producedNote").length - 1, 1, "the source line is printed once, above the list");
  // Accessible, hand-built, and it cannot overflow: the width is the capped percentage.
  assert.ok(/role="progressbar"/.test(src));
  for (const aria of ["aria-valuemin={0}", "aria-valuemax={100}", "aria-valuenow={pct}", "aria-label={text}"]) {
    assert.ok(src.includes(aria), `the bar is missing ${aria}`);
  }
  assert.ok(src.includes("style={{ width: `${pct}%` }}"));
  assert.ok(/overflow-hidden/.test(src.slice(src.indexOf('role="progressbar"'), src.indexOf("style={{ width"))));
  // MOVED DELIBERATELY on 2026-10-07 (owner: "show the loading bar like the one
  // in jobs tab"). The card's bar IS the jobs tab's bar: the same three class
  // strings, in both files, and the same forced left-to-right drawing — so a
  // restyle of one cannot leave the other behind. It used to be a thinner bar
  // with a percentage, filling from the start edge.
  const bar = src.slice(src.indexOf("function ProducedLine"), src.indexOf("export default function PortalHome"));
  const jobsTab = code("app/dashboard/jobs/page.tsx");
  for (const cls of [
    'className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"',
    'className="h-full bg-blue-500 rounded-full"',
    'className="text-xs text-gray-500 whitespace-nowrap tabular-nums"',
  ]) {
    assert.ok(bar.includes(cls), `the card's bar lost ${cls}`);
    assert.ok(jobsTab.includes(cls), `the jobs tab no longer draws ${cls} — move both together`);
  }
  assert.equal(bar.split('dir="ltr"').length - 1, 2, "track and count are drawn left-to-right, as on the jobs tab");
  assert.equal(/\b(?:left|right|ml|mr|pl|pr)-|float|flex-row-reverse|translate/.test(bar), false, "no physical-side class on the bar");
  // The count sits beside the bar («13,539 / 50,000 قطعة»), not a percentage.
  assert.ok(bar.includes("{label}") && !/fmtPct/.test(src), "the bar carries the count, as the jobs tab's does");
  // An order nothing was made for still gets its (empty) bar; a count with no
  // ordered piece total is a sentence, because there is nothing to fill against.
  assert.ok(src.includes('progress.kind === "count" && (progress.total !== null || progress.made === 0)'));
  assert.ok(src.includes('progress.kind === "count" && progress.total === null && progress.made > 0'));
  assert.ok(src.includes("pct={progress.pct ?? 0}"));
  // Numbers through lib/format.ts — Latin digits in both languages.
  assert.ok(/fmtNum\(progress\.made, isAr\)/.test(src) && /fmtNum\(progress\.total, isAr\)/.test(src));
  // Never on a customer's card: scrap, the machine, the operator, a rate, an ETA.
  for (const never of [/scrap/i, /machine/i, /operator/i, /downtime/i, /perDay|\brate\b/i, /\beta\b/i, /remaining/i]) {
    assert.equal(never.test(src), false, `the customer screen mentions ${never}`);
  }
  // The wording, both languages.
  assert.equal(cp.ar.home.producedOf, "تم إنتاج {made} من {total} قطعة");
  assert.equal(cp.ar.home.producedOnly, "تم إنتاج {made} قطعة");
  assert.equal(cp.ar.home.producedNone, "لم يُسجَّل إنتاج بعد");
  assert.equal(cp.ar.home.producedNote, "العدد المنتَج كما سُجِّل في ورديات المصنع");
  assert.equal(cp.en.home.producedNote, "Produced counts as logged on the factory's shifts");
  for (const s of [cp.en.home.producedOf, cp.ar.home.producedOf]) {
    assert.ok(s.includes("{made}") && s.includes("{total}"));
  }
});

test("the stock wording is the store's own three neutral words", () => {
  assert.ok(cp.ar.stock.flow.includes("الوارد") && cp.ar.stock.flow.includes("المنصرف"));
  assert.equal(cp.ar.stock.balance, "الرصيد");
  assert.equal(cp.ar.stock.review, "تحت المراجعة");
  assert.equal(cp.ar.stock.note, "الأرقام كما سُجِّلت في مخزن المصنع");
  assert.equal(cp.ar.stock.empty, "لا يوجد مخزون مسجل على هذا الحساب");
  for (const lang of ["en", "ar"] as const) {
    for (const k of ["in", "out"]) assert.ok(cp[lang].stock.flow.includes(`{${k}}`), `${lang}: flow must fill {${k}}`);
    for (const k of ["lastIn", "lastOut"] as const) assert.ok(cp[lang].stock[k].includes("{date}"), `${lang}: ${k}`);
    for (const k of ["approxKg", "exactKg"] as const) assert.ok(cp[lang].stock[k].includes("{kg}"), `${lang}: ${k}`);
    assert.ok(cp[lang].stock.approxKg.startsWith("≈"), `${lang}: an estimated weight is marked`);
    assert.equal(cp[lang].stock.exactKg.includes("≈"), false, `${lang}: a weighed one is not`);
  }
});

test("the portal is linked from the public site, by its login page", () => {
  for (const f of ["components/Navbar.tsx", "components/Footer.tsx"]) {
    const src = read(f);
    assert.ok(/href="\/portal\/login"/.test(src), `${f} must link to /portal/login`);
    assert.ok(/tr\.nav\.customerLogin/.test(src), `${f} must use the i18n label`);
  }
});

/* ------------------ 6. the staff side: review and approve ------------------ */
/**
 * The approval is TWO writes in two tabs over an at-least-once bridge, so the
 * things pinned here are the ones that stop it creating a second work order or
 * stamping somebody else's request. They are source-level because these are
 * Next route modules; the rules they lean on (`jobMarker`, `reqIdFromNotes`,
 * `masterRowByName`) are unit-tested where they live.
 */

const REQ_ROUTES = ["route.ts", "[reqId]/preview/route.ts", "[reqId]/approve/route.ts", "[reqId]/reject/route.ts"]
  .map((f) => `app/api/requests/${f}`);

test("the four staff routes exist and are all production + sales only", () => {
  for (const f of REQ_ROUTES) assert.ok(exists(f), `${f} is missing`);
  // The vacuous check above became real with these files: assert it is.
  const files = filesUnder("app/api/requests", [".ts"]).filter((x) => x.endsWith("route.ts"));
  assert.equal(files.length, REQ_ROUTES.length);
});

test("one code path creates a work order — the jobs route no longer has its own", () => {
  // Extracted on 2026-09-23. Two copies would agree on the day they were
  // written and part company at the first fix, and one of them buys material.
  const jobs = code("app/api/jobs/route.ts");
  assert.ok(/createWorkOrder\(/.test(jobs), "POST /api/jobs must delegate to createWorkOrder");
  for (const gone of ["appendRecord(", "masterRowForPick(", "suggestJobCode(", "jobStatusToSheet("]) {
    assert.equal(jobs.includes(gone), false, `app/api/jobs/route.ts still does ${gone} itself`);
  }
  const approve = code("app/api/requests/[reqId]/approve/route.ts");
  assert.ok(/createWorkOrder\(/.test(approve), "the approval must use the same function");
  assert.equal(approve.includes("appendRecord("), false, "the approval must not append a row itself");
});

test("the approval skips creation when the [REQ-…] marker is already in «أوامر العمل»", () => {
  // Step 1 of the contract: an attempt that LANDED but answered failed must be
  // recognised, or a second tap books the order twice.
  const write = code("lib/work-orders-write.ts");
  assert.ok(/reqIdFromNotes\(r\.notes\)/.test(write), "the plan must look for the marker in the notes");
  assert.ok(/markerCode/.test(write));
  assert.ok(
    /if \(p\.markerCode\) return \{ ok: true, kind: "replay"/.test(write),
    "a plan carrying a marker code must return before the append",
  );
  const approve = code("app/api/requests/[reqId]/approve/route.ts");
  assert.ok(/reqId: row\.reqId/.test(approve), "the approval must pass the reference number down");
  assert.ok(/jobMarker\(row\.reqId\)/.test(approve), "the created row must carry the marker");
});

test("the stamp on the request row is expect-guarded, with the fresh-read fallback", () => {
  for (const f of ["app/api/requests/[reqId]/approve/route.ts", "app/api/requests/[reqId]/reject/route.ts"]) {
    const src = code(f);
    assert.ok(/expectSupported\(\)/.test(src), `${f}: must ask whether the bridge supports expect`);
    assert.ok(/loadRequests\(\{ fresh: true \}\)/.test(src), `${f}: the fallback check needs a fresh read`);
    assert.ok(
      /expect: \{ field: "reqId", value: row\.reqId \}/.test(src),
      `${f}: the write must verify the row's reference number`,
    );
    // Addressed by its REFERENCE NUMBER, never by a row number the screen holds.
    assert.ok(/rows\.filter\(\(r\) => r\.reqId === want\)/.test(src), `${f}: must re-find the row by reqId`);
    assert.equal(/b\.row|body\.row/.test(src), false, `${f}: must not take a row number from the body`);
    // …and a number the tab holds TWICE is refused rather than guessed at: the
    // first match wins and `expect` passes on the wrong twin just as happily,
    // so the decision would land on another customer's row. The number is
    // issued from a read with no lock — the shape that put ITQ0030 in «سحب»
    // twice (2026-09-23 review).
    assert.ok(/hits\.length > 1/.test(src), `${f}: must refuse a duplicated reference number`);
    assert.ok(/duplicate_ref/.test(src), `${f}: must answer duplicate_ref`);
  }
  // The customer's own cancel does the same check, for the same reason.
  const cancel = code("app/api/portal/requests/[reqId]/route.ts");
  assert.ok(/hits\.length > 1/.test(cancel) && /duplicate_ref/.test(cancel));
  // Both languages name it — errText falls back to «generic» silently.
  for (const lang of ["en", "ar"] as const) {
    assert.ok(cp[lang].staff.reqs.errors.duplicate_ref.length > 0, `${lang}: duplicate_ref`);
  }
});

test("a stamp that fails after the order landed names the code", () => {
  const src = read("app/api/requests/[reqId]/approve/route.ts");
  assert.ok(/reason: "stamp_failed", code/.test(src), "the answer must carry the work-order code");
  // …and the screen says it, in both languages, with the code filled in.
  for (const lang of ["en", "ar"] as const) {
    assert.ok(cp[lang].staff.reqs.errors.stamp_failed.includes("{code}"), `${lang}: stamp_failed must name the code`);
  }
});

test("a product name «الرئيسي» holds twice stops the approval and offers the rows", () => {
  const write = code("lib/work-orders-write.ts");
  assert.ok(/requireUniqueProduct/.test(write));
  assert.ok(
    /return bad\("duplicate_product", 409, candidates\)/.test(write),
    "the plan must refuse rather than take the first row",
  );
  for (const f of ["app/api/requests/[reqId]/preview/route.ts", "app/api/requests/[reqId]/approve/route.ts"]) {
    assert.ok(/requireUniqueProduct: true/.test(code(f)), `${f} must refuse a duplicated name`);
  }
  // POST /api/jobs keeps the sheet's own "first row wins" reading — the person
  // picked a row in the picker — so it must NOT set the flag.
  assert.equal(/requireUniqueProduct/.test(code("app/api/jobs/route.ts")), false);
});

test("the preview writes nothing", () => {
  const src = code("app/api/requests/[reqId]/preview/route.ts");
  for (const w of ["appendRecord", "updateRecord", "deleteRecord", "createWorkOrder", "ensureTab"]) {
    assert.equal(src.includes(w), false, `the preview must not call ${w}`);
  }
  assert.ok(/planWorkOrder\(/.test(src), "the preview must be built by the same function the write uses");
});

test("the review queue reads the whole tab — the customer filter is the OTHER direction", () => {
  const src = code("app/api/requests/route.ts");
  assert.ok(/loadRequests\(/.test(src));
  assert.equal(/ownRequests\(|clientKeys/.test(src), false, "staff see every request, by design");
});

test("the requests page and the jobs counter go through authedFetch", () => {
  for (const f of ["app/dashboard/requests/page.tsx", "app/dashboard/jobs/page.tsx"]) {
    const src = read(f);
    for (const m of src.matchAll(/\bfetch\(\s*["'`](\/api\/requests[^"'`]*)/g)) {
      assert.fail(`${f}: ${m[1]} is fetched without a token`);
    }
    assert.ok(/authedFetch\(\s*(?:`|")\/api\/requests/.test(src), `${f}: must call /api/requests with a token`);
  }
  // The counter is only asked for by a role that can open the page — production
  // opens the jobs page too and would meet a 403.
  const jobs = code("app/dashboard/jobs/page.tsx");
  assert.ok(/canAccess\(profile\.role, "\/dashboard\/requests"\)/.test(jobs));
});

test("the waiting card is the SHARED component, not a second copy", () => {
  // Extracted from app/dashboard/layout.tsx on 2026-09-23 so the two screens
  // cannot drift. A copy would mean the next fix lands on one of them.
  assert.ok(exists("components/dashboard/status-screen.tsx"));
  for (const f of ["app/dashboard/layout.tsx", "app/portal/layout.tsx"]) {
    assert.ok(
      /from "@\/components\/dashboard\/status-screen"/.test(read(f)),
      `${f} must import the shared StatusScreen`,
    );
    assert.equal(/function StatusScreen\(/.test(read(f)), false, `${f} still declares its own StatusScreen`);
  }
});
