/**
 * «المتاح في المخزن» (lib/stock.ts). Run with `npm test`.
 *
 * Fixtures follow the live shapes of 2026-09-09: «الرصيد الحالي» lines with
 * display values («2,050»), products in «قطعة», materials in «كجم», work
 * orders in kilograms converted to pieces through Master's piece weight.
 * The rule under test is the brief's: never add two numbers with different
 * units — say «الوحدة مختلفة» instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareByNet, computeStock, dominantGrams, isMaterialType, itemKey, toNumber, unitKind, weightsDisagree,
  type StockBalanceLine, type StockOrder,
} from "../lib/stock.ts";
import { isOpenOrder } from "../lib/work-orders.ts";
import { normalizeText } from "../lib/storage-filter.ts";

const line = (o: Partial<StockBalanceLine> & { item: string }): StockBalanceLine => ({
  itemType: "منتج", client: "", loc: "", unit: "قطعة", avail: "0", ...o,
});
const order = (o: Partial<StockOrder> & { product: string }): StockOrder => ({
  id: "2", code: "X-1", client: "c", status: "Not Started", dueDate: "", qtyKg: 30, qtyUnreadable: false,
  qtyPieces: 30_000, pieceWeightG: 1, ...o,
});
const run = (balance: StockBalanceLine[], orders: StockOrder[], extra: Partial<Parameters<typeof computeStock>[0]> = {}) =>
  computeStock({ balance, orders, isOpen: isOpenOrder, ...extra });

/* -------------------------------- folding --------------------------------- */

test("itemKey agrees with storage-filter's normalizeText on the spellings that matter", () => {
  for (const s of ["بصمه", "بصمة", "إسطمبة", "اسطمبه", "ABS اسود مخرز", "  m50 ", "معلقه صغيره", "٣ كيلو"]) {
    assert.equal(itemKey(s), normalizeText(s), s);
  }
  assert.equal(itemKey("بصمه"), itemKey("بصمة"));
});

test("units and types are read tolerantly", () => {
  assert.equal(unitKind("قطعة"), "pieces");
  assert.equal(unitKind("كجم"), "kg");
  assert.equal(unitKind("طن"), "other");
  assert.equal(isMaterialType("خامة"), true);
  assert.equal(isMaterialType("خامات"), true);
  assert.equal(isMaterialType("منتج"), false);
  assert.equal(toNumber("2,050"), 2050);
  assert.equal(toNumber("-195"), -195);
  assert.equal(toNumber("غير متاح / N/A"), 0);
});

/* -------------------------------- products -------------------------------- */

test("a product's lines are summed and open orders are subtracted in PIECES", () => {
  const rows = run(
    [line({ item: "بصمه", client: "مينا صبحي", loc: "A12", avail: "50,000" }), line({ item: "بصمه", client: "مينا صبحي", loc: "F1", avail: "10,000" })],
    [order({ product: "بصمه", qtyKg: 30, qtyPieces: 30_000 })],
  );
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.available, 60_000);
  assert.equal(r.reserved, 30_000);
  assert.equal(r.reservedKg, 30);
  assert.equal(r.reservedNote, "ok");
  assert.equal(r.net, 30_000);
  assert.deepEqual(r.locs, ["A12", "F1"]);
  assert.deepEqual(r.clients, ["مينا صبحي"]);
  assert.equal(r.orders.length, 1);
});

test("a closed order reserves nothing; a product with no orders is 'none' and net = available", () => {
  const rows = run(
    [line({ item: "بصمه", avail: "100" })],
    [order({ product: "بصمه", status: "Completed" }), order({ id: "3", product: "بصمه", status: "ملغي" })],
  );
  assert.deepEqual([rows[0].reserved, rows[0].reservedNote, rows[0].net], [0, "none", 100]);
});

test("an order whose kg cannot become pieces makes the row «الوحدة مختلفة», and the kg are still shown", () => {
  // no piece weight in Master → qtyPieces 0
  let rows = run([line({ item: "خابور", avail: "500" })], [order({ product: "خابور", qtyKg: 50, qtyPieces: 0, pieceWeightG: 0 })]);
  assert.equal(rows[0].reserved, null);
  assert.equal(rows[0].reservedNote, "unit");
  assert.equal(rows[0].net, null, "never available − (something in another unit)");
  assert.equal(rows[0].reservedKg, 50, "the kilograms are known and shown on their own");
  // an unreadable quantity («3.1طن») is a different statement: the SUM is unknown
  rows = run([line({ item: "كليب شد", avail: "9,000" })], [order({ product: "كليب شد", qtyKg: null, qtyUnreadable: true, qtyPieces: 0 })]);
  assert.equal(rows[0].reservedNote, "unknown");
  assert.equal(rows[0].reserved, null);
  assert.equal(rows[0].net, null);
  assert.equal(rows[0].reservedUnreadable, true);
  // …and so is a blank one (nothing typed yet) — never counted as 0 kg
  rows = run([line({ item: "كليب شد", avail: "9,000" })], [order({ product: "كليب شد", qtyKg: null, qtyUnreadable: false, qtyPieces: 0 })]);
  assert.equal(rows[0].reservedNote, "unknown");
  // a unit problem on one order outranks an unknown quantity on another
  rows = run(
    [line({ item: "x", avail: "10" })],
    [order({ id: "1", product: "x", qtyKg: null, qtyPieces: 0 }), order({ id: "2", product: "x", qtyKg: 5, qtyPieces: 0, pieceWeightG: 0 })],
  );
  assert.equal(rows[0].reservedNote, "unit");
});

test("the warehouse's own piece weight disagreeing with Master's refuses the subtraction", () => {
  // «معلقه صغيره» is entered by kg with «وزن الحبة» = 1: its «قطعة» is grams.
  // Master says 2.5 g. 392,000 «pieces» − 100 kg ÷ 2.5 g = 40,000 would be nonsense.
  const rows = run(
    [line({ item: "معلقه صغيره", avail: "392,000" })],
    [order({ product: "معلقه صغيره", qtyKg: 100, qtyPieces: 40_000, pieceWeightG: 2.5 })],
    { storeGrams: { [itemKey("معلقه صغيره")]: 1 } },
  );
  assert.equal(rows[0].reservedNote, "unit");
  assert.equal(rows[0].net, null);
  // when the two weights agree (within tolerance), the pieces subtract
  const ok = run(
    [line({ item: "بصمه", avail: "50,000" })],
    [order({ product: "بصمه", qtyKg: 30, qtyPieces: 30_000, pieceWeightG: 1 })],
    { storeGrams: { [itemKey("بصمه")]: 1 } },
  );
  assert.equal(ok[0].net, 20_000);
  assert.equal(weightsDisagree(1, 2.5), true);
  assert.equal(weightsDisagree(18, 18.5), false);
  assert.equal(weightsDisagree(undefined, 18), false, "no warehouse weight → trust Master");
});

test("dominantGrams picks the piece weight the storekeeper used most", () => {
  const g = dominantGrams([
    { item: "معلقه صغيره", grams: "1" }, { item: "معلقه صغيره", grams: "1" }, { item: "معلقه صغيره", grams: "2.5" },
    { item: "بصمه", grams: "" }, { item: "زراير", grams: "3.6" },
  ]);
  assert.equal(g[itemKey("معلقه صغيره")], 1);
  assert.equal(g[itemKey("زراير")], 3.6);
  assert.equal(itemKey("بصمه") in g, false);
});

test("a product the warehouse counts in kg takes the order's kilograms directly", () => {
  const rows = run([line({ item: "حبيبات", unit: "كجم", avail: "1,000" })], [order({ product: "حبيبات", qtyKg: 250, qtyPieces: 0, pieceWeightG: 0 })]);
  assert.deepEqual([rows[0].reserved, rows[0].reservedNote, rows[0].net], [250, "ok", 750]);
});

test("lines of one item that disagree on unit cannot be summed", () => {
  const rows = run([line({ item: "x", unit: "قطعة", avail: "10" }), line({ item: "x", unit: "كجم", avail: "5" })], []);
  assert.equal(rows[0].unitMixed, true);
  assert.equal(rows[0].available, null);
  assert.equal(rows[0].net, null);
});

/* -------------------------------- materials ------------------------------- */

test("a material is never reserved by a work order: المتاح = المتوفر, and the row says why", () => {
  const rows = run(
    [line({ itemType: "خامة", item: "ABS اسود مخرز", client: "اتقان", loc: "B12", unit: "كجم", avail: "2,050" })],
    [order({ product: "ABS اسود مخرز" })], // an order naming a material by mistake still reserves nothing
  );
  assert.equal(rows[0].reserved, null);
  assert.equal(rows[0].reservedNote, "material");
  assert.equal(rows[0].net, 2050);
});

test("«الحد الأدنى» from the catalogue flags a material whose المتاح is below it; absent → no flag", () => {
  const balance = [line({ itemType: "خامة", item: "PC شفاف", unit: "كجم", avail: "200" }), line({ itemType: "خامة", item: "اوميا", unit: "كجم", avail: "2,825" })];
  const rows = run(balance, [], { catalog: [{ item: "PC شفاف", unit: "كجم", min: 500 }, { item: "اوميا", unit: "كجم", min: null }] });
  const pc = rows.find((r) => r.item === "PC شفاف")!, om = rows.find((r) => r.item === "اوميا")!;
  assert.deepEqual([pc.min, pc.belowMin], [500, true]);
  assert.deepEqual([om.min, om.belowMin], [null, false]);
  assert.equal(run(balance, [])[0].min, null, "no catalogue → no minimum, no flag");
});

/* -------------------------------- ordering -------------------------------- */

test("default order: المتاح ascending — nearly gone first; unknown units after the numbers", () => {
  const rows = run(
    [
      line({ item: "a", avail: "500" }), line({ item: "b", avail: "-195" }), line({ item: "c", avail: "20" }),
      line({ item: "d", avail: "10" }),
    ],
    [order({ product: "d", qtyKg: 1, qtyPieces: 0, pieceWeightG: 0 })], // d → unit mismatch
  ).sort(compareByNet);
  assert.deepEqual(rows.map((r) => r.item), ["b", "c", "a", "d"]);
});

test("a product's reserved orders carry what the screen lists: code, client, kg, pieces, status, due", () => {
  const rows = run([line({ item: "كليب شد", avail: "0" })], [order({ product: "كليب شد", code: "Pro/tec 01", client: "بروتك", qtyKg: 3100, qtyPieces: 14_762, pieceWeightG: 210, status: "In Production", dueDate: "2026-08-23" })]);
  assert.deepEqual(rows[0].orders, [{ id: "2", code: "Pro/tec 01", client: "بروتك", status: "In Production", dueDate: "2026-08-23", qtyKg: 3100, qtyPieces: 14_762, qtyUnreadable: false }]);
  assert.equal(rows[0].net, -14_762, "promised more than is standing — the number goes negative, it is not clamped");
});
