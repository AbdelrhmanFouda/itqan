import { appendRecord, getRecords, type UpdateResult } from "@/lib/sheets";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";
import {
  codeKey, machineMatch, parseQuantity, registryLabelForTonnage, registryLabelsFrom, suggestJobCode, ISO_DAY,
} from "@/lib/work-orders";
import { resolveMoldNumber } from "@/lib/mold-number";
import { masterRowByName, masterRowForPick, nameKey } from "@/lib/master-lookup";
import { latinDigits, normalizeDate, todayIso } from "@/lib/dates";
import { reqIdFromNotes, reqIdKey } from "@/lib/customer-requests";

/**
 * Creating a row in «أوامر العمل» — ONE code path, two callers.
 *
 * This was the body of `POST /api/jobs` until 2026-09-23. The customer
 * portal's approval screen has to create exactly the same row, with the same
 * refusals in the same order, and the worst way to do that would have been a
 * second copy of these forty lines: the two would agree on the day they were
 * written and part company at the first fix. So the route keeps its guard and
 * its HTTP shapes, and everything between them lives here.
 *
 * The rules are unchanged, and each of them was paid for:
 *
 *  - the PRODUCT is re-resolved against «الرئيسي» on a read, and re-read FRESH
 *    on a miss, because a colleague may have added it a moment ago;
 *  - a product name that «الرئيسي» holds TWICE is a real thing (two live rows
 *    on 2026-09-22, one of them shared by two different clients), so the
 *    candidates travel back with the plan. `POST /api/jobs` keeps the sheet's
 *    own "first row wins" reading, because the person picked a row in the
 *    picker; the APPROVAL passes `requireUniqueProduct` and refuses instead —
 *    it is about to buy material against somebody else's standard;
 *  - «أوامر العمل»!K and !L are validated Arabic dropdowns, so the status and
 *    the priority are translated at the boundary and an unknown status is
 *    refused here rather than thrown at the sheet;
 *  - the code is checked against the tab as it is RIGHT NOW. The same order
 *    sent twice (the bridge is at-least-once, and a phone on factory wifi
 *    retries) is recognised by code + product + kilograms + due date and
 *    written once.
 *
 * `deps` exists so the caller says which sheet functions to use — the route
 * and the approval both pass `sheetDeps`, and a future test can pass fakes.
 */

/* --------------------------------- types ---------------------------------- */

export type WorkOrderDeps = {
  getRecords: typeof getRecords;
  appendRecord: typeof appendRecord;
};

/** The real bridge. Both callers pass this. */
export const sheetDeps: WorkOrderDeps = { getRecords, appendRecord };

export type WorkOrderInput = {
  /** The product name as Master spells it (the picker never lets one be typed). */
  product: string;
  /** The row the person tapped — tells two Master rows of the same name apart. */
  masterRow?: number;
  /** The kilograms, as typed. Parsed with `parseQuantity` («3.1طن» is refused). */
  qty: string;
  startDate?: string;
  dueDate: string;
  code?: string;
  /** The page filled the code in and nobody typed one — a clash takes the next. */
  codeAuto?: boolean;
  status?: string;
  priority?: string;
  machine?: string;
  client?: string;
  materialIssued?: string;
  masterbatch?: string;
  instructions?: string;
  notes?: string;
  /**
   * Refuse a product name that «الرئيسي» holds more than once instead of
   * taking the first row. The approval screen sets it; the jobs form does not.
   */
  requireUniqueProduct?: boolean;
  /**
   * The customer request this order answers, «REQ-2026-0001».
   *
   * The marker `[REQ-…]` it leaves in «أوامر العمل»!«ملاحظات» is what makes
   * the two-step approval safe on an at-least-once bridge: if the stamp on the
   * request row fails after the order landed, the next tap re-reads the tab,
   * finds the marker, and only re-stamps. `markerCode` on the plan carries the
   * code of a row that already holds it.
   */
  reqId?: string;
};

/** One «الرئيسي» row a duplicated product name could mean. */
export type ProductCandidate = { masterRow: number; client: string; product: string; moldNumber: string };

export type WorkOrderPlan = {
  code: string;
  client: string;
  product: string;
  moldCode: string;
  qtyKg: number;
  startDate: string;
  dueDate: string;
  /** The INTERNAL token; `jobStatusToSheet` translates it on the way in. */
  status: string;
  priority: string;
  machine: string;
  materialIssued: string;
  masterbatch: string;
  instructions: string;
  notes: string;
  masterRow: number;
  /** Every Master row carrying this name — more than one means it is duplicated. */
  candidates: ProductCandidate[];
  /** An existing row that IS this order: same code, product, kilograms, due date. */
  replayCode: string;
  /** The code of the row already carrying this request's `[REQ-…]` marker, "". */
  markerCode: string;
};

export type PlanFailure = { ok: false; reason: string; status: number; candidates?: ProductCandidate[] };

export type WorkOrderOutcome =
  | PlanFailure
  | { ok: true; kind: "replay"; code: string; plan: WorkOrderPlan }
  | { ok: true; kind: "written"; code: string; res: UpdateResult; plan: WorkOrderPlan };

/* --------------------------------- the plan -------------------------------- */

const s = (v: unknown) => String(v ?? "").trim();

/**
 * Everything the row WOULD hold, and every reason it would be refused —
 * without writing anything. The approval screen renders this as its preview,
 * which is what makes the preview the same code path as the write rather than
 * a second guess at it.
 */
export async function planWorkOrder(
  input: WorkOrderInput, deps: WorkOrderDeps,
): Promise<{ ok: true; plan: WorkOrderPlan } | PlanFailure> {
  const bad = (reason: string, status = 400, candidates?: ProductCandidate[]): PlanFailure =>
    ({ ok: false, reason, status, ...(candidates ? { candidates } : {}) });

  const product = s(input.product);
  if (!product) return bad("missing_fields");
  // «أوامر العمل»!K is a validated dropdown of exactly four Arabic values —
  // an unknown status must never reach the sheet (jobStatusToSheet refuses
  // rather than guess), so surface the validation error here instead.
  const status = s(input.status) || "Not Started";
  if (!isJobStatus(status)) return bad("invalid_status");
  const dueDate = s(input.dueDate);
  if (!ISO_DAY.test(dueDate)) return bad("missing_due");
  const startDateIn = s(input.startDate);
  if (startDateIn && !ISO_DAY.test(startDateIn)) return bad("bad_start");
  const qty = parseQuantity(s(input.qty));
  if (qty.value === null || !(qty.value > 0)) return bad("bad_qty");
  const materialIssued = s(input.materialIssued);
  if (materialIssued && parseQuantity(materialIssued).unreadable) return bad("bad_material_issued");

  // The registry (cached is fine — it changes rarely, and it is re-read
  // within 45s), then the tab itself as it is RIGHT NOW.
  const [machines, jobs] = await Promise.all([
    deps.getRecords("machines"),
    deps.getRecords("jobs", { fresh: true }),
  ]);
  const labels = registryLabelsFrom(machines.records);

  // The product must exist in Master. The cached copy answers first; a miss
  // is re-checked on a fresh read so a product added to Master a moment ago
  // is not refused for the 45s the copy lives.
  const tapped = Number(input.masterRow) > 0 ? Number(input.masterRow) : undefined;
  let master = await deps.getRecords("master");
  let m = masterRowForPick(master.records, product, tapped);
  if (!m) {
    master = await deps.getRecords("master", { fresh: true });
    m = masterRowForPick(master.records, product, tapped);
  }
  if (!m) return bad("unknown_product");

  // Every row the name could mean, for a screen that must not guess.
  const hit = masterRowByName(master.records, product);
  const candidates: ProductCandidate[] = (hit.ok ? [hit.row] : hit.hits).map((r) => ({
    masterRow: r.row,
    client: (r.client || "").trim(),
    product: (r.name || "").trim(),
    moldNumber: resolveMoldNumber({ code: r.code, notes: r.notes }).number,
  }));
  if (input.requireUniqueProduct && candidates.length > 1 && tapped === undefined) {
    return bad("duplicate_product", 409, candidates);
  }

  let machine = "";
  if (s(input.machine)) {
    const mm = machineMatch(latinDigits(s(input.machine)), labels);
    if (!mm.matched) return bad("bad_machine");
    machine = mm.label;
  } else {
    // Master's «الماكينة» is a bare tonnage: a label only when it is unique.
    machine = registryLabelForTonnage(m.machine, labels);
  }

  // Step 1 of the approval, done on the same fresh read: an order already
  // carrying this request's marker means the previous attempt DID land.
  const wantMarker = reqIdKey(input.reqId);
  const marked = wantMarker ? jobs.records.find((r) => reqIdFromNotes(r.notes) === wantMarker) : undefined;
  const markerCode = marked ? marked.code : "";

  const existing = jobs.records.map((r) => r.code);
  // `codeAuto`: the page filled the code in and the person never typed one.
  const auto = input.codeAuto === true || !codeKey(s(input.code));
  let code = codeKey(s(input.code)) ? s(input.code) : suggestJobCode(existing);
  let replayCode = "";
  const taken = jobs.records.find((r) => codeKey(r.code) === codeKey(code));
  if (taken) {
    // At-least-once: the same order sent again after an answer that looked
    // failed but landed (the page re-sends the code it pinned). Same code,
    // product, kilograms and due date → it IS that order: ok, nothing written.
    const replay = nameKey(taken.product) === nameKey(m.name || product)
      && parseQuantity(taken.qty).value === qty.value
      && normalizeDate(taken.dueDate) === dueDate;
    if (replay) replayCode = taken.code;
    // A code the page filled in went stale (a colleague took it) — take the
    // next free one. A code the person TYPED is theirs to change.
    else if (!auto) return bad("duplicate_code", 409);
    else code = suggestJobCode(existing);
  }

  return {
    ok: true,
    plan: {
      code,
      // Master's own spelling and client — the sheet's «حالة الربط» is
      // MATCH(TRIM(D), Master!C), and the client is Master's for the product.
      client: (m.client || "").trim() || s(input.client),
      product: m.name || product,
      moldCode: resolveMoldNumber({ code: m.code, notes: m.notes }).number,
      qtyKg: qty.value,
      startDate: startDateIn || todayIso(),
      dueDate,
      status,
      priority: s(input.priority) || "Normal",
      machine,
      materialIssued,
      masterbatch: s(input.masterbatch),
      instructions: s(input.instructions),
      notes: s(input.notes),
      masterRow: m.row,
      candidates,
      replayCode,
      markerCode,
    },
  };
}

/* -------------------------------- the write -------------------------------- */

/**
 * Plan, then append. The caller turns the outcome into its own HTTP answer —
 * `POST /api/jobs` and the portal's approve route shape theirs differently and
 * neither shape belongs in here.
 *
 * The bridge is at-least-once: a non-ok answer may sit on top of a row that
 * DID land. Every caller reloads the list before letting anyone retry, and a
 * retry is safe because the code is the replay key.
 */
export async function createWorkOrder(
  input: WorkOrderInput, deps: WorkOrderDeps,
): Promise<WorkOrderOutcome> {
  const planned = await planWorkOrder(input, deps);
  if (!planned.ok) return planned;
  const p = planned.plan;
  // The order for this request is already in the tab (its marker says so), or
  // this exact order is (the code replay). Either way: nothing more to write.
  if (p.markerCode) return { ok: true, kind: "replay", code: p.markerCode, plan: p };
  if (p.replayCode) return { ok: true, kind: "replay", code: p.replayCode, plan: p };

  const res = await deps.appendRecord("jobs", {
    code: p.code,
    client: p.client,
    product: p.product,
    moldCode: p.moldCode,
    qty: String(p.qtyKg),
    startDate: p.startDate,
    dueDate: p.dueDate,
    // «أوامر العمل»!K and !L are validated Arabic lists — translate on the way in.
    status: jobStatusToSheet(p.status),
    priority: jobPriorityToSheet(p.priority),
    machine: p.machine,
    materialIssued: p.materialIssued,
    masterbatch: p.masterbatch,
    instructions: p.instructions,
    notes: p.notes,
  });
  return { ok: true, kind: "written", code: p.code, res, plan: p };
}
