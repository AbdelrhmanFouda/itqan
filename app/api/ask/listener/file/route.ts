import { NextRequest, NextResponse } from "next/server";
import { askConfigured, openLink } from "@/lib/ask-crypto";
import { openThread, readPhotoForListener } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, notConfigured } from "@/lib/ask-guard";
import { readIssueAudio } from "@/lib/issues-data";

/**
 * A photo or a voice note for the listener: GET ?t=<signed link>.
 *
 * The link IS the permission: /api/ask/listener/next signs one per file with
 * a key only this server holds, bound to that thread and that file, good for
 * ten minutes. No token is read here, so the listener can hand the URL
 * straight to whatever downloads it. An expired or altered link answers 401
 * and the listener asks `next` again for a fresh one.
 *
 *   photo → image/jpeg, decrypted from the photo store
 *   audio → the issue's recording from the owner's Drive (through the bridge),
 *           and only an id that thread's own issue carries
 */
export async function GET(req: NextRequest) {
  if (!askConfigured()) return notConfigured();
  const link = openLink(req.nextUrl.searchParams.get("t"));
  if (!link) return askJson({ ok: false, reason: "bad_or_expired_link" }, 401);
  try {
    const store = askStore();
    if (link.k === "photo") {
      const bytes = await readPhotoForListener(store, link.th, link.id);
      if (!bytes) return askJson({ ok: false, reason: "not_found" }, 404);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store" },
      });
    }
    const t = openThread(await store.getThread(link.th));
    const ids = [t?.issue?.issueAudioId, t?.issue?.solutionAudioId].filter(Boolean);
    if (!t?.issue?.verified || !ids.includes(link.id)) return askJson({ ok: false, reason: "not_found" }, 404);
    const r = await readIssueAudio(link.id);
    if (!r.ok) return askJson({ ok: false, reason: r.reason }, r.status);
    return new NextResponse(r.bytes, {
      headers: { "Content-Type": r.mime, "Content-Length": String(r.bytes.byteLength), "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[ask] listener file failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
