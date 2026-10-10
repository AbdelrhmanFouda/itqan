import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { askConfigured } from "@/lib/ask-crypto";
import { readPhoto } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, notConfigured } from "@/lib/ask-guard";

/**
 * One photo of a thread, for the chat screen: GET ?thread=<id>&id=<photo id>.
 *
 * Guarded like the thread itself — the asker, or owner/manager — and only a
 * photo that thread actually carries. The bytes are decrypted here; in
 * Firestore they are ciphertext. The page fetches with a token and shows an
 * object URL, because an <img src> cannot carry a header.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req, ["maintenance"]);
  if ("deny" in g) return g.deny;
  if (!askConfigured()) return notConfigured();
  try {
    const thread = req.nextUrl.searchParams.get("thread") || "";
    const id = req.nextUrl.searchParams.get("id") || "";
    const who = { uid: g.user.uid, email: g.user.email, role: g.role };
    const bytes = await readPhoto(askStore(), who, thread, id);
    if (!bytes) return askJson({ ok: false, reason: "not_found" }, 404);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    console.error("[ask] photo failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
