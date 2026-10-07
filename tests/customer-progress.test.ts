/**
 * «تم إنتاج» in the customer portal — lib/customer-progress.ts.
 *
 * The count a buyer reads on an order card is NOT the staff figure. The staff
 * rule (lib/jobs.ts) credits a shift to an order by product name and start
 * date alone; on a customer's screen that would (a) put another company's
 * shifts on the card whenever two clients share a product name and (b) hand
 * the same shift to every order of that product. Both fail silently — the
 * number simply reads too high — so each condition is pinned here:
 *
 *  - the BOUNDARY: a shift row counts only when its OWN client cell is this
 *    customer's; a blank cell counts only for a product «الرئيسي» holds once,
 *    under this customer; another client's row never counts;
 *  - the WINDOW: one shift, one order — from the order's start up to the start
 *    of the customer's next order for the same product;
 *  - the HONESTY rule: `null`, never a guess, when the split cannot be made.
 *
 * Every name and number below is invented. The GitHub repo is public: no live
 * row, no real client, no real product and no real quantity belongs here.
 *
 * Run with `npm test`.
 */
import "./_alias.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKeysOf } from "../lib/customer-link.ts";

// Loaded dynamically: the module imports its sibling through `@/`, which
// tests/_alias.ts maps — and a static import would be linked before it could.
const { attributeProduction, progressLine, orderedTotalPieces } = await import("../lib/customer-progress.ts");

/* -------------------------------- fixtures -------------------------------- */

const A = "عميل أ";
const B = "عميل ب";
const KEYS = clientKeysOf([{ no: 1, name: A, aliases: ["عميل أ للتجارة"] }]);
const P1 = "منتج 1";
const P2 = "منتج 2";

type Order = { id: string; productKey: string; startDate: string; uniqueOwner: boolean };
type Run = { productKey: string; date: string; goodUnits: number; client: string };

const order = (id: string, over: Partial<Order> = {}): Order =>
  ({ id, productKey: P1, startDate: "2026-01-10", uniqueOwner: true, ...over });
const run = (date: string, goodUnits: number, over: Partial<Run> = {}): Run =>
  ({ productKey: P1, date, goodUnits, client: A, ...over });
const made = (orders: Order[], runs: Run[], keys: Set<string> = KEYS) =>
  Object.fromEntries(attributeProduction(orders, runs, keys));

/* ------------------------------ the boundary ------------------------------ */

test("another client's shifts on the SAME product name are never counted", () => {
  // One product name, made for two clients — the shift row says which.
  const runs = [
    run("2026-01-11", 400),
    run("2026-01-12", 900, { client: B }),
    run("2026-01-13", 250),
    run("2026-01-14", 700, { client: B }),
  ];
  assert.deepEqual(made([order("7")], runs), { "7": 650 });
  // …whatever «الرئيسي» says about who owns the name.
  assert.deepEqual(made([order("7", { uniqueOwner: false })], runs), { "7": 650 });
  // Deleting the other client's rows changes nothing: they were never in it.
  assert.deepEqual(made([order("7")], runs.filter((r) => r.client === A)), { "7": 650 });
  // And with ONLY the other client's rows there is nothing to show.
  assert.deepEqual(made([order("7")], runs.filter((r) => r.client === B)), { "7": 0 });
});

test("a blank client cell counts only when the product is this customer's alone", () => {
  const runs = [run("2026-01-11", 300), run("2026-01-12", 120, { client: "" })];
  assert.deepEqual(made([order("7", { uniqueOwner: true })], runs), { "7": 420 });
  assert.deepEqual(made([order("7", { uniqueOwner: false })], runs), { "7": 300 });
});

test("a blank cell is nobody's once the log names another client on that product", () => {
  // «الرئيسي» holds the name once, under this customer (`uniqueOwner`) — and
  // the shift log still shows it being made for somebody else. Master is then
  // not proof that a blank row is theirs, so the blank is credited to no one.
  const own = run("2026-01-11", 300);
  const blank = run("2026-01-12", 120, { client: "" });
  assert.deepEqual(made([order("7")], [own, blank]), { "7": 420 });
  assert.deepEqual(made([order("7")], [own, blank, run("2026-01-13", 900, { client: B })]), { "7": 300 });
  // The other client's row is evidence wherever it sits: before the order's
  // start, with no readable date, or with no count on it.
  for (const other of [
    run("2025-06-01", 900, { client: B }),
    run("", 900, { client: B }),
    run("2026-01-13", 0, { client: B }),
  ]) {
    assert.deepEqual(made([order("7")], [own, blank, other]), { "7": 300 });
  }
  // Per product: another client on a DIFFERENT name changes nothing here.
  assert.deepEqual(made([order("7")], [own, blank, run("2026-01-13", 900, { client: B, productKey: P2 })]), { "7": 420 });
  // A filler cell on the other row is not another client.
  assert.deepEqual(made([order("7")], [own, blank, run("2026-01-13", 5, { client: "غير متاح / N/A" })]), { "7": 425 });
});

test("the workbook's filler is a blank cell, not a client", () => {
  for (const filler of ["غير متاح / N/A", "غير متاح", "N/A", "n/a", " — ", "-", "   "]) {
    const runs = [run("2026-01-11", 50, { client: filler })];
    assert.deepEqual(made([order("7", { uniqueOwner: true })], runs), { "7": 50 }, `«${filler}» under a unique owner`);
    assert.deepEqual(made([order("7", { uniqueOwner: false })], runs), { "7": 0 }, `«${filler}» without one`);
  }
});

test("an alias and a stray space are the same customer; a near-miss is not", () => {
  const runs = [
    run("2026-01-11", 100, { client: "عميل أ للتجارة" }),   // the alias the owner approved
    run("2026-01-12", 10, { client: " عميل  أ " }),          // spaces from the dropdown
    run("2026-01-13", 1, { client: "عميل أ الجديد" }),       // a different row of «العملاء»
    run("2026-01-14", 1000, { client: "عميل" }),             // a substring is not a match
  ];
  assert.deepEqual(made([order("7", { uniqueOwner: false })], runs), { "7": 110 });
});

test("an order of a DIFFERENT customer is not in the list and receives nothing", () => {
  // The route hands in the caller's own orders only. B's order for the same
  // product is simply absent: it gets no key, and it does not close A's window.
  const runs = [run("2026-01-11", 200), run("2026-02-20", 300), run("2026-02-21", 999, { client: B })];
  const out = attributeProduction([order("7")], runs, KEYS);
  assert.deepEqual([...out.keys()], ["7"]);
  assert.equal(out.get("7"), 500);
  assert.equal(out.has("8"), false);
});

test("an account with no client key is given no number at all", () => {
  const runs = [run("2026-01-11", 200, { client: "" }), run("2026-01-12", 300)];
  assert.deepEqual(made([order("7")], runs, new Set()), { "7": null });
});

/* ------------------------------- the window ------------------------------- */

test("two orders of one product: each shift is credited to exactly one of them", () => {
  const orders = [order("7", { startDate: "2026-01-10" }), order("9", { startDate: "2026-02-01" })];
  const runs = [
    run("2026-01-09", 5000),   // before the first order — nobody's
    run("2026-01-10", 100),    // the start day itself belongs to the order
    run("2026-01-31", 200),
    run("2026-02-01", 400),    // the next order's start day belongs to the NEXT order
    run("2026-03-15", 800),
  ];
  const out = made(orders, runs);
  assert.deepEqual(out, { "7": 300, "9": 1200 });
  // Σ over the orders = Σ of the customer's rows on/after the first start.
  const fromFirst = runs.filter((r) => r.date >= "2026-01-10").reduce((a, r) => a + r.goodUnits, 0);
  assert.equal((out["7"] ?? 0) + (out["9"] ?? 0), fromFirst);
  // The staff rule (start date, no upper bound) would have said 1,500 for the
  // first order — the whole point of the window.
  assert.notEqual(out["7"], fromFirst);
});

test("the window is per product — another product's order does not close it", () => {
  const orders = [order("7", { startDate: "2026-01-10" }), order("9", { productKey: P2, startDate: "2026-02-01" })];
  const runs = [run("2026-03-01", 70), run("2026-03-01", 30, { productKey: P2 })];
  assert.deepEqual(made(orders, runs), { "7": 70, "9": 30 });
});

test("three orders, given in any order", () => {
  const orders = [
    order("3", { startDate: "2026-03-01" }),
    order("1", { startDate: "2026-01-01" }),
    order("2", { startDate: "2026-02-01" }),
  ];
  const runs = [run("2026-01-15", 1), run("2026-02-15", 10), run("2026-03-15", 100), run("2026-04-15", 1000)];
  assert.deepEqual(made(orders, runs), { "1": 1, "2": 10, "3": 1100 });
});

test("an order with no start date takes everything before the next order's start", () => {
  const orders = [order("7", { startDate: "" }), order("9", { startDate: "2026-02-01" })];
  const runs = [run("2025-11-03", 40), run("2026-01-31", 60), run("2026-02-01", 500)];
  assert.deepEqual(made(orders, runs), { "7": 100, "9": 500 });
  // Alone, it takes every dated row.
  assert.deepEqual(made([order("7", { startDate: "" })], runs), { "7": 600 });
  // A start date that is not a real day reads as blank, never as a bound.
  assert.deepEqual(made([order("7", { startDate: "قريباً" })], runs), { "7": 600 });
});

test("a shift row with no readable date is credited to nothing", () => {
  const runs = [run("", 900), run("غير معروف", 900), run("2026-01-11", 5)];
  assert.deepEqual(made([order("7")], runs), { "7": 5 });
  // …including for an order with no start date, where the staff rule would count it.
  assert.deepEqual(made([order("7", { startDate: "" })], runs), { "7": 5 });
});

/* --------------------------- when it cannot be said ------------------------ */

test("two orders of one product from the same day: no number for either", () => {
  const orders = [
    order("7", { startDate: "2026-01-10" }),
    order("8", { startDate: "2026-01-10" }),
    order("9", { startDate: "2026-02-01" }),
  ];
  const runs = [run("2026-01-15", 100), run("2026-02-15", 40)];
  // The third order's window is still its own.
  assert.deepEqual(made(orders, runs), { "7": null, "8": null, "9": 40 });
});

test("two undated orders of one product: no number for either", () => {
  const orders = [order("7", { startDate: "" }), order("8", { startDate: "" })];
  assert.deepEqual(made(orders, [run("2026-01-15", 100)]), { "7": null, "8": null });
});

test("an order before a same-day pair still stops where the pair starts", () => {
  const orders = [
    order("6", { startDate: "2026-01-01" }),
    order("7", { startDate: "2026-01-10" }),
    order("8", { startDate: "2026-01-10" }),
  ];
  const runs = [run("2026-01-05", 30), run("2026-01-20", 900)];
  assert.deepEqual(made(orders, runs), { "6": 30, "7": null, "8": null });
});

test("an order with no product has no number", () => {
  const orders = [order("7", { productKey: "" }), order("8")];
  const runs = [run("2026-01-11", 10), run("2026-01-12", 10, { productKey: "" })];
  assert.deepEqual(made(orders, runs), { "7": null, "8": 10 });
});

/* ------------------------------- the number -------------------------------- */

test("zero is a real answer: an order with nothing logged yet", () => {
  assert.deepEqual(made([order("7")], []), { "7": 0 });
  assert.deepEqual(made([order("7")], [run("2026-01-11", 10, { productKey: P2 })]), { "7": 0 });
  assert.deepEqual(made([], [run("2026-01-11", 10)]), {});
});

test("a cell that is not a positive number contributes nothing", () => {
  const runs = [
    run("2026-01-11", Number.NaN), run("2026-01-11", Number.POSITIVE_INFINITY),
    run("2026-01-11", -500), run("2026-01-11", 0),
    run("2026-01-11", "250" as unknown as number), // a string is not a count
    run("2026-01-11", 12),
  ];
  assert.deepEqual(made([order("7")], runs), { "7": 12 });
});

test("the count is whole pieces and never negative", () => {
  const runs = [run("2026-01-11", 10.4), run("2026-01-12", 10.4), run("2026-01-13", 0.4)];
  const out = made([order("7")], runs);
  assert.equal(out["7"], 21);
  assert.ok(Number.isInteger(out["7"]));
  assert.ok((out["7"] ?? 0) >= 0);
});

test("every order handed in gets an answer, and nothing else does", () => {
  const orders = [order("1"), order("2", { productKey: P2 }), order("3", { productKey: "" })];
  const out = attributeProduction(orders, [run("2026-01-11", 1)], KEYS);
  assert.deepEqual([...out.keys()].sort(), ["1", "2", "3"]);
});

/* ------------------------------ what a card says --------------------------- */

test("no number is sent → the card prints nothing", () => {
  assert.deepEqual(progressLine(null, 5000), { kind: "none" });
  assert.deepEqual(progressLine(undefined, 5000), { kind: "none" });
  assert.deepEqual(progressLine(null, null), { kind: "none" });
  // A snapshot from before the count existed, or a broken value, is "not known".
  assert.deepEqual(progressLine(Number.NaN, 5000), { kind: "none" });
  assert.deepEqual(progressLine(-3, 5000), { kind: "none" });
});

test("zero is a count like any other: an EMPTY bar, as on the jobs tab", () => {
  // MOVED DELIBERATELY on 2026-10-07 (owner: "show the loading bar like the one
  // in jobs tab"). Zero used to be a sentence on a running order and nothing on
  // the others; the jobs tab draws an empty bar with «0 / 5,000» on every
  // order nothing was made for, and the customer's card now does the same.
  assert.deepEqual(progressLine(0, 5000), { kind: "count", made: 0, total: 5000, pct: 0 });
  // No ordered piece count: still a real zero, with nothing to measure against.
  assert.deepEqual(progressLine(0, null), { kind: "count", made: 0, total: null, pct: null });
  // A fraction of a piece is not a piece.
  assert.deepEqual(progressLine(0.4, 5000), { kind: "count", made: 0, total: 5000, pct: 0 });
});

test("a count with a known total carries a percentage; without one, no bar", () => {
  assert.deepEqual(progressLine(1350, 5000), { kind: "count", made: 1350, total: 5000, pct: 27 });
  assert.deepEqual(progressLine(1350, null), { kind: "count", made: 1350, total: null, pct: null });
  assert.deepEqual(progressLine(1350, 0), { kind: "count", made: 1350, total: null, pct: null });
  // Shifts logged before anybody moved the order's status are still shown.
  assert.deepEqual(progressLine(40, 1000), { kind: "count", made: 40, total: 1000, pct: 4 });
  assert.deepEqual(progressLine(1000, 1000), { kind: "count", made: 1000, total: 1000, pct: 100 });
});

test("an order that ran over: the bar stops at 100, the count does not", () => {
  const line = progressLine(1260, 1000);
  assert.deepEqual(line, { kind: "count", made: 1260, total: 1000, pct: 100 });
});

test("100% means the whole order was made — rounding never says it early", () => {
  // 99.8% rounds to 100, and the page paints 100 full and green.
  assert.deepEqual(progressLine(4990, 5000), { kind: "count", made: 4990, total: 5000, pct: 99 });
  assert.deepEqual(progressLine(4999, 5000), { kind: "count", made: 4999, total: 5000, pct: 99 });
  assert.deepEqual(progressLine(5000, 5000), { kind: "count", made: 5000, total: 5000, pct: 100 });
  // The status does not decide it: a closed order that fell short is not 100.
  assert.equal(progressLine(4990, 5000).pct, 99);
});

test("a real count never reads 0% with an empty bar", () => {
  assert.deepEqual(progressLine(40, 90000), { kind: "count", made: 40, total: 90000, pct: 1 });
  assert.deepEqual(progressLine(1, 90000), { kind: "count", made: 1, total: 90000, pct: 1 });
  // In between, ordinary rounding.
  assert.equal(progressLine(2000, 90000).pct, 2);
  assert.equal(progressLine(45000, 90000).pct, 50);
});

/* ------------------------ the total a card measures against ----------------- */

test("the total is the WORK ORDER's quantity when the factory changed it", () => {
  // Asked 8,000 pieces; approved for 10,000 pieces' worth of kilograms.
  assert.equal(orderedTotalPieces(8000, 10000, 100), 10000);
  // …so 8,800 made is 88% of a running order, not a full green bar.
  assert.deepEqual(
    progressLine(8800, orderedTotalPieces(8000, 10000, 100)),
    { kind: "count", made: 8800, total: 10000, pct: 88 },
  );
  // Edited DOWN after approval: the order is still the total.
  assert.equal(orderedTotalPieces(8000, 6000, 60), 6000);
});

test("the typed number is kept when the order differs only by rounding", () => {
  assert.equal(orderedTotalPieces(8000, 8000, 80), 8000);
  // 1,030 pieces of a 0.9 g part = 0.927 kg → stored 0.9 kg → 1,000 pieces back.
  assert.equal(orderedTotalPieces(1030, 1000, 0.9), 1030);
  // 3,007 pieces of a 37 g part = 111.259 kg → 111.3 kg → 3,008 pieces back.
  assert.equal(orderedTotalPieces(3007, 3008, 111.3), 3007);
  // Without the kilograms only a half-percent slip is taken as rounding.
  assert.equal(orderedTotalPieces(8000, 8024, null), 8000);
  assert.equal(orderedTotalPieces(8000, 8100, null), 8100);
  // One 0.1 kg step is half a step too far to be rounding: that is an edit.
  assert.equal(orderedTotalPieces(1030, 1111, 1.0), 1111);
});

test("one known quantity is the total; none means no total and no bar", () => {
  // An order the factory entered itself — nothing was typed.
  assert.equal(orderedTotalPieces(null, 5000, 50), 5000);
  assert.equal(orderedTotalPieces(0, 5000, 50), 5000);
  // A request in pieces whose order has no piece count (no weight in «الرئيسي»).
  assert.equal(orderedTotalPieces(700, null, 12), 700);
  // Kilograms only, or nothing readable.
  assert.equal(orderedTotalPieces(null, null, 40), null);
  assert.equal(orderedTotalPieces(0, 0, 0), null);
  assert.equal(orderedTotalPieces(Number.NaN, -5, 3), null);
  assert.deepEqual(progressLine(740, orderedTotalPieces(null, null, 40)),
    { kind: "count", made: 740, total: null, pct: null });
});
