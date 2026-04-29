import { NextRequest, NextResponse } from "next/server";
import { getMachines, addMachine, setupDb } from "@/lib/db";

export async function GET() {
  try {
    await setupDb();
    const machines = await getMachines();
    return NextResponse.json(machines);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await setupDb();
    const { name, type, status } = await req.json();
    const machine = await addMachine(name, type, status ?? "Operational");
    return NextResponse.json(machine);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
