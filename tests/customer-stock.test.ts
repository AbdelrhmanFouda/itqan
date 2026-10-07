/**
 * «المخزون» in the customer portal — lib/customer-stock.ts.
 *
 * Two kinds of promise are pinned here, and each of them fails silently if it
 * breaks:
 *
 *  - the BOUNDARY: a line is built from the customer's own rows and from
 *    nothing else, and it carries eleven keys — no place, no client name, no
 *    movement number, no note, no beneficiary;
 *  - the HONESTY rules: a figure the sheet cannot stand behind is replaced by
 *    «تحت المراجعة» with every number null, a product kept by weight is stated
 *    in kilograms, and an unknown weight is null — never a zero.
 *
 * Every name below is invented. The GitHub repo is public: no live row, no
 * real client and no real quantity belongs in this file.
 *
 * Run with `npm test`.
 */
import "./_alias.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKeysOf } from "../lib/customer-link.ts";
import { netMismatch } from "../lib/storage-filter.ts";

// Loaded dynamically: the module imports its siblings through `@/`, which
// tests/_alias.ts maps — and a static import would be linked before it could.
const {
  HIDDEN_FROM_CUSTOMER, PORTAL_STOCK_KEYS, buildCustomerStock, buildCustomerStockDetailed, isScaleEntry, isWeightEntry, keptByWeightKg,
  stockKindOf, stockUnitOf,
} = await import("../lib/customer-stock.ts");

/* -------------------------------- fixtures -------------------------------- */

const A = "عميل أ";
const B = "عميل ب";
const KEYS = clientKeysOf([{ no: 1, name: A, aliases: ["عميل أ للتجارة"] }]);

type Row = Record<string, string>;

/** A «الرصيد الحالي» row as lib/storage.ts shapes it — `loss` included, on purpose. */
function bal(over: Row): Row {
  return {
    itemType: "منتج", item: "منتج 1", client: A, loc: "", unit: "قطعة",
    inQty: "0", inLast: "", outQty: "0", outLast: "", loss: "0", avail: "0",
    ...over,
  };
}

let seq = 0;
/** A log row as lib/storage.ts shapes it — notes and «صرف لصالح» included. */
function mv(log: "إيداع" | "سحب", over: Row): Row {
  seq += 1;
  return {
    log, num: `T${String(seq).padStart(4, "0")}`, itemType: "منتج", item: "منتج 1", client: A, loc: "",
    date: "2026-01-10", qtyCount: "0", qtyKg: "", grams: "0", loss: "0", qtyFromWt: "", net: "0",
    unit: "قطعة", notes: "ملاحظة داخلية", forClient: "",
    ...over,
  };
}

type Input = { balance: Row[]; inLog?: Row[]; outLog?: Row[]; weights?: Record<string, number>; keys?: Set<string> };
const input = (i: Input) => ({
  balance: i.balance as never, inLog: (i.inLog ?? []) as never, outLog: (i.outLog ?? []) as never,
  weights: i.weights ?? {}, clientKeys: i.keys ?? KEYS,
});
const build = (i: Input) => buildCustomerStock(input(i));
const detail = (i: Input) => buildCustomerStockDetailed(input(i));
/** Every computed line, hidden kinds included — the rules, before the customer's cut. */
const detailLines = (i: Input) => detail(i).map((d) => d.line);

/* ------------------------------ the aggregation ---------------------------- */

test("one item standing in two places is ONE line, summed", () => {
  const lines = build({
    balance: [
      bal({ loc: "A11", inQty: "600", inLast: "2026-01-10", avail: "600" }),
      bal({ loc: "B21", inQty: "400", inLast: "2026-02-03", outQty: "150", outLast: "2026-02-20", avail: "250" }),
    ],
    inLog: [
      mv("إيداع", { loc: "A11", qtyCount: "600", net: "600", date: "2026-01-10" }),
      mv("إيداع", { loc: "B21", qtyCount: "400", net: "400", date: "2026-02-03" }),
    ],
    outLog: [mv("سحب", { loc: "B21", qtyCount: "150", net: "150", date: "2026-02-20" })],
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    kind: "product", item: "منتج 1", unit: "pcs", qty: 850, kg: null, kgApprox: false,
    received: 1000, issued: 150, lastIn: "2026-02-03", lastOut: "2026-02-20", review: false,
  });
});

test("the name is compared folded (spaces, digits, case) and printed as the sheet spells it", () => {
  const lines = build({
    balance: [
      bal({ item: "ABS منتج 1", loc: "A11", inQty: "10", avail: "10" }),
      bal({ item: "abs  منتج ١", loc: "A12", inQty: "5", avail: "5" }),
    ],
    inLog: [
      mv("إيداع", { item: "ABS منتج 1", loc: "A11", qtyCount: "10", net: "10" }),
      mv("إيداع", { item: "abs منتج ١", loc: "A12", qtyCount: "5", net: "5" }),
    ],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].item, "ABS منتج 1");
  assert.equal(lines[0].qty, 15);
});

test("the same name as a product and as a material is two lines", () => {
  const lines = detailLines({
    balance: [
      bal({ item: "صنف", inQty: "10", avail: "10" }),
      bal({ item: "صنف", itemType: "خامة", unit: "كجم", inQty: "25", avail: "25" }),
    ],
    inLog: [
      mv("إيداع", { item: "صنف", qtyCount: "10", net: "10" }),
      mv("إيداع", { item: "صنف", itemType: "خامة", unit: "كجم", qtyKg: "25", net: "25" }),
    ],
  });
  assert.deepEqual(lines.map((l) => [l.kind, l.unit, l.qty]), [["product", "pcs", 10], ["material", "kg", 25]]);
});

/* ------------------------------- the boundary ------------------------------ */

test("the client filter is exact — an alias and a trailing space match, a longer name does not", () => {
  const lines = build({
    balance: [
      bal({ client: `${A} `, loc: "A11", inQty: "10", avail: "10" }),            // trailing space
      bal({ client: "عميل أ للتجارة", loc: "A12", inQty: "20", avail: "20" }),    // an approved alias
      bal({ client: "عميل أ الجديد", loc: "A13", inQty: "4000", avail: "4000" }), // a DIFFERENT customer
      bal({ client: "عميل", loc: "A14", inQty: "5000", avail: "5000" }),          // a prefix of the name
      bal({ client: "غير متاح / N/A", loc: "A15", inQty: "6000", avail: "6000" }),// the filler is nobody
    ],
    inLog: [
      mv("إيداع", { client: `${A} `, loc: "A11", qtyCount: "10", net: "10" }),
      mv("إيداع", { client: "عميل أ للتجارة", loc: "A12", qtyCount: "20", net: "20" }),
      mv("إيداع", { client: "عميل أ الجديد", loc: "A13", qtyCount: "4000", net: "4000" }),
    ],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 30);
  assert.equal(lines[0].received, 30);
});

test("another client's row with the SAME item name is not added in", () => {
  const lines = build({
    balance: [
      bal({ loc: "A11", inQty: "100", avail: "100" }),
      bal({ client: B, loc: "A11", inQty: "7777", avail: "7777" }),
    ],
    inLog: [
      mv("إيداع", { loc: "A11", qtyCount: "100", net: "100" }),
      mv("إيداع", { client: B, loc: "A11", qtyCount: "7777", net: "7777" }),
    ],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 100);
  assert.equal(lines[0].received, 100);
  assert.equal(JSON.stringify(lines).includes("7777"), false);
});

test("the owner of the stock is «العميل» — «صرف لصالح» opens nothing", () => {
  // B's material, issued FOR customer A's job. It is still B's stock.
  const lines = build({
    balance: [bal({ client: B, itemType: "خامة", item: "خامة 1", unit: "كجم", inQty: "500", outQty: "200", avail: "300" })],
    inLog: [mv("إيداع", { client: B, itemType: "خامة", item: "خامة 1", unit: "كجم", qtyKg: "500", net: "500" })],
    outLog: [mv("سحب", { client: B, itemType: "خامة", item: "خامة 1", unit: "كجم", qtyKg: "200", net: "200", forClient: A })],
  });
  assert.deepEqual(lines, []);
});

test("an account with no link sees nothing", () => {
  const rows = { balance: [bal({ inQty: "10", avail: "10" })], inLog: [mv("إيداع", { qtyCount: "10", net: "10" })] };
  assert.deepEqual(build({ ...rows, keys: new Set() }), []);
  assert.deepEqual(build({ ...rows, keys: clientKeysOf([{ no: 0, name: "غير متاح", aliases: [""] }]) }), []);
});

test("a line carries exactly the whitelisted keys, whatever the source rows hold", () => {
  // every computed line, the hidden kinds included — the whitelist holds for all of them
  const lines = detailLines({
    balance: [
      { ...bal({ loc: "A11", inQty: "10", avail: "10" }), min: "50", price: "12.5", secret: "x" },
      bal({ itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "T", inQty: "5", avail: "5" }),
      bal({ item: "منتج 2", loc: "B12", inQty: "9", avail: "-9" }), // a review line has the same keys
    ],
    inLog: [
      { ...mv("إيداع", { loc: "A11", qtyCount: "10", net: "10" }), operator: "someone", cost: "99" },
      mv("إيداع", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "T", qtyKg: "5", net: "5" }),
    ],
  });
  assert.equal(lines.length, 3);
  for (const l of lines) assert.deepEqual(Object.keys(l), [...PORTAL_STOCK_KEYS]);
  assert.deepEqual([...PORTAL_STOCK_KEYS], [
    "kind", "item", "unit", "qty", "kg", "kgApprox", "received", "issued", "lastIn", "lastOut", "review",
  ]);
});

test("no place, client name, movement number, note or beneficiary reaches a line", () => {
  // scanned over every computed line, so the rule also covers a kind that is hidden today
  const lines = detailLines({
    balance: [
      bal({ loc: "A11", inQty: "600", avail: "600" }),
      bal({ loc: "رف", inQty: "400", avail: "400" }),
      bal({ client: "عميل أ للتجارة", itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "F3", inQty: "80", outQty: "30", avail: "50" }),
    ],
    inLog: [
      mv("إيداع", { num: "SECRET0001", loc: "A11", qtyCount: "600", net: "600", notes: "سر المصنع" }),
      mv("إيداع", { num: "SECRET0002", loc: "رف", qtyCount: "400", net: "400" }),
      mv("إيداع", { num: "SECRET0003", client: "عميل أ للتجارة", itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "F3", qtyKg: "80", net: "80" }),
    ],
    outLog: [
      mv("سحب", { num: "SECRET0004", client: "عميل أ للتجارة", itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "F3", qtyKg: "30", net: "30", forClient: "مستفيد سري" }),
    ],
  });
  assert.equal(lines.length, 2);
  const forbidden = ["A11", "رف", "F3", A, B, "عميل أ للتجارة", "SECRET", "سر المصنع", "ملاحظة داخلية", "مستفيد سري"];
  for (const l of lines) {
    for (const v of Object.values(l)) {
      for (const f of forbidden) assert.notEqual(v, f, `a line value equals «${f}»`);
    }
  }
  const wire = JSON.stringify(lines);
  for (const f of forbidden) assert.equal(wire.includes(f), false, `the answer contains «${f}»`);
});

/* ----------------------------- the honesty rules --------------------------- */

test("a NEGATIVE total is under review, and carries no number at all", () => {
  const d = detail({
    balance: [bal({ loc: "", outQty: "120", outLast: "2026-03-02", avail: "-120" })],
    outLog: [mv("سحب", { qtyCount: "120", net: "120", date: "2026-03-02" })],
    weights: { "منتج 1": 20 },
  });
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].why, ["negative"]);
  const l = d[0].line;
  assert.equal(l.review, true);
  assert.equal(l.qty, null);
  assert.equal(l.received, null);
  assert.equal(l.issued, null);
  assert.equal(l.kg, null);
  assert.equal(l.kgApprox, false);
  // the two figures behind the decision stay on the server, for the owner
  assert.equal(d[0].sheetAvail, -120);
  assert.equal(d[0].summed, -120);
});

test("one negative place and one positive place that sum positive are NOT under review", () => {
  // A withdrawal filed with no place against stock that sits in a slot: one
  // line goes below zero, the other stays too high, and the SUM is the stock.
  const d = detail({
    balance: [
      bal({ itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "A12", inQty: "600", inLast: "2026-03-01", avail: "600" }),
      bal({ itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "", outQty: "120", outLast: "2026-03-09", avail: "-120" }),
    ],
    inLog: [mv("إيداع", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "A12", qtyKg: "600", net: "600", date: "2026-03-01" })],
    outLog: [mv("سحب", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "", qtyKg: "120", net: "120", date: "2026-03-09" })],
  });
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].why, []);
  assert.deepEqual(d[0].line, {
    kind: "material", item: "خامة 1", unit: "kg", qty: 480, kg: 480, kgApprox: false,
    received: 600, issued: 120, lastIn: "2026-03-01", lastOut: "2026-03-09", review: false,
  });
});

test("the sheet's figure ≠ Σ movements is under review — the drawer's own rule", () => {
  // A balance formula typed over by hand: five deposits in the log, and a cell
  // that says something else. The customer is shown neither number.
  const d = detail({
    balance: [bal({ loc: "A11", inQty: "", outQty: "500", avail: "1200" })],
    inLog: [
      mv("إيداع", { loc: "A11", qtyCount: "4100", net: "4100" }),
      mv("إيداع", { loc: "A11", qtyCount: "2900", net: "2900" }),
    ],
    outLog: [mv("سحب", { loc: "A11", qtyCount: "500", net: "500" })],
  });
  assert.deepEqual(d[0].why, ["mismatch"]);
  assert.equal(d[0].sheetAvail, 1200);
  assert.equal(d[0].summed, 6500);
  assert.equal(d[0].line.review, true);
  assert.equal(d[0].line.qty, null);
  // …and the comparison is the one exported for the storekeeper's drawer.
  assert.equal(netMismatch(1200, 6500), true);
  assert.equal(netMismatch(100, 100.004), false);
  assert.equal(netMismatch(100, 100.01), true);
});

test("movements with no balance line behind them are under review, not hidden", () => {
  const d = detail({
    balance: [],
    inLog: [mv("إيداع", { item: "منتج 9", loc: "A11", qtyCount: "300", net: "300" })],
  });
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].why, ["mismatch"]);
  assert.equal(d[0].line.item, "منتج 9");
  assert.equal(d[0].line.qty, null);
});

test("a movement number its log holds twice puts the item under review", () => {
  const twin = { num: "T9999", loc: "A11", qtyCount: "100", net: "100" };
  const d = detail({
    balance: [
      bal({ loc: "A11", inQty: "500", outQty: "200", avail: "300" }),
      bal({ item: "منتج 2", loc: "A12", inQty: "50", avail: "50" }),
    ],
    inLog: [
      mv("إيداع", { loc: "A11", qtyCount: "500", net: "500" }),
      mv("إيداع", { item: "منتج 2", loc: "A12", qtyCount: "50", net: "50" }),
    ],
    outLog: [mv("سحب", twin), mv("سحب", twin)],
  });
  const one = d.find((x) => x.line.item === "منتج 1")!;
  assert.deepEqual(one.why, ["duplicate"]);
  assert.equal(one.line.review, true);
  assert.equal(one.line.qty, null);
  // the item the twins do not touch is unaffected
  const two = d.find((x) => x.line.item === "منتج 2")!;
  assert.deepEqual(two.why, []);
  assert.equal(two.line.qty, 50);
});

test("the same number in the deposit log AND the withdrawal log is not a duplicate", () => {
  const d = detail({
    balance: [bal({ loc: "A11", inQty: "500", outQty: "200", avail: "300" })],
    inLog: [mv("إيداع", { num: "T7000", loc: "A11", qtyCount: "500", net: "500" })],
    outLog: [mv("سحب", { num: "T7000", loc: "A11", qtyCount: "200", net: "200" })],
  });
  assert.deepEqual(d[0].why, []);
  assert.equal(d[0].line.qty, 300);
});

/* --------------------------------- weight --------------------------------- */

test("a product kept by weight is stated in KILOGRAMS — never grams dressed as pieces", () => {
  // The storekeeper's habit: kilograms in, «وزن الحبة» = 1, so the sheet's
  // «قطعة» column holds the weight in grams.
  const rows = {
    balance: [bal({ item: "منتج بالوزن", loc: "A11", inQty: "400,000", inLast: "2026-04-02", outQty: "100,000", outLast: "2026-04-20", avail: "300,000" })],
    inLog: [
      mv("إيداع", { item: "منتج بالوزن", loc: "A11", qtyKg: "250", grams: "1", qtyFromWt: "250000", net: "250000", date: "2026-04-01" }),
      mv("إيداع", { item: "منتج بالوزن", loc: "A11", qtyKg: "150", grams: "1", qtyFromWt: "150000", net: "150000", date: "2026-04-02" }),
    ],
    outLog: [mv("سحب", { item: "منتج بالوزن", loc: "A11", qtyKg: "100", grams: "1", qtyFromWt: "100000", net: "100000", date: "2026-04-20" })],
    // Master's real piece weight is NOT used to "correct" a weight-only line.
    weights: { "منتج بالوزن": 0.8 },
  };
  const d = detail(rows);
  assert.equal(d[0].weightOnly, true);
  assert.deepEqual(d[0].line, {
    kind: "product", item: "منتج بالوزن", unit: "kg", qty: 300, kg: 300, kgApprox: false,
    received: 400, issued: 100, lastIn: "2026-04-02", lastOut: "2026-04-20", review: false,
  });
  for (const v of Object.values(d[0].line)) {
    assert.notEqual(v, 300000, "the gram count must not reach the customer as a quantity");
    assert.notEqual(v, 400000);
  }
  assert.equal(isWeightEntry(rows.inLog[0] as never), true);
});

test("a product entered by count is NOT weight-only, even with a piece weight of 1", () => {
  assert.equal(isWeightEntry(mv("إيداع", { qtyCount: "500", grams: "1", net: "500" }) as never), false);
  assert.equal(isWeightEntry(mv("إيداع", { qtyKg: "10", grams: "5", net: "2000" }) as never), false);
  assert.equal(isWeightEntry(mv("إيداع", { itemType: "خامة", qtyKg: "10", grams: "1", net: "10" }) as never), false);
});

test("a product whose EVERY movement went over the scale is stated in kilograms, whatever piece weight was typed", () => {
  // Kilograms typed, no count, a real «وزن الحبة» (11 g): the sheet's «قطعة» is
  // only kg ÷ 11 — 2,727.27 + 1,363.64 − 909.09 — a fraction of a piece that
  // nobody ever counted. The scale is what was measured.
  const rows = {
    balance: [bal({ item: "منتج بالميزان", loc: "A11", inQty: "4,090.91", inLast: "2026-04-02", outQty: "909.09", outLast: "2026-04-20", avail: "3,181.82" })],
    inLog: [
      mv("إيداع", { item: "منتج بالميزان", loc: "A11", qtyKg: "30", grams: "11", qtyFromWt: "2727.27", net: "2727.27", date: "2026-04-01" }),
      mv("إيداع", { item: "منتج بالميزان", loc: "A11", qtyKg: "15", grams: "11", qtyFromWt: "1363.64", net: "1363.64", date: "2026-04-02" }),
    ],
    outLog: [mv("سحب", { item: "منتج بالميزان", loc: "A11", qtyKg: "10", grams: "11", qtyFromWt: "909.09", net: "909.09", date: "2026-04-20" })],
    weights: { "منتج بالميزان": 9 }, // Master disagrees with what was typed — and is not asked
  };
  const d = detail(rows);
  assert.deepEqual(d[0].why, []);
  assert.equal(d[0].weightOnly, true);
  assert.deepEqual(d[0].line, {
    kind: "product", item: "منتج بالميزان", unit: "kg", qty: 35, kg: 35, kgApprox: false,
    received: 45, issued: 10, lastIn: "2026-04-02", lastOut: "2026-04-20", review: false,
  });
  assert.equal(isScaleEntry(rows.inLog[0] as never), true);
  assert.equal(isWeightEntry(rows.inLog[0] as never), false, "grams 11 is not the grams-as-pieces habit");
  assert.equal(JSON.stringify(d[0].line).includes("3181"), false, "the derived piece count must not reach the customer");
});

test("a SHOT weight typed for a piece weight cannot bend an all-scale line — the kilograms stand", () => {
  // Two scale deposits of one product, the first typed with the weight of the
  // whole shot (24 g) and the second with one piece (1.5 g). In «قطعة» the line
  // reads 12,500 + 8,000; by the scale it is 300 + 12 kg — about 208,000 pieces.
  const [l] = build({
    balance: [bal({ item: "منتج بالميزان", loc: "A11", inQty: "20,500", avail: "20,500" })],
    inLog: [
      mv("إيداع", { item: "منتج بالميزان", loc: "A11", qtyKg: "300", grams: "24", qtyFromWt: "12500", net: "12500" }),
      mv("إيداع", { item: "منتج بالميزان", loc: "A11", qtyKg: "12", grams: "1.5", qtyFromWt: "8000", net: "8000" }),
    ],
  });
  assert.deepEqual([l.unit, l.qty, l.kg, l.kgApprox, l.received, l.issued], ["kg", 312, 312, false, 312, 0]);
});

test("a line mixing scale entries and counted ones stays in pieces — WHOLE pieces", () => {
  // 20 kg at 11 g is 1,818.18 «قطعة» in the sheet; with 500 counted the cell
  // reads 2,318.18. Nobody holds 0.18 of a piece.
  const d = detail({
    balance: [bal({ loc: "A11", inQty: "2,318.18", outQty: "100.4", avail: "2,217.78" })],
    inLog: [
      mv("إيداع", { loc: "A11", qtyKg: "20", grams: "11", qtyFromWt: "1818.18", net: "1818.18" }),
      mv("إيداع", { loc: "A11", qtyCount: "500", grams: "11", net: "500" }),
    ],
    outLog: [mv("سحب", { loc: "A11", qtyCount: "100.4", grams: "11", net: "100.4" })],
  });
  assert.deepEqual(d[0].why, []);
  assert.equal(d[0].weightOnly, false);
  const l = d[0].line;
  assert.deepEqual([l.unit, l.qty, l.received, l.issued], ["pcs", 2218, 2318, 100]);
  for (const k of ["qty", "received", "issued"] as const) assert.equal(Number.isInteger(l[k]), true, `${k} is whole`);
  // the weight under it: 20 kg off the scale + (500 − 100.4) × 11 g
  assert.deepEqual([l.kg, l.kgApprox], [24.4, true]);
});

test("on a weight-kept line a COUNTED movement with a real piece weight is unknown — never pieces × grams", () => {
  // 100 kg in with «وزن الحبة» = 1 (the sheet holds 100,000). Then a withdrawal
  // typed as a count of 40,000 with the form's prefilled Master weight, 0.75:
  // the sheet's balance is 60,000 (= 60 kg) and agrees with itself, so no
  // review fires. 40,000 × 0.75 g would say 30 kg went out and 70 kg is left.
  const d = detail({
    balance: [bal({ item: "منتج بالوزن", loc: "A11", inQty: "100,000", outQty: "40,000", avail: "60,000" })],
    inLog: [mv("إيداع", { item: "منتج بالوزن", loc: "A11", qtyKg: "100", grams: "1", qtyFromWt: "100000", net: "100000" })],
    outLog: [mv("سحب", { item: "منتج بالوزن", loc: "A11", qtyCount: "40000", grams: "0.75", net: "40000" })],
    weights: { "منتج بالوزن": 0.75 },
  });
  assert.deepEqual(d[0].why, []);
  assert.equal(d[0].weightOnly, true);
  const l = d[0].line;
  assert.deepEqual([l.unit, l.qty, l.kg, l.kgApprox, l.received, l.issued, l.review], ["kg", null, null, false, 100, null, false]);
  for (const v of Object.values(l)) {
    assert.notEqual(v, 70, "pieces × grams must not be offered as the balance");
    assert.notEqual(v, 30);
    assert.notEqual(v, 60000);
  }
});

test("on a weight-kept line a counted movement with «وزن الحبة» = 1 is grams, and one with no weight is unknown", () => {
  // the shape a withdrawal spread over several places is written in
  const split = mv("سحب", { item: "منتج بالوزن", loc: "A11", qtyCount: "40000", grams: "1", net: "40000" });
  const rows = {
    balance: [bal({ item: "منتج بالوزن", loc: "A11", inQty: "100,000", outQty: "40,000", avail: "60,000" })],
    inLog: [mv("إيداع", { item: "منتج بالوزن", loc: "A11", qtyKg: "100", grams: "1", qtyFromWt: "100000", net: "100000" })],
    weights: { "منتج بالوزن": 0.75 },
  };
  const [l] = build({ ...rows, outLog: [split] });
  assert.deepEqual([l.unit, l.qty, l.kg, l.received, l.issued], ["kg", 60, 60, 100, 40]);
  assert.equal(l.kgApprox, true, "40 kg of it came from a gram count, not a scale reading");
  assert.deepEqual(keptByWeightKg(split as never), { kg: 40, approx: true });

  // …and with the piece weight left blank, Master's is NOT borrowed
  const blank = mv("سحب", { item: "منتج بالوزن", loc: "A11", qtyCount: "40000", grams: "", net: "40000" });
  const [u] = build({ ...rows, outLog: [blank] });
  assert.deepEqual([u.unit, u.qty, u.kg, u.received, u.issued], ["kg", null, null, 100, null]);
  assert.equal(keptByWeightKg(blank as never), null);
});

test("a material is kilograms, and its kg IS its quantity", () => {
  const [l] = detailLines({
    balance: [
      bal({ itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "C13", inQty: "3,200", inLast: "2026-05-01", outQty: "3,200", outLast: "2026-05-20", avail: "0" }),
      bal({ itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "", inQty: "1,800", inLast: "2026-06-01", outQty: "900.5", outLast: "2026-06-05", avail: "899.5" }),
    ],
    inLog: [
      mv("إيداع", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "C13", qtyKg: "3200", net: "3200" }),
      mv("إيداع", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "", qtyKg: "1800", net: "1800" }),
    ],
    outLog: [
      mv("سحب", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "C13", qtyKg: "3200", net: "3200" }),
      mv("سحب", { itemType: "خامة", item: "خامة 1", unit: "كجم", loc: "", qtyKg: "900.5", net: "900.5" }),
    ],
  });
  assert.equal(l.kind, "material");
  assert.equal(l.unit, "kg");
  assert.equal(l.qty, 899.5);
  assert.equal(l.kg, l.qty);
  assert.equal(l.kgApprox, false);
  assert.equal(l.received, 5000);
  assert.equal(l.issued, 4100.5);
});

test("a counted product gets its kilograms from the piece weight, marked approximate", () => {
  const [own, master] = build({
    balance: [
      bal({ item: "منتج 1", loc: "A11", inQty: "2,000", avail: "2,000" }),
      bal({ item: "منتج 2", loc: "A12", inQty: "1,000", avail: "1,000" }),
    ],
    inLog: [
      mv("إيداع", { item: "منتج 1", loc: "A11", qtyCount: "2000", grams: "80", net: "2000" }), // its own piece weight
      mv("إيداع", { item: "منتج 2", loc: "A12", qtyCount: "1000", grams: "0", net: "1000" }),  // Master's
    ],
    weights: { "منتج 2": 7 },
  });
  assert.deepEqual([own.unit, own.qty, own.kg, own.kgApprox], ["pcs", 2000, 160, true]);
  assert.deepEqual([master.unit, master.qty, master.kg, master.kgApprox], ["pcs", 1000, 7, true]);
});

test("no piece weight anywhere → the kilograms are UNKNOWN (null), never zero", () => {
  const [l] = build({
    balance: [bal({ loc: "A11", inQty: "8,400", avail: "8,400" })],
    inLog: [mv("إيداع", { loc: "A11", qtyCount: "8400", grams: "0", net: "8400" })],
  });
  assert.equal(l.qty, 8400);
  assert.equal(l.kg, null);
  assert.equal(l.kgApprox, false);
  assert.equal(l.review, false);
});

/* ---------------------------------- dates --------------------------------- */

test("a filler or a place code in a date cell is \"\" — never today", () => {
  const [l] = build({
    balance: [bal({ loc: "A11", inQty: "10", inLast: "غير متاح / N/A", outQty: "4", outLast: "A17", avail: "6" })],
    inLog: [mv("إيداع", { loc: "A11", qtyCount: "10", net: "10", date: "A17" })],
    outLog: [mv("سحب", { loc: "A11", qtyCount: "4", net: "4", date: "" })],
  });
  assert.equal(l.lastIn, "");
  assert.equal(l.lastOut, "");
  assert.equal(l.qty, 6);
});

test("the storage sheet's month-first dates and the site's ISO text both read", () => {
  const [l] = build({
    balance: [bal({ loc: "A11", inQty: "10", inLast: "9/2/2026 13:56:27", outQty: "4", outLast: "2026-10-04", avail: "6" })],
    inLog: [mv("إيداع", { loc: "A11", qtyCount: "10", net: "10", date: "9/2/2026 13:56:27" })],
    outLog: [mv("سحب", { loc: "A11", qtyCount: "4", net: "4", date: "2026-10-04" })],
  });
  assert.equal(l.lastIn, "2026-09-02");
  assert.equal(l.lastOut, "2026-10-04");
});

/* ------------------------------ kept and dropped --------------------------- */

test("a zero balance WITH history is kept; a line with nothing at all is dropped", () => {
  const lines = build({
    balance: [
      bal({ item: "منتج خلص", loc: "", inQty: "4,300", inLast: "2026-07-09", outQty: "4,300", outLast: "2026-07-09", avail: "0" }),
      bal({ item: "منتج فاضي", loc: "A11" }), // 0 / 0 / 0 and no movement
    ],
    inLog: [mv("إيداع", { item: "منتج خلص", qtyCount: "4300", net: "4300", date: "2026-07-09" })],
    outLog: [mv("سحب", { item: "منتج خلص", qtyCount: "4300", net: "4300", date: "2026-07-09" })],
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    kind: "product", item: "منتج خلص", unit: "pcs", qty: 0, kg: null, kgApprox: false,
    received: 4300, issued: 4300, lastIn: "2026-07-09", lastOut: "2026-07-09", review: false,
  });
});

/* ------------------------------ kinds and units ---------------------------- */

test("kind and unit come from the sheet's own two cells", () => {
  assert.equal(stockKindOf("خامة"), "material");
  assert.equal(stockKindOf(" خامات "), "material");
  assert.equal(stockKindOf("منتج"), "product");
  assert.equal(stockKindOf(""), "other");
  assert.equal(stockKindOf("اسطمبة"), "other");
  assert.equal(stockUnitOf("قطعة", "product"), "pcs");
  assert.equal(stockUnitOf("قطعه", "product"), "pcs");
  assert.equal(stockUnitOf("كجم", "material"), "kg");
  assert.equal(stockUnitOf("KG", "material"), "kg");
  assert.equal(stockUnitOf("", "material"), "kg");
  assert.equal(stockUnitOf("", "product"), "pcs");
  assert.equal(stockUnitOf("كرتونة", "other"), "كرتونة", "any other unit is printed as the sheet writes it");
});

test("products come first, then materials, then anything else — by name inside each", () => {
  const lines = detailLines({
    balance: [
      bal({ itemType: "اسطمبة", item: "صنف آخر", unit: "كرتونة", inQty: "2", avail: "2" }),
      bal({ itemType: "خامة", item: "خامة ب", unit: "كجم", inQty: "5", avail: "5" }),
      bal({ item: "منتج ب", inQty: "1", avail: "1" }),
      bal({ itemType: "خامة", item: "خامة أ", unit: "كجم", inQty: "5", avail: "5" }),
      bal({ item: "منتج أ", inQty: "1", avail: "1" }),
    ],
    inLog: [
      mv("إيداع", { itemType: "اسطمبة", item: "صنف آخر", unit: "كرتونة", qtyCount: "2", net: "2" }),
      mv("إيداع", { itemType: "خامة", item: "خامة ب", unit: "كجم", qtyKg: "5", net: "5" }),
      mv("إيداع", { item: "منتج ب", qtyCount: "1", net: "1" }),
      mv("إيداع", { itemType: "خامة", item: "خامة أ", unit: "كجم", qtyKg: "5", net: "5" }),
      mv("إيداع", { item: "منتج أ", qtyCount: "1", net: "1" }),
    ],
  });
  assert.deepEqual(lines.map((l) => l.item), ["منتج أ", "منتج ب", "خامة أ", "خامة ب", "صنف آخر"]);
  const other = lines[4];
  assert.deepEqual([other.kind, other.unit, other.qty, other.kg], ["other", "كرتونة", 2, null]);
});

/* ------------------------- what the customer is not shown ------------------ */

test("materials never reach the customer — dropped on the server, not on the page", () => {
  // Owner, 2026-10-07: "hide the materials from the customer".
  assert.deepEqual([...HIDDEN_FROM_CUSTOMER], ["material"]);
  const i: Input = {
    balance: [
      bal({ item: "منتج أ", inQty: "40", avail: "40" }),
      bal({ itemType: "خامة", item: "خامة سرية", unit: "كجم", inQty: "900", outQty: "650", avail: "250" }),
      bal({ itemType: "اسطمبة", item: "صنف آخر", unit: "كرتونة", inQty: "2", avail: "2" }),
    ],
    inLog: [
      mv("إيداع", { item: "منتج أ", qtyCount: "40", net: "40" }),
      mv("إيداع", { itemType: "خامة", item: "خامة سرية", unit: "كجم", qtyKg: "900", net: "900" }),
      mv("إيداع", { itemType: "اسطمبة", item: "صنف آخر", unit: "كرتونة", qtyCount: "2", net: "2" }),
    ],
    outLog: [mv("سحب", { itemType: "خامة", item: "خامة سرية", unit: "كجم", qtyKg: "650", net: "650" })],
  };
  // the rules still see it …
  assert.deepEqual(detailLines(i).map((l) => l.kind), ["product", "material", "other"]);
  // … the customer's answer does not: no line, no name, none of its figures
  const lines = build(i);
  assert.deepEqual(lines.map((l) => [l.kind, l.item]), [["product", "منتج أ"], ["other", "صنف آخر"]]);
  const wire = JSON.stringify(lines);
  for (const leak of ["خامة سرية", "material", "900", "650", "250"]) {
    assert.equal(wire.includes(leak), false, `«${leak}» is on the wire`);
  }
  // a customer holding ONLY materials sees an empty list, not an error
  assert.deepEqual(build({ balance: [i.balance![1]], inLog: [i.inLog![1]], outLog: i.outLog }), []);
});
