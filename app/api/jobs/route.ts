import { NextRequest, NextResponse } from "next/server";
import { appendRecord, getRecords } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { requireRole } from "@/lib/api-guard";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";
import {
  codeKey, machineMatch, parseQuantity, registryLabelForTonnage, registryLabelsFrom, suggestJobCode, ISO_DAY,
} from "@/lib/work-orders";
import { resolveMoldNumber } from "@/lib/mold-number";
import { masterRowForPick, nameKey } from "@/lib/master-lookup";
import { latinDigits } from "@/lib/dates";
import { normalizeDate, todayIso } from "@/lib/dates";

// Jobs live in the sheet's `jobs` tab (they used to be in Firestore).
// GET returns jobs with auto-computed production progress.
//
// The GET is GUARDED (any approved role) since 2026-08-28: every job row names
// the CLIENT and the ordered quantity — the order book, not an operational
// read like runs/machines. It sat open while the doc line listing the open
// reads never included it.

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    // The list shows produced / remaining but no downtime, so «التوقفات» and
    // the Firestore open-event query are skipped here (2026-09-09, speed):
    // four bridge tabs instead of five on a cold instance. The detail route
    // still joins downtime for its runs table.
    const { jobs, writable, configured, duplicates, readAt } = await loadJobs({ downtime: false });
    return NextResponse.json({
      jobs, writable, configured, duplicates,
      // How old the numbers are: a served copy keeps its read time. The page
      // says «البيانات من قبل X» past a minute and refetches once on its own,
      // because the server has already started refreshing the copy.
      meta: { dataAgeMs: Math.max(0, Date.now() - readAt) },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ jobs: [], writable: false, configured: false, duplicates: [], meta: { dataAgeMs: 0 } });
  }
}


/**
 * A new work order. Since 2026-09-13 the person picks four things — the
 * product (from «الرئيسي»), the kilograms, the start date and the due date —
 * and Master supplies the rest: the client, the mould number and, when its
 * tonnage names exactly one machine, the machine. Owner's words: "all the data
 * that is in the master sheet to be from the master and no need to write it
 * again". Nothing a person could mistype is asked for.
 *
 * Still refused — the page makes each impossible before it can be sent:
 *  - a product that is not a Master name (re-checked on a fresh read on a miss);
 *  - a quantity that is not a plain number of kilograms («3.1طن»);
 *  - no due date, or a start date that is not a date;
 *  - a TYPED code the tab already holds (a blank code gets the next free
 *    «Job n», lib/work-orders.ts suggestJobCode) — checked on a fresh read;
 *  - a machine, when one IS sent, that is not a registry label.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string) => String(b[k] ?? "").trim();
    const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, reason }, { status });

    if (!s("product")) return bad("missing_fields");
    // «أوامر العمل»!K is a validated dropdown of exactly four Arabic values —
    // an unknown status must never reach the sheet (jobStatusToSheet refuses
    // rather than guess), so surface the validation error here instead.
    const status = s("status") || "Not Started";
    if (!isJobStatus(status)) return bad("invalid_status");
    if (!ISO_DAY.test(s("dueDate"))) return bad("missing_due");
    if (s("startDate") && !ISO_DAY.test(s("startDate"))) return bad("bad_start");
    const qty = parseQuantity(s("qtyOrdered") || s("qty"));
    if (qty.value === null || !(qty.value > 0)) return bad("bad_qty");
    const materialIssued = s("materialIssued");
    if (materialIssued && parseQuantity(materialIssued).unreadable) return bad("bad_material_issued");

    // The registry (cached is fine — it changes rarely, and it is re-read
    // within 45s), then the tab itself as it is RIGHT NOW.
    const [machines, jobs] = await Promise.all([getRecords("machines"), getRecords("jobs", { fresh: true })]);
    const labels = registryLabelsFrom(machines.records);

    // The product must exist in Master. The cached copy answers first; a miss
    // is re-checked on a fresh read so a product added to Master a moment ago
    // is not refused for the 45s the copy lives.
    // `masterRow` is the row the person tapped: it tells two Master rows with
    // the same name apart (lib/master-lookup.ts masterRowForPick).
    const tapped = Number(b.masterRow) > 0 ? Number(b.masterRow) : undefined;
    let m = masterRowForPick((await getRecords("master")).records, s("product"), tapped);
    if (!m) m = masterRowForPick((await getRecords("master", { fresh: true })).records, s("product"), tapped);
    if (!m) return bad("unknown_product");

    let machine = "";
    if (s("machine")) {
      const mm = machineMatch(latinDigits(s("machine")), labels);
      if (!mm.matched) return bad("bad_machine");
      machine = mm.label;
    } else {
      // Master's «الماكينة» is a bare tonnage: a label only when it is unique.
      machine = registryLabelForTonnage(m.machine, labels);
    }

    const existing = jobs.records.map((r) => r.code);
    // `codeAuto`: the page filled the code in and the person never typed one.
    const auto = b.codeAuto === true || !codeKey(s("code"));
    let code = codeKey(s("code")) ? s("code") : suggestJobCode(existing);
    const taken = jobs.records.find((r) => codeKey(r.code) === codeKey(code));
    if (taken) {
      // At-least-once: the same order sent again after an answer that looked
      // failed but landed (the page re-sends the code it pinned). Same code,
      // product, kilograms and due date → it IS that order: ok, nothing written.
      const replay = nameKey(taken.product) === nameKey(m.name || s("product"))
        && parseQuantity(taken.qty).value === qty.value
        && normalizeDate(taken.dueDate) === s("dueDate");
      if (replay) return NextResponse.json({ ok: true, code: taken.code, replay: true });
      // A code the page filled in went stale (a colleague took it) — take the
      // next free one. A code the person TYPED is theirs to change.
      if (!auto) return bad("duplicate_code", 409);
      code = suggestJobCode(existing);
    }

    const res = await appendRecord("jobs", {
      code,
      // Master's own spelling and client — the sheet's «حالة الربط» is
      // MATCH(TRIM(D), Master!C), and the client is Master's for the product.
      client: (m.client || "").trim() || s("client"),
      product: m.name || s("product"),
      moldCode: resolveMoldNumber({ code: m.code, notes: m.notes }).number,
      qty: String(qty.value),
      startDate: s("startDate") || todayIso(),
      dueDate: s("dueDate"),
      // «أوامر العمل»!K and !L are validated Arabic lists — translate on the way in.
      status: jobStatusToSheet(status),
      priority: jobPriorityToSheet(s("priority") || "Normal"),
      machine,
      materialIssued,
      masterbatch: s("masterbatch"),
      instructions: s("instructions"),
      notes: s("notes"),
    });
    // The bridge is at-least-once: a non-ok answer may sit on top of a row
    // that DID land. The page reloads the list before letting anyone retry.
    return NextResponse.json({ ...res, code }, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
