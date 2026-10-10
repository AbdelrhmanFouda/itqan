/**
 * «اسأل Claude» — the server's operations, over a store it is handed.
 *
 * Everything the routes do goes through here: ask, follow up, retry, read,
 * list, and the listener's four moves (next, claim, answer/fail, heartbeat).
 * The rules are lib/ask.ts; the secrecy is lib/ask-crypto.ts; this file is the
 * sequence — read, decide, write — and it imports no Firebase and no sheet, so
 * tests/ask-core.test.ts runs the REAL thing over the in-memory store below.
 *
 * A thread is stored as { id, uid, status, updatedAt, blob }. Only `blob`
 * (the encrypted thread) is believed. `uid` and `status` are an index for the
 * two queries; a stranger can rewrite them in an open collection, so every
 * read re-checks them against what the blob says.
 */
import {
  MAX_MESSAGES, MAX_PHOTO_BYTES,
  askedToday, capState, dailyCap, effectiveStatus, pendingQuestion,
  planAnswer, planClaim, planFailure, planFollowUp, planRetry, questionText, threadTitle,
  CLAIM_TTL_MS,
  type AskIssue, type AskMessage, type AskStatus, type AskThread, type CapState, type Plan,
} from "@/lib/ask";
import { newId, openBytes, openJson, sealBytes, sealJson } from "@/lib/ask-crypto";

type Env = Record<string, string | undefined>;

/* ---------------------------------- store -------------------------------- */

export type ThreadRec = { id: string; uid: string; status: AskStatus; updatedAt: number; blob: string };
export type PhotoRec = { threadId: string; blob: string; createdAt: number };

export interface AskStore {
  getThread(id: string): Promise<ThreadRec | null>;
  putThread(rec: ThreadRec): Promise<void>;
  /**
   * Read-modify-write in ONE transaction. `fn` gets the stored record (or
   * null) and returns the record to write, or null to write nothing. Resolves
   * to what `fn` returned. This is what makes a claim exclusive.
   */
  mutateThread(id: string, fn: (cur: ThreadRec | null) => ThreadRec | null): Promise<ThreadRec | null>;
  listByUid(uid: string): Promise<ThreadRec[]>;
  listByStatus(statuses: AskStatus[]): Promise<ThreadRec[]>;
  putPhoto(id: string, rec: PhotoRec): Promise<void>;
  getPhoto(id: string): Promise<PhotoRec | null>;
  getBeat(): Promise<string | null>;
  setBeat(blob: string): Promise<void>;
}

/** The store the tests use, and local development when ASK_STORE=memory. */
export function memoryStore(): AskStore {
  const threads = new Map<string, ThreadRec>();
  const photos = new Map<string, PhotoRec>();
  let beat: string | null = null;
  return {
    async getThread(id) { return threads.get(id) ?? null; },
    async putThread(rec) { threads.set(rec.id, { ...rec }); },
    async mutateThread(id, fn) {
      // No await between the read and the write: one turn of the event loop,
      // which is what a transaction gives the real store.
      const next = fn(threads.get(id) ?? null);
      if (next) threads.set(id, { ...next });
      return next;
    },
    async listByUid(uid) { return [...threads.values()].filter((t) => t.uid === uid); },
    async listByStatus(statuses) { return [...threads.values()].filter((t) => statuses.includes(t.status)); },
    async putPhoto(id, rec) { photos.set(id, { ...rec }); },
    async getPhoto(id) { return photos.get(id) ?? null; },
    async getBeat() { return beat; },
    async setBeat(blob) { beat = blob; },
  };
}

/* -------------------------------- sealing -------------------------------- */

const threadAad = (id: string) => `thread:${id}`;
const photoAad = (id: string) => `photo:${id}`;
const BEAT_AAD = "beat";

/** The thread inside a record — null for anything this server did not write. */
export function openThread(rec: ThreadRec | null, env: Env = process.env): AskThread | null {
  if (!rec) return null;
  const t = openJson<AskThread>(rec.blob, threadAad(rec.id), env);
  if (!t || t.id !== rec.id || !Array.isArray(t.messages)) return null;
  return t;
}

function recOf(t: AskThread, env: Env): ThreadRec {
  return { id: t.id, uid: t.uid, status: t.status, updatedAt: t.updatedAt, blob: sealJson(t, threadAad(t.id), env) };
}

/* --------------------------------- staff --------------------------------- */

export type Asker = { uid: string; email: string; role: string };
const fullAccess = (role: string) => role === "owner" || role === "manager";

/** What the page is given: never the claim id, which is the listener's proof. */
export type PublicThread = {
  id: string; title: string; status: AskStatus; createdAt: number; updatedAt: number;
  issue: AskIssue | null; messages: AskMessage[]; failure: { reason: string; at: number } | null;
  askedBy: string; askedByUid: string;
};

export function publicThread(t: AskThread, now: number): PublicThread {
  return {
    id: t.id, title: threadTitle(t), status: effectiveStatus(t, now), createdAt: t.createdAt, updatedAt: t.updatedAt,
    issue: t.issue, messages: t.messages, failure: t.failure, askedBy: t.email, askedByUid: t.uid,
  };
}

async function threadsOf(store: AskStore, uid: string, env: Env): Promise<AskThread[]> {
  const recs = await store.listByUid(uid);
  return recs.map((r) => openThread(r, env)).filter((t): t is AskThread => !!t && t.uid === uid);
}

export async function usage(store: AskStore, who: Asker, now: number, env: Env = process.env): Promise<CapState> {
  const limit = dailyCap(who.role, env);
  if (limit === null) return capState(null, 0);
  return capState(limit, askedToday(await threadsOf(store, who.uid, env), who.uid, now));
}

/** JPEG only — it is what the browser's resize produces, and nothing else is expected here. */
export function photoProblem(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes.byteLength > MAX_PHOTO_BYTES) return "photo_too_large";
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "bad_photo";
  return null;
}

async function storePhoto(store: AskStore, threadId: string, bytes: Uint8Array, now: number, env: Env): Promise<string> {
  const id = newId();
  await store.putPhoto(id, { threadId, blob: sealBytes(bytes, photoAad(id), env).toString("base64"), createdAt: now });
  return id;
}

export type AskResult =
  | { ok: true; thread: PublicThread; cap: CapState }
  | { ok: false; reason: string; cap?: CapState };

type Question = { text: unknown; photo?: Uint8Array | null };

/** A new thread, waiting. The cap is checked before anything is written. */
export async function createQuestion(
  store: AskStore, who: Asker, q: Question & { issue: AskIssue | null }, now: number = Date.now(), env: Env = process.env,
): Promise<AskResult> {
  const text = questionText(q.text, !!q.photo);
  if (!text.ok) return { ok: false, reason: text.reason };
  const bad = photoProblem(q.photo);
  if (bad) return { ok: false, reason: bad };
  const cap = await usage(store, who, now, env);
  if (!cap.allowed) return { ok: false, reason: "daily_cap", cap };

  const id = newId();
  const msg: AskMessage = { id: newId(), role: "user", text: text.text, at: now };
  if (q.photo) msg.photoId = await storePhoto(store, id, q.photo, now, env);
  const thread: AskThread = {
    id, uid: who.uid, email: who.email, createdAt: now, updatedAt: now, status: "waiting",
    issue: q.issue, messages: [msg], claim: null, failure: null,
  };
  await store.putThread(recOf(thread, env));
  return { ok: true, thread: publicThread(thread, now), cap: capState(cap.limit, cap.used + 1) };
}

/** Apply a plan to a thread the caller owns, inside the store's transaction. */
async function change(
  store: AskStore, id: string, env: Env, plan: (t: AskThread) => Plan, allow: (t: AskThread) => boolean = () => true,
): Promise<Plan> {
  let out: Plan = { ok: false, reason: "not_found" };
  await store.mutateThread(id, (cur) => {
    const t = openThread(cur, env);
    if (!t || !allow(t)) { out = { ok: false, reason: "not_found" }; return null; }
    out = plan(t);
    return out.ok ? recOf(out.thread, env) : null;
  });
  return out;
}

export async function followUp(
  store: AskStore, who: Asker, threadId: string, q: Question, now: number = Date.now(), env: Env = process.env,
): Promise<AskResult> {
  const text = questionText(q.text, !!q.photo);
  if (!text.ok) return { ok: false, reason: text.reason };
  const bad = photoProblem(q.photo);
  if (bad) return { ok: false, reason: bad };

  // Refuse before a photo is stored: the thread must be the caller's own and
  // ready for a question, and the day's cap must have room.
  const cur = openThread(await store.getThread(threadId), env);
  if (!cur || cur.uid !== who.uid) return { ok: false, reason: "not_found" };
  const msg: AskMessage = { id: newId(), role: "user", text: text.text, at: now };
  const dry = planFollowUp(cur, msg, now);
  if (!dry.ok) return { ok: false, reason: dry.reason };
  const cap = await usage(store, who, now, env);
  if (!cap.allowed) return { ok: false, reason: "daily_cap", cap };

  if (q.photo) msg.photoId = await storePhoto(store, threadId, q.photo, now, env);
  const done = await change(store, threadId, env, (t) => planFollowUp(t, msg, now), (t) => t.uid === who.uid);
  if (!done.ok) return { ok: false, reason: done.reason };
  return { ok: true, thread: publicThread(done.thread, now), cap: capState(cap.limit, cap.used + 1) };
}

export async function retryQuestion(
  store: AskStore, who: Asker, threadId: string, now: number = Date.now(), env: Env = process.env,
): Promise<AskResult> {
  const done = await change(store, threadId, env, (t) => planRetry(t, now), (t) => t.uid === who.uid);
  if (!done.ok) return { ok: false, reason: done.reason };
  return { ok: true, thread: publicThread(done.thread, now), cap: await usage(store, who, now, env) };
}

/** One thread: the asker's own, or any thread for owner + manager. */
export async function readThread(
  store: AskStore, who: Asker, id: string, now: number = Date.now(), env: Env = process.env,
): Promise<PublicThread | null> {
  const t = openThread(await store.getThread(id), env);
  if (!t || (t.uid !== who.uid && !fullAccess(who.role))) return null;
  return publicThread(t, now);
}

/** The caller's own threads, newest first, without the message bodies. */
export async function listThreads(store: AskStore, who: Asker, now: number = Date.now(), env: Env = process.env) {
  const mine = await threadsOf(store, who.uid, env);
  return mine
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => {
      const p = publicThread(t, now);
      const last = t.messages[t.messages.length - 1];
      return {
        id: p.id, title: p.title, status: p.status, updatedAt: p.updatedAt, hasIssue: !!t.issue,
        last: last ? { role: last.role, text: last.text.replace(/\s+/g, " ").slice(0, 120) } : null,
      };
    });
}

async function photoBytes(store: AskStore, threadId: string, photoId: string, env: Env): Promise<Buffer | null> {
  const rec = await store.getPhoto(photoId);
  if (!rec || rec.threadId !== threadId) return null;
  return openBytes(Buffer.from(rec.blob, "base64"), photoAad(photoId), env);
}

/** A photo for the page: the thread must be readable by the caller and must carry that photo. */
export async function readPhoto(
  store: AskStore, who: Asker, threadId: string, photoId: string, env: Env = process.env,
): Promise<Buffer | null> {
  const t = openThread(await store.getThread(threadId), env);
  if (!t || (t.uid !== who.uid && !fullAccess(who.role))) return null;
  if (!t.messages.some((m) => m.photoId === photoId)) return null;
  return photoBytes(store, threadId, photoId, env);
}

/** A photo for the listener, by a link this server signed (the signature is the caller's to check). */
export async function readPhotoForListener(
  store: AskStore, threadId: string, photoId: string, env: Env = process.env,
): Promise<Buffer | null> {
  const t = openThread(await store.getThread(threadId), env);
  if (!t || !t.messages.some((m) => m.photoId === photoId)) return null;
  return photoBytes(store, threadId, photoId, env);
}

/* -------------------------------- listener ------------------------------- */

/**
 * The questions waiting for an answer, oldest first. A claimed one whose five
 * minutes have passed is among them — that is the whole "goes back to waiting"
 * rule; no timer runs.
 */
export async function waitingQuestions(
  store: AskStore, now: number = Date.now(), limit = 3, env: Env = process.env,
): Promise<AskThread[]> {
  const recs = await store.listByStatus(["waiting", "claimed"]);
  return recs
    .map((r) => openThread(r, env))
    .filter((t): t is AskThread => !!t && effectiveStatus(t, now) === "waiting" && !!pendingQuestion(t))
    .sort((a, b) => (pendingQuestion(a)!.at - pendingQuestion(b)!.at))
    .slice(0, Math.max(1, Math.min(10, limit)));
}

export type ClaimResult =
  | { ok: true; claimId: string; expiresAt: number; thread: AskThread }
  | { ok: false; reason: string };

export async function claimQuestion(
  store: AskStore, threadId: string, by: string, now: number = Date.now(), env: Env = process.env,
): Promise<ClaimResult> {
  const claimId = newId();
  const done = await change(store, threadId, env, (t) => planClaim(t, { id: claimId, by: by.slice(0, 80) || "listener" }, now));
  if (!done.ok) return { ok: false, reason: done.reason };
  return { ok: true, claimId, expiresAt: now + CLAIM_TTL_MS, thread: done.thread };
}

export async function answerQuestion(
  store: AskStore, threadId: string, claimId: string, text: string, now: number = Date.now(), env: Env = process.env,
): Promise<Plan> {
  return change(store, threadId, env, (t) =>
    t.messages.length >= MAX_MESSAGES + 1
      ? { ok: false, reason: "thread_full" }
      : planAnswer(t, claimId, { id: newId(), text }, now));
}

export async function failQuestion(
  store: AskStore, threadId: string, claimId: string, reason: string, now: number = Date.now(), env: Env = process.env,
): Promise<Plan> {
  return change(store, threadId, env, (t) => planFailure(t, claimId, reason, now));
}

/* -------------------------------- heartbeat ------------------------------ */

export async function beat(store: AskStore, listener: string, now: number = Date.now(), env: Env = process.env): Promise<number> {
  await store.setBeat(sealJson({ at: now, listener: listener.slice(0, 80) }, BEAT_AAD, env));
  return now;
}

/** When the laptop last beat — null when never, or when the stored beat is not ours. */
export async function lastBeat(store: AskStore, env: Env = process.env): Promise<number | null> {
  const b = openJson<{ at: number }>(await store.getBeat(), BEAT_AAD, env);
  return b && Number.isFinite(b.at) ? b.at : null;
}
