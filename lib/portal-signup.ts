"use client";
/**
 * A marker that says "this uid is a CUSTOMER, not staff".
 *
 * It exists to close a race, and one more failure the race made possible.
 * `AuthProvider` listens to `onAuthStateChanged` for the whole app, and the
 * listener calls `ensureProfile()`, which creates `users/{uid}` when none
 * exists. At portal sign-up the Firebase user exists a moment BEFORE
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
 * It grants nothing. The worst a forged marker can do is stop a staff profile
 * being auto-created for the uid named in it — who then sees the portal's
 * waiting card and signs in again.
 */
const KEY = "itqan.portal.signup";

function get(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

/**
 * Mark the sign-up in flight. Called with no uid immediately BEFORE the
 * Firebase account is created (there is no uid yet, and the listener may fire
 * before this call returns), then again WITH the uid the moment it exists.
 */
export function markPortalSignUp(uid?: string) {
  try { localStorage.setItem(KEY, uid || "1"); } catch { /* private mode */ }
}

/** Is a sign-up in flight for this uid (or for an account not yet created)? */
export function isPortalSignUp(uid?: string): boolean {
  const v = get();
  if (!v) return false;
  return v === "1" || (!!uid && v === uid);
}

/**
 * Clear it. With a uid, only that account's marker (and the un-pinned one) is
 * removed; with no uid, only the un-pinned "1" — a sign-up that never got as
 * far as creating an account. Somebody else's unfinished registration is never
 * thrown away by a passing sign-in.
 */
export function clearPortalSignUp(uid?: string) {
  const v = get();
  if (!v) return;
  if (v !== "1" && v !== uid) return;
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
