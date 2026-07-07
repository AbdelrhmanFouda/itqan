import { NextRequest, NextResponse } from "next/server";
import { getRecords, appendRecord, sheetsWritable } from "@/lib/sheets";
import { latinDigits } from "@/lib/dates";

/**
 * Machine REGISTRY, read from the sheet's `machines` tab — one row per
 * PHYSICAL machine. The code (PQPI n) is the only unique id: several
 * tonnages (100/150/180/220/280) exist twice. `label` is the composite
 * identity ("PQPI 4 — 220") that the production tab's machine-code column
 * and the hourly board key on — keep the format in sync with the board.
 */

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

export type MachineInfo = {
  row: number;
  code: string;         // "PQPI 4" or "" when the sheet row has no code yet
  name: string;         // tonnage, e.g. "220"
  label: string;        // "PQPI 4 — 220" / "220 — بدون كود"
  product: string;      // current product from the registry
  manufacturer: string;
  status: string;       // "Active" / "Inactive" / ""
  shiftLength: number;  // minutes (720 default when blank)
};

export async function GET() {
  try {
    const tab = await getRecords("machines");
    const machines: MachineInfo[] = [];
    for (const r of tab.records) {
      const name = latinDigits((r.name || "").trim());
      if (!name) continue;
      const code = (r.code || "").trim();
      machines.push({
        row: r.row,
        code,
        name,
        label: code ? `${code} — ${name}` : `${name} — بدون كود`,
        product: r.product || "",
        manufacturer: r.manufacturer || "",
        status: r.active || "",
        shiftLength: num(r.shiftLength) > 0 ? num(r.shiftLength) : 720,
      });
    }
    // Coded machines first, in code order; then the code-less ones.
    machines.sort((a, b) => {
      const an = a.code ? num(a.code) : Infinity;
      const bn = b.code ? num(b.code) : Infinity;
      return an !== bn ? an - bn : a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return NextResponse.json({
      machines,
      writable: sheetsWritable(),
      configured: tab.records.length > 0 || tab.fields.length > 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ machines: [], writable: false, configured: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, reason: "no_name" }, { status: 400 });
    const res = await appendRecord("machines", {
      code: String(b.code ?? "").trim(),
      name,
      product: String(b.product ?? ""),
      manufacturer: String(b.manufacturer ?? ""),
      shiftLength: String(num(b.shiftLength) > 0 ? num(b.shiftLength) : 720),
      active: String(b.status ?? "Active"),
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
