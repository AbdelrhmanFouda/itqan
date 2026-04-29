import { NextRequest, NextResponse } from "next/server";
import { getMachine, updateMachineStatus } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const machine = await getMachine(Number(id));
  if (!machine) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(machine);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = await req.json();
  await updateMachineStatus(Number(id), status);
  return NextResponse.json({ ok: true });
}
