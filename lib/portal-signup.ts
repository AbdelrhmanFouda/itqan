"use client";
/**
 * A marker that says "this uid is a CUSTOMER, not staff".
 *
 * It exists to close a race, and one more failure the race made possible.
 * `AuthProvider` listens to `onAuthStateChanged` for the whole app, and the
 * listener calls `ensureProfile()`, which creates `users/{uid}` when none
 * exists. At the portal's door the Firebase user exists a moment BEFORE
 * `POST /api/portal/register` has written `customers/{uid}` — so without this
 * marker the listener would win the race, write a staff profile for a buyer,
 * and drop them into the owner's staff approvals queue as a pending «عامل».
 *
 * ── Why it carries a uid, and why it outlives the tab (2026-09-23 review) ──
 * The first version stored a bare "1" in sessionStorage and was cleared as
 * soon as the register call had been MADE, success or failure. Two things came
 * out of that:
 *
 *  - a sign-up that never reached the register call (a weak password, a closed
 *    Google popup) left the bare "1" set for the whole tab, and the next
 *    person to sign up — including a colleague who clicked through to the
 *    staff login in the same tab — got NO `users/{uid}` at all and no way to
 *    ask for one. Pinning the marker to the uid it was set for makes a stale
 *    marker harmless to everybody else;
 *  - a register call that FAILED (the limiter, a Firestore stall, rules not
 *    published yet) left an account with neither document, and the marker was
 *    already gone — so the NEXT sign-in created the staff profile this module
 *    exists to prevent. Keeping the marker until the document actually exists,
 *    in localStorage rather than sessionStorage, means that account is still
 *    recognised as a customer on the next visit and the portal can finish the
 *    registration itself (context/CustomerAuthContext.tsx).
 *
 * ── Every sign-in at the portal's door sets it (2026-10-07) ────────────────
 * It used to be set for SIGN-UP only. A brand-new account that came in on the
 * sign-in tab — the Google button on the default tab, or a login the owner
 * made whose document had failed to write — therefore got a staff profile and
 * the factory's role list. Now `signInEmail` and `signInGoogle` set it too, in
 * both modes, so the marker is in flight far more often, and two things
 * changed to keep that safe:
 *
 *  - the in-flight marker and the pinned one are TWO keys. Setting the first
 *    used to overwrite the second, so a mistyped password threw away the
 *    record of an unfinished registration on this browser;
 *  - the in-flight marker EXPIRES. It has no uid, so while it is set it speaks
 *    for whoever signs in next on this browser, through either door. A popup
 *    left open and a tab closed on it used to leave it for good; now it is
 *    honoured for `FLIGHT_TTL_MS` and no longer.
 *
 * ── More than one account can be pinned, and the staff door ends a flight ──
 * (2026-10-07, review of the change above.) Two holes it left:
 *
 *  - the pinned key held ONE uid, and every sign-in at the portal's door pins
 *    its own — so an existing customer (or a member of staff) signing in threw
 *    away the record of somebody else's unfinished registration on that
 *    browser. The key is a short LIST now: pinning adds, clearing removes that
 *    uid alone;
 *  - nothing at the STAFF door ended an in-flight marker. A Google popup left
 *    open behind the portal's page, then the page's own «من فريق العمل؟» link,
 *    then a sign-up at /login inside the TTL: the new employee was read as a
 *    customer and registered as one. /login clears the in-flight marker when
 *    it opens, the staff sign-in paths clear it before they ask Firebase, and
 *    the portal's login page clears it when it is left. A portal sign-in that
 *    completes afterwards is unharmed — it pins its uid the instant the
 *    account comes back, before the listener's own read can return.
 *
 * It grants nothing. The worst a forged marker can do is stop a staff profile
 * being auto-created for the uid named in it — who then sees the portal's
 * waiting card and signs in again.
 */
const KEY = "itqan.portal.signup";
const FLIGHT_KEY = "itqan.portal.signup.flight";

/**
 * How long an in-flight marker is honoured. Longer than any real Google popup
 * (account chooser, password, second factor), and short enough that a sign-in
 * abandoned on a shared computer does not wait there for the next person.
 */
export const FLIGHT_TTL_MS = 15 * 60 * 1000;

/**
 * How many unfinished registrations one browser remembers. A pin normally
 * lives for a second or two (until the document is written); the cap only
 * keeps a shared computer's list from growing without end. The OLDEST goes.
 */
export const MAX_PINNED = 8;

/** A bare "1" is the un-pinned marker as it was written before 2026-10-07. */
const LEGACY = "1";

function read(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
function drop(key: string) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

/** The pinned uids, oldest first. A Firebase uid holds no comma. */
function pinned(): string[] {
  return read(KEY).split(",").map((s) => s.trim()).filter(Boolean);
}
function savePinned(list: string[]) {
  if (list.length === 0) drop(KEY);
  else write(KEY, list.join(","));
}

function inFlight(now: number): boolean {
  const at = Number(read(FLIGHT_KEY));
  // A stamp from the future (a clock set back) is not trusted for longer than
  // one from now would be.
  return Number.isFinite(at) && at > 0 && Math.abs(now - at) < FLIGHT_TTL_MS;
}

/**
 * Mark the door. Called with no uid immediately BEFORE the Firebase call
 * (there is no uid yet, and the listener may fire before this call returns),
 * then again WITH the uid the moment it exists — which also ends the in-flight
 * marker, so it speaks for nobody else from then on. Pinning one account never
 * un-pins another.
 */
export function markPortalSignUp(uid?: string, now: number = Date.now()) {
  if (!uid) { write(FLIGHT_KEY, String(now)); return; }
  // A pin also ends the un-pinned marker of before 2026-10-07, as it always did.
  const list = pinned().filter((v) => v !== uid && v !== LEGACY);
  list.push(uid);
  savePinned(list.slice(-MAX_PINNED));
  drop(FLIGHT_KEY);
}

/** Is this uid marked as a customer (or is a portal sign-in in flight right now)? */
export function isPortalSignUp(uid?: string, now: number = Date.now()): boolean {
  if (inFlight(now)) return true;
  const list = pinned();
  return list.includes(LEGACY) || (!!uid && list.includes(uid));
}

/**
 * Clear it. With a uid, that account's marker and the in-flight one are
 * removed; with no uid, only the in-flight one — a sign-in that never got as
 * far as an account, or the staff door being used. Somebody else's unfinished
 * registration is never thrown away by a passing sign-in.
 */
export function clearPortalSignUp(uid?: string) {
  drop(FLIGHT_KEY);
  const list = pinned();
  if (list.length === 0) return;
  const kept = list.filter((v) => v !== LEGACY && v !== uid);
  if (kept.length !== list.length) savePinned(kept);
}

/* ------------------------- who came through the door ----------------------- */

/**
 * What the portal's door does with an account that has just signed in.
 *
 *   staff     has `users/{uid}` (or is the owner): left exactly as it is. The
 *             shell sends it to /dashboard. NEVER given a customer document —
 *             an account with both would pass `requireRole` and, once linked,
 *             `requireCustomer` as well;
 *   customer  has `customers/{uid}`: left exactly as it is, whatever its status;
 *   register  has neither: it becomes a customer applicant, once;
 *   defer     one of the two could not be read. Nothing is written on a guess:
 *             the marker stays pinned and the provider's own heal — which waits
 *             for `ensureProfile`'s answer — decides when it can.
 *
 * `null` means "could not be read". A staff profile outranks everything else,
 * including an unreadable customer document.
 */
export type DoorAction = "staff" | "customer" | "register" | "defer";

export function portalDoorAction(k: {
  owner: boolean;
  staff: boolean | null;
  customer: boolean | null;
}): DoorAction {
  if (k.owner || k.staff === true) return "staff";
  if (k.staff === null) return "defer";
  if (k.customer === true) return "customer";
  if (k.customer === null) return "defer";
  return "register";
}
