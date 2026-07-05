import { NextRequest, NextResponse } from "next/server";
import { appendRecord } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";

// Jobs live in the sheet's `jobs` tab (they used to be in Firestore).
// GET returns jobs with auto-computed production progress.

export async function GET() {
  try {
    const { jobs, writable, configured } = await loadJobs();
    return NextResponse.json({ jobs, writable, configured });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ jobs: [], writable: false, configured: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string) => String(b[k] ?? "").trim();
    if (!s("code") || !s("product")) {
      return NextResponse.json({ ok: false, reason: "missing_fields" }, { status: 400 });
    }
    const res = await appendRecord("jobs", {
      code: s("code"),
      client: s("client"),
      product: s("product"),
      moldCode: s("moldCode"),
      qty: s("qtyOrdered") || s("qty"),
      startDate: s("startDate") || new Date().toISOString().slice(0, 10),
      dueDate: s("dueDate"),
      status: s("status") || "In Production",
      priority: s("priority") || "Normal",
      machine: s("machine"),
      materialIssued: s("materialIssued"),
      masterbatch: s("masterbatch"),
      instructions: s("instructions"),
      notes: s("notes"),
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
