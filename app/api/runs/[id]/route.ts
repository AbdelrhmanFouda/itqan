import { NextRequest, NextResponse } from "next/server";
import { deleteRecord } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";

// A run's id is its row number in the Production tab.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  const result = await deleteRecord("production", Number(id));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
