import { NextResponse } from "next/server";

/**
 * Which build is serving, with NO dependencies — no sheet, no Firebase, no
 * cache. Added 2026-09-10 while every sheet-backed route on production hung:
 * with the token-only routes answering and the read routes not, there was no
 * way to tell from outside whether the fix had even deployed. Now there is.
 *
 * Open on purpose (an operational read, like /api/machines): a commit hash
 * and a region give nothing away. `sharedCopy` says whether the optional
 * region-shared copy (lib/shared-copy.ts) is switched on in this environment.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      build: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "local",
      region: process.env.VERCEL_REGION || "",
      sharedCopy: process.env.SHEET_SHARED_COPY === "on",
      at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
