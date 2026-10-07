/**
 * The customer portal's door — who is a customer, and the marker that says so.
 *
 * `AuthProvider` creates a STAFF profile for any signed-in account that has no
 * document at all, unless the marker in lib/portal-signup.ts names that
 * account as a customer. Until 2026-10-07 the marker was set for sign-UP only,
 * so a brand-new account that came in on the portal's sign-IN tab was written
 * a pending staff profile and landed in the staff approvals queue.
 *
 * Two things are pinned here, both pure:
 *
 *  - the marker's life: set before the Firebase call, removed if it throws,
 *    pinned to the uid when it succeeds, and never able to speak for the next
 *    person on this browser for long;
 *  - `portalDoorAction`: every (owner × staff profile × customer document)
 *    combination, so no account is converted, registered twice or guessed at.
 *
 * The React half (context/CustomerAuthContext.tsx) cannot be loaded by Node's
 * runner; tests/portal-access.test.ts pins it at source level.
 *
 * Run with `npm test`.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  markPortalSignUp, isPortalSignUp, clearPortalSignUp, portalDoorAction, FLIGHT_TTL_MS, MAX_PINNED,
  type DoorAction,
} from "../lib/portal-signup.ts";

/** A browser's localStorage, as much of it as the module touches. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
beforeEach(() => store.clear());

const T0 = 1_760_000_000_000;
const UID_A = "uidAAAAAAAAAAAAAAAAAAAAAAAAA";
const UID_B = "uidBBBBBBBBBBBBBBBBBBBBBBBBB";

/* ------------------------------- the marker -------------------------------- */

test("nothing set: nobody is marked", () => {
  assert.equal(isPortalSignUp(), false);
  assert.equal(isPortalSignUp(UID_A), false);
});

test("in flight: set before the Firebase call, it speaks for whoever signs in next", () => {
  markPortalSignUp(undefined, T0);
  // There is no uid yet — the listener may ask with any, or with none.
  assert.equal(isPortalSignUp(UID_A, T0 + 1000), true);
  assert.equal(isPortalSignUp(UID_B, T0 + 1000), true);
  assert.equal(isPortalSignUp(undefined, T0 + 1000), true);
});

test("a sign-in that throws leaves nothing behind (wrong password, closed popup)", () => {
  markPortalSignUp(undefined, T0);
  clearPortalSignUp(); // what both sign-in paths do in their catch
  assert.equal(isPortalSignUp(UID_A, T0 + 1), false);
  assert.equal(store.size, 0, "no key is left in storage");
});

test("pinned: once the account exists the marker speaks for that uid alone", () => {
  markPortalSignUp(undefined, T0);
  markPortalSignUp(UID_A, T0 + 500);
  assert.equal(isPortalSignUp(UID_A, T0 + 1000), true);
  assert.equal(isPortalSignUp(UID_B, T0 + 1000), false, "the next person on this browser is not a customer");
  assert.equal(isPortalSignUp(undefined, T0 + 1000), false);
  // …and it does not expire: the registration may be finished on a later visit.
  assert.equal(isPortalSignUp(UID_A, T0 + 30 * 24 * 60 * 60 * 1000), true);
});

test("an abandoned sign-in expires — it cannot wait for the next person", () => {
  // A popup left open and the tab closed on it: nothing ever clears the marker.
  markPortalSignUp(undefined, T0);
  assert.equal(isPortalSignUp(UID_B, T0 + FLIGHT_TTL_MS - 1), true);
  assert.equal(isPortalSignUp(UID_B, T0 + FLIGHT_TTL_MS), false);
  assert.equal(isPortalSignUp(UID_B, T0 + 24 * 60 * 60 * 1000), false);
  assert.ok(FLIGHT_TTL_MS >= 5 * 60 * 1000, "longer than a real Google popup with a second factor");
  assert.ok(FLIGHT_TTL_MS <= 30 * 60 * 1000, "and not a standing flag");
  // A stamp from far in the future (a clock that was wrong) is not honoured either.
  markPortalSignUp(undefined, T0 + 10 * FLIGHT_TTL_MS);
  assert.equal(isPortalSignUp(UID_B, T0), false);
});

test("a second attempt does not throw away an unfinished registration", () => {
  // A's account exists, its document does not (the register call failed).
  markPortalSignUp(UID_A, T0);
  // Somebody mistypes a password at the same door: mark, throw, clear.
  markPortalSignUp(undefined, T0 + 1000);
  clearPortalSignUp();
  assert.equal(isPortalSignUp(UID_A, T0 + 2000), true, "A is still known to be a customer");
  assert.equal(isPortalSignUp(UID_B, T0 + 2000), false);
});

test("clearing with a uid removes that account's marker — and nobody else's", () => {
  markPortalSignUp(UID_A, T0);
  clearPortalSignUp(UID_B);
  assert.equal(isPortalSignUp(UID_A, T0 + 1), true, "B signing in does not clear A's marker");
  clearPortalSignUp(UID_A);
  assert.equal(isPortalSignUp(UID_A, T0 + 1), false);
  assert.equal(store.size, 0);
  // With a uid, the in-flight marker goes too: that sign-in has resolved.
  markPortalSignUp(undefined, T0);
  clearPortalSignUp(UID_B);
  assert.equal(isPortalSignUp(UID_A, T0 + 1), false);
});

test("the un-pinned marker written before 2026-10-07 is still read, and still cleared", () => {
  store.set("itqan.portal.signup", "1");
  assert.equal(isPortalSignUp(UID_A, T0), true);
  clearPortalSignUp();
  assert.equal(isPortalSignUp(UID_A, T0), false);
  assert.equal(store.size, 0);
  // A pin ends it too, as it always did — it must not go on speaking for everybody.
  store.set("itqan.portal.signup", "1");
  markPortalSignUp(UID_A, T0);
  assert.equal(isPortalSignUp(UID_B, T0), false);
  assert.equal(store.get("itqan.portal.signup"), UID_A, "one pinned uid is stored exactly as it was before the list");
});

test("a passing sign-in never throws away somebody else's unfinished registration", () => {
  // A's account exists, its document does not (the register call failed).
  markPortalSignUp(UID_A, T0);
  // B — an existing customer, or a member of staff — signs in at the same
  // door: in flight, pinned by settle(), then cleared a moment later.
  markPortalSignUp(undefined, T0 + 1000);
  markPortalSignUp(UID_B, T0 + 1500);
  assert.equal(isPortalSignUp(UID_A, T0 + 1600), true, "pinning B must not un-pin A");
  assert.equal(isPortalSignUp(UID_B, T0 + 1600), true);
  clearPortalSignUp(UID_B);
  assert.equal(isPortalSignUp(UID_B, T0 + 2000), false);
  assert.equal(isPortalSignUp(UID_A, T0 + 2000), true, "A is still known to be a customer on the next visit");
  // …and a NEW account registering after A does not cost A its marker either.
  markPortalSignUp("uidCCCCCCCCCCCCCCCCCCCCCCCCC", T0 + 3000);
  assert.equal(isPortalSignUp(UID_A, T0 + 3000), true);
  assert.equal(isPortalSignUp("uidDDDDDDDDDDDDDDDDDDDDDDDDD", T0 + 3000), false, "the list speaks only for the uids in it");
  // Pinning the same account twice keeps one entry.
  markPortalSignUp(UID_A, T0 + 4000);
  assert.equal(store.get("itqan.portal.signup")!.split(",").filter((v) => v === UID_A).length, 1);
});

test("the list of pinned accounts is bounded — the oldest goes", () => {
  assert.ok(MAX_PINNED >= 2 && MAX_PINNED <= 20);
  const uid = (i: number) => `uid${String(i).padStart(25, "0")}`;
  for (let i = 0; i < MAX_PINNED + 3; i++) markPortalSignUp(uid(i), T0 + i);
  const kept = store.get("itqan.portal.signup")!.split(",");
  assert.equal(kept.length, MAX_PINNED);
  assert.equal(isPortalSignUp(uid(0), T0), false, "the oldest was dropped");
  assert.equal(isPortalSignUp(uid(MAX_PINNED + 2), T0), true, "the newest is kept");
  for (let i = 0; i < MAX_PINNED + 3; i++) clearPortalSignUp(uid(i));
  assert.equal(store.size, 0, "an emptied list leaves no key behind");
});

test("the STAFF door ends a sign-in in flight, and nothing else", () => {
  // The review's case: a Google popup left open behind the portal's page…
  markPortalSignUp(UID_A, T0);            // somebody's unfinished registration, from earlier
  markPortalSignUp(undefined, T0 + 1000); // …the popup: in flight, no uid
  assert.equal(isPortalSignUp(UID_B, T0 + 2000), true, "before the fix this is what a new employee met at /login");
  // …then /login opens, or a staff sign-in path runs: clearPortalSignUp() with NO uid.
  clearPortalSignUp();
  assert.equal(isPortalSignUp(UID_B, T0 + 2000), false, "the new employee is not read as a customer");
  assert.equal(isPortalSignUp(undefined, T0 + 2000), false);
  assert.equal(isPortalSignUp(UID_A, T0 + 2000), true, "the pinned account is untouched");
  // The abandoned popup completing AFTERWARDS still makes its account a
  // customer: settle() pins the uid the moment the account comes back.
  markPortalSignUp("uidCCCCCCCCCCCCCCCCCCCCCCCCC", T0 + 3000);
  assert.equal(isPortalSignUp("uidCCCCCCCCCCCCCCCCCCCCCCCCC", T0 + 3001), true);
  assert.equal(isPortalSignUp(UID_B, T0 + 3001), false);
});

test("a browser with no storage marks nothing and throws nothing", () => {
  const real = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  try {
    markPortalSignUp(undefined, T0);
    markPortalSignUp(UID_A, T0);
    clearPortalSignUp(UID_A);
    assert.equal(isPortalSignUp(UID_A, T0), false);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = real;
  }
});

/* ------------------------- who came through the door ----------------------- */

test("every account state, at the customer door", () => {
  const tri = [true, false, null] as const;
  const expected = new Map<string, DoorAction>();
  const key = (owner: boolean, staff: boolean | null, customer: boolean | null) => `${owner}|${staff}|${customer}`;
  // The owner is staff whatever the reads say — he is never registered.
  for (const s of tri) for (const c of tri) expected.set(key(true, s, c), "staff");
  // A staff profile outranks everything, including a customer document.
  for (const c of tri) expected.set(key(false, true, c), "staff");
  // The profile could not be read: nothing is written on a guess.
  for (const c of tri) expected.set(key(false, null, c), "defer");
  // No staff profile:
  expected.set(key(false, false, true), "customer");   // approved, pending or stopped — left as it is
  expected.set(key(false, false, null), "defer");      // could not tell: do not spend the register limiter blind
  expected.set(key(false, false, false), "register");  // brand new, or a login whose document never landed

  let seen = 0;
  for (const owner of [true, false]) for (const staff of tri) for (const customer of tri) {
    assert.equal(
      portalDoorAction({ owner, staff, customer }), expected.get(key(owner, staff, customer)),
      key(owner, staff, customer),
    );
    seen++;
  }
  assert.equal(seen, 18);
  assert.equal(expected.size, 18, "every combination is decided on purpose");
});

test("the door registers in exactly one state — neither document, both read", () => {
  const tri = [true, false, null] as const;
  const registering: string[] = [];
  for (const owner of [true, false]) for (const staff of tri) for (const customer of tri) {
    if (portalDoorAction({ owner, staff, customer }) === "register") registering.push(`${owner}|${staff}|${customer}`);
  }
  assert.deepEqual(registering, ["false|false|false"]);
});

test("the named cases", () => {
  // Staff with a profile, on either tab, with either method: untouched.
  assert.equal(portalDoorAction({ owner: false, staff: true, customer: false }), "staff");
  // A staff account that ALSO holds a customer document is still staff — and is not given a second one.
  assert.equal(portalDoorAction({ owner: false, staff: true, customer: true }), "staff");
  // An approved or a pending customer: untouched (the register route is never called for them).
  assert.equal(portalDoorAction({ owner: false, staff: false, customer: true }), "customer");
  // A brand-new Google account on the sign-in tab, and the owner-made login
  // whose document write failed: both become a customer applicant.
  assert.equal(portalDoorAction({ owner: false, staff: false, customer: false }), "register");
});
