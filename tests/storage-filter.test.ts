/**
 * Storage search + location filtering. Run with `npm test`.
 *
 * Two properties are worth pinning hard, because getting either wrong looks
 * like the page "just doesn't find things" rather than like a bug:
 *
 *  - the location filter FOLDS CASE while the sheet's balance key does NOT, so
 *    the two stale lowercase rows in «الرصيد الحالي» (storage/CLAUDE.md open
 *    item 4) must appear under the same slot as their uppercase twins;
 *  - Arabic search folds the spellings that are not meaningful when looking a
 *    thing up — the warehouse types «إسطمبة» and «اسطمبه» for one item.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_LOCATION, buildFloorPlan, caseTwin, collectLocations, compareLocKey, historyFor,
  locGroup, locKey, matchesTerms, movePayloads, normalizeText, parseSlot, pillarOf,
  sameLine, sameLocation, sameOwnerItem, searchTerms, siblingLines, storageDate, sumNet,
  toNumber, whereIs,
} from "../lib/storage-filter.ts";

/* --------------------------------- search --------------------------------- */

test("Arabic spelling variants fold to the same search form", () => {
  assert.equal(normalizeText("إسطمبة"), normalizeText("اسطمبه"));
  assert.equal(normalizeText("مُنْتَج"), normalizeText("منتج"));
  assert.equal(normalizeText("نــايلون"), normalizeText("نايلون")); // tatweel
  assert.equal(normalizeText("عيسى"), normalizeText("عيسي"));
});

test("Arabic-Indic digits are searchable as ASCII", () => {
  assert.equal(normalizeText("١٢٣"), "123");
  assert.equal(normalizeText("ITQ٠٠٤٦"), "itq0046");
});

test("terms are ANDed across the row's fields, in any order", () => {
  const fields = ["نايلون أبيض", "ميجا بلاست", "A12"];
  assert.equal(matchesTerms(fields, searchTerms("a12 نايلون")), true);
  assert.equal(matchesTerms(fields, searchTerms("نايلون a12")), true);
  assert.equal(matchesTerms(fields, searchTerms("a12 بولى")), false);
  // an empty query matches everything — the page must not blank itself
  assert.equal(matchesTerms(fields, searchTerms("   ")), true);
});

test("a term cannot span two fields", () => {
  // "أبيض ميجا" is only adjacent because the fields were joined for matching
  assert.equal(matchesTerms(["نايلون أبيض", "ميجا"], searchTerms("أبيض ميجا")), true);
  assert.equal(matchesTerms(["نايلون أبيض", "ميجا"], searchTerms("أبيضميجا")), false);
});

/* -------------------------------- locations ------------------------------- */

test("the location filter folds case — the sheet's balance key does not", () => {
  assert.equal(locKey(" a12 "), "A12");
  assert.equal(sameLocation("a12", "A12"), true);
  assert.equal(sameLocation("A12", "A12"), true);
  assert.equal(sameLocation("A13", "A12"), false);
});

test("an empty filter means all rows, and NO_LOCATION means only the unfiled ones", () => {
  assert.equal(sameLocation("A12", ""), true);
  assert.equal(sameLocation("", ""), true);
  assert.equal(sameLocation("", NO_LOCATION), true);
  assert.equal(sameLocation("—", NO_LOCATION), true);
  assert.equal(sameLocation("A12", NO_LOCATION), false);
});

test("slots sort by line then NUMERICALLY — A2 before A11", () => {
  const sorted = ["A11", "F2", "رف", "A2", "B1", "F10"].sort(compareLocKey);
  assert.deepEqual(sorted, ["A2", "A11", "B1", "F2", "F10", "رف"]);
});

test("no-location always sorts last", () => {
  assert.deepEqual(["رف", NO_LOCATION, "A1"].sort(compareLocKey), ["A1", "رف", NO_LOCATION]);
});

test("locGroup names the line, and leaves named zones ungrouped", () => {
  assert.equal(locGroup("A12"), "A");
  assert.equal(locGroup("F5"), "F");
  assert.equal(locGroup("T"), "");
  assert.equal(locGroup("رف"), "");
});

const bal = (item: string, loc: string, avail: string, client = "ميجا", itemType = "خامة") =>
  ({ itemType, item, client, loc, unit: "كجم", inQty: "", inLast: "", outQty: "", outLast: "", loss: "", avail });

test("collectLocations counts lines and movements, and keeps empty known slots", () => {
  const locs = collectLocations(
    [bal("نايلون", "A12", "30"), bal("بولي", "a12", "-5"), bal("كسر", "", "10")],
    [{ loc: "A12" }, { loc: "F1" }],
    ["A12", "A13", "F1"],
  );
  const byKey = Object.fromEntries(locs.map((l) => [l.key, l]));

  // a12 and A12 are one slot here, and the negative line flags the whole slot
  assert.equal(byKey.A12.lines, 2);
  assert.equal(byKey.A12.moves, 1);
  assert.equal(byKey.A12.negative, true);
  // a slot on the sheet's list with nothing in it is still offered — that is
  // where a deposit goes
  assert.equal(byKey.A13.lines, 0);
  assert.equal(byKey.A13.inUse, false);
  // the unfiled row becomes the NO_LOCATION bucket, last
  assert.equal(locs[locs.length - 1].key, NO_LOCATION);
  assert.equal(locs[locs.length - 1].lines, 1);
});

test("a location only the DATA knows about is still offered — an old bridge sends no list", () => {
  const locs = collectLocations([bal("نايلون", "B7", "12")], [], []);
  assert.deepEqual(locs.map((l) => l.key), ["B7"]);
  assert.equal(locs[0].label, "B7");
});

test("the sheet's own spelling wins as the label", () => {
  const locs = collectLocations([bal("نايلون", "a12", "12")], [], ["A12"]);
  assert.equal(locs[0].label, "A12");
  assert.equal(locs[0].lines, 1);
});

/* --------------------------------- whereIs -------------------------------- */

test("whereIs lists the places holding an item, biggest pile first, owner-blind", () => {
  const rows = [
    bal("نايلون", "A12", "30", "ميجا"),
    bal("نايلون", "F1", "120", "اتقان"),
    bal("نايلون", "A13", "0"),          // nothing there — not a place to go to
    bal("بولي", "A14", "99"),
  ];
  assert.deepEqual(whereIs(rows, "نايلون", "خامة"), [
    { loc: "F1", qty: 120, unit: "كجم" },
    { loc: "A12", qty: 30, unit: "كجم" },
  ]);
});

test("whereIs does not cross the product/material line", () => {
  const rows = [bal("نايلون", "A12", "30", "ميجا", "منتج")];
  assert.deepEqual(whereIs(rows, "نايلون", "خامة"), []);
  assert.equal(whereIs(rows, "نايلون", "منتج").length, 1);
});

/* --------------------------------- numbers -------------------------------- */

test("toNumber survives thousands separators and blanks", () => {
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber(""), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber("غير متاح"), 0);
  assert.equal(toNumber("-5"), -5);
});

/* ------------------------------- floor plan ------------------------------- */

test("a code splits into line / side / place — and a floor zone is not a slot", () => {
  assert.deepEqual(parseSlot("A23"), { line: "A", side: 2, slot: 3 });
  assert.deepEqual(parseSlot("B11"), { line: "B", side: 1, slot: 1 });
  assert.equal(parseSlot("F5"), null);   // one digit = a floor area, not a column face
  assert.equal(parseSlot("رف"), null);
  assert.equal(parseSlot("A31"), null);  // there is no side 3
});

test("the columns group exactly as the owner's drawing has them", () => {
  // bottom box carries place 1 alone, then pairs, then the top box carries 8 alone
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(pillarOf), [1, 2, 2, 3, 3, 4, 4, 5]);
});

test("buildFloorPlan draws the whole line, holes included, top box first", () => {
  const stats = collectLocations(
    [bal("نايلون", "A12", "30"), bal("كسر", "A16", "5"), bal("بولي", "B11", "9")],
    [], [],
  );
  const plan = buildFloorPlan(stats);
  assert.deepEqual(plan.lines.map((l) => l.line), ["A", "B"]);

  const a = plan.lines[0];
  // five columns per line, top of the drawing (place 8) first
  assert.equal(a.pillars.length, 5);
  assert.deepEqual(a.pillars[0].side1.map((p) => p.key), ["A18"]);
  assert.deepEqual(a.pillars[0].side2.map((p) => p.key), ["A28"]);
  // the middle boxes carry a pair each, higher place on top
  assert.deepEqual(a.pillars[1].side1.map((p) => p.key), ["A17", "A16"]);
  assert.deepEqual(a.pillars[1].side2.map((p) => p.key), ["A27", "A26"]);
  assert.deepEqual(a.pillars[4].side1.map((p) => p.key), ["A11"]);
  assert.deepEqual(a.pillars[4].side2.map((p) => p.key), ["A21"]);

  // the paper writes only the two-digit code; the line letter is the header
  assert.deepEqual(a.pillars[3].side1.map((p) => p.short), ["13", "12"]);

  // a place nobody has filled is still drawn, with nothing in it
  const empty = a.pillars[0].side1[0].stat;
  assert.equal(empty.lines, 0);
  assert.equal(empty.inUse, false);
  // and one that holds stock carries its count
  const a12 = a.pillars[3].side1.find((p) => p.key === "A12");
  assert.equal(a12.stat.lines, 1);
});

test("a line the room does not have is never invented", () => {
  const plan = buildFloorPlan(collectLocations([bal("نايلون", "A12", "30")], [], []));
  assert.deepEqual(plan.lines.map((l) => l.line), ["A"]);  // no B, no C
});

test("floor areas, named places and the unfiled bucket sit outside the columns", () => {
  const stats = collectLocations(
    [bal("نايلون", "A12", "30"), bal("كسر", "F3", "5"), bal("بواقي", "رف", "2"), bal("خام", "", "7")],
    [], [],
  );
  const plan = buildFloorPlan(stats);
  assert.deepEqual(plan.zones.map((z) => z.key), ["F3"]);
  assert.deepEqual(plan.named.map((z) => z.key), ["رف"]);
  assert.equal(plan.unfiled?.lines, 1);
  // …and none of them leaked into a column
  assert.deepEqual(plan.lines.map((l) => l.line), ["A"]);
});

/* ------------------------------- the stock line ------------------------------ */

const mv = (log: "إيداع" | "سحب", num: string, date: string, net: string, loc = "A12", client = "اتقان", item = "كوبوليمر", itemType = "خامة") =>
  ({ log, num, date, net, loc, client, item, itemType });

test("the sheet's three date shapes all normalise, and a location in the date cell does not", () => {
  assert.equal(storageDate("9/2/2026 13:56:27"), "2026-09-02");   // Sheets, en_US locale
  assert.equal(storageDate("7/19/2026 0:00:00"), "2026-07-19");
  assert.equal(storageDate("2026-09-02"), "2026-09-02");           // written as text
  assert.equal(storageDate("A17"), "");                            // ITQ0167, live on 2026-09-02
  assert.equal(storageDate(undefined), "");
});

test("a line's movements match on all four keys EXACTLY, the way the sheet sums them", () => {
  const line = { itemType: "خامة", item: "كوبوليمر", client: "اتقان", loc: "A12" };
  assert.equal(sameLine(mv("إيداع", "ITQ0001", "2026-07-01", "720"), line), true);
  // a blank location is a DIFFERENT line — that is how the −195 came to exist
  assert.equal(sameLine(mv("سحب", "ITQ0002", "2026-08-01", "195", ""), line), false);
  // and so is the lowercase twin: the sheet does not fold case, so neither may this
  assert.equal(sameLine(mv("إيداع", "ITQ0003", "2026-08-01", "5", "a12"), line), false);
  // whitespace is the one thing forgiven — lib/storage.ts collapses it on both sides
  assert.equal(sameLine(mv("إيداع", "ITQ0004", "2026-08-01", "5", " A12 "), line), true);
  // product vs material is a key too
  assert.equal(sameLine(mv("إيداع", "ITQ0005", "2026-08-01", "5", "A12", "اتقان", "كوبوليمر", "منتج"), line), false);
  // the "any place" variant a v4 bridge uses ignores only the location
  assert.equal(sameOwnerItem(mv("سحب", "ITQ0002", "2026-08-01", "195", ""), line), true);
  assert.equal(sameOwnerItem(mv("سحب", "ITQ0002", "2026-08-01", "195", "", "ميجا"), line), false);
});

test("history is newest first, with the invoice number breaking same-day ties", () => {
  const line = { itemType: "خامة", item: "كوبوليمر", client: "اتقان", loc: "A12" };
  const rows = [
    mv("إيداع", "ITQ0001", "7/1/2026 0:00:00", "720"),
    mv("سحب", "ITQ0010", "2026-09-02", "40"),
    mv("سحب", "ITQ0009", "9/2/2026 13:56:27", "10"),
    mv("إيداع", "ITQ0002", "2026-08-01", "100", ""),   // other line — excluded
  ];
  assert.deepEqual(historyFor(rows, line).map((m) => m.num), ["ITQ0010", "ITQ0009", "ITQ0001"]);
});

test("sumNet is Σ deposits − Σ withdrawals of the net column, two decimals", () => {
  assert.equal(sumNet([
    mv("إيداع", "1", "2026-01-01", "1,120"),
    mv("سحب", "2", "2026-01-02", "40"),
    mv("سحب", "3", "2026-01-03", "0.5"),
  ]), 1079.5);
  assert.equal(sumNet([]), 0);
});

test("siblings are the same item and owner elsewhere; the case twin is the a12/A12 pair", () => {
  const bal = [
    { itemType: "خامة", item: "كوبوليمر", client: "اتقان", loc: "A12", avail: "720" },
    { itemType: "خامة", item: "كوبوليمر", client: "اتقان", loc: "", avail: "-195" },
    { itemType: "خامة", item: "كوبوليمر", client: "ميجا", loc: "B11", avail: "5" },    // other owner
    { itemType: "منتج", item: "EXT 57L", client: "الكترو فود", loc: "a12", avail: "1000" },
    { itemType: "منتج", item: "EXT 57L", client: "الكترو فود", loc: "A12", avail: "3" },
  ];
  const neg = bal[1];
  assert.deepEqual(siblingLines(bal, neg).map((b) => b.loc), ["A12"]);
  assert.equal(caseTwin(bal, neg), undefined);
  assert.equal(caseTwin(bal, bal[3])?.loc, "A12");
});

test("a move is one withdrawal here and one deposit there, on the line's exact strings", () => {
  const line = { itemType: "خامة", item: "كوبوليمر", client: "اتقان", loc: "" };
  const [out, inn] = movePayloads(line, "A13", 150, "2026-09-02", "نقل");
  assert.equal(out.moveType, "سحب");
  assert.equal(out.loc, "");          // the blank-location line, exactly — not "all"
  assert.equal(out.qtyKg, 150);
  assert.equal(out.qtyCount, 0);
  assert.equal(inn.moveType, "إيداع");
  assert.equal(inn.loc, "A13");
  assert.equal(inn.qtyKg, 150);
  assert.equal(inn.itemType, "خامة");

  // products move by count and carry the known piece weight along
  const p = { itemType: "منتج", item: "محقن احمر", client: "الهندي", loc: "" };
  const [po, pi] = movePayloads(p, "F1", 200, "2026-09-02", "", 11);
  assert.equal(po.qtyCount, 200);
  assert.equal(po.qtyKg, 0);
  assert.equal(pi.grams, 11);
  assert.equal(pi.itemType, "منتج");
});
