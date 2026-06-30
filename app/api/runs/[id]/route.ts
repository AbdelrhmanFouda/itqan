import { NextRequest, NextResponse } from "next/server";
import { deleteRecord } from "@/lib/sheets";

// A run's id is its row number in the Production tab.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteRecord("production", Number(id));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
