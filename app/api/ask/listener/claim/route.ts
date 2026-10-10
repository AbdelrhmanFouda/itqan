import { NextRequest } from "next/server";
import { claimQuestion } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, requireListener, statusFor } from "@/lib/ask-guard";

/**
 * The listener takes one question: POST { threadId, listener? }.
 *
 *   200 { ok, claimId, expiresAt }   — yours for five minutes
 *   409 { reason: "already_claimed" } — another listener holds it
 *   409 { reason: "not_waiting" }     — answered, failed, or nothing to answer
 *
 * One Firestore transaction on the thread's document, so two listeners
 * asking in the same instant cannot both be told yes. The `claimId` is what
 * the answer must carry.
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
  if (!threadId) return askJson({ ok: false, reason: "no_thread" }, 400);
  try {
    const r = await claimQuestion(askStore(), threadId, String(b.listener ?? ""));
    if (!r.ok) return askJson(r, statusFor(r.reason));
    return askJson({ ok: true, threadId, claimId: r.claimId, expiresAt: r.expiresAt });
  } catch (err) {
    console.error("[ask] claim failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
