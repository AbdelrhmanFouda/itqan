import { NextRequest, NextResponse } from "next/server";
import { getReports, addReport } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

// Guarded read (2026-08-28): monthly reports are internal management narrative
// (notes / issues / recommendations, routinely naming clients and products) —
// they sat as an anonymous open read while POST/DELETE in the same files were
// guarded. Any approved role may read; NAV limits the page to finance.
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const reports = await getReports();
    return NextResponse.json(reports);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
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
