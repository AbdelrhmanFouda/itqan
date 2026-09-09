/**
 * «المتاح في المخزن» — what the production side may PROMISE.
 *
 * The warehouse («مخزن اتقان»!«الرصيد الحالي») can only answer «الكمية
 * المتوفرة». Nothing in either workbook holds a RESERVED quantity, so stock
 * already promised against one work order still reads as free and gets
 * promised twice (2026-09-09 brief). This module computes, per item:
 *
 *     المتوفر   ← «الكمية المتوفرة», summed over the item's balance lines
 *     المحجوز   ← Σ «الكمية المطلوبة» of the OPEN work orders naming that
 *                  product (open = lib/work-orders.ts isOpenOrder: not
 *                  مكتمل / ملغي / delivered)
 *     المتاح    = المتوفر − المحجوز
 *
 * and it is honest about UNITS, which are not uniform: products are counted
 * in «قطعة», materials in «كجم», and «أوامر العمل» records kilograms even for
 * products. A kg order is converted to pieces with Master's piece weight (the
 * same rule lib/jobs.ts and the sheet's own «المطلوب بالقطعة» use), and only
 * then subtracted. When the conversion cannot be made — no piece weight, an
 * unreadable quantity, or the warehouse counting that product in a piece
 * weight that disagrees with Master (the weight-only products entered with
 * «وزن الحبة» = 1, whose «قطعة» is really grams) — the row says «الوحدة
 * مختلفة» and shows the kilograms separately. Two numbers in different units
 * are never added.
 *
 * Materials get no reservation: a work order names a PRODUCT, and turning
 * that into kilograms of a particular grade is a second conversion this
 * version does not make. Their المتاح is their المتوفر, and the row says so.
 *
 * Pure, zero imports (the folding is copied from lib/storage-filter.ts and
 * tests/stock.test.ts asserts the two agree), unit-tested.
 */

/* --------------------------------- inputs --------------------------------- */

/** One row of «الرصيد الحالي» as lib/storage.ts maps it. */
export type StockBalanceLine = {
  itemType: string; item: string; client: string; loc: string; unit: string;
  /** Display value — «2,050», «0», «-195». */
  avail: string | number;
};

/** One work order as lib/jobs.ts shapes it — the fields this needs. */
export type StockOrder = {
  id: string; code: string; client: string; product: string; status: string; dueDate: string;
  /** Kilograms as typed, null when blank or unreadable. */
  qtyKg: number | null;
  qtyUnreadable: boolean;
  /** Pieces = kg × 1000 ÷ Master's piece weight; 0 when Master has no weight. */
  qtyPieces: number;
  /** The piece weight (g) the conversion used; 0 when none. */
  pieceWeightG: number;
};

/** A row of «كتالوج الخامات» (materials only), when the bridge serves it. */
export type StockCatalogRow = { item: string; unit: string; min: number | null };

/* -------------------------------- outputs --------------------------------- */

export type ReservedNote =
  /** Reserved is a number in the row's own unit. */
  | "ok"
  /** No open order names this item — reserved is 0 by observation. */
  | "none"
  /** A material: work orders reserve products, not kilograms of a grade. */
  | "material"
  /** Orders exist but cannot be expressed in the row's unit («الوحدة مختلفة»). */
  | "unit"
  /** Some open order has no readable quantity, so the sum cannot be stated. */
  | "unknown";

export type StockLineOut = { client: string; loc: string; avail: number; unit: string };
export type StockOrderOut = {
  id: string; code: string; client: string; status: string; dueDate: string;
  qtyKg: number | null; qtyPieces: number; qtyUnreadable: boolean;
};

export type StockRow = {
  key: string;
  itemType: string;
  item: string;
  /** The unit المتوفر is stated in; "" when the item's lines disagree. */
  unit: string;
  unitMixed: boolean;
  clients: string[];
  locs: string[];
  lines: StockLineOut[];
  /** Σ avail over the lines. null when the lines' units disagree. */
  available: number | null;
  reserved: number | null;
  reservedNote: ReservedNote;
  /** Σ kg over the open orders (readable ones) — always shown beside a
   *  reservation, and the only figure when the pieces cannot be stated. */
  reservedKg: number;
  /** Some open order's quantity could not be read at all. */
  reservedUnreadable: boolean;
  /** available − reserved; equals available for a material; null when
   *  either side is unknown. */
  net: number | null;
  min: number | null;
  belowMin: boolean;
  orders: StockOrderOut[];
};

/* --------------------------------- folding -------------------------------- */

// Same folding as normalizeText() in lib/storage-filter.ts — copied, because a
// module Node's test runner loads directly imports nothing; the test pins
// that the two agree on the values that matter.
const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
export function itemKey(s: string | number | undefined | null): string {
  return String(s ?? "")
    .replace(AR_DIACRITICS, "")
    .replace(/ـ/g, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[أإآٱٲٳ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** «2,050» / «-195» / 3 → number; anything else → 0. Mirrors storage-filter's toNumber. */
export function toNumber(v: string | number | undefined | null): number {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** The sheet writes «خامة»/«منتج»; tolerate «خامات» and stray spaces. */
export const isMaterialType = (t: string | undefined | null): boolean => String(t ?? "").trim().startsWith("خام");

const PIECES = new Set(["قطعة", "قطعه", "قطع", "pcs", "pc", "piece", "pieces"]);
const KILOS = new Set(["كجم", "كيلو", "كيلوجرام", "kg", "kgs", "kilogram"]);
export const unitKind = (u: string | undefined | null): "pieces" | "kg" | "other" => {
  const k = itemKey(u);
  if (PIECES.has(k)) return "pieces";
  if (KILOS.has(k)) return "kg";
  return "other";
};

/* ------------------------- the warehouse's own weight ---------------------- */

/**
 * The piece weight the STOREKEEPER used for a product — the most common
 * «وزن الحبة» on its deposits. The weight-only products are entered by kg
 * with «وزن الحبة» = 1 (their «قطعة» is grams: 392,000 = 392 kg), which is
 * nothing like Master's real weight. Subtracting Master-converted pieces from
 * such a line would be wrong by the whole weight, so `computeStock` compares
 * the two and refuses when they disagree.
 */
export function dominantGrams(
  movements: readonly { item: string; grams: string | number | undefined }[],
): Record<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const m of movements) {
    const k = itemKey(m.item);
    const g = toNumber(m.grams);
    if (!k || !(g > 0)) continue;
    const c = counts.get(k) ?? new Map<number, number>();
    c.set(g, (c.get(g) ?? 0) + 1);
    counts.set(k, c);
  }
  const out: Record<string, number> = {};
  for (const [k, c] of counts) {
    let best = 0, n = -1;
    for (const [g, cnt] of c) if (cnt > n) { best = g; n = cnt; }
    out[k] = best;
  }
  return out;
}

/** Two piece weights that would make «قطعة» mean two different things. */
export function weightsDisagree(storeGrams: number | undefined, masterGrams: number): boolean {
  if (!storeGrams || !(storeGrams > 0) || !(masterGrams > 0)) return false;
  const r = storeGrams / masterGrams;
  return r > 1.25 || r < 0.8;
}

/* --------------------------------- compute -------------------------------- */

export type ComputeStockInput = {
  balance: readonly StockBalanceLine[];
  orders: readonly StockOrder[];
  /** «كتالوج الخامات» rows, [] when the bridge does not serve the tab. */
  catalog?: readonly StockCatalogRow[];
  /** From dominantGrams() over the deposit log; {} when unknown. */
  storeGrams?: Record<string, number>;
  /** lib/work-orders.ts isOpenOrder — passed in to stay import-free. */
  isOpen: (status: string) => boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeStock(input: ComputeStockInput): StockRow[] {
  const { balance, orders, catalog = [], storeGrams = {}, isOpen } = input;

  // open orders by product key
  const openBy = new Map<string, StockOrder[]>();
  for (const o of orders) {
    if (!isOpen(o.status)) continue;
    const k = itemKey(o.product);
    if (!k) continue;
    const arr = openBy.get(k) ?? [];
    arr.push(o);
    openBy.set(k, arr);
  }

  // catalogue minimums by material key
  const minBy = new Map<string, number>();
  for (const c of catalog) {
    const k = itemKey(c.item);
    if (k && c.min !== null && Number.isFinite(c.min)) minBy.set(k, c.min);
  }

  // one row per (type, item), lines kept in sheet order
  const rows = new Map<string, StockRow>();
  for (const b of balance) {
    const ik = itemKey(b.item);
    if (!ik) continue;
    const type = isMaterialType(b.itemType) ? "خامة" : "منتج";
    const key = `${type}|${ik}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key, itemType: b.itemType.trim() || type, item: b.item.trim(), unit: b.unit.trim(), unitMixed: false,
        clients: [], locs: [], lines: [], available: 0, reserved: null, reservedNote: "none", reservedKg: 0,
        reservedUnreadable: false, net: null, min: null, belowMin: false, orders: [],
      };
      rows.set(key, row);
    }
    const avail = toNumber(b.avail);
    row.lines.push({ client: b.client.trim(), loc: b.loc.trim(), avail, unit: b.unit.trim() });
    if (b.client.trim() && !row.clients.includes(b.client.trim())) row.clients.push(b.client.trim());
    if (b.loc.trim() && !row.locs.includes(b.loc.trim())) row.locs.push(b.loc.trim());
    if (unitKind(b.unit) !== unitKind(row.unit) || (unitKind(b.unit) === "other" && itemKey(b.unit) !== itemKey(row.unit))) {
      row.unitMixed = true;
    }
  }

  for (const row of rows.values()) {
    const ik = row.key.slice(row.key.indexOf("|") + 1);
    row.available = row.unitMixed ? null : r2(row.lines.reduce((a, l) => a + l.avail, 0));
    const open = openBy.get(ik) ?? [];
    row.orders = open.map((o) => ({
      id: o.id, code: o.code, client: o.client, status: o.status, dueDate: o.dueDate,
      qtyKg: o.qtyKg, qtyPieces: o.qtyPieces, qtyUnreadable: o.qtyUnreadable,
    }));
    row.reservedKg = r2(open.reduce((a, o) => a + (o.qtyKg ?? 0), 0));
    row.reservedUnreadable = open.some((o) => o.qtyUnreadable);

    const material = isMaterialType(row.itemType);
    if (material) {
      row.reservedNote = "material";
      row.reserved = null;
      row.net = row.available;
    } else if (open.length === 0) {
      row.reservedNote = "none";
      row.reserved = 0;
      row.net = row.available;
    } else if (row.unitMixed) {
      row.reservedNote = "unit";
      row.reserved = null;
      row.net = null;
    } else {
      const kind = unitKind(row.unit);
      // An order with no readable quantity makes the SUM unknown; an order
      // whose kilograms cannot become this row's unit makes it a unit problem.
      // Both leave reserved null — they are told apart so the screen can say
      // which. A unit problem is the stronger statement and wins.
      const unknown = open.some((o) => o.qtyUnreadable || o.qtyKg === null);
      let unit = false;
      let reserved = 0;
      if (kind === "kg") {
        // the warehouse counts this product by weight — the order is already in kg
        reserved = row.reservedKg;
      } else if (kind === "pieces") {
        for (const o of open) {
          if (o.qtyKg === null || o.qtyUnreadable) continue; // already "unknown"
          if (!(o.qtyPieces > 0) || !(o.pieceWeightG > 0) || weightsDisagree(storeGrams[ik], o.pieceWeightG)) {
            unit = true;
            break;
          }
          reserved += o.qtyPieces;
        }
      } else {
        unit = true;
      }
      if (unit) { row.reserved = null; row.reservedNote = "unit"; }
      else if (unknown) { row.reserved = null; row.reservedNote = "unknown"; }
      else { row.reserved = r2(reserved); row.reservedNote = "ok"; }
      row.net = row.reserved === null || row.available === null ? null : r2(row.available - row.reserved);
    }

    const min = minBy.get(ik);
    row.min = min !== undefined ? min : null;
    row.belowMin = row.min !== null && row.net !== null && row.net < row.min;
  }

  return Array.from(rows.values());
}

/* --------------------------------- ordering ------------------------------- */

/**
 * Default order: المتاح ascending, so what is nearly gone is at the top.
 * Rows whose المتاح cannot be stated («الوحدة مختلفة») come after the
 * numbers, in name order — they are flagged, not hidden.
 */
export function compareByNet(a: StockRow, b: StockRow): number {
  const an = a.net, bn = b.net;
  if (an === null && bn === null) return a.item.localeCompare(b.item, "ar");
  if (an === null) return 1;
  if (bn === null) return -1;
  if (an !== bn) return an - bn;
  return a.item.localeCompare(b.item, "ar");
}
