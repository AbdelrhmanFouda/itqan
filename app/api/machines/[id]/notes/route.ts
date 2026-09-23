import { NextRequest, NextResponse } from "next/server";
import { getMachineNotes, addMachineNote } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

// GUARDED since 2026-09-23 (any approved role). Maintenance notes are what a
// fitter wrote about a press — internal by nature, and the POST beside them was
// already guarded.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  const notes = await getMachineNotes(id);
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  const { note, note_date } = await req.json();
  const result = await addMachineNote(id, note, note_date);
  return NextResponse.json(result);
}
