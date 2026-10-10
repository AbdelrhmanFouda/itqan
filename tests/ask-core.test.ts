/**
 * «اسأل Claude» — the REAL server sequence (lib/ask-core.ts) over the
 * in-memory store: ask → next → claim → answer → follow-up, two listeners,
 * the five-minute return, a failed answer, the daily cap, and what an
 * outsider with write access to the open collection can and cannot do.
 *
 * lib/ask-core.ts imports its pure siblings through `@/`, so the alias hook
 * is loaded first and the module dynamically (tests/_alias.ts says why).
 *
 * Run with `npm test`.
 */
import "./_alias.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const C = await import("../lib/ask-core.ts");
const X = await import("../lib/ask-crypto.ts");
const { CLAIM_TTL_MS, MAX_PHOTO_BYTES } = await import("../lib/ask.ts");

const ENV = { ASK_DATA_KEY: "k".repeat(48), ASK_LISTENER_TOKEN: "t".repeat(48), ASK_DAILY_CAP: "3" };
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const MIN = 60_000;
const fitter = { uid: "u1", email: "fitter@example.com", role: "maintenance" };
const other = { uid: "u2", email: "other@example.com", role: "maintenance" };
const owner = { uid: "u0", email: "owner@example.com", role: "owner" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const ISSUE = {
  row: 12, date: "2026-10-10", machine: "PQ 7 — 100", product: "غطاء", category: "اسطمبة",
  description: "فلاش على الحافة", action: "", status: "مفتوح", note: "", issueAudioId: "", solutionAudioId: "", verified: true,
};

async function asked(store = C.memoryStore(), who = fitter, at = T0) {
  const r = await C.createQuestion(store, who, { text: "ليه فيه فلاش؟", photo: JPEG, issue: ISSUE }, at, ENV);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return { store, id: r.thread.id, thread: r.thread };
}

test("the whole round: ask with a photo, next, claim, answer, read, follow-up", async () => {
  const { store, id, thread } = await asked();
  assert.equal(thread.status, "waiting");
  assert.equal("claim" in thread, false, "the page never sees a claim id");

  const waiting = await C.waitingQuestions(store, T0 + MIN, 3, ENV);
  assert.deepEqual(waiting.map((t) => t.id), [id]);
  assert.equal(waiting[0].issue?.machine, "PQ 7 — 100");
  const photoId = waiting[0].messages[0].photoId!;
  assert.deepEqual([...(await C.readPhotoForListener(store, id, photoId, ENV))!], [...JPEG]);

  const claim = await C.claimQuestion(store, id, "laptop", T0 + MIN, ENV);
  assert.ok(claim.ok);
  assert.equal(claim.expiresAt, T0 + MIN + CLAIM_TTL_MS);
  assert.deepEqual(await C.waitingQuestions(store, T0 + 2 * MIN, 3, ENV), [], "a claimed question is not offered again");

  const ans = await C.answerQuestion(store, id, claim.claimId, "راجع قوة القفل.", T0 + 2 * MIN, ENV);
  assert.ok(ans.ok);
  const seen = await C.readThread(store, fitter, id, T0 + 3 * MIN, ENV);
  assert.equal(seen?.status, "answered");
  assert.deepEqual(seen?.messages.map((m) => [m.role, m.text]), [["user", "ليه فيه فلاش؟"], ["assistant", "راجع قوة القفل."]]);

  const more = await C.followUp(store, fitter, id, { text: "ولو زوّدتها وما نفعش؟" }, T0 + 4 * MIN, ENV);
  assert.ok(more.ok);
  assert.equal(more.thread.status, "waiting");
  const again = await C.waitingQuestions(store, T0 + 5 * MIN, 3, ENV);
  assert.equal(again[0].messages.length, 3, "the listener gets the earlier messages with the new question");
});

test("two listeners claim at once: exactly one wins", async () => {
  const { store, id } = await asked();
  const [a, b] = await Promise.all([
    C.claimQuestion(store, id, "laptop-a", T0 + MIN, ENV),
    C.claimQuestion(store, id, "laptop-b", T0 + MIN, ENV),
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const loser = a.ok ? b : a;
  assert.equal(!loser.ok && loser.reason, "already_claimed");
});

test("claimed and not answered within five minutes: back in the queue, and the old claim dies when re-taken", async () => {
  const { store, id } = await asked();
  const first = await C.claimQuestion(store, id, "laptop-a", T0, ENV);
  assert.ok(first.ok);
  assert.equal((await C.waitingQuestions(store, T0 + CLAIM_TTL_MS - 1, 3, ENV)).length, 0);
  assert.equal((await C.waitingQuestions(store, T0 + CLAIM_TTL_MS, 3, ENV)).length, 1);
  assert.equal((await C.readThread(store, fitter, id, T0 + CLAIM_TTL_MS, ENV))?.status, "waiting");

  const second = await C.claimQuestion(store, id, "laptop-b", T0 + CLAIM_TTL_MS, ENV);
  assert.ok(second.ok);
  const stale = await C.answerQuestion(store, id, first.claimId, "late", T0 + CLAIM_TTL_MS + MIN, ENV);
  assert.deepEqual(stale, { ok: false, reason: "claim_lost" });
  assert.ok((await C.answerQuestion(store, id, second.claimId, "on time", T0 + CLAIM_TTL_MS + MIN, ENV)).ok);
});

test("a failed answer is shown with its reason, and retry re-queues the same question", async () => {
  const { store, id } = await asked();
  const claim = await C.claimQuestion(store, id, "laptop", T0, ENV);
  assert.ok(claim.ok);
  assert.ok((await C.failQuestion(store, id, claim.claimId, "claude exited 1", T0 + MIN, ENV)).ok);
  const seen = await C.readThread(store, fitter, id, T0 + 2 * MIN, ENV);
  assert.equal(seen?.status, "failed");
  assert.equal(seen?.failure?.reason, "claude exited 1");
  assert.equal((await C.waitingQuestions(store, T0 + 2 * MIN, 3, ENV)).length, 0, "a failed question is not re-offered by itself");

  const before = await C.usage(store, fitter, T0 + 2 * MIN, ENV);
  const retry = await C.retryQuestion(store, fitter, id, T0 + 3 * MIN, ENV);
  assert.ok(retry.ok);
  assert.equal(retry.cap.used, before.used, "a retry is not a new question");
  assert.equal((await C.waitingQuestions(store, T0 + 3 * MIN, 3, ENV)).length, 1);
});

test("the daily cap: the fourth question of the day is refused, the owner is not counted", async () => {
  const store = C.memoryStore();
  for (let i = 0; i < 3; i++) {
    const r = await C.createQuestion(store, fitter, { text: `q${i}`, issue: null }, T0 + i * MIN, ENV);
    assert.ok(r.ok);
    assert.equal(r.cap.remaining, 2 - i);
  }
  const fourth = await C.createQuestion(store, fitter, { text: "q3", issue: null }, T0 + 4 * MIN, ENV);
  assert.equal(fourth.ok, false);
  assert.equal(!fourth.ok && fourth.reason, "daily_cap");
  assert.deepEqual(!fourth.ok && fourth.cap, { limit: 3, used: 3, remaining: 0, allowed: false });
  assert.equal((await C.listThreads(store, fitter, T0, ENV)).length, 3, "nothing was stored for the refused one");

  assert.ok((await C.createQuestion(store, other, { text: "mine", issue: null }, T0, ENV)).ok, "another user has their own count");
  assert.ok((await C.createQuestion(store, fitter, { text: "tomorrow", issue: null }, T0 + 24 * 60 * MIN, ENV)).ok, "the count resets with the Cairo day");
  for (let i = 0; i < 5; i++) assert.ok((await C.createQuestion(store, owner, { text: `o${i}`, issue: null }, T0, ENV)).ok);
});

test("a follow-up counts against the cap too, and is refused before its photo is stored", async () => {
  const store = C.memoryStore();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await C.createQuestion(store, fitter, { text: `q${i}`, issue: null }, T0, ENV);
    assert.ok(r.ok);
    ids.push(r.thread.id);
  }
  const claim = await C.claimQuestion(store, ids[0], "laptop", T0, ENV);
  assert.ok(claim.ok && (await C.answerQuestion(store, ids[0], claim.claimId, "a", T0, ENV)).ok);
  const r = await C.followUp(store, fitter, ids[0], { text: "one more", photo: JPEG }, T0 + MIN, ENV);
  assert.equal(!r.ok && r.reason, "daily_cap");
});

test("a thread is its asker's: another fitter cannot read, write or see its photo; the owner can read", async () => {
  const { store, id } = await asked();
  const photoId = (await C.waitingQuestions(store, T0, 3, ENV))[0].messages[0].photoId!;
  assert.equal(await C.readThread(store, other, id, T0, ENV), null);
  assert.equal(await C.readPhoto(store, other, id, photoId, ENV), null);
  assert.deepEqual(await C.listThreads(store, other, T0, ENV), []);
  assert.equal((await C.retryQuestion(store, other, id, T0, ENV)).ok, false);
  const fu = await C.followUp(store, other, id, { text: "x" }, T0, ENV);
  assert.equal(!fu.ok && fu.reason, "not_found");
  assert.equal((await C.readThread(store, owner, id, T0, ENV))?.id, id);
  assert.ok(await C.readPhoto(store, owner, id, photoId, ENV));
  assert.equal(await C.readPhoto(store, fitter, id, "not-a-photo-of-this-thread", ENV), null);
});

test("photos: JPEG only, and not over the limit", async () => {
  const store = C.memoryStore();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const r1 = await C.createQuestion(store, fitter, { text: "x", photo: png, issue: null }, T0, ENV);
  assert.equal(!r1.ok && r1.reason, "bad_photo");
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  const r2 = await C.createQuestion(store, fitter, { text: "x", photo: big, issue: null }, T0, ENV);
  assert.equal(!r2.ok && r2.reason, "photo_too_large");
  const r3 = await C.createQuestion(store, fitter, { text: "", photo: null, issue: null }, T0, ENV);
  assert.equal(!r3.ok && r3.reason, "empty_question");
});

test("what is stored is ciphertext: no question, no email, no photo bytes in the clear", async () => {
  const { store, id } = await asked();
  const rec = (await store.getThread(id))!;
  const raw = JSON.stringify(rec) + Buffer.from(rec.blob, "base64").toString("latin1");
  for (const secret of ["فلاش", "fitter@example.com", "PQ 7", "غطاء"]) {
    assert.equal(raw.includes(secret), false, `«${secret}» is readable in the stored document`);
    assert.equal(Buffer.from(rec.blob, "base64").includes(Buffer.from(secret, "utf8")), false, `«${secret}» bytes are in the blob`);
  }
  const photoId = C.openThread(rec, ENV)!.messages[0].photoId!;
  const photo = (await store.getPhoto(photoId))!;
  assert.equal(Buffer.from(photo.blob, "base64").includes(Buffer.from(JPEG.subarray(3))), false);
  assert.equal(C.openThread(rec, { ...ENV, ASK_DATA_KEY: "z".repeat(48) }), null, "another key reads nothing");
});

test("an outsider with write access cannot forge an answer, move a blob, or fake the heartbeat", async () => {
  const { store, id } = await asked();
  const rec = (await store.getThread(id))!;

  // A hand-written document: ignored everywhere.
  await store.putThread({ id: "forged", uid: fitter.uid, status: "answered", updatedAt: T0, blob: Buffer.from('{"messages":[]}').toString("base64") });
  assert.equal(await C.readThread(store, fitter, "forged", T0, ENV), null);
  assert.equal((await C.listThreads(store, fitter, T0, ENV)).some((t) => t.id === "forged"), false);

  // A real blob copied under another id: the id is bound in, so it does not open.
  await store.putThread({ ...rec, id: "copied" });
  assert.equal(await C.readThread(store, fitter, "copied", T0, ENV), null);

  // The plain index fields rewritten: the blob decides, not the index.
  await store.putThread({ ...rec, uid: other.uid, status: "answered" });
  assert.equal(await C.readThread(store, other, id, T0, ENV), null, "re-pointing uid does not hand the thread over");
  assert.deepEqual(await C.listThreads(store, other, T0, ENV), []);
  assert.equal((await C.readThread(store, fitter, id, T0, ENV))?.status, "waiting", "the status shown comes from the blob");

  // The heartbeat.
  assert.equal(await C.lastBeat(store, ENV), null);
  await store.setBeat(Buffer.from(JSON.stringify({ at: T0 })).toString("base64"));
  assert.equal(await C.lastBeat(store, ENV), null, "a hand-written heartbeat is not a heartbeat");
  await C.beat(store, "laptop", T0, ENV);
  assert.equal(await C.lastBeat(store, ENV), T0);
});

test("a question asked while the laptop is off stays waiting, oldest first, until it is claimed", async () => {
  const store = C.memoryStore();
  const first = await asked(store, fitter, T0);
  const second = await asked(store, other, T0 + MIN);
  assert.equal(await C.lastBeat(store, ENV), null);
  const dayLater = T0 + 24 * 60 * MIN;
  assert.deepEqual((await C.waitingQuestions(store, dayLater, 10, ENV)).map((t) => t.id), [first.id, second.id]);
  assert.deepEqual((await C.waitingQuestions(store, dayLater, 1, ENV)).map((t) => t.id), [first.id]);
});

test("links to a photo or a recording are signed, bound and expire in ten minutes", () => {
  const link = X.signLink({ k: "photo", id: "p1", th: "t1" }, T0, ENV);
  assert.deepEqual(X.openLink(link, T0 + 9 * MIN, ENV), { k: "photo", id: "p1", th: "t1", exp: Math.floor(T0 / 1000) + 600 });
  assert.equal(X.openLink(link, T0 + 11 * MIN, ENV), null, "expired");
  const [body, sig] = link.split(".");
  const tampered = Buffer.from(JSON.stringify({ k: "photo", id: "p2", th: "t1", exp: 9_999_999_999 })).toString("base64url");
  assert.equal(X.openLink(`${tampered}.${sig}`, T0, ENV), null, "a changed body fails its signature");
  assert.equal(X.openLink(`${body}.${sig.slice(0, -2)}xx`, T0, ENV), null);
  assert.equal(X.openLink(link, T0, { ...ENV, ASK_DATA_KEY: "z".repeat(48) }), null);
  assert.equal(X.openLink("", T0, ENV), null);
});

test("the feature is off unless BOTH secrets are set and long", () => {
  assert.equal(X.askConfigured(ENV), true);
  assert.equal(X.askConfigured({ ...ENV, ASK_DATA_KEY: "" }), false);
  assert.equal(X.askConfigured({ ...ENV, ASK_LISTENER_TOKEN: "short" }), false);
  assert.equal(X.askConfigured({}), false);
  assert.throws(() => X.sealJson({ a: 1 }, "x", {}), /ask_not_configured/);
});
