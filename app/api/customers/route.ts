import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { getRecords } from "@/lib/sheets";
import { clientKey, clientNoOf, type ClientLink } from "@/lib/customer-link";
import {
  MIN_PASSWORD, isValidUsername, loginEmailFor, normalizeUsername, sanitizeAliases,
  firebaseErrorToken, signUpRefusal,
} from "@/lib/customer-login";
import { createCustomerDoc, linkCustomerDoc } from "@/lib/customer-doc";

/**
 * «إنشاء حساب عميل» — the owner makes a customer's login himself (2026-10-07).
 *
 * A customer does not always have an address he reads, and the owner tried to
 * make one a login from the portal's own sign-up page with a made-up address.
 * This is the door for that: a USERNAME and a password the owner chooses, an
 * account created for them, and the link to the customer's «العملاء» row
 * written in the same step — so the customer signs in once and sees his orders.
 *
 * OWNER AND MANAGER ONLY — `requireRole(req, [])`, the same empty allow-list
 * /api/downtime/reclassify uses — and the guard runs before the body is read.
 *
 * In order, and each step only after the one before it held:
 *
 *  1. validate what was sent, and find the «العملاء» row on the SHEET. The
 *     link stored is the sheet's own number and spelling, never the caller's;
 *  2. create the Firebase account over REST (there is no Admin SDK here). The
 *     address is the username on the reserved login domain
 *     (lib/customer-login.ts) — this route cannot create an account for a real
 *     address, by construction;
 *  3. write `customers/{uid}` AS THE NEW ACCOUNT, pending and unlinked — the
 *     same document, through the same function, as the portal's own sign-up
 *     (lib/customer-doc.ts). The rules allow a create to that account alone;
 *  4. approve and link it AS THE CALLER, whose own ID token the rules accept
 *     because the caller is an admin.
 *
 * If 2 gets NO ANSWER the account may or may not exist (`maybe_created`) — the
 * screen says to look before trying again. If 3 or 4 fails the login already
 * exists, and the answer says so
 * (`created_not_linked`): the account appears under «في انتظار الموافقة» — at
 * once when the document was written, or after the customer's first sign-in
 * through the portal's door, which registers it — and is approved from there.
 *
 * ⚠ THE PASSWORD AND BOTH ID TOKENS. The password is read from the body and
 * sent to Firebase in the BODY of one request; the new account's token is used
 * for one write; the caller's for one write. None of the three is ever logged,
 * returned, stored or put in a URL — the owner's screen shows the password
 * from its own form, because this route never sends it back. On a failure the
 * only thing logged is the stage and Firebase's own error token.
 * tests/portal-access.test.ts pins all of that against this file's source.
 */

const SIGNUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const TIMEOUT_MS = 8000;

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** One refusal: a reason the screen has a sentence for, and nothing else. */
function refuse(reason: string, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json({ ok: false, reason, ...extra }, { status });
}

type SheetClient = { no?: string; name?: string };

/**
 * The «العملاء» row a link names: the same number AND the same name, compared
 * the way the portal compares client names everywhere (`clientKey`). A filler
 * or blank name matches nothing.
 */
function findClient(records: readonly SheetClient[], no: number, key: string): SheetClient | undefined {
  if (!key) return undefined;
  return records.find((r) => clientNoOf(r.no) === no && clientKey(r.name) === key);
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req, []);
  if ("deny" in g) return g.deny;
  // The guard has just verified this token; it is used again for step 4 only.
  const header = req.headers.get("authorization") || "";
  const callerToken = header.startsWith("Bearer ") ? header.slice(7) : "";

  let b: Record<string, unknown> = {};
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    /* an empty body fails the first check below */
  }

  /* ------------------------------ 1. validate ------------------------------ */

  const username = normalizeUsername(typeof b.username === "string" ? b.username : "");
  if (!isValidUsername(username)) return refuse("bad_username", 400);

  // Never trimmed and never capped: it is the customer's password exactly as
  // the owner read it off his own screen.
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < MIN_PASSWORD) return refuse("weak_password", 400);

  const displayName = text(b.displayName, 120);
  if (!displayName) return refuse("missing_name", 400);

  const sent = (b.client && typeof b.client === "object" ? b.client : {}) as Record<string, unknown>;
  const aliases = sanitizeAliases(sent.aliases);
  if (!aliases) return refuse("bad_aliases", 400);
  const no = Number(sent.no);
  const key = clientKey(typeof sent.name === "string" ? sent.name : "");
  if (!Number.isInteger(no) || no < 0 || !key) return refuse("unknown_client", 400);

  // The copy first; on a miss, the sheet as it is right now — a customer added
  // a minute ago is in «العملاء» and not yet in the copy.
  let read = await getRecords("clients");
  let row = findClient(read.records as SheetClient[], no, key);
  if (!row) {
    read = await getRecords("clients", { fresh: true });
    row = findClient(read.records as SheetClient[], no, key);
  }
  if (!row) {
    // A tab that could not be read arrives EMPTY (lib/sheets.ts). That is not
    // "this customer does not exist", and saying so would send the owner to
    // re-pick a row that is there.
    return read.records.length === 0 ? refuse("sheet_unreadable", 503) : refuse("unknown_client", 400);
  }
  const link: ClientLink = { no: clientNoOf(row.no), name: String(row.name ?? "").trim(), aliases };

  /* ------------------------- 2. the Firebase account ----------------------- */

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
  if (!apiKey) {
    console.error("[customers] signUp: NO_API_KEY");
    return refuse("auth_failed", 502, { code: "NO_API_KEY" });
  }
  const email = loginEmailFor(username);

  let res: Response;
  try {
    res = await fetch(`${SIGNUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      // The web API key may be restricted to this site's own pages; the call
      // is made on the site's behalf, so it says where it comes from.
      headers: { "Content-Type": "application/json", Referer: `${req.nextUrl.origin}/` },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // No answer is NOT "nothing happened": a call that timed out may have
    // created the account all the same (at-least-once, like the sheet bridge).
    // Saying «could not be created» sent the owner to retry, meet «username
    // taken», pick another name and leave a login behind with the same
    // password. The screen is told the truth and says to look first.
    console.error("[customers] signUp: NO_ANSWER");
    return refuse("maybe_created", 504, { code: "NO_ANSWER" });
  }
  const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = firebaseErrorToken(answer, res.status);
    const refusal = signUpRefusal(code);
    if (refusal.reason !== "auth_failed") return refuse(refusal.reason, refusal.status);
    console.error(`[customers] signUp: ${code}`);
    return refuse("auth_failed", 502, { code });
  }
  const uid = typeof answer?.localId === "string" ? answer.localId : "";
  const idToken = typeof answer?.idToken === "string" ? answer.idToken : "";
  if (!uid || !idToken) {
    console.error("[customers] signUp: NO_ACCOUNT_IN_ANSWER");
    return refuse("auth_failed", 502, { code: "NO_ACCOUNT_IN_ANSWER" });
  }

  /* ------------------ 3. the document, as the NEW account ------------------ */

  const made = await createCustomerDoc({
    uid,
    asToken: idToken,
    email,
    displayName,
    // Display only, as at sign-up: what the owner reads in the queue if the
    // link below does not finish.
    requestedClient: link.name,
    skipExistingCheck: true,
    timeoutMs: TIMEOUT_MS,
  });
  if (!made.ok) {
    console.error(`[customers] doc: HTTP_${made.status}`);
    return refuse("created_not_linked", 502, { stage: "doc", uid });
  }

  /* ------------------ 4. approve and link, as the CALLER ------------------- */

  const linked = await linkCustomerDoc({
    uid,
    asToken: callerToken,
    link,
    approvedBy: g.user.email,
    timeoutMs: TIMEOUT_MS,
  });
  if (!linked.ok) {
    console.error(`[customers] link: ${linked.code}`);
    return refuse("created_not_linked", 502, { stage: "link", uid });
  }

  return NextResponse.json({ ok: true, uid, username, email });
}
