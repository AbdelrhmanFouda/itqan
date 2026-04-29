import { NextRequest, NextResponse } from "next/server";
import { getReports, addReport, setupDb } from "@/lib/db";

export async function GET() {
  try {
    await setupDb();
    const reports = await getReports();
    return NextResponse.json(reports);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await setupDb();
    const { month, year, jobs_completed, notes, issues, recommendations } = await req.json();
    const report = await addReport(
      Number(month),
      Number(year),
      jobs_completed ? Number(jobs_completed) : null,
      notes ?? "",
      issues ?? "",
      recommendations ?? ""
    );
    return NextResponse.json(report);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
