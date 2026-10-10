/**
 * «اسأل Claude» — the rules (lib/ask.ts): who may ask, the claim, the
 * five-minute return, the daily cap, the status light, the listener's token.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_ROLES, CLAIM_TTL_MS, DEFAULT_DAILY_CAP, MAX_ANSWER_CHARS, MAX_QUESTION_CHARS, ONLINE_WINDOW_MS,
  askedToday, canAsk, capState, dailyCap, effectiveStatus, isOnline, listenerTokenOk,
  planAnswer, planClaim, planFailure, planFollowUp, planRetry, pollDelayMs, questionText,
  type AskThread,
} from "../lib/ask.ts";
import { ALL_ROLES, NAV, canAccess } from "../lib/roles.ts";

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0); // 12:00 in Cairo
const MIN = 60_000;

const thread = (over: Partial<AskThread> = {}): AskThread => ({
  id: "t1", uid: "u1", email: "fitter@example.com", createdAt: T0, updatedAt: T0, status: "waiting", issue: null,
  messages: [{ id: "m1", role: "user", text: "ليه فيه فلاش؟", at: T0 }], claim: null, failure: null, ...over,
});
const must = <T>(p: { ok: true; thread: T } | { ok: false; reason: string }): T => {
  assert.ok(p.ok, p.ok ? "" : p.reason);
  return p.thread;
};

/* ---------------------------------- roles --------------------------------- */

test("owner, manager and maintenance may ask — and nobody else", () => {
  const allowed = ALL_ROLES.filter((r) => canAsk(r)).sort();
  assert.deepEqual(allowed, ["maintenance", "manager", "owner"]);
  for (const junk of [null, undefined, "", "customer", "Owner", "admin"]) assert.equal(canAsk(junk as string), false);
});

test("the page's NAV entry and the API's role list are the same list", () => {
  const nav = NAV.find((n) => n.key === "ask");
  assert.ok(nav, "the ask page has a NAV entry of its own");
  assert.deepEqual([...nav.roles].sort(), [...ASK_ROLES].sort());
  for (const role of ALL_ROLES) assert.equal(canAccess(role, "/dashboard/ask"), canAsk(role), role);
});

/* ---------------------------------- claim --------------------------------- */

test("a waiting question is claimed once; the second listener is refused", () => {
  const first = planClaim(thread(), { id: "c1", by: "laptop" }, T0 + MIN);
  const claimed = must(first);
  assert.equal(claimed.status, "claimed");
  assert.deepEqual(claimed.claim, { id: "c1", by: "laptop", at: T0 + MIN });
  const second = planClaim(claimed, { id: "c2", by: "other" }, T0 + 2 * MIN);
  assert.deepEqual(second, { ok: false, reason: "already_claimed" });
});

test("an answered or failed question cannot be claimed", () => {
  const answered = thread({ status: "answered", messages: [...thread().messages, { id: "m2", role: "assistant", text: "…", at: T0 }] });
  assert.deepEqual(planClaim(answered, { id: "c", by: "x" }, T0), { ok: false, reason: "not_waiting" });
  const failed = thread({ status: "failed", failure: { reason: "x", at: T0 } });
  assert.deepEqual(planClaim(failed, { id: "c", by: "x" }, T0), { ok: false, reason: "not_waiting" });
});

/* ----------------------------- the 5-minute return ------------------------ */

test("a claim not answered within five minutes is waiting again", () => {
  const claimed = must(planClaim(thread(), { id: "c1", by: "laptop" }, T0));
  assert.equal(effectiveStatus(claimed, T0 + CLAIM_TTL_MS - 1), "claimed");
  assert.equal(effectiveStatus(claimed, T0 + CLAIM_TTL_MS), "waiting");
  // …and another listener may take it then, not a moment before.
  assert.equal(planClaim(claimed, { id: "c2", by: "b" }, T0 + CLAIM_TTL_MS - 1).ok, false);
  const again = must(planClaim(claimed, { id: "c2", by: "b" }, T0 + CLAIM_TTL_MS));
  assert.equal(again.claim?.id, "c2");
});

test("a late answer is kept while nobody re-claimed, and refused once somebody did", () => {
  const claimed = must(planClaim(thread(), { id: "c1", by: "a" }, T0));
  const late = planAnswer(claimed, "c1", { id: "m2", text: "راجع الضغط" }, T0 + CLAIM_TTL_MS + MIN);
  assert.equal(must(late).status, "answered");
  const retaken = must(planClaim(claimed, { id: "c2", by: "b" }, T0 + CLAIM_TTL_MS));
  assert.deepEqual(planAnswer(retaken, "c1", { id: "m2", text: "x" }, T0 + CLAIM_TTL_MS + MIN), { ok: false, reason: "claim_lost" });
  assert.equal(planAnswer(retaken, "c2", { id: "m2", text: "x" }, T0 + CLAIM_TTL_MS + MIN).ok, true);
});

/* ----------------------------- answer and failure ------------------------- */

test("an answer needs the claim, is appended once, and a replay writes nothing", () => {
  const claimed = must(planClaim(thread(), { id: "c1", by: "a" }, T0));
  assert.deepEqual(planAnswer(thread(), "c1", { id: "m2", text: "x" }, T0), { ok: false, reason: "claim_lost" });
  assert.deepEqual(planAnswer(claimed, "wrong", { id: "m2", text: "x" }, T0), { ok: false, reason: "claim_lost" });
  assert.deepEqual(planAnswer(claimed, "c1", { id: "m2", text: "   " }, T0), { ok: false, reason: "empty_answer" });
  assert.deepEqual(planAnswer(claimed, "c1", { id: "m2", text: "x".repeat(MAX_ANSWER_CHARS + 1) }, T0), { ok: false, reason: "answer_too_long" });
  const done = must(planAnswer(claimed, "c1", { id: "m2", text: " زوّد التبريد " }, T0 + MIN));
  assert.equal(done.status, "answered");
  assert.equal(done.claim, null);
  assert.deepEqual(done.messages.at(-1), { id: "m2", role: "assistant", text: "زوّد التبريد", at: T0 + MIN });
  assert.deepEqual(planAnswer(done, "c1", { id: "m3", text: "again" }, T0 + 2 * MIN), { ok: false, reason: "already_answered" });
});

test("a failure keeps the question, and a retry puts it back in the queue", () => {
  const claimed = must(planClaim(thread(), { id: "c1", by: "a" }, T0));
  const failed = must(planFailure(claimed, "c1", "  Claude Code\n timed out ", T0 + MIN));
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.failure, { reason: "Claude Code timed out", at: T0 + MIN });
  assert.equal(failed.messages.length, 1, "the question is still the last message");
  assert.deepEqual(planRetry(thread(), T0), { ok: false, reason: "not_failed" });
  const waiting = must(planRetry(failed, T0 + 2 * MIN));
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.failure, null);
  assert.equal(planClaim(waiting, { id: "c2", by: "a" }, T0 + 3 * MIN).ok, true);
});

test("a follow-up waits for the answer to the question before it", () => {
  const msg = { id: "m3", role: "user" as const, text: "ولو ما نفعش؟", at: T0 + 5 * MIN };
  assert.deepEqual(planFollowUp(thread(), msg, T0), { ok: false, reason: "still_waiting" });
  const claimed = must(planClaim(thread(), { id: "c1", by: "a" }, T0));
  assert.deepEqual(planFollowUp(claimed, msg, T0), { ok: false, reason: "still_waiting" });
  const failed = must(planFailure(claimed, "c1", "x", T0));
  assert.deepEqual(planFollowUp(failed, msg, T0), { ok: false, reason: "retry_first" });
  const answered = must(planAnswer(claimed, "c1", { id: "m2", text: "جرّب كذا" }, T0));
  const next = must(planFollowUp(answered, msg, T0 + 5 * MIN));
  assert.equal(next.status, "waiting");
  assert.equal(next.messages.length, 3);
});

test("a question is text or a photo, and not longer than the limit", () => {
  assert.deepEqual(questionText("  ", false), { ok: false, reason: "empty_question" });
  assert.deepEqual(questionText("", true), { ok: true, text: "" });
  assert.deepEqual(questionText(" سؤال ", false), { ok: true, text: "سؤال" });
  assert.deepEqual(questionText("x".repeat(MAX_QUESTION_CHARS + 1), false), { ok: false, reason: "question_too_long" });
});

/* ----------------------------------- cap ---------------------------------- */

test("the daily cap: the owner is unlimited, everyone else gets the env number or 20", () => {
  assert.equal(dailyCap("owner", { ASK_DAILY_CAP: "3" }), null);
  assert.equal(dailyCap("maintenance", { ASK_DAILY_CAP: "3" }), 3);
  assert.equal(dailyCap("manager", { ASK_DAILY_CAP: " 7 " }), 7);
  for (const bad of [undefined, "", "0", "-4", "abc", "2.5", "unlimited"]) {
    assert.equal(dailyCap("maintenance", { ASK_DAILY_CAP: bad }), DEFAULT_DAILY_CAP, `ASK_DAILY_CAP=${bad}`);
  }
});

test("questions are counted per user per CAIRO day, follow-ups included", () => {
  const cairoMidnight = Date.UTC(2026, 9, 9, 21, 0, 0); // 00:00 on 10 Oct in Cairo (UTC+3)
  const threads = [
    thread({ messages: [
      { id: "a", role: "user", text: "1", at: cairoMidnight - MIN },       // yesterday, 23:59
      { id: "b", role: "assistant", text: "r", at: cairoMidnight },
      { id: "c", role: "user", text: "2", at: cairoMidnight + MIN },       // today
    ] }),
    thread({ id: "t2", messages: [{ id: "d", role: "user", text: "3", at: T0 }] }),
    thread({ id: "t3", uid: "someone-else", messages: [{ id: "e", role: "user", text: "4", at: T0 }] }),
  ];
  assert.equal(askedToday(threads, "u1", T0), 2);
  assert.equal(askedToday(threads, "someone-else", T0), 1);
  assert.equal(askedToday(threads, "u1", cairoMidnight - 2 * MIN), 1, "the day before has its own count");
});

test("the cap closes at the limit and says how many are left", () => {
  assert.deepEqual(capState(3, 2), { limit: 3, used: 2, remaining: 1, allowed: true });
  assert.deepEqual(capState(3, 3), { limit: 3, used: 3, remaining: 0, allowed: false });
  assert.deepEqual(capState(3, 9), { limit: 3, used: 9, remaining: 0, allowed: false });
  assert.deepEqual(capState(null, 50), { limit: null, used: 50, remaining: null, allowed: true });
});

/* ------------------------------ light and token --------------------------- */

test("«Claude متصل» only while the last heartbeat is under three minutes old", () => {
  assert.equal(isOnline(T0, T0 + ONLINE_WINDOW_MS - 1), true);
  assert.equal(isOnline(T0, T0 + ONLINE_WINDOW_MS), false);
  assert.equal(isOnline(null, T0), false);
  assert.equal(isOnline(0, T0), false);
  assert.equal(isOnline(Number.NaN, T0), false);
});

test("the listener token: exact match only, and a missing or short secret refuses everything", () => {
  const secret = "s".repeat(40);
  assert.equal(listenerTokenOk(secret, secret), true);
  assert.equal(listenerTokenOk(` ${secret} `, secret), true);
  assert.equal(listenerTokenOk(secret + "x", secret), false);
  assert.equal(listenerTokenOk(secret.slice(1), secret), false);
  assert.equal(listenerTokenOk("", secret), false);
  assert.equal(listenerTokenOk(null, secret), false);
  assert.equal(listenerTokenOk("", ""), false, "an unset secret must never mean open");
  assert.equal(listenerTokenOk(undefined, undefined), false);
  assert.equal(listenerTokenOk("short", "short"), false, "a short secret is refused even when it matches");
});

test("the page checks every 4 s for a minute, then every 10 s", () => {
  assert.equal(pollDelayMs(T0, T0 + 59_000), 4000);
  assert.equal(pollDelayMs(T0, T0 + 60_000), 10_000);
});
