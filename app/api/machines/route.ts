import { NextRequest, NextResponse } from "next/server";
import { getMachines, addMachine } from "@/lib/db";

export async function GET() {
  try {
    const machines = await getMachines();
    // Flatten last_note_date for the frontend
    const mapped = machines.map((m) => ({
      ...m,
      last_note_date: m.notes[0]?.noteDate ?? null,
      notes: undefined,
    }));
    return NextResponse.json(mapped);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, type, status } = await req.json();
    const machine = await addMachine(name, type, status ?? "Operational");
    return NextResponse.json(machine);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
