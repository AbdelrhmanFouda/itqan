"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { watchCustomer } from "@/lib/customers";
import type { CustomerAccount } from "@/lib/customer-link";
import { markPortalSignUp, clearPortalSignUp } from "@/lib/portal-signup";
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
 * The sign-up paths deliberately do NOT go through AuthContext's `signUpEmail`
 * / `signInGoogle`: those call `ensureProfile`, which writes a STAFF profile.
 * A buyer must never get one — see lib/portal-signup.ts for the race this
 * closes and lib/customer-link.ts for why the two kinds are separate at all.
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

/**
 * `register`, with the provider's "already tried this uid" mark released when
 * it fails.
 *
 * The mark is what stops the effect below doubling a registration that is
 * already in flight. But /portal/login and /portal share ONE layout, so the
 * provider survives the redirect between them: a sign-up whose register call
 * failed would otherwise arrive at /portal with the uid already marked, the
 * self-heal disabled, and the waiting card showing for good — which is the
 * exact failure the heal was written for.
 */
async function registerOnce(
  mark: { current: string }, uid: string, displayName: string, requestedClient: string,
) {
  try {
    await register(uid, displayName, requestedClient);
  } catch (e) {
    if (mark.current === uid) mark.current = "";
    throw e;
  }
}

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const { user, loading, profile, profileLoading, isCustomer } = useAuth();
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [healing, setHealing] = useState(false);
  /** The uid whose missing document this provider has already tried to write. */
  const healed = useRef("");

  useEffect(() => {
    if (loading) return;
    if (!user) { setAccount(null); setDocLoading(false); return; }
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
  }, [loading, user, account, docLoading, profile, profileLoading, isCustomer]);

  async function signInEmail(email: string, password: string) {
    clearPortalSignUp();
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signUpEmail(email: string, password: string, displayName: string, company: string) {
    // Set BEFORE the account exists: the app-wide auth listener fires the
    // instant Firebase reports the new user, and without the marker it would
    // write a staff profile before the customer document is created. If the
    // account is never created, the marker goes again at once — a stale one
    // would otherwise sit over this browser's next sign-up.
    markPortalSignUp();
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      clearPortalSignUp();
      throw e;
    }
    markPortalSignUp(cred.user.uid);
    if (displayName) {
      await updateProfile(cred.user, { displayName }).catch(() => { /* cosmetic */ });
    }
    healed.current = cred.user.uid; // this IS the registration — never doubled
    await registerOnce(healed, cred.user.uid, displayName, company);
  }

  async function signInGoogle(company?: string) {
    const signingUp = company !== undefined;
    if (signingUp) markPortalSignUp(); else clearPortalSignUp();
    let cred;
    try {
      cred = await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      // A closed popup must not leave the marker behind it.
      if (signingUp) clearPortalSignUp();
      throw e;
    }
    if (!signingUp) return;
    markPortalSignUp(cred.user.uid);
    healed.current = cred.user.uid;
    await registerOnce(healed, cred.user.uid, cred.user.displayName ?? "", company ?? "");
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
