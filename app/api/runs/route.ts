import { NextRequest, NextResponse } from "next/server";
import { getRecords, appendRecord, type SheetRecord } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
import { normalizeDate } from "@/lib/dates";
import { resolveScrap } from "@/lib/scrap";
import { distributeDowntime, downtimeKey } from "@/lib/downtime";
import { loadDowntimeTotals, EMPTY_DOWNTIME } from "@/lib/downtime-data";
import {
  buildShiftLengthIndex, machineKeyOf, resolvePlannedMin, isStubRun,
} from "@/lib/run-join";

// Production runs now live in the Google Sheet's "Production" tab (Sheet-only
// data model). Each run is one row; the sheet row number is its id.
//
// ONE of a run's numbers is not in its own row and is joined on here:
//
//   downtimeMin  ← «التوقفات», via distributeDowntime()
//
// Scrap used to be the second one, joined from «تسجيل الإنتاج». That tab was
// removed from the workbook on 2026-08-27 and «الإنتاج» now carries the
// numbers itself, so scrap is resolved from the run's OWN row — see
// lib/scrap.ts — and is no longer a join at all.
//
// «الإنتاج»!J «زمن التوقف» has never been filled in 418 rows and will not be —
// stoppages are logged in their own tab «التوقفات» instead (Firestore until
// 2026-08-14; see lib/downtime-data.ts). Without
// the join below every consumer of this route reported downtime as a flat 0
// while /performance (buildOEEData) showed the real merged minutes: the same
// metric, two answers, on two pages. The join deliberately reuses buildOEEData's
// own machine key, planned-minutes fallback and stub rule rather than
// re-deriving them, because that is exactly where the two drifted apart.

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function shape(r: SheetRecord) {
  const scrap = resolveScrap(r);
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
    scrapUnits: scrap.scrapUnits,
    // "logged" («هالك»), "system" (سستم − سليم), or "none" — which means
    // NOT KNOWN, not "zero scrap". INTERNAL since 2026-08-28 (see publicRun):
    // no consumer ever read it. A UI stating scrap confidence would want it —
    // restore it to publicRun() then, don't re-derive it client-side.
    scrapSource: scrap.source,
    // The sheet's own verdict on the row: «سليم» / «لم يُعد بعد» /
    // «الفعلي أكبر من العداد», or "" on a row the site appended (those
    // get no formula). A consumer showing scrap SHOULD show this beside it —
    // none does yet, so it too is stripped from the payload until one wants it.
    rowCheck: r.rowCheck ?? "",
    openCavities: num(r.openCavities),
    downtimeMin: num(r.downtimeMin),
    // The run's own «زمن التوقف» value, kept after captured minutes are added
    // to downtimeMin so the join below can still tell the two sources apart.
    // downtimeSource ("none" | "sheet" | "capture") was the consumer-facing
    // form of the same distinction; both are internal-only now.
    sheetDowntimeMin: num(r.downtimeMin),
    downtimeReason: r.downtimeReason || "None",
    downtimeSource: "none" as "none" | "sheet" | "capture",
    operator: r.operator ?? "",
    note: r.note ?? "",
  };
}

// The GET payload — ONLY the fields a consumer actually reads, verified
// against all five dashboard callers on 2026-08-28 (overview, finance,
// quality, production; jobs/[id] never reads the GET body at all). Everything
// else in shape() stays INTERNAL because this route itself still needs it:
// plannedMin feeds resolvePlannedMin() (the downtime headroom — skip it and
// every captured minute silently returns as unallocated), sheetDowntimeMin
// tells sheet minutes from captured ones during the join. So strip HERE, at
// serialization time after the join — never inside shape(). Dropping the
// seven never-read fields (plannedMin, scrapSource, rowCheck, openCavities,
// sheetDowntimeMin, downtimeSource, note) cuts the ~593-row payload by
// roughly a third; restoring one is a one-line addition.
function publicRun(r: ReturnType<typeof shape>) {
  return {
    id: r.id,
    date: r.date,
    shift: r.shift,
    machine: r.machine,
    machineCode: r.machineCode,
    mold: r.mold,
    product: r.product,
    goodUnits: r.goodUnits,
    scrapUnits: r.scrapUnits,
    downtimeMin: r.downtimeMin,
    downtimeReason: r.downtimeReason,
    operator: r.operator,
  };
}

export async function GET(req: NextRequest) {
  try {
    const machine = req.nextUrl.searchParams.get("machine");
    const mold = req.nextUrl.searchParams.get("mold");
    const [{ records }, machinesTab, captured] = await Promise.all([
      getRecords("production"),
      // Best-effort: a registry or Firestore that is briefly unreachable
      // degrades this route to "downtime not measured" rather than failing the
      // whole run list.
      getRecords("machines").catch(() => ({ records: [] as SheetRecord[] })),
      loadDowntimeTotals(null).catch(() => EMPTY_DOWNTIME),
    ]);
    let runs = records.map(shape).map((r) => ({
      ...r,
      downtimeSource: (r.downtimeMin > 0 ? "sheet" : "none") as "none" | "sheet" | "capture",
    }));

    // Downtime from «التوقفات», joined on the same way buildOEEData does
    // it. Stub rows are held out of the spread for the reason in isStubRun():
    // they have planned minutes but no production, so letting them absorb a
    // share here — where OEE will not — is precisely what would make the
    // Overview tile and /performance print different totals again.
    const lenByKey = buildShiftLengthIndex(machinesTab.records);
    const live: number[] = [];
    records.forEach((rec, i) => { if (!isStubRun(rec)) live.push(i); });
    const spread = distributeDowntime(
      live.map((i) => ({
        date: runs[i].date || "",
        machine: machineKeyOf(runs[i].machineCode, runs[i].machine),
        plannedMin: resolvePlannedMin(
          runs[i].plannedMin, machineKeyOf(runs[i].machineCode, runs[i].machine), runs[i].machine, lenByKey,
        ),
        downtimeMin: runs[i].downtimeMin,
      })),
      captured.byKey,
    );
    live.forEach((i, j) => {
      const add = spread.perRun[j];
      if (add <= 0) return;
      const r = runs[i];
      const reasonKnown = r.downtimeReason && r.downtimeReason !== "None";
      runs[i] = {
        ...r,
        downtimeMin: r.downtimeMin + add,
        // A run with no reason of its own shows that day's dominant one, so a
        // table can name the cause. Reason breakdowns that must be exact read
        // the events themselves (/api/downtime), never this field.
        downtimeReason: reasonKnown
          ? r.downtimeReason
          : captured.dominantByKey.get(downtimeKey(r.date, machineKeyOf(r.machineCode, r.machine))) ?? "Other",
        downtimeSource: r.sheetDowntimeMin > 0 ? "sheet" : "capture",
      };
    });

    if (machine) runs = runs.filter((r) => r.machine === machine);
    if (mold) runs = runs.filter((r) => r.mold === mold);
    runs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id)));
    // Open operational read — a browser may reuse it briefly. The server-side
    // sheet cache (lib/sheets.ts, 45s) is the real one; this only spares a
    // phone re-downloading the same list on every poll.
    return NextResponse.json(runs.map(publicRun), {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
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
