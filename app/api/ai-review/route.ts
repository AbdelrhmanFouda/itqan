import { NextRequest, NextResponse } from "next/server";
import { buildOEEData } from "@/lib/oee-data";
import {
  cairoDay, generateReview, pickProvider, readCachedReview, writeCachedReview,
} from "@/lib/ai-review";

/**
 * Daily AI review of the production data.
 *
 * GET /api/ai-review?month=YYYY-MM        → today's review (generated once per
 *                                           Cairo day per period, then cached)
 * GET /api/ai-review?month=...&refresh=1  → force regeneration now
 *
 * The review is grounded in exactly the same dataset as /api/oee
 * (lib/oee-data.ts), so the narrative can never disagree with the charts.
 */
export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month");
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const scope = month || "all";
    const day = cairoDay();
    const llmConfigured = pickProvider() !== null;

    if (!refresh) {
      const cached = await readCachedReview(day, scope);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true, llmConfigured, configured: true });
      }
    }

    const data = await buildOEEData(month);
    const env = await generateReview(data, scope, day);
    // Cache only if there was actually data (an empty-period review is cheap
    // to recompute and shouldn't pin "no data" for the rest of the day).
    if (data.runCount > 0) await writeCachedReview(env);

    return NextResponse.json({ ...env, cached: false, llmConfigured, configured: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { review: null, provider: null, model: null, generatedAt: null, cached: false, llmConfigured: false, configured: false },
      { status: 200 },
    );
  }
}
