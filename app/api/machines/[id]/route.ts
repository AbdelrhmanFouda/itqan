import { NextRequest, NextResponse } from "next/server";
import { getMachine, updateMachineStatus, deleteMachine } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

// GUARDED since 2026-09-23 (any approved role) — one row of the registry the
// list route serves, closed for the same reason.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  const machine = await getMachine(id);
  if (!machine) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Per-browser reuse only — never a shared cache, now that a token decides
  // who may see this.
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
