/**
 * «تم إنتاج» — how many pieces were made for ONE customer's ONE order.
 *
 * The portal showed status and dates only until 2026-10-07, on purpose: the
 * staff progress figure (lib/jobs.ts `matches()`) credits «الإنتاج» to an order
 * by product NAME and start date alone — no client term, no end date. That is
 * the owner's own rule for his own screens, and it is wrong on a customer's:
 *
 *  - one product name is made for TWO clients in the live workbook, and the
 *    name alone would put the other company's shifts on this buyer's card;
 *  - two orders for one product each receive the whole total. (The window
 *    below closes an order only where this customer's NEXT order for the same
 *    product opens: a finished order with no later one still accrues for as
 *    long as the product is made for them, exactly as the staff figure does,
 *    and two orders opened days apart are split by DATE, not by which of them
 *    a shift really served. Neither is solved here.)
 *
 * The owner signed in as a customer and asked for the count ("I only see my
 * orders, not how many were made"), so it is shown — with three conditions a
 * shift row must meet, ALL of them, before it is credited to an order:
 *
 *  1. SAME PRODUCT — the row's product key equals the order's (the key
 *     lib/jobs.ts builds; this module never re-derives it).
 *  2. SAME CUSTOMER, READ OFF THE SHIFT ROW — the row's own «العميل» cell
 *     belongs to the account (`belongsToCustomer`, the exact-match link). THIS
 *     IS THE BOUNDARY. A row naming another client is never counted, whatever
 *     «الرئيسي» says. A row whose client cell is blank or filler counts only
 *     when the order is a `uniqueOwner` («الرئيسي» holds the product name ONCE
 *     and that row's client is this customer) AND the shift log itself never
 *     names another client on that product. «الرئيسي» alone is not proof: a
 *     name it lists once, under one client, can still stand on shift rows
 *     typed under another — there a blank could be either company's, so it is
 *     nobody's.
 *  3. INSIDE THE ORDER'S WINDOW — the row is dated on or after the order's
 *     start and BEFORE the start of this customer's next order for the same
 *     product. So one shift is credited to exactly one order. An order with no
 *     start date takes everything before the next order's start; a row with no
 *     readable date is credited to nothing.
 *
 * And it answers `null` — the page then prints NO number — when the split
 * cannot be made honestly: the order has no product, or two of the customer's
 * orders for one product share a start date (two blank ones included), because
 * a shift cannot be divided between them. A number that is sometimes wrong is
 * worse than no number on the screen a buyer reads instead of phoning.
 *
 * `0` is a real answer: nothing logged yet.
 *
 * `orders` are ONLY the caller's own — the route filters «أوامر العمل»!C by
 * the link before it gets here, exactly as `findReplay` is handed the caller's
 * own rows. Another customer's order is never in the list and therefore never
 * narrows a window or receives a piece.
 *
 * Pure: one pure sibling, no reader, no network. tests/customer-progress.test.ts
 * loads it through tests/_alias.ts, and tests/portal-access.test.ts pins the
 * import list.
 */
import { belongsToCustomer, clientKey } from "@/lib/customer-link";

/** One of the caller's OWN work orders, already shaped by the route. */
export type ProgressOrder = {
  /** The order's sheet row — unique, and the key of the answer. */
  id: string;
  /** lib/jobs.ts' product key for the order's product; "" when it has none. */
  productKey: string;
  /** ISO yyyy-mm-dd, or "" when «تاريخ البدء» is blank or unreadable. */
  startDate: string;
  /** «الرئيسي» holds this product name ONCE and that row's client is the
   *  customer's — the only case in which a shift row with a blank client cell
   *  may be counted. */
  uniqueOwner: boolean;
};

/** One «الإنتاج» shift row, as lib/jobs.ts shapes it (`productionRuns`). */
export type ProgressRun = {
  productKey: string;
  /** ISO yyyy-mm-dd, or "" when the date cell cannot be read. */
  date: string;
  /** «إنتاج سليم» — the typed count of good pieces. */
  goodUnits: number;
  /** The shift row's own «العميل» cell. */
  client: string;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A start date that is not a real ISO day is treated as blank. */
const startOf = (o: ProgressOrder): string => (ISO_DAY.test(o.startDate) ? o.startDate : "");
/** Good pieces a row contributes — a non-finite or negative cell is nothing. */
const piecesOf = (r: ProgressRun): number =>
  typeof r.goodUnits === "number" && Number.isFinite(r.goodUnits) && r.goodUnits > 0 ? r.goodUnits : 0;

/**
 * What an order's card prints under its quantity — decided HERE so the page
 * and the tests share one reading of it.
 *
 *  - `none`  — nothing at all: the count is unknown (`null`), or it is 0 on an
 *              order that has not started or is already closed;
 *  - `empty` — «لم يُسجَّل إنتاج بعد»: the order is in production and no shift
 *              has been credited to it yet;
 *  - `count` — the count, with the ordered total and a percentage when the
 *              ordered PIECE count is known. The percentage is capped at 100 so
 *              the bar never overflows; `made` is never capped — an order that
 *              ran over still states what was really made.
 */
export type ProgressLine =
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "count"; made: number; total: number | null; pct: number | null };

export function progressLine(
  produced: number | null | undefined,
  /** The customer-facing status: not_started · in_production · completed. */
  status: string | null | undefined,
  /** The ordered quantity in PIECES, or null when only kilograms are known. */
  totalPieces: number | null | undefined,
): ProgressLine {
  if (typeof produced !== "number" || !Number.isFinite(produced) || produced < 0) return { kind: "none" };
  const made = Math.round(produced);
  if (made === 0) return status === "in_production" ? { kind: "empty" } : { kind: "none" };
  const total =
    typeof totalPieces === "number" && Number.isFinite(totalPieces) && totalPieces > 0 ? Math.round(totalPieces) : null;
  // 100 means DONE and nothing less does: 4,990 of 5,000 rounds to 100 and
  // would paint a full green bar over an order still ten pieces short, and 40
  // of 90,000 rounds to 0 — an empty bar under a sentence that says 40 were
  // made. So an unfinished order reads 1–99, and only `made >= total` is 100.
  const pct =
    total === null ? null
    : made >= total ? 100
    : Math.max(1, Math.min(99, Math.round((made / total) * 100)));
  return { kind: "count", made, total, pct };
}

/**
 * The ordered quantity in PIECES a card measures the count against — or null
 * when only kilograms are known (the count is then shown with no total, no bar).
 *
 * A card that began as a request carries two candidates: the pieces the
 * customer TYPED and the pieces of the work order it became (the order's
 * kilograms through «الرئيسي»'s weight). They are the same number only until
 * somebody changes the order — the approval screen's kilograms are editable on
 * purpose, and the order can be edited afterwards. The ORDER is what the
 * factory is making, so it is the total; measured against the typed number, an
 * order approved for more would read 100% and green while it was still running.
 *
 * The typed number is kept only when the two agree within ROUNDING, so the bar
 * repeats the figure printed on the line above it: the order's kilograms are
 * stored to one decimal place, so going pieces → kg → pieces can move the
 * count by up to half a 0.1 kg step.
 */
export function orderedTotalPieces(
  /** Pieces the customer typed; null/0 when they asked in kg or never asked. */
  askedPieces: number | null | undefined,
  /** The work order's quantity in pieces; null when it has none. */
  orderPieces: number | null | undefined,
  /** The work order's kilograms — what `orderPieces` was worked out from. */
  orderKg?: number | null,
): number | null {
  const pos = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const asked = pos(askedPieces);
  const ordered = pos(orderPieces);
  if (asked === null || ordered === null) return ordered ?? asked;
  const kg = pos(orderKg);
  // Half of one 0.1 kg step, in pieces, plus one for the piece rounding.
  const step = kg === null ? 0 : ordered / (kg * 20) + 1;
  const slack = Math.max(1, asked * 0.005, step);
  return Math.abs(ordered - asked) <= slack ? asked : ordered;
}

/**
 * The produced piece count per order id — `null` where it cannot be stated.
 *
 * Every id in `orders` is a key of the answer; nothing else is.
 */
export function attributeProduction(
  orders: readonly ProgressOrder[],
  runs: readonly ProgressRun[],
  clientKeys: Set<string>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();

  // An account that answers to no client key owns nothing. Fail closed: with
  // no key, the only rows that could ever count are the blank-client ones.
  if (!clientKeys || clientKeys.size === 0) {
    for (const o of orders) out.set(o.id, null);
    return out;
  }

  // The customer's orders, per product.
  const byProduct = new Map<string, ProgressOrder[]>();
  for (const o of orders) {
    if (!o.productKey) { out.set(o.id, null); continue; }
    const list = byProduct.get(o.productKey);
    if (list) list.push(o); else byProduct.set(o.productKey, [o]);
  }
  if (byProduct.size === 0) return out;

  // The shift rows worth looking at, per product — dated, and either this
  // customer's or carrying no client at all. A row naming ANOTHER client is
  // dropped here and cannot reach a sum below — but it is REMEMBERED: a product
  // the log shows being made for somebody else is not this customer's alone,
  // whatever «الرئيسي» says, so its blank-client rows are credited to nobody.
  // Read before the date and the count: an undated or empty row is evidence too.
  type Row = { date: string; pieces: number; blank: boolean };
  const rowsByProduct = new Map<string, Row[]>();
  const foreign = new Set<string>();
  for (const r of runs) {
    if (!r || !r.productKey || !byProduct.has(r.productKey)) continue;
    const own = belongsToCustomer(r.client, clientKeys);
    const blank = !own && clientKey(r.client) === "";
    if (!own && !blank) { foreign.add(r.productKey); continue; }
    if (!ISO_DAY.test(r.date)) continue;
    const pieces = piecesOf(r);
    if (pieces === 0) continue;
    const list = rowsByProduct.get(r.productKey);
    const row = { date: r.date, pieces, blank };
    if (list) list.push(row); else rowsByProduct.set(r.productKey, [row]);
  }

  for (const [productKey, group] of byProduct) {
    const startCount = new Map<string, number>();
    for (const o of group) startCount.set(startOf(o), (startCount.get(startOf(o)) ?? 0) + 1);
    const rows = rowsByProduct.get(productKey) ?? [];

    for (const o of group) {
      const start = startOf(o);
      // Two orders of one product from the same day (or both undated): a shift
      // cannot be split between them, so neither is given a number.
      if ((startCount.get(start) ?? 0) > 1) { out.set(o.id, null); continue; }

      // The window closes where this customer's NEXT order for the product
      // opens — the earliest strictly later start. "" sorts before every ISO
      // day, so an undated order's window ends at the first dated one.
      let next = "";
      for (const other of group) {
        const s = startOf(other);
        if (s > start && (next === "" || s < next)) next = s;
      }

      let sum = 0;
      for (const r of rows) {
        if (start && r.date < start) continue;
        if (next && r.date >= next) continue;
        if (r.blank && (!o.uniqueOwner || foreign.has(productKey))) continue;
        sum += r.pieces;
      }
      out.set(o.id, Math.max(0, Math.round(sum)));
    }
  }
  return out;
}
