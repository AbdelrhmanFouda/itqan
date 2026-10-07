/**
 * Why a sign-in failed — one reading of it, for both doors.
 *
 * `/login` (staff) and `/portal/login` (customers) each carried their own
 * six-case switch, and everything outside those six fell to «حدث خطأ ما. حاول
 * مرة أخرى.» with nothing beside it. On 2026-10-07 the owner tried to make a
 * customer login on the portal page with a made-up address, got exactly that
 * sentence, and had nothing to report: no account, no reason, no word to
 * search for. So:
 *
 *  - the kinds a person can ACT on are named (no connection, too many tries, a
 *    mistyped address, sign-up switched off, a disabled account);
 *  - for what is still `generic`, the pages print the raw code under the
 *    sentence, small and grey — the next unknown failure can be reported in
 *    one word.
 *
 * Pure and import-free, like lib/scrap.ts and lib/customer-link.ts: Node's test
 * runner loads it directly (tests/auth-errors.test.ts), and both pages share it.
 */

export type AuthErrorKind =
  | "invalid"            // wrong identifier or password — Firebase does not say which
  | "emailInUse"
  | "weakPassword"
  | "unauthorizedDomain" // Google sign-in on an address Firebase does not list
  | "popupClosed"
  | "network"
  | "tooMany"
  | "badEmail"
  | "signupClosed"       // the provider is switched off in the Firebase console
  | "disabled"
  | "register"           // the account exists; its customer document could not be written
  | "generic";

/**
 * A Map, not an object literal: a thrown value whose message is "constructor"
 * or "toString" must read as `generic`, not as whatever Object.prototype holds
 * under that name.
 */
const KINDS = new Map<string, AuthErrorKind>([
  ["auth/invalid-credential", "invalid"],
  ["auth/invalid-login-credentials", "invalid"],
  ["auth/wrong-password", "invalid"],
  ["auth/user-not-found", "invalid"],
  ["auth/email-already-in-use", "emailInUse"],
  ["auth/weak-password", "weakPassword"],
  ["auth/unauthorized-domain", "unauthorizedDomain"],
  ["auth/popup-closed-by-user", "popupClosed"],
  ["auth/cancelled-popup-request", "popupClosed"],
  ["auth/network-request-failed", "network"],
  ["auth/too-many-requests", "tooMany"],
  ["auth/invalid-email", "badEmail"],
  ["auth/missing-email", "badEmail"],
  ["auth/operation-not-allowed", "signupClosed"],
  ["auth/admin-restricted-operation", "signupClosed"],
  ["auth/user-disabled", "disabled"],
  ["register_failed", "register"],
]);

/**
 * What a browser's own `fetch` says when the request never left: Chrome
 * ("Failed to fetch"), Firefox ("NetworkError when attempting to fetch
 * resource."), Safari ("Load failed"), Node ("fetch failed"). Each is the
 * message of a `TypeError` — and only these messages are read as a network
 * failure, because most TypeErrors are a bug in the page, not a dead socket.
 */
const NETWORK_MESSAGE = /^(?:TypeError:\s*)?(?:failed to fetch|networkerror when attempting to fetch resource\.?|load failed|fetch failed|network request failed)$/i;

/**
 * The one word a failure is known by: Firebase's `code` when the thrown value
 * carries one, else the Error's message, else "".
 */
export function authErrorCode(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (!err || typeof err !== "object") return "";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) return code.trim();
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message.trim() : "";
}

/** The kind of failure behind a code. Anything unrecognised is `generic`. */
export function authErrorKind(code: string | null | undefined): AuthErrorKind {
  const c = String(code ?? "").trim();
  if (!c) return "generic";
  const known = KINDS.get(c);
  if (known) return known;
  if (NETWORK_MESSAGE.test(c)) return "network";
  return "generic";
}

/**
 * The raw code as the pages print it under the generic sentence: capped, and
 * on one line. An Error's message can be a paragraph; the line under the
 * sentence is for a word somebody can read out over the phone.
 */
export function authErrorDetail(code: string | null | undefined): string {
  return String(code ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}
