/**
 * «المخزون» in the customer portal — what a buyer may see of the stock the
 * factory holds for them, and the rules that decide when a figure is honest
 * enough to show.
 *
 * Source: «مخزن اتقان» as `getStorageData()` shapes it (lib/storage.ts) — the
 * balance tab plus the two movement logs. A row belongs to the customer iff
 * `belongsToCustomer(row.client, clientKeys)`: the SAME exact-key rule the
 * orders route uses, on the cell that says who OWNS the stock («العميل»),
 * never on «صرف لصالح».
 *
 * Three things here are decisions, not accidents:
 *
 *  1. **Lines are aggregated per item, across storage places.** A customer is
 *     never shown a slot, and the sum is also the only figure that is right: a
 *     withdrawal filed with no place against stock that sits in a slot leaves
 *     one line negative and one positive, and only their SUM is the stock.
 *
 *  2. **A figure the sheet cannot stand behind is not shown at all** — the
 *     line says «تحت المراجعة» and carries no number (`review`). Three rules
 *     fire it, each of them a real shape the storage sheet has held:
 *       - the summed balance is negative;
 *       - the sheet's figure disagrees with Σ movements (a balance formula
 *         typed over — two rows were, on 2026-09-02) — `netMismatch`, the
 *         same comparison the storekeeper's drawer makes;
 *       - one of the item's movements carries a number its log holds twice
 *         (`duplicateNums` — the twin has to be removed in the sheet first).
 *
 *  3. **A product kept by weight is stated in kilograms.** Two shapes, one
 *     answer (`unit: "kg"`, every figure rebuilt from the movements — never
 *     a piece count that is really a weight):
 *       - the storekeeper enters some products by kg with «وزن الحبة» = 1,
 *         so their «قطعة» is really grams (392,000 «قطعة» = 392 kg);
 *       - a product whose EVERY movement went over the scale (kilograms
 *         typed, no count) with a real piece weight. Its «قطعة» is only
 *         kg ÷ the piece weight somebody typed — fractional, and wrong the
 *         day a shot weight is typed for a piece weight — while the
 *         kilograms are what was measured.
 *     On such a line a movement that was NOT weighed is only trusted when
 *     its own «وزن الحبة» is exactly 1 (its «قطعة» are grams too); anything
 *     else makes the figure unknown (null), and Master's piece weight is
 *     never consulted — the line's pieces are not pieces.
 *     A product counted in pieces has its figures rounded to whole pieces.
 *
 * `PortalStockLine` is an exact whitelist (`PORTAL_STOCK_KEYS`), built key by
 * key, so nothing can ride along on the back of a later change to the storage
 * reader: no place, no loss, no client name, no movement number, no note, no
 * beneficiary, no Master weight.
 *
 * Pure. Its only imports are the two pure modules below, so Node's test runner
 * loads it (tests/customer-stock.test.ts maps the `@/` alias — the app's own
 * resolution is untouched).
 */
import {
  duplicateNums, dupKey, lineWeightKg, movementKg, netMismatch, normalizeText, storageDate, sumNet, toNumber,
  type WeighedMovement,
} from "@/lib/storage-filter";
import { belongsToCustomer, clientKey } from "@/lib/customer-link";

/* --------------------------------- shapes --------------------------------- */

/** A row of «الرصيد الحالي» — the fields this module reads, and no others. */
export type StockBalanceRow = {
  itemType: string; item: string; client: string; loc: string; unit: string;
  inQty: string; inLast: string; outQty: string; outLast: string; avail: string;
};

/** A row of «إيداع» / «سحب» — the fields this module reads, and no others. */
export type StockMovementRow = WeighedMovement & { unit?: string };

export type PortalStockKind = "product" | "material" | "other";

/** The exact key set of a line on the wire — pinned by tests/customer-stock.test.ts. */
export const PORTAL_STOCK_KEYS = [
  "kind", "item", "unit", "qty", "kg", "kgApprox", "received", "issued", "lastIn", "lastOut", "review",
] as const;

export type PortalStockLine = {
  kind: PortalStockKind;
  /** The item name as the sheet spells it. */
  item: string;
  /** "pcs" | "kg" | the sheet's own unit string for anything else. */
  unit: string;
  /** The balance in `unit`; null under review, or when it cannot be stated honestly. */
  qty: number | null;
  /** The balance in kilograms when it can be derived; for a kg line it equals `qty`. */
  kg: number | null;
  /** `kg` came from a piece weight rather than a scale. */
  kgApprox: boolean;
  /** Σ «وارد» in `unit`; null under review. */
  received: number | null;
  /** Σ «منصرف» in `unit`; null under review. */
  issued: number | null;
  /** Latest deposit, ISO yyyy-mm-dd; "" when none or unreadable. */
  lastIn: string;
  /** Latest withdrawal, same rule. */
  lastOut: string;
  /** The page shows «تحت المراجعة» and NO number. */
  review: boolean;
};

/** Why a line is under review — for the owner and the tests, NEVER on the wire. */
export type StockReviewReason = "negative" | "mismatch" | "duplicate";

export type CustomerStockDetail = {
  line: PortalStockLine;
  why: StockReviewReason[];
  /** The item is kept by weight and stated in kg (see rule 3 above — either shape). */
  weightOnly: boolean;
  /** Σ the sheet's own balance over the item's places, in the SHEET's unit. */
  sheetAvail: number;
  /** Σ deposits − Σ withdrawals of the item's movements, in the sheet's unit. */
  summed: number;
  /** How many balance rows (places) were added together. */
  places: number;
  /** How many movements belong to the item. */
  movements: number;
};

export type CustomerStockInput = {
  balance: readonly StockBalanceRow[];
  inLog: readonly StockMovementRow[];
  outLog: readonly StockMovementRow[];
  /** `lists.weights` — Master's piece weight in grams, by item name. */
  weights?: Record<string, number> | null;
  /** The guard's `customer.clientKeys` — never anything from the request. */
  clientKeys: Set<string>;
};

/* ---------------------------------- rules --------------------------------- */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** «خامة» → material (the storage module's own rule), «منتج» → product. */
export function stockKindOf(itemType: string | null | undefined): PortalStockKind {
  const t = String(itemType ?? "").trim();
  if (t.startsWith("خام")) return "material";
  if (t.startsWith("منتج")) return "product";
  return "other";
}

const PIECES = new Set(["قطعه", "قطع", "حبه", "pcs", "pc", "piece", "pieces"]);
const KILOS = new Set(["كجم", "كيلو", "كيلوجرام", "كغ", "kg", "kgs", "kilogram", "kilograms"]);

/**
 * "pcs" | "kg" | the sheet's own string. A blank unit takes the storage
 * sheet's convention — a material is kilograms, a product is pieces.
 */
export function stockUnitOf(unit: string | null | undefined, kind: PortalStockKind): string {
  const raw = String(unit ?? "").replace(/\s+/g, " ").trim();
  const k = normalizeText(raw); // folds ة → ه, so «قطعة» and «قطعه» are one unit
  if (PIECES.has(k)) return "pcs";
  if (KILOS.has(k)) return "kg";
  if (!k) return kind === "material" ? "kg" : kind === "product" ? "pcs" : "";
  return raw;
}

/**
 * A product movement put on the SCALE: kilograms typed, no count. The sheet
 * turns it into «قطعة» by dividing by «وزن الحبة», so the kilograms are the
 * measured figure and the pieces the derived one.
 */
export function isScaleEntry(m: StockMovementRow): boolean {
  if (stockKindOf(m.itemType) === "material") return false;
  return toNumber(m.qtyKg) > 0 && toNumber(m.qtyCount) === 0;
}

/**
 * A scale entry with «وزن الحبة» = 1 — the storekeeper's habit for the
 * products kept by weight. Its «قطعة» figure is the weight in grams, so it
 * must never be shown as a count.
 */
export function isWeightEntry(m: StockMovementRow): boolean {
  return isScaleEntry(m) && toNumber(m.grams) === 1;
}

/**
 * The kilograms of one movement on a line that is KEPT BY WEIGHT.
 *
 *  - a scale entry: the kilograms typed (or, when a loss was typed with it,
 *    its net × its OWN piece weight — `movementKg` without Master);
 *  - a counted entry whose own «وزن الحبة» is exactly 1: its «قطعة» are grams
 *    like the rest of the line (the shape a withdrawal spread over several
 *    places is written in);
 *  - anything else — a count typed with a real piece weight, or with none —
 *    cannot be weighed on such a line: pieces × grams would multiply a gram
 *    count by a piece weight. Unknown, never a guess.
 */
export function keptByWeightKg(m: StockMovementRow): { kg: number; approx: boolean } | null {
  if (isScaleEntry(m) || toNumber(m.grams) === 1) return movementKg(m);
  return null;
}

type Group = {
  kind: PortalStockKind;
  item: string;
  unit: string;
  rows: StockBalanceRow[];
  history: StockMovementRow[];
};

const KIND_ORDER: Record<PortalStockKind, number> = { product: 0, material: 1, other: 2 };

/** The later of two ISO dates ("" loses to anything). */
const later = (a: string, b: string): string => (b > a ? b : a);

/**
 * Every line of the customer's stock, with the reasons behind each review.
 * Server-side only: the route serialises `line` and nothing else.
 */
export function buildCustomerStockDetailed(input: CustomerStockInput): CustomerStockDetail[] {
  const keys = input.clientKeys;
  if (!keys || keys.size === 0) return [];
  const weights = input.weights ?? {};

  const groups = new Map<string, Group>();
  const groupFor = (itemType: string, item: string, unit: string | undefined): Group | null => {
    const name = String(item ?? "").replace(/\s+/g, " ").trim();
    const nameKey = clientKey(name);
    if (!nameKey) return null;
    const kind = stockKindOf(itemType);
    const u = stockUnitOf(unit, kind);
    const key = `${kind}|${nameKey}|${normalizeText(u)}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind, item: name, unit: u, rows: [], history: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const b of input.balance) {
    if (!belongsToCustomer(b.client, keys)) continue;
    groupFor(b.itemType, b.item, b.unit)?.rows.push(b);
  }

  // Numbers a log holds twice are looked for across the WHOLE log, the way the
  // storekeeper's page does: the twin of one of this customer's movements may
  // sit on anybody's line. Only a yes/no ever comes out of it.
  const all = [...input.inLog, ...input.outLog];
  const dups = duplicateNums(all);
  const mine = all.filter((m) => belongsToCustomer(m.client, keys));
  for (const m of mine) groupFor(m.itemType, m.item, m.unit)?.history.push(m);

  const out: CustomerStockDetail[] = [];
  for (const g of groups.values()) {
    const sheetAvail = r2(g.rows.reduce((acc, b) => acc + toNumber(b.avail), 0));
    const sheetIn = r2(g.rows.reduce((acc, b) => acc + toNumber(b.inQty), 0));
    const sheetOut = r2(g.rows.reduce((acc, b) => acc + toNumber(b.outQty), 0));
    const summed = sumNet(g.history);

    // Nothing was ever held under this name: no balance, nothing in, nothing
    // out, and no movement left unaccounted for. Not a line.
    if (sheetAvail === 0 && sheetIn === 0 && sheetOut === 0 && !netMismatch(0, summed)) continue;

    const why: StockReviewReason[] = [];
    if (sheetAvail < 0) why.push("negative");
    if (netMismatch(sheetAvail, summed)) why.push("mismatch");
    if (g.history.some((m) => dups.has(dupKey(m)))) why.push("duplicate");
    const review = why.length > 0;

    // Kept by weight: one entry of grams-dressed-as-pieces, or a line whose
    // every movement went over the scale (see rule 3 at the top).
    const weightOnly = g.kind !== "material" && g.unit === "pcs" &&
      (g.history.some(isWeightEntry) || (g.history.length > 0 && g.history.every(isScaleEntry)));
    const unit = weightOnly ? "kg" : g.unit;

    let lastIn = "", lastOut = "";
    for (const b of g.rows) {
      lastIn = later(lastIn, storageDate(b.inLast));
      lastOut = later(lastOut, storageDate(b.outLast));
    }
    for (const m of g.history) {
      const d = storageDate(m.date);
      if (m.log === "سحب") lastOut = later(lastOut, d);
      else lastIn = later(lastIn, d);
    }

    let qty: number | null = null, kg: number | null = null, kgApprox = false;
    let received: number | null = null, issued: number | null = null;

    if (!review && weightOnly) {
      // Every figure in kg, rebuilt from the movements — the sheet's own
      // columns hold a weight dressed as pieces. Not under review means the
      // sheet's balance IS Σ these movements, so they are the whole line.
      // Unknown stays null, never 0, and Master's weight is not consulted.
      const flow = (log: "إيداع" | "سحب"): { kg: number; approx: boolean } | null => {
        let t = 0, approx = false;
        for (const m of g.history) {
          if (m.log !== log) continue;
          const w = keptByWeightKg(m);
          if (!w) return null;
          t += w.kg;
          approx = approx || w.approx;
        }
        return { kg: r2(t), approx };
      };
      const inKg = flow("إيداع"), outKg = flow("سحب");
      received = inKg ? inKg.kg : null;
      issued = outKg ? outKg.kg : null;
      if (inKg && outKg) {
        qty = r2(inKg.kg - outKg.kg);
        kg = qty;
        kgApprox = inKg.approx || outKg.approx;
      }
    } else if (!review) {
      // A count is whole pieces: a fraction can only come out of a weight
      // divided by a piece weight, and is not a number of anything.
      const whole = (n: number) => (unit === "pcs" ? Math.round(n) || 0 : n);
      qty = whole(sheetAvail);
      received = whole(sheetIn);
      issued = whole(sheetOut);
      if (unit === "kg") {
        kg = sheetAvail; // already on the scale's unit
      } else if (unit === "pcs" && g.kind !== "material") {
        // The kilograms behind the item: each place weighed the way the
        // storekeeper's page weighs it, and unknown the moment one of them is.
        let total = 0, approx = false, known = g.rows.length > 0;
        for (const b of g.rows) {
          const w = lineWeightKg(b, g.history, weights[b.item]);
          if (!w) { known = false; break; }
          total += w.kg;
          approx = approx || w.approx;
        }
        if (known) { kg = r2(total); kgApprox = approx; }
      }
    }

    // Built key by key: the whitelist is this object literal.
    const line: PortalStockLine = {
      kind: g.kind,
      item: g.item,
      unit,
      qty,
      kg,
      kgApprox,
      received,
      issued,
      lastIn,
      lastOut,
      review,
    };
    out.push({ line, why, weightOnly, sheetAvail, summed, places: g.rows.length, movements: g.history.length });
  }

  return out.sort((a, b) =>
    KIND_ORDER[a.line.kind] - KIND_ORDER[b.line.kind] || a.line.item.localeCompare(b.line.item, "ar"));
}

/**
 * Kinds a customer is NOT shown. Materials are hidden at the owner's word
 * (2026-10-07: "hide the materials from the customer") — the received and
 * issued kilograms of a customer's own resin say how much the factory used,
 * which is the factory's business. They are dropped HERE, on the server, so a
 * material line never reaches the wire; hiding it on the page alone would leave
 * it one network tab away. The rules above still compute a material line
 * (`buildCustomerStockDetailed`), so emptying this set brings them back whole.
 */
export const HIDDEN_FROM_CUSTOMER: ReadonlySet<PortalStockKind> = new Set<PortalStockKind>(["material"]);

/** What `GET /api/portal/stock` answers with. */
export function buildCustomerStock(input: CustomerStockInput): PortalStockLine[] {
  return buildCustomerStockDetailed(input)
    .map((d) => d.line)
    .filter((line) => !HIDDEN_FROM_CUSTOMER.has(line.kind));
}
