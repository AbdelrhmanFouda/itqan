/**
 * Server-side Firebase ID-token verification WITHOUT firebase-admin.
 *
 * Org policy blocks service-account keys, so we can't use the Admin SDK. Instead
 * we verify the RS256 JWT ourselves against Google's public x509 certs, exactly
 * as the Admin SDK would: check the signature, `aud`, `iss`, and `exp`.
 *
 * Then a per-user daily message limit is enforced in Firestore (`usage/{uid}`).
 * Owner + managers are unlimited; everyone else gets AI_AGENT_DAILY_LIMIT/day.
 */

import { createPublicKey, createVerify } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cairoDay } from "@/lib/ai-review";
import { isOwnerEmail, hasFullAccess, type Role } from "@/lib/roles";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "itqan-5f802";
const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

export type VerifiedUser = { uid: string; email: string };

/* ------------------------------ JWT verify -------------------------------- */

function b64urlJson(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

async function fetchCerts(): Promise<Record<string, string>> {
  // Google rotates these; a 1h revalidate keeps us well inside the cert lifetime.
  const res = await fetch(CERTS_URL, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`certs_${res.status}`);
  return (await res.json()) as Record<string, string>;
}

/** Verify a Firebase ID token. Throws on any failure; returns {uid,email} on success. */
export async function verifyIdToken(token: string): Promise<VerifiedUser> {
  const parts = (token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed_token");
  const [h, p, sig] = parts;

  const header = b64urlJson(h);
  if (header.alg !== "RS256") throw new Error("bad_alg");
  const kid = String(header.kid || "");
  if (!kid) throw new Error("no_kid");

  const certs = await fetchCerts();
  const cert = certs[kid];
  if (!cert) throw new Error("unknown_kid");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  verifier.end();
  if (!verifier.verify(createPublicKey(cert), Buffer.from(sig, "base64url")))
    throw new Error("bad_signature");

  const payload = b64urlJson(p);
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp || 0);
  const iat = Number(payload.iat || 0);
  if (exp < now) throw new Error("expired");
  if (iat > now + 300) throw new Error("issued_in_future");
  if (payload.aud !== PROJECT_ID) throw new Error("bad_aud");
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error("bad_iss");
  const uid = String(payload.sub || "");
  if (!uid) throw new Error("no_sub");

  return { uid, email: String(payload.email || "") };
}

/* ------------------------------ role lookup ------------------------------- */

/** The granted role for a verified user (owner email always wins). Best-effort. */
export async function roleFor(user: VerifiedUser): Promise<Role | null> {
  if (isOwnerEmail(user.email)) return "owner";
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return d.status === "approved" ? ((d.role as Role) ?? null) : null;
  } catch {
    return null;
  }
}

/* ------------------------------ usage limit ------------------------------- */

function dailyLimitFor(role: Role | null): number | null {
  if (role && hasFullAccess(role)) return null; // owner + manager: unlimited
  const env = Number(process.env.AI_AGENT_DAILY_LIMIT);
  return Number.isFinite(env) && env > 0 ? env : 20;
}

export type UsageState = { allowed: boolean; used: number; limit: number | null; remaining: number | null };

/** Read today's usage without mutating it (limit === null ⇒ unlimited). */
export async function peekUsage(uid: string, role: Role | null): Promise<UsageState> {
  const limit = dailyLimitFor(role);
  if (limit === null) return { allowed: true, used: 0, limit: null, remaining: null };
  const today = cairoDay();
  let used = 0;
  try {
    const snap = await getDoc(doc(db, "usage", uid));
    if (snap.exists() && snap.data().date === today) used = Number(snap.data().count) || 0;
  } catch {
    /* best-effort — a Firestore hiccup must not lock a user out */
  }
  return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Reserve one message for the day. Rejects (allowed:false) when the limit is hit;
 * otherwise increments the counter and returns the post-increment state. Resets
 * automatically when the stored date differs from today's Cairo day.
 */
export async function consumeUsage(uid: string, role: Role | null): Promise<UsageState> {
  const limit = dailyLimitFor(role);
  if (limit === null) return { allowed: true, used: 0, limit: null, remaining: null };
  const today = cairoDay();
  const ref = doc(db, "usage", uid);
  let used = 0;
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().date === today) used = Number(snap.data().count) || 0;
  } catch {
    /* treat as zero — never lock out on a read error */
  }
  if (used >= limit) return { allowed: false, used, limit, remaining: 0 };
  const next = used + 1;
  try {
    await setDoc(ref, { date: today, count: next }, { merge: true });
  } catch {
    /* if the write fails we still let this one message through */
  }
  return { allowed: true, used: next, limit, remaining: Math.max(0, limit - next) };
}
