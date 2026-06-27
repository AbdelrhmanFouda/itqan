import { NextRequest, NextResponse } from "next/server";
import { getReport, deleteReport } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteReport(id);
  return NextResponse.json({ ok: true });
}
