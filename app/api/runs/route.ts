import { NextRequest, NextResponse } from "next/server";
import { getRuns, getRunsForJob, getRunsForMachine, addRun } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    const machineId = req.nextUrl.searchParams.get("machineId");
    if (jobId) return NextResponse.json(await getRunsForJob(jobId));
    if (machineId) return NextResponse.json(await getRunsForMachine(machineId));
    return NextResponse.json(await getRuns());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const run = await addRun({
      jobId: b.jobId ?? "",
      machineId: b.machineId ?? "",
      date: b.date ?? "",
      goodUnits: Number(b.goodUnits) || 0,
      scrapUnits: Number(b.scrapUnits) || 0,
      downtimeMin: Number(b.downtimeMin) || 0,
      downtimeReason: b.downtimeReason ?? "None",
      operator: b.operator ?? "",
      note: b.note ?? "",
    });
    return NextResponse.json(run);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
