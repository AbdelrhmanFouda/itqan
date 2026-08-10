/**
 * Reading a photographed paper sheet into «تسجيل الإنتاج». Run with `npm test`.
 *
 * These guard the two mistakes that would be invisible and permanent: filing an
 * evening's output into the morning's columns, and writing over a formula.
 * Every expectation below is checked against the real 09/08/2026 rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shiftHourKeys, detectShift, parseCell, matchSheetRow, buildRowChanges,
  writableKeys, SHEET_HOUR_KEYS, FORMULA_KEYS, HOURS_PER_SHIFT,
  type ExtractedRow, type SheetRow,
} from "../lib/sheet-import.ts";
import { readFileSync } from "node:fs";

test("the hour keys match lib/hourly.ts exactly — the duplication cannot drift", () => {
  // Read as TEXT rather than imported: lib/hourly.ts pulls in @/lib/sheets, an
  // alias Node cannot resolve. Comparing the source is also the stronger check —
  // it catches a reordering in the file even if both modules still export 24 keys.
  const src = readFileSync(new URL("../lib/hourly.ts", import.meta.url), "utf8");
  const block = src.match(/HOUR_KEYS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "HOUR_KEYS not found in lib/hourly.ts");
  const keys = Array.from(block[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(keys, [...SHEET_HOUR_KEYS]);
  assert.equal(SHEET_HOUR_KEYS.length, 24);
});

/* ------------------------- the shift mapping ------------------------------ */

test("morning fills the FIRST twelve columns, 08:00→19:00", () => {
  assert.deepEqual(shiftHourKeys("morning"),
    ["h08","h09","h10","h11","h12","h13","h14","h15","h16","h17","h18","h19"]);
});

test("evening fills the LAST twelve, 20:00→07:00 — the paper's 8:00 is 20:00", () => {
  assert.deepEqual(shiftHourKeys("evening"),
    ["h20","h21","h22","h23","h00","h01","h02","h03","h04","h05","h06","h07"]);
  // The paper's first column on an evening sheet must never be h08.
  assert.equal(shiftHourKeys("evening")[0], "h20");
  assert.notEqual(shiftHourKeys("evening")[0], shiftHourKeys("morning")[0]);
});

test("the two shifts are disjoint and together cover all 24 hours", () => {
  const m = shiftHourKeys("morning"), e = shiftHourKeys("evening");
  assert.equal(m.length, HOURS_PER_SHIFT);
  assert.equal(e.length, HOURS_PER_SHIFT);
  assert.equal(new Set([...m, ...e]).size, 24, "no overlap");
  assert.deepEqual([...m, ...e], [...SHEET_HOUR_KEYS], "and in column order");
});

test("the shift is read from the printed Arabic heading", () => {
  assert.equal(detectShift("الأنتاج اليومي لماكينات الحقن الوردية المسائية"), "evening");
  assert.equal(detectShift("الأنتاج اليومي لماكينات الحقن الوردية الصباحية"), "morning");
});

test("an unreadable heading returns null so the caller ASKS instead of assuming", () => {
  // Guessing here costs a whole shift of data, filed into the wrong half.
  assert.equal(detectShift("الأنتاج اليومي لماكينات الحقن"), null);
  assert.equal(detectShift(""), null);
});

/* --------------------------- handwritten cells ---------------------------- */

test("Arabic-Indic handwriting parses", () => {
  assert.equal(parseCell("٢٣"), 23);
  assert.equal(parseCell("١٦٣"), 163);
  assert.equal(parseCell("١٢٣٩"), 1239);
  assert.equal(parseCell("١٣,٣٧٢"), 13372);
  assert.equal(parseCell(564), 564);
});

test("a blank or a scrawled note becomes null, NEVER zero", () => {
  // «متوقف صيانة» is written across cells on the real sheet. Reading that as 0
  // would claim the machine ran and made nothing, dragging efficiency down.
  for (const v of ["", "   ", "—", "-", "متوقف صيانة", "صيانة", null, undefined, "n/a"]) {
    assert.equal(parseCell(v), null, `${String(v)} should be null`);
  }
  assert.equal(parseCell("0"), 0, "but a written zero IS a reading");
  assert.equal(parseCell("٠"), 0);
});

/* ------------------------------ row matching ------------------------------ */

const SHEET: SheetRow[] = [
  { row: 120, date: "2026-08-09", machine: "PQ 12 — 180", product: "عجلة مكنسة" },
  { row: 128, date: "2026-08-09", machine: "PQ 12 — 180", product: "جوان عجلة مكنسة" },
  { row: 121, date: "2026-08-09", machine: "PQ 1 — 550", product: "كرسي" },
  { row: 99,  date: "2026-08-08", machine: "PQ 1 — 550", product: "كرسي" },
];

test("a machine that ran two products in a day resolves to the RIGHT row", () => {
  // The real 09/08 case: PQ 12 — 180 has two rows, one per product.
  assert.equal(matchSheetRow(SHEET, "2026-08-09", { machine: "PQ 12 — 180", product: "عجلة مكنسة" }), 120);
  assert.equal(matchSheetRow(SHEET, "2026-08-09", { machine: "PQ 12 — 180", product: "جوان عجلة مكنسة" }), 128);
});

test("matching is scoped to the day", () => {
  assert.equal(matchSheetRow(SHEET, "2026-08-08", { machine: "PQ 1 — 550", product: "كرسي" }), 99);
});

test("a new product on a known machine gets NO match, so a new row is appended", () => {
  assert.equal(matchSheetRow(SHEET, "2026-08-09", { machine: "PQ 12 — 180", product: "منتج جديد" }), null);
  assert.equal(matchSheetRow(SHEET, "2026-08-10", { machine: "PQ 1 — 550", product: "كرسي" }), null);
});

test("matching tolerates spacing and Arabic digits on both sides", () => {
  assert.equal(matchSheetRow(SHEET, "2026-08-09", { machine: "PQ  ١٢  —  180", product: " عجلة  مكنسة " }), 120);
});

/* ------------------------------ the changes ------------------------------- */

const row = (over: Partial<ExtractedRow> = {}): ExtractedRow => ({
  machine: "PQ 1 — 550",
  product: "كرسي",
  hours: [23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23],
  actualTotal: 527,
  ...over,
});

test("an evening sheet writes h20…h07 and nothing else", () => {
  const c = buildRowChanges("evening", row());
  assert.deepEqual(Object.keys(c).sort(),
    ["actualTotal","h00","h01","h02","h03","h04","h05","h06","h07","h20","h21","h22","h23"].sort());
  assert.equal(c.h20, "23");
  assert.equal(c.actualTotal, "527");
  assert.equal(c.h08, undefined, "must not touch the morning half");
});

test("a morning sheet writes h08…h19 and nothing else", () => {
  const c = buildRowChanges("morning", row());
  assert.equal(c.h08, "23");
  assert.equal(c.h20, undefined, "must not touch the evening half");
});

test("the formula columns are NEVER in the changes", () => {
  for (const shift of ["morning", "evening"] as const) {
    const c = buildRowChanges(shift, row());
    for (const k of FORMULA_KEYS) {
      assert.equal(k in c, false, `${k} would overwrite a live formula`);
      assert.equal(writableKeys(shift).has(k), false);
    }
  }
});

test("a blank hour is OMITTED, not written as empty — the sheet keeps what it had", () => {
  const c = buildRowChanges("evening", row({ hours: [null, 23, null, 23, 23, 23, 23, 23, 23, 23, 23, 23] }));
  assert.equal("h20" in c, false, "blank first hour left alone");
  assert.equal("h22" in c, false);
  assert.equal(c.h21, "23");
  // Matches the real sheet: PQ 1 on 09/08 has 20:00 empty and 21:00–07:00 filled.
});

test("a missing actual total is omitted rather than blanked", () => {
  const c = buildRowChanges("evening", row({ actualTotal: null }));
  assert.equal("actualTotal" in c, false);
});

test("a written zero IS carried through", () => {
  const c = buildRowChanges("evening", row({ hours: [0, ...Array(11).fill(null)] }));
  assert.equal(c.h20, "0");
});
