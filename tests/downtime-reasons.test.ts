/**
 * The downtime reason list, and the promise that the planned/unplanned flag
 * never reaches the shop floor. Run with `npm test`.
 *
 * The worker's flow is machine → reason → start → stop. These tests exist to
 * make it hard to accidentally grow that: one flat list, Arabic labels, no
 * grouping key the UI could sort into sections, no English on the buttons.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNTIME_CAPTURE_REASONS, ALL_DOWNTIME_REASONS, DOWNTIME_REASONS,
  downtimeReasonAr, isPlannedDowntime, isOrganisationalDowntime,
} from "../lib/prod-meta.ts";

test("the owner's seven reasons plus «أخرى», in the owner's order", () => {
  assert.deepEqual(
    DOWNTIME_CAPTURE_REASONS.map((r) => r.key),
    ["Setup", "Nozzle burn", "Mold change", "Mold maintenance", "Maintenance",
     "Material drying", "No operator", "Other"],
  );
  assert.deepEqual(
    DOWNTIME_CAPTURE_REASONS.map((r) => r.ar),
    ["ضبط منتج", "حرق فونيه", "تغيير الاسطمبة", "صيانة الاسطمبة",
     "صيانة في الماكينة", "تجفيف خامة", "توقف بسبب عدم وجود عامل", "أخرى"],
  );
  assert.equal(DOWNTIME_CAPTURE_REASONS.length, 8);
  assert.equal(DOWNTIME_CAPTURE_REASONS[DOWNTIME_CAPTURE_REASONS.length - 1].key, "Other",
    "«أخرى» stays last");
});

test("every button has a non-empty ARABIC label — the floor never sees English", () => {
  for (const r of DOWNTIME_CAPTURE_REASONS) {
    assert.ok(r.ar.trim().length > 0, `${r.key} has no Arabic label`);
    assert.ok(/[؀-ۿ]/.test(r.ar), `${r.key} label is not Arabic: ${r.ar}`);
  }
});

test("keys are stable English and unique, so wording can change later", () => {
  const keys = DOWNTIME_CAPTURE_REASONS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate key");
  for (const k of keys) assert.ok(/^[\x20-\x7E]+$/.test(k), `${k} is not a plain ASCII key`);
});

test("the three pre-existing keys are reused, not re-minted", () => {
  for (const k of ["Mold change", "Maintenance", "Other"]) {
    assert.ok(DOWNTIME_CAPTURE_REASONS.some((r) => r.key === k), `${k} should keep its key`);
  }
});

/* ------------------------- planned is metadata only ----------------------- */

test("planned/unplanned matches the owner's classification", () => {
  const planned = DOWNTIME_CAPTURE_REASONS.filter((r) => r.planned).map((r) => r.key);
  assert.deepEqual(planned.sort(), ["Material drying", "Mold change", "Setup"]);
});

test("planned is metadata on the reason, never a choice offered to the worker", () => {
  // Nothing in the capture list carries a group/section/category field the UI
  // could render as a heading or a second step. If someone adds one, this fails.
  const allowed = new Set(["key", "ar", "en", "planned", "organisational"]);
  for (const r of DOWNTIME_CAPTURE_REASONS) {
    for (const k of Object.keys(r)) {
      assert.ok(allowed.has(k), `unexpected field "${k}" on ${r.key} — is the flow growing?`);
    }
  }
  // And the list is FLAT: a plain array, not buckets.
  assert.ok(Array.isArray(DOWNTIME_CAPTURE_REASONS));
  assert.ok(DOWNTIME_CAPTURE_REASONS.every((r) => typeof r.key === "string"));
});

test("an unknown reason counts as UNPLANNED, never as scheduled", () => {
  // Calling an unrecognised stoppage "planned" would flatter the avoidable
  // number, so the default has to fall the other way.
  assert.equal(isPlannedDowntime("something nobody defined"), false);
  assert.equal(isPlannedDowntime(""), false);
  assert.equal(isPlannedDowntime("Setup"), true);
  assert.equal(isPlannedDowntime("Nozzle burn"), false);
});

test("«عدم وجود عامل» is flagged organisational so the report can single it out", () => {
  assert.equal(isOrganisationalDowntime("No operator"), true);
  assert.equal(isOrganisationalDowntime("Nozzle burn"), false);
  assert.equal(isOrganisationalDowntime("unknown"), false);
});

/* ---------------------------- retired keys -------------------------------- */

test("retired keys still resolve for display and grouping", () => {
  // They are gone from the buttons but remain in the sheet's own «سبب التوقف»
  // vocabulary, so anything typed there must still group and must not render as
  // a bare English key on an Arabic page.
  for (const k of ["Breakdown", "Material", "No order", "Quality hold", "None"]) {
    assert.ok(!DOWNTIME_CAPTURE_REASONS.some((r) => r.key === k), `${k} should not be a button`);
    assert.ok(ALL_DOWNTIME_REASONS.some((r) => r.key === k), `${k} must still resolve`);
    assert.notEqual(downtimeReasonAr(k), k, `${k} has no Arabic label`);
  }
});

test("every reason in the sheet's own vocabulary resolves", () => {
  for (const k of DOWNTIME_REASONS) {
    assert.ok(ALL_DOWNTIME_REASONS.some((r) => r.key === k), `sheet reason "${k}" is ungroupable`);
  }
});

test("an unknown key degrades to itself rather than throwing", () => {
  assert.equal(downtimeReasonAr("Totally unknown"), "Totally unknown");
});
