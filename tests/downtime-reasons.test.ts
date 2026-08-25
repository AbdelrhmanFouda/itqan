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
  downtimeReasonFromSheet, downtimeEstimatedFromSheet, normalizeArabic,
} from "../lib/prod-meta.ts";

test("the owner's ten reasons plus «أخرى», in the owner's order", () => {
  // 2026-08-22: «عدم وجود خامة», «لا يوجد أمر شغل» (the retired key revived) and
  // «كسر المصب» added at the owner's word, after «أخرى» reached 25 of 54 rows.
  assert.deepEqual(
    DOWNTIME_CAPTURE_REASONS.map((r) => r.key),
    ["Setup", "Nozzle burn", "Mold change", "Mold maintenance", "Maintenance",
     "Material drying", "No operator", "No material", "No order", "Sprue broken", "Other"],
  );
  assert.deepEqual(
    DOWNTIME_CAPTURE_REASONS.map((r) => r.ar),
    ["ضبط منتج", "حرق فونيه", "تغيير الاسطمبة", "صيانة الاسطمبة",
     "صيانة في الماكينة", "تجفيف خامة", "توقف بسبب عدم وجود عامل",
     "عدم وجود خامة", "لا يوجد أمر شغل", "كسر المصب", "أخرى"],
  );
  assert.equal(DOWNTIME_CAPTURE_REASONS.length, 11);
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
  // The two 2026-08-22 absence reasons are organisational for the same reason:
  // nothing broke — something was not provided. A broken sprue is a machine fault.
  assert.equal(isOrganisationalDowntime("No material"), true);
  assert.equal(isOrganisationalDowntime("No order"), true);
  assert.equal(isOrganisationalDowntime("Sprue broken"), false);
  assert.equal(isOrganisationalDowntime("Nozzle burn"), false);
  assert.equal(isOrganisationalDowntime("unknown"), false);
});

/* ---------------------------- retired keys -------------------------------- */

test("retired keys still resolve for display and grouping", () => {
  // They are gone from the buttons but remain in the sheet's own «سبب التوقف»
  // vocabulary, so anything typed there must still group and must not render as
  // a bare English key on an Arabic page. ("No order" left this list on
  // 2026-08-22 — it is a button again, same key, so its history groups with it.)
  for (const k of ["Breakdown", "Material", "Quality hold", "None"]) {
    assert.ok(!DOWNTIME_CAPTURE_REASONS.some((r) => r.key === k), `${k} should not be a button`);
    assert.ok(ALL_DOWNTIME_REASONS.some((r) => r.key === k), `${k} must still resolve`);
    assert.notEqual(downtimeReasonAr(k), k, `${k} has no Arabic label`);
  }
  assert.ok(DOWNTIME_CAPTURE_REASONS.some((r) => r.key === "No order"), "No order is a button again");
});

test("every reason in the sheet's own vocabulary resolves", () => {
  for (const k of DOWNTIME_REASONS) {
    assert.ok(ALL_DOWNTIME_REASONS.some((r) => r.key === k), `sheet reason "${k}" is ungroupable`);
  }
});

test("an unknown key degrades to itself rather than throwing", () => {
  assert.equal(downtimeReasonAr("Totally unknown"), "Totally unknown");
});

/* ------------- the sheet direction: «التوقفات»!C Arabic → key -------------- */
/**
 * Added 2026-08-14, when «التوقفات» became the store. Until then the mapping
 * only ran key → Arabic, which is the direction a WRITE needs; every READ needs
 * the reverse, and a word that resolves to nothing would land in «أخرى» and
 * move minutes from one bar of the Pareto to another without any error.
 */

test("every reason round-trips: key → Arabic → key", () => {
  // The property that has to hold for the Pareto to be trustworthy. It covers
  // the retired keys too, which are NOT in the sheet's dropdown but ARE in the
  // migrated history — «عطل» is 2,251 real minutes and «خامة» is 896.
  for (const r of ALL_DOWNTIME_REASONS) {
    assert.equal(downtimeReasonFromSheet(downtimeReasonAr(r.key)), r.key, `${r.key} did not survive the round trip`);
  }
  assert.equal(downtimeReasonFromSheet("عطل"), "Breakdown");
  assert.equal(downtimeReasonFromSheet("خامة"), "Material");
  assert.equal(downtimeReasonFromSheet("صيانة في الماكينة"), "Maintenance");
  assert.equal(downtimeReasonFromSheet("توقف بسبب عدم وجود عامل"), "No operator");
});

test("the mapping survives how Arabic is actually typed", () => {
  // A cell can carry a trailing tab (the known «زراير\t» case in this workbook),
  // harakat, tatweel, and either spelling of alef/ya/ta-marbuta. None of those
  // is a different reason.
  assert.equal(downtimeReasonFromSheet("تغيير الاسطمبة\t"), "Mold change");
  assert.equal(downtimeReasonFromSheet("  تغيير   الاسطمبة  "), "Mold change");
  assert.equal(downtimeReasonFromSheet("صيانة فى الماكينة"), "Maintenance", "ى for ي");
  assert.equal(downtimeReasonFromSheet("أخرى"), "Other");
  assert.equal(downtimeReasonFromSheet("اخرى"), "Other", "bare alef");
  assert.equal(downtimeReasonFromSheet("تَجفيف خامة"), "Material drying", "harakat");
  assert.equal(downtimeReasonFromSheet("تجفيــف خامة"), "Material drying", "tatweel");
});

test("an English key or label in the cell resolves too", () => {
  // Someone pasting an export back in, or the assistant writing a row.
  assert.equal(downtimeReasonFromSheet("Mold change"), "Mold change");
  assert.equal(downtimeReasonFromSheet("mold change"), "Mold change");
  assert.equal(downtimeReasonFromSheet("No operator"), "No operator");
  assert.equal(downtimeReasonFromSheet("Machine maintenance"), "Maintenance", "the English LABEL");
});

test("an unknown reason keeps its own name — it never becomes «أخرى»", () => {
  // Deliberate, and the same rule as jobStatusFromSheet. Folding an
  // unrecognised word into Other hides it; leaving it visible in the Pareto is
  // how anyone finds out the sheet has a word the app does not know. Unknown
  // keys already count as unplanned, so this cannot flatter anything either.
  assert.equal(downtimeReasonFromSheet("كهرباء"), "كهرباء");
  assert.equal(downtimeReasonFromSheet("something new"), "something new");
  assert.equal(isPlannedDowntime(downtimeReasonFromSheet("كهرباء")), false);
});

test("a blank «سبب التوقف» is empty, not a reason", () => {
  // «غير متاح / N/A» reaches this as "" (clean() in lib/sheets strips it). It
  // means NOT RECORDED. It must not become a value, and it must never be 0.
  for (const v of ["", "   ", undefined]) {
    assert.equal(downtimeReasonFromSheet(v as string), "");
  }
});

test("«تقديري؟» — نعم means the minutes are a reconstruction", () => {
  assert.equal(downtimeEstimatedFromSheet("نعم"), true);
  assert.equal(downtimeEstimatedFromSheet(" نعم "), true);
  assert.equal(downtimeEstimatedFromSheet("لا"), false);
  assert.equal(downtimeEstimatedFromSheet(""), false);
  assert.equal(downtimeEstimatedFromSheet(undefined), false);
  // Nothing else may quietly mark a measured stoppage as a guess.
  assert.equal(downtimeEstimatedFromSheet("ربما"), false);
});

test("normalizeArabic folds only spelling, never two different reasons together", () => {
  const folded = ALL_DOWNTIME_REASONS.map((r) => normalizeArabic(r.ar));
  assert.equal(new Set(folded).size, folded.length, "two reasons collapsed onto one key");
});
