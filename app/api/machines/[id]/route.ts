import { NextRequest, NextResponse } from "next/server";
import { getMachine, updateMachineStatus, deleteMachine } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const machine = await getMachine(id);
  if (!machine) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Open operational read (the GET is deliberately unguarded; PATCH/DELETE
  // below are not) — browsers may reuse it briefly.
  return NextResponse.json(machine, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  const { status } = await req.json();
  await updateMachineStatus(id, status);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  await deleteMachine(id);
  return NextResponse.json({ ok: true });
}
