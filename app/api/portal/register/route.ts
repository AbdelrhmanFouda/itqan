import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/agent-auth";
import { createCustomerDoc } from "@/lib/customer-doc";

/**
 * Create the caller's own `customers/{uid}` document — the portal's sign-up.
 *
 * This is the ONE portal route that cannot use `requireCustomer`: it runs
 * before the document exists. So it carries its own guards.
 *
 *  - IT VERIFIES THE ID TOKEN ITSELF and writes to the uid IN that token. The
 *    body cannot name a different account, and it deliberately does NOT look up
 *    a role: a customer has none, and asking would only cost a round trip.
 *  - PER-IP RATE LIMIT, the same shape as /api/contact (5 per hour, fixed
 *    window, in memory, therefore per serverless instance). Self sign-up with a
 *    public link makes `customers` a public create target and the owner's
 *    approvals queue a public inbox; most abuse hammers one warm instance.
 *  - IDEMPOTENT. A document that already exists is answered ok and left alone —
 *    a second tap, a retried request or a page reload after sign-up must never
 *    reset a status the owner has already decided, and `clients` (the access
 *    link) is never sent at all, on either path.
 *
 * The write goes through the Firestore REST API AS THE CALLER, like every other
 * server-side Firestore access here (org policy blocks service-account keys, so
 * there is no Admin SDK). firestore.rules then enforces the rest: own uid,
 * `status: 'pending'`, and no `clients` field.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}

const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function POST(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  let user: { uid: string; email: string };
  try {
    user = await verifyIdToken(token);
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  let b: Record<string, unknown> = {};
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    /* an empty body is fine — the name falls back to the token's email */
  }
  const displayName = s(b.displayName, 120) || s(user.email, 120);
  const requestedClient = s(b.requestedClient, 200);

  // The write itself is lib/customer-doc.ts since 2026-10-07 — the SAME
  // function the owner-made login (app/api/customers) calls, so the document
  // the two produce cannot drift. It looks for an existing document first and
  // leaves one exactly as it is, including a status the owner has already
  // decided; it never sends `clients`; and a 409 on the create is success.
  const made = await createCustomerDoc({
    uid: user.uid, asToken: token, email: user.email, displayName, requestedClient,
  });
  if (made.ok) return NextResponse.json({ ok: true, existing: made.existing });
  // status 0 = Firestore never answered (a timeout): nothing to log about it.
  if (made.status) console.error(`[portal/register] create failed: ${made.status}`);
  return NextResponse.json({ ok: false, reason: "store_failed" }, { status: 503 });
}
