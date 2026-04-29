import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(Number(id));
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(report);
}
