/**
 * The mould-number rule (lib/mold-number.ts), pinned with the REAL cell values
 * read from «الرئيسي» through the bridge on 2026-09-04 — every notes value the
 * column held that day is here, so the rule is judged on what the sheet
 * actually says, not on invented examples.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  moldNumberFromNotes, resolveMoldNumber, moldNumberLabel, moldNumberIndex, moldKey, latinDigits,
} from "../lib/mold-number.ts";

/* ------------------------- notes that ARE a number ------------------------ */

// r156–r178 (the عداد ثلاثي / عداد 1-2 families, code in D as well) and
// r383–r385 (the دايموند meter parts — NO code, the note is all they have).
const NOTE_IS_NUMBER = [
  "HD16713", "HD16714", "HD16712", "HD16715", "KY20176",
  "HD16704", "20190R122", "HD16703", "20190RX121", "HD16705", "HD16706", "DL14035",
  "HD16709", "HD16707", "HD16710",
  "QH190032", "2024QRX097", "QH190031", "2023QRX087", "QH190033", "QH190036", "QH190035", "QH190037",
  "201907", "201906", "201908",
];

test("every customer mould number written in a Master note is read back as itself", () => {
  for (const n of NOTE_IS_NUMBER) {
    assert.equal(moldNumberFromNotes(n), n, `note «${n}» should be the mould number`);
  }
});

test("surrounding whitespace and Arabic-Indic digits do not hide a number", () => {
  assert.equal(moldNumberFromNotes("  HD16713 \n"), "HD16713");
  assert.equal(moldNumberFromNotes("٢٠١٩٠٧"), "201907");
  assert.equal(moldNumberFromNotes("HD١٦٧١٣"), "HD16713");
});

/* ------------------------ notes that are NOT a number --------------------- */

// Every OTHER notes value the column held on 2026-09-04, verbatim.
const NOTE_IS_TEXT = [
  "الدبدوب", "التعديل 1-02", "لا يعمل", "جديد", "قديم", "تيش", "بستم",
  "يمكن تشغيله أيضاً بـ بولي اميد مخرز",
  "⚠ مضاف من جرد المخزن 2026-07-27 — يحتاج مراجعة: الوزن وعدد الكافيتي وزمن الدورة",
  "وزن الحبة: 5 قطع = 18 جم",
];

test("no other note in the column is mistaken for a mould number", () => {
  for (const n of NOTE_IS_TEXT) {
    assert.equal(moldNumberFromNotes(n), "", `note «${n}» is not a mould number`);
  }
});

test("blank, filler, and the note shapes of the OTHER tabs are not numbers", () => {
  // «أوامر العمل» notes are cycle times; «الأعطال» notes are sentences; a
  // storage slot code («A17», the ITQ0167 mistake) is two digits short.
  for (const n of ["", "   ", undefined, null, "غير متاح / N/A", "N/A", "—",
                   "16 ث", "زمن الدورة 14 ث", "A17", "3.6", "50", "2026-07-27",
                   "تكرار هذا العطل في اسطمبه سابقه ك (النقاط / جردل كيرلوس)",
                   "لايوجد أجكتورات", "توحيد الكراتين في العدد حتي لا يحدث تشتيت في العدد"]) {
    assert.equal(moldNumberFromNotes(n), "", `«${n}» must not read as a mould number`);
  }
});

test("a bare identifier needs at least five characters and four digits", () => {
  // The bar that keeps short counts, years and slot codes out.
  assert.equal(moldNumberFromNotes("AB123"), "");      // 3 digits
  assert.equal(moldNumberFromNotes("1234"), "");       // 4 chars
  assert.equal(moldNumberFromNotes("12345"), "12345"); // 5 chars, 5 digits
  assert.equal(moldNumberFromNotes("A1234"), "A1234"); // 5 chars, 4 digits
  assert.equal(moldNumberFromNotes("X".repeat(20) + "12345"), ""); // 25 chars — too long to be a number
  assert.equal(moldNumberFromNotes("HD16713 قديم"), ""); // two words, unlabelled — not the whole note
});

/* ------------------------------ labelled notes ---------------------------- */

test("a note that NAMES the number is read whatever the number looks like", () => {
  assert.equal(moldNumberFromNotes("رقم الاسطمبة HD16713"), "HD16713");
  assert.equal(moldNumberFromNotes("كود الاسطمبة: 201907"), "201907");
  assert.equal(moldNumberFromNotes("رقم الإسطمبة 50"), "50");          // short is fine when labelled
  assert.equal(moldNumberFromNotes("نمرة الاسطمبه - 12"), "12");
  assert.equal(moldNumberFromNotes("رقم الاسطمبة ٢٠١٩٠٧ قديم"), "201907"); // Arabic digits, trailing text
  assert.equal(moldNumberFromNotes("Mold no. QH190032"), "QH190032");
  assert.equal(moldNumberFromNotes("mould #: 77"), "77");
  assert.equal(moldNumberFromNotes("tool code 2024-QRX/097 (old)"), "2024-QRX/097");
});

test("a label followed by words, not a number, yields nothing", () => {
  assert.equal(moldNumberFromNotes("رقم الاسطمبة غير معروف"), "");
  assert.equal(moldNumberFromNotes("mold number unknown"), "");
});

/* ------------------------------ resolveMoldNumber ------------------------- */

test("the code wins, and the notes number rides beside it", () => {
  // r156 «ضهر عداد ثلاثي»: code 001, note HD16713.
  const m = resolveMoldNumber({ code: "001", notes: "HD16713" });
  assert.deepEqual(m, { number: "001", source: "code", code: "001", notesNumber: "HD16713" });
  assert.equal(moldNumberLabel(m), "001 · HD16713");
});

test("with no code, the notes number IS the mould number", () => {
  // r383 «مديول عداد جديد (جولد دايموند)»: no code, note 201907.
  const m = resolveMoldNumber({ code: "", notes: "201907" });
  assert.deepEqual(m, { number: "201907", source: "notes", code: "", notesNumber: "201907" });
  assert.equal(moldNumberLabel(m), "201907");
});

test("filler in the code cell is blank, not a number", () => {
  assert.equal(resolveMoldNumber({ code: "غير متاح / N/A", notes: "" }).source, "none");
  assert.equal(resolveMoldNumber({ code: "غير متاح / N/A", notes: "201907" }).number, "201907");
  assert.equal(resolveMoldNumber({ code: undefined, notes: undefined }).number, "");
  assert.equal(moldNumberLabel(resolveMoldNumber({})), "");
});

test("a code typed with Arabic digits is the same code", () => {
  const m = resolveMoldNumber({ code: "٥٠", notes: "قديم" });
  assert.equal(m.number, "50");
  assert.equal(m.notesNumber, "");
  assert.equal(moldNumberLabel(m), "50");
});

/* -------------------------------- the index ------------------------------- */

test("the index is keyed by the normalised product name, first row wins, duplicates flagged", () => {
  const idx = moldNumberIndex([
    { name: "ضهر عداد ثلاثي", code: "001", notes: "HD16713" },
    { name: "زراير\t", code: "6", notes: "وزن الحبة: 5 قطع = 18 جم" },
    { name: "سماعة اريون", code: "332", notes: "" },
    { name: "سماعة  اريون ", code: "", notes: "201999" }, // same name, different spacing — a duplicate
    { name: "", code: "999", notes: "" },                 // nameless rows are skipped
    { name: "غير متاح / N/A", code: "", notes: "" },      // filler names are skipped too
  ]);
  assert.equal(idx.get(moldKey("ضهر عداد ثلاثي"))?.number, "001");
  assert.equal(idx.get(moldKey("زراير"))?.number, "6", "a trailing tab must not split the name");
  const dup = idx.get(moldKey("سماعة اريون"));
  assert.equal(dup?.number, "332", "first row wins");
  assert.equal(dup?.ambiguous, true, "…and the duplicate is flagged");
  assert.equal(idx.get(moldKey("ضهر عداد ثلاثي"))?.ambiguous, false);
  assert.equal(idx.has(""), false);
  assert.equal(idx.has(moldKey("غير متاح / N/A")), false);
});

test("moldKey folds digits, case and whitespace the way the other joins do", () => {
  assert.equal(moldKey(" Product  ١٢ "), "product 12");
  assert.equal(moldKey("زراير\t"), "زراير");
  assert.equal(moldKey(undefined), "");
  assert.equal(latinDigits("۱۲۳"), "123");
});
