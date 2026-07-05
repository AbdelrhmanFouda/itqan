import { NextRequest, NextResponse } from "next/server";
import { getRecords, appendRecord, sheetsWritable } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";

/**
 * Machine fleet, read from the sheet's `machines` DAILY-PLAN tab (one row per
 * machine per day). GET aggregates to one card per machine: latest status,
 * shift length, last plan date and last product. POST appends a plan row.
 * (This replaced the old Firestore-backed list, which the sheet superseded.)
 */

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export type MachineAgg = {
  name: string;
  status: string;       // "Active" / "Inactive" / "" (as written in the sheet)
  shiftLength: number;  // minutes, from the latest dated row that has one
  lastDate: string;     // ISO
  lastProduct: string;
  planRows: number;
};

export async function GET() {
  try {
    const tab = await getRecords("machines");
    const by = new Map<string, MachineAgg>();
    for (const r of tab.records) {
      const key = normKey(r.name);
      if (!key) continue;
      const d = normalizeDate(r.date);
      const cur =
        by.get(key) ??
        { name: latinDigits((r.name || "").trim()), status: "", shiftLength: 0, lastDate: "", lastProduct: "", planRows: 0 };
      cur.planRows++;
      if (d >= cur.lastDate) {
        cur.lastDate = d;
        if (r.active) cur.status = r.active;
        if (num(r.shiftLength) > 0) cur.shiftLength = num(r.shiftLength);
        if (r.product) cur.lastProduct = r.product;
      }
      by.set(key, cur);
    }
    const machines = Array.from(by.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    return NextResponse.json({ machines, writable: sheetsWritable(), configured: tab.records.length > 0 || tab.fields.length > 0 });
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
      name,
      date: normalizeDate(String(b.date ?? "")) || new Date().toISOString().slice(0, 10),
      shiftLength: String(num(b.shiftLength) > 0 ? num(b.shiftLength) : 720),
      active: String(b.status ?? "Active"),
      product: String(b.product ?? ""),
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
