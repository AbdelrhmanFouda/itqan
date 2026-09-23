import { getRecords, type SheetRecord } from "@/lib/sheets";
import { normalizeDate } from "@/lib/dates";
import { nameKey } from "@/lib/master-lookup";
import { parseQuantity } from "@/lib/work-orders";
import { belongsToCustomer } from "@/lib/customer-link";
import {
  canonicalStamp, portalRequest, requestStateFromSheet, reqIdKey, type PortalRequest,
} from "@/lib/customer-requests";

/**
 * Reading «طلبات العملاء» — the server glue between the tab and the rules.
 *
 * The rules themselves are in lib/customer-requests.ts, which imports nothing
 * so Node's test runner can load it. This file is the half that touches the
 * bridge: it shapes a row once, the same way for every caller, so the portal's
 * three routes cannot disagree about what a request row says. Same split as
 * lib/issues-data.ts over lib/issues.ts and lib/downtime-data.ts over
 * lib/downtime.ts.
 *
 * Everything that a date or a number could arrive as is normalised HERE —
 * `normalizeDate` for the wanted date (the workbook holds two conventions),
 * **`canonicalStamp` for the two date-and-time columns**, and `parseQuantity`
 * for the two quantity columns (a cell that is not a plain number is 0 and is
 * never parsed out of, the rule «3.1طن» taught).
 *
 * ⚠ The two stamps are written as «yyyy-mm-dd HH:MM» text and do NOT come back
 * that way: both transports enter a value USER_ENTERED, so Sheets parses it
 * into a DateTime cell and renders it in the workbook's own locale
 * («9/23/2026 14:05:00»). Only `wantedDate` was normalised until the
 * 2026-09-23 review; `submittedAt` and `decidedAt` were read raw, which made
 * the replay guard inert, the staff queue's "newest first" a lexicographic
 * sort of m/d/yyyy text, and the portal card's date `slice(0, 10)` print
 * «9/23/2026 ». One conversion here fixes all three at once.
 */

export type RequestRow = {
  /** The sheet row number — never an identity. The reference number is. */
  row: number;
  reqId: string;
  /** «yyyy-mm-dd HH:MM» Cairo, as text. */
  submittedAt: string;
  clientNo: string;
  client: string;
  product: string;
  /** The product folded through lib/master-lookup.ts `nameKey`. */
  productKey: string;
  masterRow: number;
  qtyAsked: number;
  unit: string;
  qtyKg: number;
  /** ISO yyyy-mm-dd. */
  wantedDate: string;
  note: string;
  /** The INTERNAL token; an unknown sheet word passes through as itself. */
  state: string;
  rejectReason: string;
  jobCode: string;
  decidedBy: string;
  decidedAt: string;
};

export function shapeRequest(r: SheetRecord): RequestRow {
  const product = (r.product || "").trim();
  return {
    row: r.row,
    reqId: reqIdKey(r.reqId),
    submittedAt: canonicalStamp(r.submittedAt),
    clientNo: (r.clientNo || "").trim(),
    client: (r.client || "").trim(),
    product,
    productKey: nameKey(product),
    masterRow: Number(parseQuantity(r.masterRow).value ?? 0),
    qtyAsked: parseQuantity(r.qtyAsked).value ?? 0,
    unit: (r.unit || "").trim(),
    qtyKg: parseQuantity(r.qtyKg).value ?? 0,
    wantedDate: normalizeDate(r.wantedDate),
    note: r.note || "",
    state: requestStateFromSheet(r.state),
    rejectReason: r.rejectReason || "",
    jobCode: (r.jobCode || "").trim(),
    decidedBy: (r.decidedBy || "").trim(),
    decidedAt: canonicalStamp(r.decidedAt),
  };
}

/**
 * Every request row. The tab is created lazily by the first real submit, so
 * "it does not exist yet" and "nobody has asked for anything yet" both arrive
 * as an empty list — which is the same thing to every caller here.
 */
export async function loadRequests(opts: { fresh?: boolean } = {}): Promise<{
  rows: RequestRow[];
  readAt: number;
}> {
  const tab = await getRecords("customerRequests", opts);
  return { rows: tab.records.map(shapeRequest), readAt: tab.readAt };
}

/**
 * The rows belonging to ONE account — exact key match on the client column,
 * the same rule «أوامر العمل» is filtered by. Doing it in one place is what
 * makes "a route forgot to filter" a thing that cannot happen quietly.
 */
export const ownRequests = (rows: readonly RequestRow[], keys: Set<string>): RequestRow[] =>
  rows.filter((r) => belongsToCustomer(r.client, keys));

/** The whitelisted shape a customer reads back. */
export const toPortalRequest = (r: RequestRow): PortalRequest =>
  portalRequest({
    reqId: r.reqId,
    submittedAt: r.submittedAt,
    product: r.product,
    qtyAsked: r.qtyAsked,
    unit: r.unit,
    qtyKg: r.qtyKg,
    wantedDate: r.wantedDate,
    note: r.note,
    state: r.state,
    rejectReason: r.rejectReason,
    jobCode: r.jobCode,
    decidedAt: r.decidedAt,
  });
