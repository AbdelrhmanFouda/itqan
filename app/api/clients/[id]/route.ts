import { NextRequest, NextResponse } from "next/server";
import { deleteClient } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  await deleteClient(id);
  return NextResponse.json({ ok: true });
}
