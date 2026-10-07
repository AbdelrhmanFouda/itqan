/**
 * The two server-side writes to `customers/{uid}` — ONE copy of each.
 *
 *  - `createCustomerDoc`  the pending, unlinked document a new account starts
 *    with. Extracted from `POST /api/portal/register` on 2026-10-07, when the
 *    owner-made login (`POST /api/customers`) needed to write the very same
 *    document: two copies would agree on the day they were written and part
 *    company at the first fix, and this is the document every portal guard
 *    reads.
 *  - `linkCustomerDoc`    the approval: status, the link, by whom and when.
 *    The same four fields `approveCustomer` (lib/customers.ts) writes from the
 *    approvals screen, and nothing else on the document.
 *
 * Both go over the Firestore REST API AS SOMEBODY — there is no Admin SDK here
 * (org policy blocks service-account keys) — and firestore.rules decides:
 * a document is created by its OWN account, pending, with no `clients` field;
 * it is updated by an admin alone. So each function takes the ID token to act
 * as (`asToken`), and the caller chooses whose it is. Neither function logs,
 * returns or stores that token.
 *
 * Every call is bounded and never cached, like every read-path dependency
 * since the September outage.
 */
import { customerDocUrl, customerCollectionUrl } from "@/lib/agent-auth";
import { LINK_MASK, approvalFields, firebaseErrorToken } from "@/lib/customer-login";
import type { ClientLink } from "@/lib/customer-link";

const FIRESTORE_TIMEOUT_MS = 5000;

const cap = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/**
 * `status` is Firestore's HTTP status when it answered and refused, and 0 when
 * it did not answer at all (a timeout, a dropped connection).
 */
export type CustomerDocResult =
  | { ok: true; existing: boolean }
  | { ok: false; status: number };

/**
 * Create `customers/{uid}` — pending, and with NO `clients` key, on purpose
 * and permanently: the rules refuse a create that carries one, and the link is
 * an admin's to write.
 *
 * Idempotent: a document that already exists is answered `existing: true` and
 * left exactly as it is, including a status the owner has already decided.
 * `asToken` must be the ID token of the account the document belongs to.
 */
export async function createCustomerDoc(p: {
  uid: string;
  asToken: string;
  email: string;
  displayName: string;
  requestedClient: string;
  /** A just-created account cannot have a document yet: skip the look-up. */
  skipExistingCheck?: boolean;
  /** The bound on each call. The register route keeps the 5 s it always had. */
  timeoutMs?: number;
}): Promise<CustomerDocResult> {
  const timeoutMs = p.timeoutMs ?? FIRESTORE_TIMEOUT_MS;
  // Already registered? Leave it exactly as it is. This is what makes a retry
  // harmless.
  if (!p.skipExistingCheck) {
    try {
      const existing = await fetch(customerDocUrl(p.uid), {
        headers: { Authorization: `Bearer ${p.asToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (existing.ok) return { ok: true, existing: true };
    } catch {
      /* fall through to the create; a duplicate create answers ALREADY_EXISTS */
    }
  }

  const fields = {
    email: { stringValue: cap(p.email, 200) },
    displayName: { stringValue: cap(p.displayName, 120) },
    kind: { stringValue: "customer" },
    status: { stringValue: "pending" },
    requestedClient: { stringValue: cap(p.requestedClient, 200) },
    createdAt: { integerValue: String(Date.now()) },
  };

  let res: Response;
  try {
    res = await fetch(
      `${customerCollectionUrl()}?documentId=${encodeURIComponent(p.uid)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${p.asToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    return { ok: false, status: 0 };
  }
  if (res.ok) return { ok: true, existing: false };
  // 409 = the document appeared between the read and the write (two taps, or
  // the sign-up page retrying). That is success, not a failure to report.
  if (res.status === 409) return { ok: true, existing: true };
  return { ok: false, status: res.status };
}

/** `code` is Firestore's own token (`PERMISSION_DENIED`, `NOT_FOUND`) or `NO_ANSWER`. */
export type CustomerLinkResult = { ok: true } | { ok: false; code: string };

/**
 * Approve an account and link it to ONE «العملاء» row.
 *
 * One PATCH whose `updateMask` is exactly `LINK_MASK`, so nothing else on the
 * document can be changed by it, and with `currentDocument.exists` so it can
 * only ever UPDATE: a missing document is a refusal, never a second way to
 * create one. `asToken` must be an ADMIN's ID token — the rules allow the
 * update to the owner or an approved manager and to nobody else.
 */
export async function linkCustomerDoc(p: {
  uid: string;
  asToken: string;
  link: ClientLink;
  approvedBy: string;
  timeoutMs?: number;
}): Promise<CustomerLinkResult> {
  const timeoutMs = p.timeoutMs ?? FIRESTORE_TIMEOUT_MS;
  const mask = LINK_MASK.map((f) => `updateMask.fieldPaths=${f}`).join("&");
  let res: Response;
  try {
    res = await fetch(`${customerDocUrl(p.uid)}?${mask}&currentDocument.exists=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${p.asToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: approvalFields(p.link, cap(p.approvedBy, 200), Date.now()) }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, code: "NO_ANSWER" };
  }
  if (res.ok) return { ok: true };
  return { ok: false, code: firebaseErrorToken(await res.json().catch(() => null), res.status) };
}
