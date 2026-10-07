"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { watchCustomer, hasCustomerAccount } from "@/lib/customers";
import { hasStaffProfile } from "@/lib/users";
import { isOwnerEmail } from "@/lib/roles";
import type { CustomerAccount } from "@/lib/customer-link";
import { markPortalSignUp, clearPortalSignUp, portalDoorAction } from "@/lib/portal-signup";
import { authedFetch } from "@/lib/authed-fetch";

/**
 * The portal's own auth context — a customer's account, never a staff role.
 *
 * It sits ON TOP of AuthProvider rather than beside it: Firebase allows one
 * signed-in user per app instance, and a second `onAuthStateChanged` listener
 * would only be a second copy of the same truth. What this adds is the
 * `customers/{uid}` document, live, so that revoking an account closes the
 * portal on the next snapshot instead of on the next API call.
 *
 * None of the paths here go through AuthContext's `signUpEmail` /
 * `signInGoogle`: those call `ensureProfile`, which writes a STAFF profile.
 * A buyer must never get one — see lib/portal-signup.ts for the race this
 * closes and lib/customer-link.ts for why the two kinds are separate at all.
 * This module READS `users/{uid}` once per sign-in (does a profile exist?) and
 * never writes that collection.
 *
 * ── Whoever comes in through this door is a customer (2026-10-07) ───────────
 * The marker used to be set for sign-UP only, so a brand-new account that came
 * in on the sign-IN tab — the Google button on the default tab, or a login the
 * owner made himself whose document had failed to write — was handed a pending
 * staff profile by the app-wide listener and landed in the staff approvals
 * queue with the factory's role list. Now every path sets the marker BEFORE
 * the Firebase call, removes it if that call throws, and then `settle()`s the
 * account that came back:
 *
 *   has a staff profile     → left exactly as it is (the shell sends it to
 *                             /dashboard); the marker for that uid is cleared;
 *   has a customer document → left exactly as it is, whatever its status;
 *   has neither             → registered as a customer applicant, ONCE, with
 *                             its Firebase name and the company typed on the
 *                             sign-up tab when there is one;
 *   could not tell          → nothing is written on a guess (below).
 *
 * The rule is `portalDoorAction` (lib/portal-signup.ts, pure, tested case by
 * case). A staff profile outranks everything: an existing staff account is
 * never given a customer document — until this change the Google button on the
 * sign-up tab would have written one for it.
 *
 * ── Registration heals itself (2026-09-23 review) ───────────────────────────
 * `POST /api/portal/register` used to get exactly one chance, inside the
 * sign-up call. If it failed — the IP limiter, a Firestore stall, rules not
 * published yet — the Firebase account existed with NO `customers/{uid}`, the
 * redirect to /portal had already fired so the error was never seen, and
 * nothing anywhere tried again: the person sat on the waiting card for good
 * and never appeared in «حسابات العملاء» for the owner to approve. The route
 * is idempotent, so the provider now calls it again whenever a signed-in
 * account that is NOT staff has no customer document yet, and the shell keeps
 * showing «جارٍ التحقق» rather than the waiting card while it does.
 * `isCustomer` from AuthContext is the gate — it is `ensureProfile`'s own
 * answer, so a member of staff can never be handed a customer document here.
 */
type CustomerAuthCtx = {
  account: CustomerAccount | null;
  /** The customer document is still resolving (or no user is signed in yet). */
  accountLoading: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, displayName: string, company: string) => Promise<void>;
  signInGoogle: (company?: string) => Promise<void>;
};

const Ctx = createContext<CustomerAuthCtx>(null as unknown as CustomerAuthCtx);

/**
 * Tell the server to create `customers/{uid}`; it is idempotent and
 * rate-limited. The marker is cleared only on SUCCESS — while it is set this
 * uid is still known to be a customer, so a retry (here, or on the next visit)
 * is not racing a staff profile being written underneath it.
 */
async function register(uid: string, displayName: string, requestedClient: string) {
  const res = await authedFetch("/api/portal/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, requestedClient }),
  });
  const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
  if (!res.ok || !json.ok) throw new Error("register_failed");
  clearPortalSignUp(uid);
}

/** A read at the door must not hang the sign-in: no answer in time is "could not tell". */
const KIND_TIMEOUT_MS = 6000;
function bounded(p: Promise<boolean | null>): Promise<boolean | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), KIND_TIMEOUT_MS); }),
  ]);
}

/**
 * The in-flight marker has no uid: while it is set it speaks for whoever signs
 * in next on this browser, through either door. A sign-in that throws clears
 * it — but a tab CLOSED with Google's popup still open never gets the chance,
 * so the tab clears it on its way out. (The marker also expires by itself,
 * lib/portal-signup.ts; this just does not wait for that.) Returns the
 * un-listen, called the moment the Firebase call settles either way.
 */
function clearOnLeave(): () => void {
  const onLeave = () => clearPortalSignUp();
  window.addEventListener("pagehide", onLeave);
  return () => window.removeEventListener("pagehide", onLeave);
}

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const { user, loading, profile, profileLoading, isCustomer } = useAuth();
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [healing, setHealing] = useState(false);
  /**
   * The uid whose missing document somebody here is ALREADY writing — a
   * sign-in path below, or the heal effect. Whoever sets it owns the
   * registration; the other one stands back, so one account is never
   * registered twice at once.
   */
  const healed = useRef("");
  /**
   * Bumped when a sign-in path lets go of `healed` without having written the
   * document, so the heal effect looks again. A ref alone cannot wake an
   * effect: the provider survives the redirect from /portal/login to /portal
   * (they share one layout), none of the effect's other inputs change, and the
   * "retry on /portal" this module promises would not happen until a reload.
   */
  const [healTick, setHealTick] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Signed out: no registration is in flight for anybody. A claim left on
      // the last uid would make that account's next sign-in stand back from
      // its own registration.
      healed.current = "";
      setAccount(null);
      setDocLoading(false);
      return;
    }
    setDocLoading(true);
    const unsub = watchCustomer(user.uid, (c) => {
      setAccount(c);
      setDocLoading(false);
    });
    return () => unsub();
  }, [user, loading]);

  // Signed in, not staff, and no customer document: the register call never
  // landed. Ask again — once per uid, and never while a staff profile is
  // still resolving.
  useEffect(() => {
    if (loading || !user || docLoading || account) return;
    if (profile || profileLoading || isCustomer !== true) return;
    if (healed.current === user.uid) return;
    healed.current = user.uid;
    setHealing(true);
    register(user.uid, user.displayName ?? "", "")
      .catch(() => { /* the waiting card is the honest answer */ })
      .finally(() => setHealing(false));
  }, [loading, user, account, docLoading, profile, profileLoading, isCustomer, healTick]);

  // An account with a STAFF profile has nothing to register, so a marker
  // pinned for it has nothing left to say. `settle()` clears it when it can
  // read the profile; when that read timed out (`defer`) the pin stayed for
  // good — and would have read the account as a customer if its profile were
  // ever deleted to be made again. The profile itself is the proof.
  useEffect(() => {
    if (user && profile) clearPortalSignUp(user.uid);
  }, [user, profile]);

  /** Let go of the claim on a uid and wake the heal effect. */
  function release(uid: string) {
    if (healed.current === uid) healed.current = "";
    setHealTick((n) => n + 1);
  }

  /**
   * Write the customer document for an account this door has just let in.
   * The caller has ALREADY claimed `healed` — synchronously, before its first
   * await — so the heal effect cannot fire in the gap and register the account
   * with an empty name and no company.
   */
  async function registerClaimed(uid: string, displayName: string, company: string) {
    try {
      await register(uid, displayName, company);
    } catch (e) {
      release(uid);
      throw e;
    }
  }

  /**
   * Decide what the account that just signed in IS, and act on it once.
   * Called by both sign-in paths, in both modes; `company` is what was typed
   * on the sign-up tab, "" otherwise.
   */
  async function settle(u: User, company: string) {
    const uid = u.uid;
    // Pin the marker: from here it speaks for this uid alone, and it ends the
    // in-flight one. The app-wide listener may not have asked yet. Pinning
    // ADDS to the list — somebody else's unfinished registration on this
    // browser is still there afterwards (lib/portal-signup.ts).
    markPortalSignUp(uid);
    // Claimed before the first await, so the heal effect stands back. If the
    // effect is ALREADY writing this uid's document, this call stands back
    // instead: one registration per account, whoever started it.
    const mine = healed.current !== uid;
    healed.current = uid;
    const [staff, customer] = await Promise.all([
      bounded(hasStaffProfile(uid)),
      bounded(hasCustomerAccount(uid)),
    ]);
    const action = portalDoorAction({ owner: isOwnerEmail(u.email), staff, customer });
    if (action === "staff" || action === "customer") {
      // Nothing to write. The marker has done its job — the document that says
      // what this account is already exists.
      clearPortalSignUp(uid);
      return;
    }
    if (!mine) return;
    if (action === "defer") {
      // The marker stays pinned, so `ensureProfile` still writes no staff
      // profile for this uid; the heal effect registers it if — and only if —
      // `ensureProfile` itself answers "not staff".
      release(uid);
      return;
    }
    await registerClaimed(uid, u.displayName ?? "", company);
  }

  async function signInEmail(email: string, password: string) {
    // Set BEFORE Firebase is asked, on the sign-in tab too: an account with no
    // document at all (a login the owner made whose document failed to write)
    // must not be handed a staff profile by the listener. If nobody signs in,
    // the marker goes again at once.
    markPortalSignUp();
    const stop = clearOnLeave();
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      clearPortalSignUp();
      throw e;
    } finally {
      stop();
    }
    await settle(cred.user, "");
  }

  async function signUpEmail(email: string, password: string, displayName: string, company: string) {
    // Set BEFORE the account exists: the app-wide auth listener fires the
    // instant Firebase reports the new user, and without the marker it would
    // write a staff profile before the customer document is created. If the
    // account is never created, the marker goes again at once — a stale one
    // would otherwise sit over this browser's next sign-up.
    markPortalSignUp();
    const stop = clearOnLeave();
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      clearPortalSignUp();
      throw e;
    } finally {
      stop();
    }
    // A brand-new account has neither document, so there is nothing to look
    // up: this IS the registration. Claimed before the next await — the heal
    // effect could otherwise run during `updateProfile` and register the
    // account without the name and company typed here.
    markPortalSignUp(cred.user.uid);
    healed.current = cred.user.uid;
    if (displayName) {
      await updateProfile(cred.user, { displayName }).catch(() => { /* cosmetic */ });
    }
    await registerClaimed(cred.user.uid, displayName, company);
  }

  async function signInGoogle(company?: string) {
    // Both tabs. Google's popup makes no difference between "sign in" and
    // "sign up" — a person who has never been here and presses the button on
    // the default tab is creating an account, whatever the tab is called.
    markPortalSignUp();
    const stop = clearOnLeave();
    let cred;
    try {
      cred = await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      // A closed popup must not leave the marker behind it.
      clearPortalSignUp();
      throw e;
    } finally {
      stop();
    }
    await settle(cred.user, company ?? "");
  }

  return (
    <Ctx.Provider
      value={{
        account,
        // Writing the document is still "resolving": the waiting card must not
        // appear for a person whose registration is in flight.
        accountLoading: docLoading || healing,
        signInEmail, signUpEmail, signInGoogle,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(Ctx);
}
