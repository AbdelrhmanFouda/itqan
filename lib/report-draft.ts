/**
 * PHASE 3 — the monthly report draft. Pure composition, no I/O and no imports,
 * so it is unit-testable (same rule as lib/oee.ts and lib/downtime.ts).
 *
 * /dashboard/reports was a blank manual form, which is exactly why it was never
 * filled in. This turns it into a DRAFT: the numbers and the AI review are
 * assembled into Arabic prose the owner then edits and explicitly saves.
 *
 * Two rules govern everything here:
 *  1. NOTHING is invented. Every number comes from buildOEEData(month). Where a
 *     value is unknown (jobs completed has no date in the sheet) the field is
 *     left EMPTY for the owner rather than guessed.
 *  2. Measured and assumed are never blurred. If availability or quality is not
 *     measured, or downtime minutes are an estimate, or stoppages were never
 *     closed, the draft says so in the text the owner will read.
 *
 * The AI half is REUSED from lib/ai-review.ts — the same generateReview() the
 * Performance page calls, sharing the same daily cache. There is deliberately no
 * second AI path, and no second prompt: that review is already bilingual, so the
 * Arabic here is its `.ar` half. With no API key the deterministic rulesReview()
 * fallback supplies Arabic too, so the draft still works.
 */

/* Minimal structural inputs — declared locally so this module imports nothing. */
export type DraftBi = { en: string; ar: string };
export type DraftFinding = { severity: "critical" | "warn" | "good" | "info"; en: string; ar: string };
export type DraftReview = { summary: DraftBi; findings: DraftFinding[]; actions: DraftBi[] };

export type DraftOEE = {
  overall: {
    oee: number; availability: number; performance: number; quality: number;
    performanceKnown: boolean;
    goodUnits: number; scrapUnits: number; downtimeMin: number; plannedMin: number;
  };
  downtime: { reason: string; minutes: number; planned?: boolean; organisational?: boolean }[];
  machines: { machine: string; oee: number; performanceKnown: boolean; weakest: string | null }[];
  readiness: {
    runs: number;
    downtimeEstimatedMin: number;
    downtimeEstimatedCount: number;
    downtimeUnallocatedMin: number;
    staleOpen: { machine: string; date: string; reason: string }[];
  };
  explain: {
    availabilityMeasured: boolean;
    qualityMeasured: boolean;
    plannedDowntimeMin?: number;
    unplannedDowntimeMin?: number;
    organisationalDowntimeMin?: number;
  };
  runCount: number;
};

export const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const int = (x: number) => Math.round(x).toLocaleString("en-US");

export type ReportDraft = {
  month: string;            // "1".."12"
  year: string;
  jobs_completed: string;   // deliberately blank — the sheet cannot tell us
  notes: string;
  issues: string;
  recommendations: string;
};

/**
 * Build the draft. `reasonAr` translates a canonical downtime key to the crew's
 * Arabic wording; it is injected so this module stays import-free.
 */
export function buildReportDraft(
  monthKey: string,                       // "YYYY-MM"
  d: DraftOEE,
  review: DraftReview | null,
  reasonAr: (key: string) => string,
): ReportDraft {
  const [yearStr, monthStr] = monthKey.split("-");
  const monthNum = Number(monthStr);
  const monthName = MONTHS_AR[monthNum - 1] ?? monthStr;
  const head = `${monthName} ${yearStr}`;
  const o = d.overall;

  /* ------------------------------- notes -------------------------------- */
  const notes: string[] = [`تقرير شهر ${head}`, ""];

  if (d.runCount === 0) {
    notes.push("لا توجد تشغيلات مسجلة لهذا الشهر.");
  } else {
    notes.push(
      `عدد التشغيلات: ${int(d.runCount)}`,
      `إنتاج سليم: ${int(o.goodUnits)} قطعة · هالك: ${int(o.scrapUnits)} قطعة`,
      o.performanceKnown
        ? `الكفاءة الكلية OEE: ${pct(o.oee)}`
        : "الكفاءة الكلية OEE: غير متاحة (زمن الدورة غير مسجل في «الرئيسي» لبعض المنتجات)",
      `الجاهزية: ${pct(o.availability)} · الأداء: ${
        o.performanceKnown ? pct(o.performance) : "غير متاح"
      } · الجودة: ${pct(o.quality)}`,
      `زمن التوقف المسجل: ${int(o.downtimeMin)} دقيقة من ${int(o.plannedMin)} دقيقة مخططة`,
    );

    // Honesty lines — these are the difference between a number and a guess.
    if (!d.explain.availabilityMeasured) {
      notes.push(
        "⚠ الجاهزية غير مقاسة: لا توجد توقفات مسجلة لهذا الشهر، لذلك الرقم مفترض والكفاءة الحقيقية على الأرجح أقل.",
      );
    }
    if (!d.explain.qualityMeasured) {
      notes.push("⚠ الجودة غير مقاسة: الهالك غير مسجل لهذا الشهر.");
    }
    if (d.readiness.downtimeEstimatedCount > 0) {
      notes.push(
        `ملاحظة: ${int(d.readiness.downtimeEstimatedMin)} دقيقة من زمن التوقف تقديرية ` +
          `(${int(d.readiness.downtimeEstimatedCount)} توقف اتقفل بعد نهاية الوردية، محدش ضغط «رجعت تشتغل»).`,
      );
    }
  }

  // The AI paragraph is labelled, and always comes AFTER the computed numbers.
  // Observed live: the model restated OEE as 54.7% while the digest said 52.7%.
  // The lines above are computed from the sheet and are the authoritative ones;
  // marking the prose makes a disagreement attributable instead of confusing.
  if (review?.summary.ar) notes.push("", `— ملخص المساعد الذكي (راجعه):`, review.summary.ar);

  /* ------------------------------- issues ------------------------------- */
  const issues: string[] = [];

  // Top downtime reasons — the Pareto, in the crew's own words.
  const top = d.downtime.slice(0, 5).filter((x) => x.minutes > 0);
  if (top.length > 0) {
    const total = d.downtime.reduce((s, x) => s + x.minutes, 0);
    issues.push("أهم أسباب التوقف:");
    for (const r of top) {
      const share = total > 0 ? ` (${((r.minutes / total) * 100).toFixed(0)}%)` : "";
      // Planned/unplanned is stated here, on the owner's page. It is never asked
      // of the worker — it is metadata on the reason itself.
      const kind = r.planned ? " — مخطط" : " — غير مخطط";
      issues.push(`• ${reasonAr(r.reason)} — ${int(r.minutes)} دقيقة${share}${kind}`);
    }
    issues.push("");
  }

  // How much of the stoppage time was avoidable.
  const plannedMin = d.explain.plannedDowntimeMin ?? 0;
  const unplannedMin = d.explain.unplannedDowntimeMin ?? 0;
  if (plannedMin + unplannedMin > 0) {
    const share = (unplannedMin / (plannedMin + unplannedMin)) * 100;
    issues.push(
      `التوقف المخطط: ${int(plannedMin)} دقيقة · غير المخطط: ${int(unplannedMin)} دقيقة ` +
        `(${share.toFixed(0)}% من وقت التوقف كان يمكن تفاديه).`,
      "",
    );
  }

  // «توقف بسبب عدم وجود عامل» is organisational, not mechanical — the fix is a
  // rota, not a spanner. It gets its own line so it cannot disappear inside a
  // per-machine breakdown where it would look like a machine fault.
  const orgMin = d.explain.organisationalDowntimeMin ?? 0;
  if (orgMin > 0) {
    issues.push(
      `⚠ ${int(orgMin)} دقيقة توقف سببها تنظيمي (مش عطل في الماكينة) — زي عدم وجود عامل. ` +
        "دي بتتحل بجدول الورديات مش بالصيانة.",
      "",
    );
  }

  // Stoppages nobody closed — they are MISSING from the numbers above.
  const stale = d.readiness.staleOpen;
  if (stale.length > 0) {
    issues.push(
      `⚠ ${int(stale.length)} توقف بدأ ومااتقفلش، وبالتالي غير محسوب في الجاهزية ` +
        "(زمن التوقف الحقيقي أعلى من الأرقام دي):",
    );
    for (const e of stale.slice(0, 8)) {
      issues.push(`• ${e.machine} — ${reasonAr(e.reason)} — من ${e.date}`);
    }
    if (stale.length > 8) issues.push(`• …و${int(stale.length - 8)} غيرها`);
    issues.push("");
  }

  if (d.readiness.downtimeUnallocatedMin > 0) {
    issues.push(
      `⚠ ${int(d.readiness.downtimeUnallocatedMin)} دقيقة توقف مسجلة بدون صف إنتاج مقابل لها ` +
        "(أو أطول من زمن الوردية) — محتاجة مراجعة.",
      "",
    );
  }

  // AI findings worth acting on.
  const notable = (review?.findings ?? []).filter(
    (f) => f.severity === "critical" || f.severity === "warn",
  );
  if (notable.length > 0) {
    issues.push("— ملاحظات المساعد الذكي (راجعها):");
    for (const f of notable) issues.push(`• ${f.ar}`);
  }

  /* --------------------------- recommendations -------------------------- */
  const recs: string[] = [];
  for (const a of review?.actions ?? []) if (a.ar) recs.push(`• ${a.ar}`);
  if (stale.length > 0) {
    recs.push("• اقفل التوقفات المفتوحة من صفحة «التوقفات» عشان الأرقام تبقى مظبوطة.");
  }
  if (!d.explain.availabilityMeasured && d.runCount > 0) {
    recs.push("• سجّل التوقفات من صفحة «التوقفات» عشان الجاهزية تبقى مقاسة مش مفترضة.");
  }

  return {
    month: String(monthNum),
    year: yearStr,
    // The sheet has no completion date on «أوامر العمل», so this cannot be
    // derived. Left blank on purpose for the owner to fill.
    jobs_completed: "",
    notes: notes.join("\n").trim(),
    issues: issues.join("\n").trim(),
    recommendations: recs.join("\n").trim(),
  };
}
