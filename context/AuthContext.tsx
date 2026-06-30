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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = undefined; }
      setUser(u);
      if (!u) {
        setProfile(null);
        setProfileLoading(false);
        setLoading(false);
        return;
      }
      setProfileLoading(true);
      try {
        await ensureProfile({ uid: u.uid, email: u.email ?? "", displayName: u.displayName ?? "" });
      } catch {
        // ignore — a sign-up path may create the profile with a requested role
      }
      unsubProfile = watchProfile(u.uid, (p) => {
        setProfile(p);
        setProfileLoading(false);
      });
      setLoading(false);
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
