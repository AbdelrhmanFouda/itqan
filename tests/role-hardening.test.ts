/**
 * Phase 0a of the customer portal — the three holes that had to close BEFORE
 * a second kind of account could exist.
 *
 * The whole portal design rests on one property: a customer resolves to no
 * role, so all thirty bare `requireRole(req)` handlers refuse them without a
 * single edit. Three things quietly undermined that property:
 *
 *  1. the role string read from Firestore was CAST, never checked — an
 *     approved profile with `role: "customer"` typed in by hand passed every
 *     guard in the site;
 *  2. `isManager()` in firestore.rules asked for the role and not the status,
 *     so a revoked manager kept admin rights over every profile, his own
 *     included;
 *  3. rejecting or revoking a user left the role on the document, so any later
 *     write that flipped the status back restored the old privileges without
 *     anyone choosing them.
 *
 * (1) is a pure function and is unit-tested. (2) and (3) live in a rules file
 * and in a "use client" module that imports the Firebase SDK, so neither can
 * be imported by node:test — they are pinned at SOURCE level, the same way
 * tests/api-guards.test.ts pins the route guards.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asRole, ALL_ROLES } from "../lib/roles.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ------------------------- 1. the untrusted role string ------------------- */

test("asRole accepts every real role and nothing else", () => {
  for (const r of ALL_ROLES) assert.equal(asRole(r), r);
});

test("asRole rejects a word that is not a role — including 'customer'", () => {
  // The portal's account kind must never resolve to a staff role, whatever a
  // hand-written Firestore document says.
  for (const bad of ["customer", "Customer", "admin", "OWNER", "worker ", "", "role"]) {
    assert.equal(asRole(bad), null, `asRole(${JSON.stringify(bad)}) must be null`);
  }
});

test("asRole rejects a non-string, however truthy", () => {
  for (const bad of [null, undefined, 0, 1, true, {}, [], ["owner"], { role: "owner" }]) {
    assert.equal(asRole(bad), null, `asRole(${JSON.stringify(bad)}) must be null`);
  }
});

test("lookupRole converts the Firestore role through asRole on BOTH read paths", () => {
  const src = read("lib/agent-auth.ts");
  const body = src.slice(src.indexOf("async function lookupRole"));
  assert.ok(/asRole\(f\.role\?\.stringValue\)/.test(body), "the REST path must validate the role");
  assert.ok(/asRole\(d\.role\)/.test(body), "the SDK fallback path must validate the role");
  assert.equal(
    /role(?:\?\.stringValue)?\s+as\s+Role/.test(body), false,
    "lookupRole still casts a Firestore string to Role — that cast is the hole",
  );
});

/* ---------------------- 2. a revoked manager is not an admin -------------- */

test("firestore.rules: isManager() requires an APPROVED account", () => {
  const rules = read("firestore.rules");
  const fn = rules.slice(rules.indexOf("function isManager()"), rules.indexOf("function isAdmin()"));
  assert.ok(/\.data\.role == 'manager'/.test(fn), "isManager() must still check the role");
  assert.ok(/\.data\.status == 'approved'/.test(fn), "isManager() must also require status == 'approved'");
});

test("firestore.rules: the customers collection is readable by its owner and writable only by an admin", () => {
  const rules = read("firestore.rules");
  const i = rules.indexOf("match /customers/{uid}");
  assert.ok(i > 0, "firestore.rules has no /customers block");
  const block = rules.slice(i, rules.indexOf("}", rules.indexOf("allow update, delete", i)));
  assert.ok(/allow read:\s*if isSignedIn\(\) && \(request\.auth\.uid == uid \|\| isAdmin\(\)\)/.test(block));
  // A customer may create their OWN document, pending, and may NOT set the
  // client link at sign-up — that link is the access boundary.
  assert.ok(/allow create:/.test(block) && /request\.auth\.uid == uid/.test(block));
  assert.ok(/request\.resource\.data\.status == 'pending'/.test(block));
  assert.ok(/!\('clients' in request\.resource\.data\)/.test(block));
  assert.ok(/allow update, delete:\s*if isAdmin\(\)/.test(block), "only an admin may link or revoke");
});

test("firestore.rules still has no catch-all that would reopen /users or /customers", () => {
  // Comments mention the catch-all by name (to say why it is absent), so the
  // check is per line and skips them.
  const live = read("firestore.rules").split("\n").filter((l) => !l.trim().startsWith("//"));
  for (const line of live) {
    assert.equal(/match \/\{document=\*\*\}/.test(line), false, `catch-all rule: ${line.trim()}`);
  }
});

/* ------------------- 3. taking access away clears the role ---------------- */

test("rejectUser and setPending clear the role as well as the status", () => {
  const src = read("lib/users.ts");
  const fnOf = (name: string) => {
    const i = src.indexOf(`export async function ${name}(`);
    assert.ok(i > 0, `lib/users.ts has no ${name}`);
    return src.slice(i, src.indexOf("\n}", i));
  };
  for (const [name, status] of [["rejectUser", "rejected"], ["setPending", "pending"]]) {
    const body = fnOf(name);
    assert.ok(body.includes(`status: "${status}"`), `${name} must set status: "${status}"`);
    assert.ok(body.includes("role: null"), `${name} must also clear the role`);
  }
});

test("granting access still writes a role — clearing it must not have leaked into approve", () => {
  const src = read("lib/users.ts");
  for (const name of ["approveUser", "setUserRole"]) {
    const i = src.indexOf(`export async function ${name}(`);
    const body = src.slice(i, src.indexOf("\n}", i));
    assert.ok(/\{ role, status: "approved" \}/.test(body), `${name} must grant the role it was given`);
  }
});

test("the approvals page never depends on the stored role when re-approving", () => {
  // Clearing the role on revoke is only safe because both controls fall back
  // to the least-privileged requestable role when the profile carries none.
  const page = read("app/dashboard/approvals/page.tsx");
  assert.ok(/approveUser\(uid, sel\[uid\] \?\? REQUESTABLE_ROLES\[0\]\)/.test(page));
  assert.ok(/u\.role && u\.role !== "owner" \? u\.role : REQUESTABLE_ROLES\[0\]/.test(page));
});
