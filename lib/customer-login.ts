/**
 * The owner-made customer login — the pure rules.
 *
 * A customer of the factory does not always have an e-mail address he reads,
 * and the owner does not want to wait for one: he makes the login himself on
 * «حسابات العملاء» — a USERNAME and a password — links it to the customer's row
 * in «العملاء» in the same step, and sends the two over WhatsApp (2026-10-07).
 *
 * Firebase only knows e-mail addresses, so a username is stored as an address
 * on `CUSTOMER_LOGIN_DOMAIN`. Everything that turns one into the other, checks
 * one, or builds what the server sends lives here, so that the screen, the
 * route and the portal's sign-in box share ONE reading:
 *
 *   «sampleco»  ⇄  sampleco@example.com
 *
 * Pure and import-free, like lib/customer-link.ts: Node's test runner loads it
 * directly (tests/customer-login.test.ts). The random source for a generated
 * password is INJECTED for the same reason — the browser hands in
 * `crypto.getRandomValues`, a test hands in a counter.
 */

/**
 * IANA-reserved (RFC 2606): nobody can own it and nobody can receive mail at
 * it, so a password-reset mail for such an account can never reach anyone —
 * which is the point, and also the limit (a forgotten password means a new
 * login). Firebase's identifier check accepts it (looked up 2026-10-07; no
 * sign-up was sent).
 */
export const CUSTOMER_LOGIN_DOMAIN = "example.com";

/** Firebase's own minimum on this project. Below it the sign-up is refused. */
export const MIN_PASSWORD = 6;

/** Under this the screen ADVISES a longer one. It never blocks. */
export const ADVISED_PASSWORD = 10;

export const MAX_ALIASES = 10;
export const MAX_ALIAS_LENGTH = 120;

/* -------------------------------- username -------------------------------- */

/** Trimmed, Arabic-Indic and Persian digits as Latin, lower-case. */
export function normalizeUsername(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .toLowerCase();
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/**
 * 3–30 of a–z, 0–9, `.`, `_`, `-`; starts with a letter or a digit; no `..`
 * and no trailing `.` (both are illegal in the local part of an address, and
 * Firebase would answer INVALID_EMAIL after the owner had already typed it).
 * Takes an ALREADY normalised value — «ALI» is not valid, «ali» is.
 */
export function isValidUsername(u: string | null | undefined): boolean {
  const s = String(u ?? "");
  return USERNAME.test(s) && !s.includes("..") && !s.endsWith(".");
}

export type UsernameIssue = "ok" | "empty" | "chars" | "start" | "short" | "long" | "dots";

/**
 * What is wrong with a username, for the live line under the box. "ok" exactly
 * when `isValidUsername` says so — the test pins the two against each other.
 */
export function usernameIssue(u: string | null | undefined): UsernameIssue {
  const s = String(u ?? "");
  if (!s) return "empty";
  if (/[^a-z0-9._-]/.test(s)) return "chars";
  if (!/^[a-z0-9]/.test(s)) return "start";
  if (s.length < 3) return "short";
  if (s.length > 30) return "long";
  if (s.includes("..") || s.endsWith(".")) return "dots";
  return "ok";
}

/**
 * What to hand Firebase for whatever was typed in the sign-in box: "" for a
 * blank, the address itself (trimmed, as typed) when it holds an `@`, else the
 * username on the login domain.
 */
export function loginEmailFor(input: string | null | undefined): string {
  const typed = String(input ?? "").trim();
  if (!typed) return "";
  if (typed.includes("@")) return typed;
  return `${normalizeUsername(typed)}@${CUSTOMER_LOGIN_DOMAIN}`;
}

/** The username behind an address on the login domain; "" for any other address. */
export function usernameOf(email: string | null | undefined): string {
  const s = String(email ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at <= 0) return "";
  return s.slice(at + 1).toLowerCase() === CUSTOMER_LOGIN_DOMAIN ? s.slice(0, at).toLowerCase() : "";
}

/* -------------------------------- password -------------------------------- */

export type PasswordAdvice = "ok" | "short" | "digitsOnly";

/**
 * ADVICE the screen prints in amber — never a refusal. A password of
 * `MIN_PASSWORD` or more is always accepted; the owner is told when it is all
 * digits (a phone number, a year) or shorter than `ADVISED_PASSWORD`. All
 * digits is said first: it is the weaker of the two, at any length.
 */
export function passwordAdvice(pw: string | null | undefined): PasswordAdvice {
  const s = String(pw ?? "");
  if (s.length > 0 && /^[0-9٠-٩۰-۹]+$/.test(s)) return "digitsOnly";
  if (s.length < ADVISED_PASSWORD) return "short";
  return "ok";
}

/**
 * No look-alikes: no 0/O/o, no 1/l/I/i. The password is read off one phone and
 * typed on another, usually out of a WhatsApp message.
 */
export const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Twelve characters in three groups of four — «xxxx-xxxx-xxxx» (about 69 bits).
 *
 * `randomInt(n)` must answer an integer in [0, n). It is the CALLER's: the
 * browser passes one built on `crypto.getRandomValues`, so nothing here can
 * quietly fall back to `Math.random`. A source that answers out of range is a
 * bug in the caller and throws rather than producing a shorter password.
 */
export function generatePassword(randomInt: (n: number) => number): string {
  const n = PASSWORD_ALPHABET.length;
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let part = "";
    for (let i = 0; i < 4; i++) {
      const at = randomInt(n);
      if (!Number.isInteger(at) || at < 0 || at >= n) throw new Error("bad_random_source");
      part += PASSWORD_ALPHABET[at];
    }
    groups.push(part);
  }
  return groups.join("-");
}

/* --------------------------------- aliases -------------------------------- */

/**
 * The aliases a request carries, cleaned — or null when they cannot be taken.
 *
 * An alias is an ACCESS KEY (lib/customer-link.ts: a sheet row belongs to an
 * account when its client cell is exactly one of these). So nothing is
 * repaired here: an over-long spelling is not cut short into a different key
 * and an eleventh is not silently dropped — the request is refused and the
 * screen says so. Trimming, dropping blanks and removing exact repeats are the
 * only changes, the same three `normalizeClients` makes when it reads them back.
 */
export function sanitizeAliases(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const s = item.trim();
    if (!s) continue;
    if (s.length > MAX_ALIAS_LENGTH) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > MAX_ALIASES ? null : out;
}

/* ---------------------------- what the server sends ----------------------- */

type LinkShape = { no: number; name: string; aliases: readonly string[] };

/**
 * A `clients` list as a Firestore REST `Value`.
 *
 * The mirror of `restValue` (lib/firestore-rest.ts) + `normalizeClients`
 * (lib/customer-link.ts), which is how `requireCustomer` reads the link back.
 * The round trip is pinned in tests/customer-login.test.ts — a field named
 * differently on the way in would be an account that LOOKS linked on the
 * approvals screen and opens nothing.
 */
export function clientsToFirestore(clients: readonly LinkShape[]): {
  arrayValue: { values: unknown[] };
} {
  return {
    arrayValue: {
      values: clients.map((c) => ({
        mapValue: {
          fields: {
            no: { integerValue: String(Number.isFinite(c.no) ? Math.trunc(c.no) : 0) },
            name: { stringValue: c.name },
            aliases: { arrayValue: { values: c.aliases.map((a) => ({ stringValue: a })) } },
          },
        },
      })),
    },
  };
}

/**
 * The four fields an approval writes — exactly what `approveCustomer`
 * (lib/customers.ts) writes from the approvals screen, and the whole
 * `updateMask` of the server's PATCH. Nothing else on the document is touched.
 */
export const LINK_MASK = ["status", "clients", "approvedBy", "approvedAt"] as const;

/** The REST `fields` of an approval: ONE link, approved, by whom, when. */
export function approvalFields(link: LinkShape, approvedBy: string, now: number): Record<(typeof LINK_MASK)[number], unknown> {
  return {
    status: { stringValue: "approved" },
    clients: clientsToFirestore([link]),
    approvedBy: { stringValue: approvedBy },
    approvedAt: { integerValue: String(Math.trunc(now)) },
  };
}

/* --------------------------- what Firebase answers ------------------------ */

/**
 * The one token of a Firebase / Google API error body that is safe to log and
 * to show: `EMAIL_EXISTS`, `OPERATION_NOT_ALLOWED`, `PERMISSION_DENIED`.
 *
 * Identity Toolkit answers `{ error: { message: "WEAK_PASSWORD : Password
 * should be…" } }`; other Google APIs answer prose in `message` and the token
 * in `status`. Only an UPPER_SNAKE token is ever taken — never the prose, and
 * never anything from the request, which is where the password was.
 */
export function firebaseErrorToken(body: unknown, httpStatus: number): string {
  const e = (body as { error?: { message?: unknown; status?: unknown } } | null)?.error;
  const message = typeof e?.message === "string" ? e.message : "";
  const m = /^([A-Z][A-Z0-9_]{2,59})(?:\s*:|$)/.exec(message.trim());
  if (m) return m[1];
  const status = typeof e?.status === "string" ? e.status : "";
  if (/^[A-Z][A-Z_]{2,39}$/.test(status)) return status;
  return `HTTP_${Number.isFinite(httpStatus) ? Math.trunc(httpStatus) : 0}`;
}

export type SignUpRefusal = {
  reason: "username_taken" | "weak_password" | "bad_username" | "too_many" | "auth_failed";
  status: number;
};

/** A sign-up token as the route's own refusal. Anything unknown is `auth_failed`. */
export function signUpRefusal(token: string): SignUpRefusal {
  if (token === "EMAIL_EXISTS") return { reason: "username_taken", status: 409 };
  if (token.startsWith("WEAK_PASSWORD")) return { reason: "weak_password", status: 400 };
  if (token === "INVALID_EMAIL" || token === "MISSING_EMAIL") return { reason: "bad_username", status: 400 };
  if (token === "TOO_MANY_ATTEMPTS_TRY_LATER") return { reason: "too_many", status: 429 };
  return { reason: "auth_failed", status: 502 };
}
