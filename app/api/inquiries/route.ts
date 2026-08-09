import { NextRequest, NextResponse } from "next/server";
import { getInquiries } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

// Customer inquiries carry contact details — sales (+ owner/manager) only.
export async function GET(req: NextRequest) {
  const g = await requireRole(req, ["sales"]);
  if ("deny" in g) return g.deny;
  try {
    return NextResponse.json(await getInquiries());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
