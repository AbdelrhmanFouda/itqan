/**
 * The issues log's rules (lib/issues.ts) — voice notes, Drive links, row
 * identity, the list filters. Pure, so pinned directly.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickRecordingMime, extFor, isAudioMime, audioFileName, formatSeconds,
  driveIdFromLink, driveViewLink, audioRef, isDriveId,
  hasProblem, sameIssue, diffIssue, dayLabel, cairoToday, matchesIssue, foldArabic, countByStatus,
  MAX_AUDIO_BYTES, MAX_REQUEST_BYTES, MAX_AUDIO_SECONDS, NEXT_STATUS, ISSUE_STATUSES,
} from "../lib/issues.ts";

/* ------------------------------- recording ------------------------------- */

test("the recorder prefers WebM/Opus (Chrome's native) and falls back to mp4 (Safari, AAC)", () => {
  // Chrome supports both; its "audio/mp4" is Opus in an MP4 box (measured
  // 2026-09-09), so WebM/Opus must win there.
  assert.equal(pickRecordingMime(() => true), "audio/webm;codecs=opus");
  // Safari: no WebM at all → mp4, recorded as AAC.
  assert.equal(pickRecordingMime((m) => m === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecordingMime((m) => m === "audio/webm"), "audio/webm");
  assert.equal(pickRecordingMime((m) => m === "audio/ogg;codecs=opus"), "audio/ogg;codecs=opus");
  assert.equal(pickRecordingMime(() => false), "");
  // An old browser whose isTypeSupported throws must not take the page down.
  assert.equal(pickRecordingMime(() => { throw new Error("no"); }), "");
});

test("file extensions follow the recording type", () => {
  assert.equal(extFor("audio/mp4"), "m4a");
  assert.equal(extFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extFor("audio/ogg;codecs=opus"), "ogg");
  assert.equal(extFor("audio/wav"), "wav");
  assert.equal(extFor("audio/mpeg"), "mp3");
  assert.equal(extFor(""), "bin");
});

test("only audio types are accepted from a phone", () => {
  assert.equal(isAudioMime("audio/webm;codecs=opus"), true);
  assert.equal(isAudioMime("audio/mp4"), true);
  assert.equal(isAudioMime("video/mp4"), false);
  assert.equal(isAudioMime("application/octet-stream"), false);
  assert.equal(isAudioMime(""), false);
});

test("a recording's Drive name says what, which machine and when", () => {
  const at = new Date(2026, 8, 9, 14, 30, 5);
  assert.equal(audioFileName("issue", "PQ 7 — 100", "2026-09-09", at, "audio/webm;codecs=opus"),
    "عطل PQ 7 — 100 2026-09-09 14-30-05.webm");
  assert.equal(audioFileName("solution", "", "2026-09-09", at, "audio/mp4"),
    "حل 2026-09-09 14-30-05.m4a");
  // Characters a Windows download would refuse are dropped from the label.
  assert.equal(audioFileName("issue", "PQ/7: 100", "", at, "audio/ogg"),
    "عطل PQ 7 100 بدون تاريخ 14-30-05.ogg");
});

test("seconds format as m:ss", () => {
  assert.equal(formatSeconds(0), "0:00");
  assert.equal(formatSeconds(7), "0:07");
  assert.equal(formatSeconds(90), "1:30");
  assert.equal(formatSeconds(119.9), "1:59");
  assert.equal(formatSeconds(-3), "0:00");
  assert.equal(formatSeconds(NaN), "0:00");
});

test("the size caps leave two full clips under Vercel's 4.5 MB body limit", () => {
  assert.ok(MAX_AUDIO_BYTES < MAX_REQUEST_BYTES);
  assert.ok(MAX_REQUEST_BYTES < 4_500_000);
  assert.equal(MAX_AUDIO_SECONDS, 120);
});

/* ----------------------------- Drive links ------------------------------- */

test("the Drive id is read out of every link shape the cell may hold", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  assert.equal(driveIdFromLink(`https://drive.google.com/file/d/${id}/view`), id);
  assert.equal(driveIdFromLink(`https://drive.google.com/file/d/${id}/view?usp=drivesdk`), id);
  assert.equal(driveIdFromLink(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveIdFromLink(`https://drive.google.com/uc?export=download&id=${id}`), id);
  assert.equal(driveIdFromLink(`  ${id}  `), id);
  assert.equal(driveIdFromLink(""), "");
  assert.equal(driveIdFromLink("تسجيل صوتي"), "");
  assert.equal(driveIdFromLink("short"), "");
  assert.equal(driveViewLink(id), `https://drive.google.com/file/d/${id}/view`);
  assert.deepEqual(audioRef(driveViewLink(id)), { id, url: driveViewLink(id) });
  assert.equal(audioRef(""), null);
  assert.equal(isDriveId(id), true);
  assert.equal(isDriveId("../etc/passwd"), false);
  assert.equal(isDriveId(""), false);
});

/* --------------------------- what a row needs ---------------------------- */

test("a new issue needs a description or a recording of one", () => {
  assert.equal(hasProblem("لايوجد عامل", false), true);
  assert.equal(hasProblem("", true), true);
  assert.equal(hasProblem("   ", false), false);
  assert.equal(hasProblem(undefined, false), false);
});

/* -------------------------- recognising a row ---------------------------- */

test("a row is recognised by the fields the caller saw, whitespace and case aside", () => {
  const fresh = { date: "2026-08-23", machine: "PQ 7 — 100", product: "حرف U", description: "عدم وجود عامل", issueAudio: "" };
  assert.equal(sameIssue({ date: "2026-08-23", machine: "PQ 7 — 100" }, fresh), true);
  assert.equal(sameIssue({ date: "2026-08-23", machine: "pq 7 —  100", description: " عدم وجود عامل " }, fresh), true);
  // a shifted row: same date, different machine
  assert.equal(sameIssue({ date: "2026-08-23", machine: "PQ 5 — 100" }, fresh), false);
  // an audio-only issue is recognised by its recording
  assert.equal(sameIssue({ date: "2026-08-23", machine: "PQ 7 — 100", issueAudio: "abc" }, fresh), false);
  assert.equal(sameIssue({ date: "2026-08-23", machine: "PQ 7 — 100", issueAudio: "" }, fresh), true);
  // date and machine are the minimum
  assert.equal(sameIssue({ machine: "PQ 7 — 100" }, fresh), false);
  assert.equal(sameIssue({ date: "2026-08-23" }, fresh), false);
});

test("diffIssue sends only what changed", () => {
  const before = { description: "a", action: "", status: "مفتوح", note: "" };
  assert.deepEqual(diffIssue(before, { ...before }), {});
  assert.deepEqual(diffIssue(before, { ...before, action: "b", status: "تم" }), { action: "b", status: "تم" });
  // clearing a field IS a change
  assert.deepEqual(diffIssue(before, { ...before, description: "" }), { description: "" });
});

/* ------------------------------- the list -------------------------------- */

test("today / yesterday labels, else the date", () => {
  assert.equal(dayLabel("2026-09-09", "2026-09-09"), "today");
  assert.equal(dayLabel("2026-09-08", "2026-09-09"), "yesterday");
  assert.equal(dayLabel("2026-09-07", "2026-09-09"), null);
  assert.equal(dayLabel("2026-08-31", "2026-09-01"), "yesterday");
  assert.equal(dayLabel("2026-09-10", "2026-09-09"), null);
  assert.equal(dayLabel("19/07/2026", "2026-09-09"), null);
  assert.match(cairoToday(), /^\d{4}-\d{2}-\d{2}$/);
  // 2026-09-09 01:30 UTC is 04:30 in Cairo — same calendar day; 22:30 UTC is already the 10th.
  assert.equal(cairoToday(Date.UTC(2026, 8, 9, 1, 30)), "2026-09-09");
  assert.equal(cairoToday(Date.UTC(2026, 8, 9, 22, 30)), "2026-09-10");
});

const issue = {
  machine: "PQ 7 — 100", product: "حرف U", category: "ماكينة", description: "عدم وجود عامل",
  action: "وجود عامل", note: "", status: "تم", date: "2026-08-23", issueAudio: null, solutionAudio: null,
};

test("filters: status, machine, category and a folded multi-term search", () => {
  assert.equal(matchesIssue(issue, {}), true);
  assert.equal(matchesIssue(issue, { status: "تم" }), true);
  assert.equal(matchesIssue(issue, { status: "مفتوح" }), false);
  assert.equal(matchesIssue(issue, { machine: "PQ 7 — 100" }), true);
  assert.equal(matchesIssue(issue, { machine: "PQ 5 — 100" }), false);
  assert.equal(matchesIssue(issue, { category: "ماكينة" }), true);
  assert.equal(matchesIssue(issue, { category: "خامة" }), false);
  assert.equal(matchesIssue(issue, { query: "عامل" }), true);
  assert.equal(matchesIssue(issue, { query: "PQ 7 عامل" }), true);
  assert.equal(matchesIssue(issue, { query: "pq 7" }), true);
  assert.equal(matchesIssue(issue, { query: "خامة" }), false);
  // «إسطمبة» finds «اسطمبه»
  assert.equal(matchesIssue({ ...issue, description: "كسر في الاسطمبه" }, { query: "إسطمبة" }), true);
  assert.equal(foldArabic("إسطمبةٌ ىـ ٣"), "اسطمبه ي 3");
});

test("the three tiles count every status, and an unknown one counts as open", () => {
  assert.deepEqual(countByStatus([
    { status: "مفتوح" }, { status: "تم" }, { status: "تم" }, { status: "قيد التنفيذ" }, { status: "" },
  ]), { "مفتوح": 2, "قيد التنفيذ": 1, "تم": 2 });
  for (const s of ISSUE_STATUSES) assert.ok(NEXT_STATUS[s], `${s} has a next status`);
});
