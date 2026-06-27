import { NextRequest, NextResponse } from "next/server";
import { getJobs, addJob } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(await getJobs());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const job = await addJob({
      code: b.code ?? "",
      client: b.client ?? "",
      partName: b.partName ?? "",
      moldId: b.moldId ?? "",
      machineId: b.machineId ?? "",
      qtyOrdered: Number(b.qtyOrdered) || 0,
      dueDate: b.dueDate ?? "",
      status: b.status ?? "Quoted",
      priority: b.priority ?? "Normal",
      notes: b.notes ?? "",
    });
    return NextResponse.json(job);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
