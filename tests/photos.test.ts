/**
 * Hourly log-sheet photo paths and sizing. Run with `npm test`.
 *
 * The path is generated on a phone and checked on the server, so the two rules
 * (build + validate) have to agree exactly — that pairing is what these cover.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hourlyPhotoPath, isValidPhotoPath, machineSlug, fitWithin,
  PHOTO_MAX_EDGE, PHOTO_MAX_BYTES,
} from "../lib/photos.ts";

test("a machine label becomes a safe path segment", () => {
  assert.equal(machineSlug("PQ 7 — 100"), "pq-7-100");
  assert.equal(machineSlug("PQPI 4 — 220"), "pqpi-4-220");
  assert.equal(machineSlug("220 — بدون كود"), "220");
  assert.equal(machineSlug(""), "unknown");
});

test("PQ 5 and PQ 7 stay different folders — tonnage alone never identifies a machine", () => {
  assert.notEqual(machineSlug("PQ 5 — 100"), machineSlug("PQ 7 — 100"));
});

test("Arabic-Indic digits fold, so one machine cannot land in two folders", () => {
  assert.equal(machineSlug("PQ ٧ — ١٠٠"), machineSlug("PQ 7 — 100"));
});

test("the built path is always accepted by the server's validator", () => {
  for (const m of ["PQ 7 — 100", "PQPI 4 — 220", "220 — بدون كود", "PQ ٧ — ١٠٠"]) {
    const p = hourlyPhotoPath("2026-08-10", m, 1786500000000);
    assert.ok(isValidPhotoPath(p), `${p} rejected`);
  }
});

test("path shape is date-first, so a day lists by prefix", () => {
  assert.equal(
    hourlyPhotoPath("2026-08-10", "PQ 7 — 100", 1786500000000),
    "hourly/2026-08-10/pq-7-100/1786500000000.jpg",
  );
});

test("a bad date or timestamp throws rather than writing somewhere odd", () => {
  assert.throws(() => hourlyPhotoPath("10/08/2026", "PQ 7 — 100", 1), /bad_date/);
  assert.throws(() => hourlyPhotoPath("", "PQ 7 — 100", 1), /bad_date/);
  assert.throws(() => hourlyPhotoPath("2026-08-10", "PQ 7 — 100", 0), /bad_timestamp/);
  assert.throws(() => hourlyPhotoPath("2026-08-10", "PQ 7 — 100", NaN), /bad_timestamp/);
});

test("the validator rejects anything outside the hourly prefix", () => {
  for (const bad of [
    "",
    "hourly/2026-08-10/pq-7-100/x.jpg",          // non-numeric name
    "hourly/2026-8-10/pq-7-100/1.jpg",           // unpadded date
    "hourly/2026-08-10/pq-7-100/1.png",          // wrong extension
    "other/2026-08-10/pq-7-100/1.jpg",           // different prefix
    "hourly/2026-08-10/PQ 7/1.jpg",              // unslugged machine
    "../hourly/2026-08-10/pq-7-100/1.jpg",       // traversal
    "hourly/2026-08-10/pq-7-100/../../1.jpg",
  ]) {
    assert.equal(isValidPhotoPath(bad), false, `should reject: ${bad}`);
  }
});

test("downscaling caps the long edge and keeps the aspect ratio", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  const r = fitWithin(4032, 3024);
  assert.equal(Math.max(r.width, r.height), PHOTO_MAX_EDGE);
});

test("a small image is left alone, never upscaled into a bigger file", () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 1200), { width: 1600, height: 1200 });
});

test("degenerate dimensions are safe", () => {
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(-5, 100), { width: 0, height: 0 });
});

test("the long edge is big enough to keep a log sheet readable", () => {
  // This is a document, not a thumbnail — the numbers on it must survive.
  assert.ok(PHOTO_MAX_EDGE >= 1200);
  assert.ok(PHOTO_MAX_BYTES >= 1024 * 1024);
});
