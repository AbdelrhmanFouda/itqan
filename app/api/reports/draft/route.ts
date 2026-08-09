import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { buildOEEData } from "@/lib/oee-data";
import {
  cairoDay, generateReview, readCachedReview, writeCachedReview, rulesReview,
} from "@/lib/ai-review";
import { buildReportDraft, type DraftOEE, type DraftReview } from "@/lib/report-draft";
import { downtimeReasonAr } from "@/lib/prod-meta";

/**
 * PHASE 3 — pre-fill the monthly report.
 *
 * Returns a DRAFT only. It writes nothing: the owner reads it, edits it, and
 * saves through the existing POST /api/reports. There is no auto-save anywhere
 * in this path, deliberately.
 *
 * The AI half REUSES lib/ai-review.ts — the same generateReview() the
 * Performance page calls, keyed on the same (Cairo day, month) cache document.
 * So a month already reviewed today costs nothing extra, and the report can
 * never disagree with the Performance page. No second AI path, no second prompt.
 *
 * Without GEMINI_API_KEY (or ANTHROPIC_API_KEY) generateReview falls back to the
 * deterministic rulesReview(), which is also bilingual — so the draft still
 * arrives in Arabic, just less fluent.
 *
 * Guarded: it costs an LLM call and reads the whole OEE picture.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, reason: "bad_month" }, { status: 400 });
  }

  try {
    const data = await buildOEEData(month);
    const day = cairoDay();

    // Same cache document as the Performance page's month view.
    let envelope = await readCachedReview(day, month);
    if (!envelope) {
      const fresh = await generateReview(data, month, day);
      envelope = { ...fresh, day, scope: month };
      // Only cache a real model answer. Caching the rules fallback would pin the
      // whole day to it even after a key is added.
      if (fresh.provider !== "rules") await writeCachedReview(envelope);
    }

    const review: DraftReview = envelope?.review ?? rulesReview(data);
    const draft = buildReportDraft(month, data as unknown as DraftOEE, review, downtimeReasonAr);

    return NextResponse.json({
      ok: true,
      draft,
      meta: {
        provider: envelope?.provider ?? "rules",
        model: envelope?.model ?? null,
        runCount: data.runCount,
        availabilityMeasured: data.explain.availabilityMeasured,
        qualityMeasured: data.explain.qualityMeasured,
        staleOpen: data.readiness.staleOpen.length,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
