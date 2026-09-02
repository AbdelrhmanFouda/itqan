"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureProfile, watchProfile, type UserProfile } from "@/lib/users";
import type { Role } from "@/lib/roles";

type AuthCtx = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;        // initial auth state resolving
  profileLoading: boolean; // profile document resolving
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, displayName: string, requestedRole: Role) => Promise<void>;
  signInGoogle: (requestedRole?: Role | null) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

const PROFILE_KEY = (uid: string) => `itqan.profile.${uid}`;
function readCachedProfile(uid: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(uid));
    if (!raw) return null;
    const p = JSON.parse(raw) as UserProfile;
    return p && p.uid === uid ? p : null;
  } catch { return null; }
}
function writeCachedProfile(uid: string, p: UserProfile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY(uid), JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY(uid));
  } catch { /* private mode */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = undefined; }
      setUser(u);
      // Auth is resolved the moment Firebase reports the user. This used to wait
      // for ensureProfile() too — a Firestore round trip from the phone to eur3,
      // on every page open, before any page could mount (2026-09-02, "the
      // downtime page is still slow on my phone").
      setLoading(false);
      if (!u) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }
      // The profile seen last time on this device, keyed by uid, stands in
      // until the live snapshot arrives — so the dashboard renders at once
      // instead of holding every page behind one more round trip. The snapshot
      // still wins: a revoked role redirects the moment it lands, and the API
      // guard never trusted the client anyway. Nothing secret is stored: it is
      // the user's own name, email and role, on the user's own device.
      const cached = readCachedProfile(u.uid);
      if (cached) setProfile(cached);
      setProfileLoading(!cached);
      unsubProfile = watchProfile(u.uid, (p) => {
        setProfile(p);
        setProfileLoading(false);
        writeCachedProfile(u.uid, p);
      });
      // Create-if-missing runs alongside, not in front. For an existing user it
      // is a read that changes nothing; for a brand-new one the snapshot above
      // reports the document the instant this writes it.
      ensureProfile({ uid: u.uid, email: u.email ?? "", displayName: u.displayName ?? "" }).catch(() => {
        // ignore — a sign-up path may create the profile with a requested role
      });
    });
    return () => {
      unsub();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  async function signInEmail(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signUpEmail(email: string, password: string, displayName: string, requestedRole: Role) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
    await ensureProfile({
      uid: cred.user.uid,
      email: cred.user.email ?? email,
      displayName,
      requestedRole,
    });
  }

  async function signInGoogle(requestedRole?: Role | null) {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await ensureProfile({
      uid: cred.user.uid,
      email: cred.user.email ?? "",
      displayName: cred.user.displayName ?? "",
      requestedRole: requestedRole ?? null,
    });
  }

  async function signOut() {
    await fbSignOut(auth);
  }

  return (
    <Ctx.Provider value={{ user, profile, loading, profileLoading, signInEmail, signUpEmail, signInGoogle, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
