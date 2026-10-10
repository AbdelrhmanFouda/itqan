/**
 * «اسأل Claude» — the rules, pure and import-free (tests/ask.test.ts).
 *
 * The website never calls Claude. It stores a question and shows an answer; a
 * listener on the owner's laptop does the answering, through four token-gated
 * routes (docs/ASK-CLAUDE-LISTENER.md). Everything a route decides — who may
 * ask, whether a question can be claimed, when a claim has lapsed, whether the
 * day's cap is reached, whether the laptop is there — is decided HERE, so the
 * routes and the page cannot disagree and the tests run without a server.
 *
 * A thread is one document: its messages live inside it, so a claim is one
 * transaction on one document and two listeners can never both win it.
 */

/* ---------------------------------- who ---------------------------------- */

/** The non-full-access roles that may ask. Owner + manager always may. */
export const ASK_ROLES = ["maintenance"] as const;

/** Owner, manager and maintenance — the owner's word, 2026-10-10. */
export function canAsk(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || (ASK_ROLES as readonly string[]).includes(role ?? "");
}

/* --------------------------------- limits -------------------------------- */

/** A claimed question nobody answered goes back to waiting after this. */
export const CLAIM_TTL_MS = 5 * 60_000;
/** The listener beats every minute; under this the light is green. */
export const ONLINE_WINDOW_MS = 3 * 60_000;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_FAILURE_CHARS = 300;
export const MAX_MESSAGES = 40;
/** The photo AFTER the browser resized it. One Firestore document is 1 MiB. */
export const MAX_PHOTO_BYTES = 450_000;
/** What the browser aims for: longest edge and size. */
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_TARGET_BYTES = 300_000;
export const DEFAULT_DAILY_CAP = 20;
/** A link to a photo or a recording handed to the listener lives this long. */
export const LINK_TTL_S = 10 * 60;

/* ---------------------------------- shape -------------------------------- */

export type AskStatus = "waiting" | "claimed" | "answered" | "failed";

export type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** The photo attached to a user message — an id in the photo store. */
  photoId?: string;
};

/** The logged issue a thread is about — a SNAPSHOT taken when it was asked. */
export type AskIssue = {
  row: number;
  date: string;
  machine: string;
  product: string;
  category: string;
  description: string;
  action: string;
  status: string;
  note: string;
  issueAudioId: string;
  solutionAudioId: string;
  /** true = found on the sheet as the same issue; false = as the phone sent it. */
  verified: boolean;
};

/** The issue as the issues page hands it to the ask page (sessionStorage, one hop). */
export type IssueSnap = Omit<AskIssue, "verified" | "issueAudioId" | "solutionAudioId">;
export const ASK_ISSUE_KEY = "itqan.ask.issue";

export type AskClaim = { id: string; by: string; at: number };

export type AskThread = {
  id: string;
  uid: string;
  email: string;
  createdAt: number;
  updatedAt: number;
  status: AskStatus;
  issue: AskIssue | null;
  messages: AskMessage[];
  claim: AskClaim | null;
  failure: { reason: string; at: number } | null;
};

/* --------------------------------- status -------------------------------- */

/**
 * The status that counts. A claim older than CLAIM_TTL_MS has lapsed: the
 * question is waiting again, whatever the stored word says — nothing has to
 * run on a timer for the five-minute rule to hold.
 */
export function effectiveStatus(t: Pick<AskThread, "status" | "claim">, now: number): AskStatus {
  if (t.status !== "claimed") return t.status;
  if (!t.claim || now - t.claim.at >= CLAIM_TTL_MS) return "waiting";
  return "claimed";
}

/** The question being answered: the last message, when it is the user's. */
export function pendingQuestion(t: Pick<AskThread, "messages">): AskMessage | null {
  const last = t.messages[t.messages.length - 1];
  return last && last.role === "user" ? last : null;
}

export type Plan<T = AskThread> = { ok: true; thread: T } | { ok: false; reason: string };

/**
 * A listener takes a question. Only a WAITING one (a lapsed claim counts) —
 * a second listener asking a moment later is told `already_claimed`.
 */
export function planClaim(t: AskThread, claim: { id: string; by: string }, now: number): Plan {
  const s = effectiveStatus(t, now);
  if (s === "claimed") return { ok: false, reason: "already_claimed" };
  if (s !== "waiting") return { ok: false, reason: "not_waiting" };
  if (!pendingQuestion(t)) return { ok: false, reason: "not_waiting" };
  return {
    ok: true,
    thread: { ...t, status: "claimed", claim: { id: claim.id, by: claim.by, at: now }, failure: null, updatedAt: now },
  };
}

/**
 * Whether `claimId` still owns the question. A claim that lapsed but that
 * nobody else took is still honoured — a slow answer is better than none —
 * but once the question was re-claimed (or answered) the old claim is dead.
 */
function ownsClaim(t: AskThread, claimId: string): string | null {
  if (t.status === "answered") return "already_answered";
  if (!t.claim || t.claim.id !== claimId) return "claim_lost";
  if (t.status !== "claimed") return "claim_lost";
  return null;
}

export function planAnswer(t: AskThread, claimId: string, msg: { id: string; text: string }, now: number): Plan {
  const lost = ownsClaim(t, claimId);
  if (lost) return { ok: false, reason: lost };
  const text = msg.text.trim();
  if (!text) return { ok: false, reason: "empty_answer" };
  if (text.length > MAX_ANSWER_CHARS) return { ok: false, reason: "answer_too_long" };
  return {
    ok: true,
    thread: {
      ...t,
      status: "answered",
      claim: null,
      failure: null,
      updatedAt: now,
      messages: [...t.messages, { id: msg.id, role: "assistant", text, at: now }],
    },
  };
}

export function planFailure(t: AskThread, claimId: string, reason: string, now: number): Plan {
  const lost = ownsClaim(t, claimId);
  if (lost) return { ok: false, reason: lost };
  const why = reason.replace(/\s+/g, " ").trim().slice(0, MAX_FAILURE_CHARS) || "unknown";
  return { ok: true, thread: { ...t, status: "failed", claim: null, failure: { reason: why, at: now }, updatedAt: now } };
}

/** The user asks again after a failure: the same question waits again. Not counted against the cap. */
export function planRetry(t: AskThread, now: number): Plan {
  if (effectiveStatus(t, now) !== "failed") return { ok: false, reason: "not_failed" };
  if (!pendingQuestion(t)) return { ok: false, reason: "not_failed" };
  return { ok: true, thread: { ...t, status: "waiting", claim: null, failure: null, updatedAt: now } };
}

/**
 * A follow-up in the same thread. Only once the last question has an answer —
 * a second question while the first is waiting would leave the listener two
 * to answer in one turn, and the cap counting one of them.
 */
export function planFollowUp(t: AskThread, msg: AskMessage, now: number): Plan {
  const s = effectiveStatus(t, now);
  if (s === "waiting" || s === "claimed") return { ok: false, reason: "still_waiting" };
  if (s === "failed") return { ok: false, reason: "retry_first" };
  if (t.messages.length >= MAX_MESSAGES) return { ok: false, reason: "thread_full" };
  return {
    ok: true,
    thread: { ...t, status: "waiting", claim: null, failure: null, updatedAt: now, messages: [...t.messages, msg] },
  };
}

/** A question's text as it is stored: trimmed, or the reason it is refused. */
export function questionText(raw: unknown, hasPhoto: boolean): { ok: true; text: string } | { ok: false; reason: string } {
  const text = String(raw ?? "").trim();
  if (!text && !hasPhoto) return { ok: false, reason: "empty_question" };
  if (text.length > MAX_QUESTION_CHARS) return { ok: false, reason: "question_too_long" };
  return { ok: true, text };
}

/* ---------------------------------- the cap ------------------------------ */

const CAIRO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
/** The Cairo calendar day of a moment, as YYYY-MM-DD. */
export const cairoDay = (ms: number): string => CAIRO_DAY.format(new Date(ms));

/**
 * Questions per user per Cairo day. The owner is unlimited; everyone else gets
 * ASK_DAILY_CAP, or 20 when it is unset or unreadable (never "unlimited" by a
 * typo in an env var).
 */
export function dailyCap(role: string | null | undefined, env: Record<string, string | undefined>): number | null {
  if (role === "owner") return null;
  const n = Number((env.ASK_DAILY_CAP ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

/** How many questions `uid` asked today: every user message in their threads. */
export function askedToday(threads: Pick<AskThread, "uid" | "messages">[], uid: string, now: number): number {
  const today = cairoDay(now);
  let n = 0;
  for (const t of threads) {
    if (t.uid !== uid) continue;
    for (const m of t.messages) if (m.role === "user" && cairoDay(m.at) === today) n++;
  }
  return n;
}

export type CapState = { limit: number | null; used: number; remaining: number | null; allowed: boolean };

export function capState(limit: number | null, used: number): CapState {
  if (limit === null) return { limit: null, used, remaining: null, allowed: true };
  return { limit, used, remaining: Math.max(0, limit - used), allowed: used < limit };
}

/* ------------------------------- the laptop ------------------------------ */

/** «Claude متصل» — the last heartbeat is under three minutes old. */
export function isOnline(lastBeatAt: number | null | undefined, now: number): boolean {
  if (!lastBeatAt || !Number.isFinite(lastBeatAt)) return false;
  // A beat stamped slightly in the future (two servers' clocks) is still a beat.
  return now - lastBeatAt < ONLINE_WINDOW_MS;
}

/** The shortest token the listener routes accept. */
export const MIN_SECRET_CHARS = 32;

/**
 * The listener's bearer token, compared in constant time. An unset or short
 * expected value refuses EVERYTHING: a missing env var must never mean "open".
 */
export function listenerTokenOk(given: string | null | undefined, expected: string | null | undefined): boolean {
  const want = (expected ?? "").trim();
  const got = (given ?? "").trim();
  if (want.length < MIN_SECRET_CHARS) return false;
  let diff = want.length ^ got.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i % (got.length || 1)) || 0);
  return diff === 0;
}

/* ------------------------------ the two kinds ----------------------------- */

/**
 * The ask page offers logged issues as two kinds (owner, 2026-10-10: "show 2
 * types of errors (machines, molds)"): a fault of the press — «ماكينة» and
 * «كهرباء», the same pair lib/issues.ts isMachineCategory names — or of the
 * mould, «اسطمبة». «خامة» and «أخرى» are neither; they are still askable from
 * the opened issue on the issues page.
 */
export type IssueKind = "mould" | "machine";
export const ISSUE_KINDS: readonly IssueKind[] = ["mould", "machine"];
export function issueKind(category: string | null | undefined): IssueKind | null {
  const c = (category ?? "").trim();
  if (c === "اسطمبة") return "mould";
  if (c === "ماكينة" || c === "كهرباء") return "machine";
  return null;
}

/* --------------------------------- display ------------------------------- */

/** How long the page waits between checks: 4 s for the first minute, then 10 s. */
export function pollDelayMs(waitingSinceMs: number, now: number): number {
  return now - waitingSinceMs < 60_000 ? 4000 : 10_000;
}

/** One line that names a thread in the list. */
export function threadTitle(t: Pick<AskThread, "issue" | "messages">): string {
  if (t.issue) return [t.issue.product, t.issue.machine].filter(Boolean).join(" · ") || t.issue.description.slice(0, 60);
  const first = t.messages.find((m) => m.role === "user");
  return (first?.text || "").replace(/\s+/g, " ").slice(0, 60);
}
