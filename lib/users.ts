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
 */
export async function ensureProfile(params: {
  uid: string; email: string; displayName?: string; requestedRole?: Role | null;
}): Promise<UserProfile> {
  const ref = doc(db, COL, params.uid);
  const snap = await getDoc(ref);
  const owner = isOwnerEmail(params.email);

  if (!snap.exists()) {
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
export async function rejectUser(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "rejected" });
}
export async function setUserRole(uid: string, role: Role) {
  await updateDoc(doc(db, COL, uid), { role, status: "approved" });
}
export async function setPending(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "pending" });
}
