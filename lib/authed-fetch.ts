"use client";
/**
 * fetch() that attaches the signed-in user's Firebase ID token as a Bearer
 * header. All dashboard calls to protected /api routes go through this —
 * the server side is enforced by lib/api-guard.ts.
 */
import { auth } from "@/lib/firebase";

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let token = "";
  try {
    token = (await auth.currentUser?.getIdToken()) ?? "";
  } catch {
    /* not signed in / token refresh failed — request goes out unauthenticated
       and the API answers 401, which the caller already surfaces as a save error */
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
