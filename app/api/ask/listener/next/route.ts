import { NextRequest } from "next/server";
import { CLAIM_TTL_MS } from "@/lib/ask";
import { waitingQuestions } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, requireListener } from "@/lib/ask-guard";
import { listenerQuestion } from "@/lib/ask-listener";
import { originFrom } from "@/lib/mcp-auth";

/**
 * The listener asks: what is waiting? GET ?limit=1..10 (default 3).
 *
 * Oldest first. Each question arrives whole — thread, issue, the sheet's
 * history, links — and is NOT claimed by being read: the listener claims the
 * one it is about to answer (POST /api/ask/listener/claim). A question claimed
 * more than five minutes ago and never answered is listed here again.
 *
 * The sheet reads behind `history` share one six-second budget; past it the
 * question is handed over with `historyMissing: true`.
 */
export async function GET(req: NextRequest) {
  const g = requireListener(req);
  if ("deny" in g) return g.deny;
  try {
    const now = Date.now();
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 3;
    const waiting = await waitingQuestions(askStore(), now, limit);
    const origin = originFrom(req.headers, req.nextUrl.origin);
    const questions = await Promise.all(waiting.map((t) => listenerQuestion(t, origin, now)));
    return askJson({ ok: true, now, claimTtlMs: CLAIM_TTL_MS, questions });
  } catch (err) {
    console.error("[ask] listener next failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
