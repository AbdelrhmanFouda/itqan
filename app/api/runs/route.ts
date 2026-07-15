import { NextRequest, NextResponse } from "next/server";
import { getRecords, appendRecord, type SheetRecord } from "@/lib/sheets";
import { normalizeDate } from "@/lib/dates";

// Production runs now live in the Google Sheet's "Production" tab (Sheet-only
// data model). Each run is one row; the sheet row number is its id.

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function shape(r: SheetRecord) {
  return {
    id: String(r.row),
    date: normalizeDate(r.date) || (r.date ?? ""),
    shift: r.shift ?? "",
    machine: r.machine ?? "",
    machineCode: r.machineCode ?? "",
    mold: r.mold ?? "",
    product: r.product ?? "",
    plannedMin: num(r.plannedMin),
    goodUnits: num(r.goodUnits),
    scrapUnits: num(r.scrapUnits),
    openCavities: num(r.openCavities),
    downtimeMin: num(r.downtimeMin),
    downtimeReason: r.downtimeReason || "None",
    operator: r.operator ?? "",
    note: r.note ?? "",
  };
}

export async function GET(req: NextRequest) {
  try {
    const machine = req.nextUrl.searchParams.get("machine");
    const mold = req.nextUrl.searchParams.get("mold");
    const { records } = await getRecords("production");
    let runs = records.map(shape);
    if (machine) runs = runs.filter((r) => r.machine === machine);
    if (mold) runs = runs.filter((r) => r.mold === mold);
    runs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id)));
    return NextResponse.json(runs);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const values: Record<string, string> = {
      date: b.date ?? "",
      shift: b.shift ?? "",
      machine: b.machine ?? "",
      machineCode: b.machineCode ?? "",
      mold: b.mold ?? "",
      product: b.product ?? "",
      plannedMin: String(num(b.plannedMin) || 720),
      goodUnits: String(num(b.goodUnits)),
      scrapUnits: String(num(b.scrapUnits)),
      // Optional — left blank (not 0) when the crew doesn't record it.
      openCavities: num(b.openCavities) > 0 ? String(num(b.openCavities)) : "",
      downtimeMin: String(num(b.downtimeMin)),
      downtimeReason: b.downtimeReason || "None",
      operator: b.operator ?? "",
      note: b.note ?? "",
    };
    const result = await appendRecord("production", values);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}
