import { NextRequest, NextResponse } from "next/server";
import { getMachineNotes, addMachineNote } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notes = await getMachineNotes(Number(id));
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { note, note_date } = await req.json();
  const result = await addMachineNote(Number(id), note, note_date);
  return NextResponse.json(result);
}
