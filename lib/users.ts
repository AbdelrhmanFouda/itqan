"use client";
/**
 * User-profile data layer (client SDK, runs authenticated in the browser so
 * Firestore rules on the `users` collection apply). Stores who is allowed in,
 * their requested vs granted role, and approval status.
 */
import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { isOwnerEmail, type Role, type UserStatus } from "./roles";
import { isPortalSignUp } from "./portal-signup";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  requestedRole: Role | null;
  role: Role | null;
  status: UserStatus;
  createdAt?: number;
};

const COL = "users";

function shape(uid: string, d: DocumentData): UserProfile {
  return {
    uid,
    email: (d.email as string) ?? "",
    displayName: (d.displayName as string) ?? "",
    requestedRole: (d.requestedRole as Role | null) ?? null,
    role: (d.role as Role | null) ?? null,
    status: (d.status as UserStatus) ?? "pending",
    createdAt: (d.createdAt as number) ?? undefined,
  };
}

/**
 * Make sure a profile document exists for a signed-in user.
 * - The owner email is auto-approved as `owner`.
 * - Everyone else starts `pending` with their requested role recorded.
 * - A CUSTOMER gets nothing at all, and the function returns null.
 *
 * That last branch is the customer portal's half of the account-kind split
 * (2026-09-23). `AuthProvider` calls this on every sign-in, for every account,
 * including a buyer signing in to /portal — and a staff profile written for a
 * buyer would put them in the owner's staff approvals queue and, if anyone ever
 * approved it by reflex, hand them a role. So before creating anything we check
 * whether this uid is a customer: `isPortalSignUp(uid)` for the window at the
 * portal's door when `customers/{uid}` does not exist yet — every sign-in
 * there since 2026-10-07, not only a sign-up — and the document itself for
 * every sign-in after that (a user may read their own customer document —
 * firestore.rules). The marker is PINNED to the uid it was set for, and the
 * un-pinned one expires, so an abandoned sign-in in this browser cannot
 * suppress a colleague's staff profile for long (lib/portal-signup.ts).
 *
 * Returning null means "this is not a staff account"; the caller uses it to
 * send the person to /portal instead of /dashboard.
 */
export async function ensureProfile(params: {
  uid: string; email: string; displayName?: string; requestedRole?: Role | null;
}): Promise<UserProfile | null> {
  const ref = doc(db, COL, params.uid);
  const snap = await getDoc(ref);
  const owner = isOwnerEmail(params.email);

  if (!snap.exists()) {
    // Not staff → create nothing. The owner email is exempt: it bootstraps
    // itself as owner and must never be diverted by a stray flag.
    if (!owner && (isPortalSignUp(params.uid) || (await isCustomerAccount(params.uid)))) return null;
    const base = {
      email: params.email,
      displayName: params.displayName ?? "",
      requestedRole: owner ? "owner" : (params.requestedRole ?? null),
      role: owner ? "owner" : null,
      status: owner ? "approved" : "pending",
      createdAt: Date.now(),
    };
    await setDoc(ref, base);
    return shape(params.uid, base);
  }

  const data = snap.data();
  // Promote the owner email if its doc predates owner status.
  if (owner && data.role !== "owner") {
    await updateDoc(ref, { role: "owner", status: "approved", requestedRole: "owner" });
    return shape(params.uid, { ...data, role: "owner", status: "approved", requestedRole: "owner" });
  }
  // Backfill a requested role if sign-up raced the auth listener.
  if (!owner && params.requestedRole && data.requestedRole == null && (data.status ?? "pending") === "pending") {
    await updateDoc(ref, { requestedRole: params.requestedRole });
    return shape(params.uid, { ...data, requestedRole: params.requestedRole });
  }
  return shape(params.uid, data);
}

/**
 * Does this uid already hold a customer account?
 *
 * Read as the signed-in user, which the rules allow for their OWN document.
 * A denial or a network failure answers false — the caller then creates a
 * staff profile, which is the pre-2026-09-23 behaviour and is recoverable;
 * refusing to create one on a hiccup would lock a real new employee out of
 * sign-up with nothing on screen to explain it.
 */
async function isCustomerAccount(uid: string): Promise<boolean> {
  try {
    return (await getDoc(doc(db, "customers", uid))).exists();
  } catch {
    return false;
  }
}

/**
 * Does this uid hold a STAFF profile? `null` = it could not be read.
 *
 * A READ, and the only thing the customer portal's door asks of this
 * collection (context/CustomerAuthContext.tsx, 2026-10-07): an account that
 * already has a profile is staff and is left exactly as it is — never handed a
 * customer document. Three answers on purpose: "could not tell" must not be
 * taken for "no profile", or a hiccup would register a member of staff as a
 * customer applicant.
 */
export async function hasStaffProfile(uid: string): Promise<boolean | null> {
  try {
    return (await getDoc(doc(db, COL, uid))).exists();
  } catch {
    return null;
  }
}

export function watchProfile(uid: string, cb: (p: UserProfile | null) => void) {
  return onSnapshot(doc(db, COL, uid), (snap) => {
    cb(snap.exists() ? shape(uid, snap.data()) : null);
  });
}

export async function listUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(collection(db, COL));
  return snap.docs
    .map((d) => shape(d.id, d.data()))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export async function approveUser(uid: string, role: Role) {
  await updateDoc(doc(db, COL, uid), { role, status: "approved" });
}
/**
 * Taking access away CLEARS THE ROLE as well as the status.
 *
 * Leaving `role` behind on a rejected or revoked profile was a standing hazard:
 * the role was the thing every guard reads, and a single later write that set
 * `status: 'approved'` — a stray console edit, a rules mistake, a future
 * re-approve path that forgot to pass one — restored the OLD privileges
 * silently, without anyone choosing them. A revoked manager is the sharp case,
 * because `isManager()` in firestore.rules is what lets a profile be edited at
 * all. Re-approving still works: /dashboard/approvals sends the role explicitly
 * (`approveUser(uid, sel[uid] ?? REQUESTABLE_ROLES[0])`, and the all-users
 * select falls back to the least-privileged role when `u.role` is null).
 */
export async function rejectUser(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "rejected", role: null });
}
export async function setUserRole(uid: string, role: Role) {
  await updateDoc(doc(db, COL, uid), { role, status: "approved" });
}
export async function setPending(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "pending", role: null });
}
