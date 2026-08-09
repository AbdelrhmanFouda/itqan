/**
 * Monthly-report draft composition. Run with `npm test`.
 *
 * The properties that matter: the draft never invents a number, and it never
 * lets an assumption read as a measurement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportDraft, type DraftOEE, type DraftReview } from "../lib/report-draft.ts";

const reasonAr = (k: string) =>
  ({ "Mold change": "تغيير اسطمبة", Breakdown: "مش شغالة", Material: "خامة خلصت" }[k] ?? k);

const base = (over: Partial<DraftOEE> = {}): DraftOEE => ({
  overall: {
    oee: 0.527, availability: 1, performance: 0.643, quality: 0.819,
    performanceKnown: true,
    goodUnits: 331854, scrapUnits: 73553, downtimeMin: 0, plannedMin: 93600,
  },
  downtime: [],
  machines: [],
  readiness: {
    runs: 130, downtimeEstimatedMin: 0, downtimeEstimatedCount: 0,
    downtimeUnallocatedMin: 0, staleOpen: [],
  },
  explain: { availabilityMeasured: false, qualityMeasured: true },
  runCount: 130,
  ...over,
});

const review: DraftReview = {
  summary: { en: "August was steady.", ar: "أغسطس كان مستقر." },
  findings: [
    { severity: "critical", en: "Scrap is high", ar: "الهالك عالي" },
    { severity: "good", en: "No breakdowns", ar: "مفيش أعطال" },
    { severity: "warn", en: "PQ 4 is slow", ar: "PQ 4 بطيئة" },
  ],
  actions: [{ en: "Check the mold", ar: "افحص الاسطمبة" }],
};

test("draft is Arabic and carries the month, the numbers and the AI summary", () => {
  const d = buildReportDraft("2026-08", base(), review, reasonAr);
  assert.equal(d.month, "8");
  assert.equal(d.year, "2026");
  assert.ok(d.notes.includes("أغسطس 2026"));
  assert.ok(d.notes.includes("331,854"), "good units present");
  assert.ok(d.notes.includes("81.9%"), "quality present");
  assert.ok(d.notes.includes("أغسطس كان مستقر."), "AI summary reused, in Arabic");
});

test("AI prose is labelled and always follows the computed numbers", () => {
  // Live, Gemini restated OEE as 54.7% while the digest said 52.7%. The computed
  // lines are authoritative, so the model's text must be attributable.
  const d = buildReportDraft("2026-08", base(), review, reasonAr);
  assert.ok(d.notes.includes("ملخص المساعد الذكي"), "summary is labelled");
  assert.ok(
    d.notes.indexOf("52.7%") < d.notes.indexOf("أغسطس كان مستقر."),
    "computed numbers come before the prose",
  );
  assert.ok(d.issues.includes("ملاحظات المساعد الذكي"), "findings are labelled too");
});

test("jobs_completed is left EMPTY — the sheet cannot tell us", () => {
  assert.equal(buildReportDraft("2026-08", base(), review, reasonAr).jobs_completed, "");
});

test("an unmeasured factor is called out, not quietly reported as 100%", () => {
  const d = buildReportDraft("2026-08", base(), review, reasonAr);
  assert.ok(d.notes.includes("الجاهزية غير مقاسة"), "availability flagged as assumed");
  assert.ok(!d.notes.includes("الجودة غير مقاسة"), "quality IS measured here, so no flag");
});

test("top downtime reasons appear in the crew's Arabic, with shares", () => {
  const d = buildReportDraft(
    "2026-08",
    base({ downtime: [
      { reason: "Mold change", minutes: 300 },
      { reason: "Breakdown", minutes: 100 },
    ] }),
    review, reasonAr,
  );
  assert.ok(d.issues.includes("تغيير اسطمبة"));
  assert.ok(d.issues.includes("300"));
  assert.ok(d.issues.includes("75%"), "300 of 400 minutes");
});

test("stoppages never closed are named as MISSING from the numbers", () => {
  const d = buildReportDraft(
    "2026-08",
    base({ readiness: { ...base().readiness, staleOpen: [
      { machine: "PQ 7 — 100", date: "2026-08-03", reason: "Breakdown" },
    ] } }),
    review, reasonAr,
  );
  assert.ok(d.issues.includes("مااتقفلش"), "flagged in issues");
  assert.ok(d.issues.includes("PQ 7 — 100"));
  assert.ok(d.recommendations.includes("اقفل التوقفات"), "and an action to fix it");
});

test("estimated minutes are disclosed in the notes", () => {
  const d = buildReportDraft(
    "2026-08",
    base({ readiness: { ...base().readiness, downtimeEstimatedMin: 240, downtimeEstimatedCount: 2 } }),
    review, reasonAr,
  );
  assert.ok(d.notes.includes("تقديرية"));
  assert.ok(d.notes.includes("240"));
});

test("unallocated downtime is surfaced for review", () => {
  const d = buildReportDraft(
    "2026-08",
    base({ readiness: { ...base().readiness, downtimeUnallocatedMin: 90 } }),
    review, reasonAr,
  );
  assert.ok(d.issues.includes("90"));
  assert.ok(d.issues.includes("مراجعة"));
});

test("only critical/warn findings become issues — 'good' is not a problem", () => {
  const d = buildReportDraft("2026-08", base(), review, reasonAr);
  assert.ok(d.issues.includes("الهالك عالي"));
  assert.ok(d.issues.includes("PQ 4 بطيئة"));
  assert.ok(!d.issues.includes("مفيش أعطال"));
});

test("it works with NO review at all (no API key, rules unavailable)", () => {
  const d = buildReportDraft("2026-08", base(), null, reasonAr);
  assert.ok(d.notes.includes("أغسطس 2026"));
  assert.ok(d.notes.includes("331,854"));
  assert.equal(d.recommendations.includes("سجّل التوقفات"), true, "still advises logging downtime");
});

test("an empty month says so instead of printing zeros as achievement", () => {
  const d = buildReportDraft(
    "2026-01",
    base({ runCount: 0, overall: { ...base().overall, goodUnits: 0, scrapUnits: 0 } }),
    null, reasonAr,
  );
  assert.ok(d.notes.includes("لا توجد تشغيلات مسجلة"));
  assert.ok(!d.notes.includes("OEE"));
});

test("unknown performance is reported as unavailable, not as zero", () => {
  const d = buildReportDraft(
    "2026-08",
    base({ overall: { ...base().overall, performanceKnown: false, oee: 0 } }),
    null, reasonAr,
  );
  assert.ok(d.notes.includes("غير متاحة"));
  assert.ok(!d.notes.includes("OEE: 0.0%"));
});
