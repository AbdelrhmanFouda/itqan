import { NextRequest } from "next/server";
import { answerQuestion, failQuestion } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, requireListener, statusFor } from "@/lib/ask-guard";

/**
 * The listener is done with a question it claimed:
 *
 *   POST { threadId, claimId, answer }   — the answer, Arabic, plain text
 *   POST { threadId, claimId, failure }  — it could not answer, and why
 *
 *   200 { ok }
 *   409 { reason: "claim_lost" }        — the five minutes passed and another
 *                                         listener claimed it; drop this one
 *   409 { reason: "already_answered" }  — a replay; nothing was written
 *
 * A claim that lapsed but that nobody else took is still honoured: a late
 * answer beats none. A failure leaves the question in the thread; the person
 * sees the reason and a «حاول تاني» button that puts it back in the queue.
 */
export async function POST(req: NextRequest) {
  const g = requireListener(req);
  if ("deny" in g) return g.deny;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return askJson({ ok: false, reason: "bad_body" }, 400);
  }
  const threadId = String(b?.threadId ?? "").trim();
  const claimId = String(b?.claimId ?? "").trim();
  if (!threadId || !claimId) return askJson({ ok: false, reason: "no_claim" }, 400);
  const failed = typeof b.failure === "string" && b.failure.trim() !== "";
  if (!failed && typeof b.answer !== "string") return askJson({ ok: false, reason: "empty_answer" }, 400);
  try {
    const r = failed
      ? await failQuestion(askStore(), threadId, claimId, String(b.failure))
      : await answerQuestion(askStore(), threadId, claimId, String(b.answer));
    if (!r.ok) return askJson(r, statusFor(r.reason));
    console.log(`[ask] ${failed ? "failure" : "answer"} posted for ${threadId}`);
    return askJson({ ok: true, threadId, status: r.thread.status });
  } catch (err) {
    console.error("[ask] answer failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
