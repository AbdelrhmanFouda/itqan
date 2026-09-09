import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { readIssueAudio } from "@/lib/issues-data";

/**
 * One voice note from «الأعطال», as audio bytes: GET ?id=<Drive file id>.
 *
 * GUARDED (any approved role): a recording is a worker's voice describing a
 * fault, and the Drive file behind it is never shared publicly — the bytes
 * come through the bridge, which serves only files inside the recordings
 * folder, and only for an id some issue row actually links to
 * (lib/issues-data.ts readIssueAudio). The page fetches with a token and
 * plays from an object URL, because an <audio src> cannot carry a header.
 *
 * Cached per instance (up to 40 MB) and in the browser for a day: a clip is
 * ~3s to fetch cold through the bridge and never changes once saved.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const id = req.nextUrl.searchParams.get("id") || "";
    const r = await readIssueAudio(id);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: r.status });
    return new NextResponse(r.bytes, {
      headers: {
        "Content-Type": r.mime,
        "Content-Length": String(r.bytes.byteLength),
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.name || "recording")}`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
