import { NextRequest } from "next/server";
import { ONLINE_WINDOW_MS } from "@/lib/ask";
import { beat } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, requireListener } from "@/lib/ask-guard";

/**
 * «Claude متصل» — the listener says it is there: POST { listener? }, once a
 * minute. The page shows the green light while the last beat is under three
 * minutes old. The time is stamped HERE; the laptop's clock is not trusted.
 */
export async function POST(req: NextRequest) {
  const g = requireListener(req);
  if ("deny" in g) return g.deny;
  let listener = "";
  try {
    const b = (await req.json()) as Record<string, unknown>;
    listener = String(b?.listener ?? "");
  } catch {
    /* an empty body is a valid heartbeat */
  }
  try {
    const at = await beat(askStore(), listener);
    return askJson({ ok: true, at, onlineWindowMs: ONLINE_WINDOW_MS });
  } catch (err) {
    console.error("[ask] heartbeat failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
