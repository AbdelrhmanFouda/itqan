import { NextRequest, NextResponse } from "next/server";
import { getMold, updateMold, deleteMold } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mold = await getMold(id);
  if (!mold) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(mold);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = await req.json();
  await updateMold(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteMold(id);
  return NextResponse.json({ ok: true });
}
