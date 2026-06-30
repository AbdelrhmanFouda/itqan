import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsConfigured } from "@/lib/sheets";

// Back-compat endpoint — delegates to the generic sheet reader for "molds".
export async function GET() {
  const data = await getRecords("molds");
  return NextResponse.json({ ...data, configured: sheetsConfigured() });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const result = await updateRecord("molds", Number(body.row), (body.changes ?? {}) as Record<string, string>);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
