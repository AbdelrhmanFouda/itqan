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
  NO_LOCATION, collectLocations, compareLocKey, locGroup, locKey, matchesTerms,
  normalizeText, sameLocation, searchTerms, toNumber, whereIs,
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
