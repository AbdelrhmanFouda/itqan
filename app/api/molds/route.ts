import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsWritable, type SheetRecord } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
import { resolveMoldNumber, moldKey, appendToNotes, NOTE_LINE_MAX, type MoldNumberSource } from "@/lib/mold-number";
import { masterRowByName } from "@/lib/master-lookup";

/**
 * The mould register — «الرئيسي» (Master) read directly, one row per product
 * / mould, with the MOULD NUMBER resolved the one way the site resolves it
 * (lib/mold-number.ts): column D «كود الاسطمبة», else the number written in
 * column Q «ملاحظات».
 *
 * Why Master and not the «الاسطمبات» view: the view is a FILTER of Master's
 * A:D, J:K, N and P — it carries no notes column, so the 26 products whose
 * customer mould number lives in the notes (three of them with no code at all)
 * would show nothing. Master is the source anyway; the view exists for people
 * reading the workbook.
 *
 * GUARDED (any approved role, 2026-09-04). This is the page the worker role
 * was given the same day, so every approved role can read AND edit it. The «الاسطمبات»
 * and «المنتجات» views stay open reads (lib/open-reads.ts) and between them
 * already serve every column here except the notes — nothing new is
 * published; the token is what lets a worker have it at all, since Master
 * (`sheet/master`) has been deny-by-default since 2026-08-28.
 *
 * Writes (PATCH) are open to EVERY approved role — the owner's word, 2026-09-04
 * ("allow for editing for everyone") — located by product NAME on a fresh read
 * (lib/master-lookup.ts): never by the row the browser holds, and never by
 * mould code, which repeats across customers. The name itself is not editable:
 * everything in the workbook joins on it.
 *
 * ⚠ This path used to be a Firestore-era route (deleted 2026-08-28, zero
 * callers). This is a different thing that happens to share the URL.
 */

export type MoldRow = {
  row: number;
  id: string;
  /** The number to show: the code, else the notes number, else "". */
  number: string;
  numberSource: MoldNumberSource;
  /** D «كود الاسطمبة» as written. */
  code: string;
  /** The customer's number found in Q «ملاحظات» ("" when none). */
  notesNumber: string;
  name: string;
  client: string;
  category: string;
  cavities: string;
  cycle: string;
  worstCycle: string;
  weight: string;
  material: string;
  machine: string;
  defects: string;
  active: string;
  notes: string;
  /** The product name appears on more than one Master row. */
  ambiguous: boolean;
};

const s = (v: string | undefined) => (v ?? "").trim();

/**
 * «ملاحظات» is read with its LINE BREAKS (getRecords' `raw`): the cell collects
 * one line per fault since 2026-10-07, and the default reader collapses every
 * newline to a space — the page would show a flattened cell, and the next
 * append would write the flattened text back for good.
 */
const MASTER_READ = { raw: ["notes"] as const };

function shape(r: SheetRecord, nameCount: Map<string, number>): MoldRow {
  const mn = resolveMoldNumber({ code: r.code, notes: r.notes });
  return {
    row: r.row,
    id: s(r.id),
    number: mn.number,
    numberSource: mn.source,
    code: mn.code,
    notesNumber: mn.notesNumber,
    name: s(r.name),
    client: s(r.client),
    category: s(r.category),
    cavities: s(r.cavities),
    cycle: s(r.cycle),
    worstCycle: s(r.worstCycle),
    weight: s(r.weight),
    material: s(r.material),
    machine: s(r.machine),
    defects: s(r.defects),
    active: s(r.active),
    notes: s(r.notes),
    ambiguous: (nameCount.get(moldKey(r.name)) ?? 0) > 1,
  };
}

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const tab = await getRecords("master", MASTER_READ);
    const nameCount = new Map<string, number>();
    for (const r of tab.records) {
      const k = moldKey(r.name);
      if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }
    // A row with neither a name nor a number is nothing to register — the 30
    // rows literally named «غير متاح / N/A» arrive with an empty name and are
    // kept only when they at least carry a number.
    const molds = tab.records.map((r) => shape(r, nameCount)).filter((m) => m.name || m.number);
    return NextResponse.json({
      molds,
      writable: sheetsWritable(),
      // Every approved role may edit (owner's word, 2026-09-04). Kept as a
      // field so the page has one switch to flip if that ever narrows again —
      // it must come from the verified role here, never from the client.
      canEdit: true,
      configured: tab.fields.length > 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

// The Master columns the register may edit. `name`/`id` are identity and
// absent on purpose; a rename must happen in the sheet, where the person can
// see every tab that joins on it.
const EDITABLE = new Set([
  "code", "client", "category", "cavities", "cycle", "worstCycle",
  "weight", "material", "machine", "defects", "active", "notes",
]);

export async function PATCH(req: NextRequest) {
  // Any approved role (owner's word, 2026-09-04: "editing for everyone").
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const body = (await req.json()) as {
      row?: unknown; name?: unknown; changes?: unknown; appendNote?: unknown;
      expect?: { client?: unknown; code?: unknown } | null;
    };

    // { name, row?, expect?, appendNote } — ONE line added under what «ملاحظات»
    // already holds (the issues log's "write this in Master notes", 2026-10-07).
    // The notes are taken from the FRESH row (line breaks kept), never from the
    // browser, so nothing a colleague wrote meanwhile is erased; appendToNotes
    // refuses a line that would change the customer's mould number kept in
    // that cell, and answers `changed: false` for a line already there (the
    // bridge is at-least-once). A line longer than the cap is REFUSED, not
    // sliced: the person approved the text they saw.
    if (body.appendNote !== undefined) {
      const line = String(body.appendNote ?? "").replace(/\s+/g, " ").trim();
      if (line.length > NOTE_LINE_MAX) return NextResponse.json({ ok: false, reason: "too_long" }, { status: 400 });
      const master = await getRecords("master", { fresh: true, ...MASTER_READ });
      const preferRow = body.row === undefined || body.row === null ? undefined : Number(body.row);
      const m = masterRowByName(master.records, String(body.name ?? ""), preferRow);
      if (!m.ok) return NextResponse.json({ ok: false, reason: m.reason }, { status: 400 });
      // A name Master holds twice is tied to the chosen twin only by the row
      // NUMBER the browser holds, and a row deleted above adjacent twins puts
      // the OTHER twin on that number. The browser sends the twin's client and
      // code as well; a fresh row that no longer agrees is refused.
      const twins = master.records.filter((r) => moldKey(r.name) === moldKey(m.row.name)).length;
      if (body.expect && typeof body.expect === "object" && twins > 1) {
        const same = (a: unknown, b: string | undefined) => moldKey(String(a ?? "")) === moldKey(b);
        if (!same(body.expect.client, m.row.client) || !same(body.expect.code, m.row.code)) {
          return NextResponse.json({ ok: false, reason: "identity_mismatch" }, { status: 400 });
        }
      }
      const a = appendToNotes(m.row.notes, line);
      if (!a.ok) return NextResponse.json({ ok: false, reason: a.reason }, { status: 400 });
      if (!a.changed) return NextResponse.json({ ok: true, unchanged: true, notes: a.notes });
      const res = await updateRecord("master", m.row.row, { notes: a.notes });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      console.log(`[molds] ${g.user.email} added a note to Master row ${m.row.row} («${s(m.row.name)}»)`);
      return NextResponse.json({ ok: true, notes: a.notes, row: m.row.row });
    }

    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries((body.changes ?? {}) as Record<string, unknown>)) {
      if (EDITABLE.has(k)) changes[k] = String(v ?? "");
    }
    if (Object.keys(changes).length === 0) return NextResponse.json({ ok: true });

    // Fresh read, then locate by NAME: the row the browser holds is minutes
    // old and a colleague edits this sheet daily. A duplicated name refuses.
    const master = await getRecords("master", { fresh: true });
    const m = masterRowByName(master.records, String(body.name ?? ""), Number(body.row));
    if (!m.ok) return NextResponse.json({ ok: false, reason: m.reason }, { status: 400 });
    const res = await updateRecord("master", m.row.row, changes);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
