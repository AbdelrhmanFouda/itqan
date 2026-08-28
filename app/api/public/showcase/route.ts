import { NextResponse } from "next/server";
import { getPublicShowcase } from "@/lib/sheets";

export async function GET() {
  try {
    // Counts only, public by design — cacheable at the edge and in browsers.
    return NextResponse.json(await getPublicShowcase(), {
      headers: { "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error(err);
    // No Cache-Control here: a transient failure must not be pinned.
    return NextResponse.json({ stats: { molds: 0, machines: 0, clients: 0 } });
  }
}
