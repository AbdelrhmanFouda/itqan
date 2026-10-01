/**
 * «خطة الاسطمبات» (lib/changeover.ts). Run with `npm test`.
 *
 * The fixtures are the live shapes of 2026-09-30: Master's «نوع الخام» as it
 * is actually spelled («بروبلين مخرز اسود», «pc ابيض», «ABS&بولي كربونيت»),
 * work-order instructions that name the colour in a sentence, registry labels
 * with an em dash. The rules under test are the owner's and the production
 * engineer's own answers, in the order they gave them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANY_COLOUR, CHANGEOVER_NUMBERS, MISSING_ITEMS, NOTHING_MISSING,
  answersFor, colourKey, colourRelation, colourToSheet, coloursIn, dryingFor, estimateChange, guessColour,
  isNightHour, kindFromSheet, kindToSheet, listFromSheet, listToSheet, machineKey, materialFamily, mergeAnswers,
  missingFromSheet, missingToSheet, parseYesNo, rankFor, safeText, splitMinutes, standingFromLog,
  type PlanMachine, type PlanOrder,
} from "../lib/changeover.ts";

const machine = (o: Partial<PlanMachine> = {}): PlanMachine => ({
  label: "PQ 5 — 100", tonnage: "100", active: true, state: "free", transparentOnly: false, bigMachine: false,
  now: { product: "غطاء", colour: "white", material: "بروبلين بيور", order: "Job 1", source: "plan" },
  ...o,
});
const order = (o: Partial<PlanOrder> & { code: string }): PlanOrder => ({
  id: o.code, product: `منتج ${o.code}`, client: "عميل", material: "بروبلين", dueDate: "2026-10-20", status: "Not Started",
  qtyKg: 100, remaining: 50_000, runHours: 40, colour: "white", colourSource: "answer",
  fits: null, fitsHint: [], fitsHintText: "", workers: null, oilCores: null, missing: [], keyClient: false, mountedOn: "",
  ...o,
});
const ctx = { today: "2026-09-30", transparentMachines: [] as string[] };
const codes = (m: PlanMachine, os: PlanOrder[], c = ctx) => rankFor(m, os, c).ranked.map((s) => s.order.code);

/* --------------------------------- colours -------------------------------- */

test("a colour cell folds to one key whatever the spelling", () => {
  assert.equal(colourKey("أبيض"), "white");
  assert.equal(colourKey("ابيض"), "white");
  assert.equal(colourKey(" الأسود "), "black");
  assert.equal(colourKey("شفاف"), "transparent");
  assert.equal(colourKey("أي لون"), ANY_COLOUR);
  assert.equal(colourKey(""), "");
  // A colour the list does not know is still a colour — kept, never dropped.
  assert.equal(colourKey("فوشيا"), "فوشيا");
  assert.equal(colourToSheet("white"), "أبيض");
  assert.equal(colourToSheet(ANY_COLOUR), "أي لون");
});

test("a colour is guessed only when the text names exactly one", () => {
  assert.deepEqual(coloursIn("اللون ابيض ماستر 4٪"), ["white"]);
  assert.equal(guessColour(["اللون ابيض ماستر 4٪"]), "white");
  assert.equal(guessColour(["تغيير اللون الي ابيض"]), "white");
  assert.equal(guessColour(["", "", "محقن شفاف"]), "transparent");
  assert.equal(guessColour(["", "عظمة قشارة ثوم", "ABS اسود مخرز"]), "black");
  // Two colours in the instructions is no guess — and the product name after
  // it is NOT consulted, because the order has already said it is not simple.
  assert.equal(guessColour(["اللون الرمادي 4٪ / اللون الاسود 2٪", "محقن احمر"]), "");
  assert.equal(guessColour(["غطاء جوان", "غطاء تك 46"]), "");
});

test("light → dark is easy, dark → light is hard, anything → transparent is the worst", () => {
  assert.equal(colourRelation("white", "white"), "same");
  assert.equal(colourRelation("white", "black"), "darker");
  assert.equal(colourRelation("black", "white"), "lighter");
  assert.equal(colourRelation("yellow", "red"), "darker");
  assert.equal(colourRelation("black", "transparent"), "toTransparent");
  assert.equal(colourRelation("white", "transparent"), "toTransparent");
  assert.equal(colourRelation("transparent", "red"), "fromTransparent");
  assert.equal(colourRelation("black", ANY_COLOUR), "any");
  assert.equal(colourRelation("", "white"), "unknown");
  assert.equal(colourRelation("white", ""), "unknown");
  // Two colours outside the list: the same one is the same, two are unknown.
  assert.equal(colourRelation("فوشيا", "فوشيا"), "same");
  assert.equal(colourRelation("فوشيا", "تركواز"), "unknown");
});

/* -------------------------------- materials ------------------------------- */

test("Master's material spellings resolve to a family", () => {
  for (const [text, family] of [
    ["بروبلين بيور", "PP"], ["بروبلين مخرز اسود", "PP"], ["بولي بروبلين", "PP"], ["P.P RECYLE", "PP"],
    ["راندم", "PP"], ["كوبلمارت", "PP"], ["بروبلين هومو+ اوميا+ماستر اسود", "PP"],
    ["بولي ايثلين", "PE"], ["PE", "PE"], ["بولي ايثلين 7000", "PE"],
    ["ABS", "ABS"], ["ABS اسود مخرز", "ABS"], ["ABS&بولي كربونيت", "ABS"],
    ["بولي كربونيت", "PC"], ["pc ابيض", "PC"], ["PC شفاف", "PC"],
    ["بولي اميد بيور", "PA"], ["بولي اميد فايبر", "PA"], ["كسر بولي اميد", "PA"],
    ["بولي ايستال", "POM"], ["PVC 87", "PVC"],
    ["PPT", "other"], ["سان", "other"],
    ["", ""], ["غير متاح / N/A", ""],
  ] as const) {
    assert.equal(materialFamily(text), family, `«${text}»`);
  }
});

test("drying hours are the engineer's: PC 3–4, ABS 3, بولي أمايد 3 with fibre and 4–5 without", () => {
  assert.deepEqual(dryingFor("بولي كربونيت"), { minH: 3, maxH: 4 });
  assert.deepEqual(dryingFor("ABS اسود مخرز"), { minH: 3, maxH: 3 });
  assert.deepEqual(dryingFor("بولي اميد فايبر"), { minH: 3, maxH: 3 });
  assert.deepEqual(dryingFor("بولي اميد بيور"), { minH: 4, maxH: 5 });
  assert.equal(dryingFor("بروبلين بيور"), null);
  assert.equal(dryingFor(""), null);
});

/* ------------------------------- the estimate ------------------------------ */

test("the same colour on the same material costs only the mould swap", () => {
  const e = estimateChange(
    { product: "أ", colour: "أبيض", material: "بروبلين بيور" },
    { product: "ب", colour: "ابيض", material: "بروبلين مخرز" },
  );
  assert.equal(e.ease, "same");
  assert.equal(e.purgeMin, 0);
  assert.equal(e.swapMin, CHANGEOVER_NUMBERS.swapMin);
  assert.equal(e.materialChange, false);
});

test("a hard colour change takes his 20 minutes on PP and his 105 on ABS", () => {
  const pp = estimateChange({ product: "أ", colour: "black", material: "بروبلين" }, { product: "ب", colour: "white", material: "بروبلين" });
  assert.equal(pp.ease, "hard");
  assert.equal(pp.purgeMin, 20);
  const abs = estimateChange({ product: "أ", colour: "black", material: "ABS" }, { product: "ب", colour: "white", material: "ABS" });
  assert.equal(abs.purgeMin, 105);
  const easy = estimateChange({ product: "أ", colour: "white", material: "ABS" }, { product: "ب", colour: "black", material: "ABS" });
  assert.equal(easy.ease, "easy");
  assert.ok(easy.purgeMin < abs.purgeMin);
});

test("anything → transparent is the worst tier and costs the most", () => {
  const e = estimateChange({ product: "أ", colour: "black", material: "بولي كربونيت" }, { product: "ب", colour: "شفاف", material: "PC شفاف" });
  assert.equal(e.ease, "veryHard");
  assert.equal(e.purgeMin, 210);
  assert.deepEqual(e.drying, { minH: 3, maxH: 4 });
});

test("a different material is never better than hard, and is priced on the slower of the two", () => {
  const e = estimateChange({ product: "أ", colour: "white", material: "بولي كربونيت" }, { product: "ب", colour: "white", material: "بروبلين" });
  assert.equal(e.materialChange, true);
  assert.equal(e.ease, "hard");
  assert.equal(e.purgeMin, 105, "leaving PC is slow even though PP is quick");
});

test("the big machine and oil cores set the mould time; the same mould costs none", () => {
  const from = { product: "أ", colour: "white", material: "بروبلين" };
  const to = { product: "ب", colour: "white", material: "بروبلين" };
  assert.equal(estimateChange(from, to, { bigMachine: true }).swapMin, 360);
  assert.equal(estimateChange(from, to, { oilCores: true }).swapMin, 150);
  assert.equal(estimateChange(from, to).swapMin, 45);
  const same = estimateChange(from, { ...from, colour: "black" }, { bigMachine: true });
  assert.equal(same.sameMould, true);
  assert.equal(same.swapMin, 0);
});

test("an unknown material is not flattered: priced as slow, and never 'nothing to do'", () => {
  const e = estimateChange({ product: "أ", colour: "white", material: "" }, { product: "ب", colour: "white", material: "" });
  assert.equal(e.materialChange, null);
  assert.equal(e.ease, "easy");
  assert.ok(e.purgeMin > 0);
});

/* --------------------------------- answers -------------------------------- */

test("the latest non-blank answer wins, per thing and per question", () => {
  const all = mergeAnswers([
    { kind: "order", key: "job 1", colour: "أبيض", missing: "الخامة" },
    { kind: "order", key: "job 1", colour: "", missing: NOTHING_MISSING },   // colour left alone
    { kind: "order", key: "job 1", colour: "أسود" },
    { kind: "mold", key: "غطاء", fits: "PQ 1 — 550" },
    { kind: "", key: "x", colour: "أحمر" },                                    // an unreadable kind is ignored
    { kind: "order", key: "", colour: "أحمر" },
  ]);
  assert.deepEqual(answersFor(all, "order", "job 1"), { colour: "أسود", missing: NOTHING_MISSING });
  assert.deepEqual(answersFor(all, "mold", "غطاء"), { fits: "PQ 1 — 550" });
  assert.deepEqual(answersFor(all, "client", "nobody"), {});
});

test("cells round-trip: kinds, yes/no, lists, and what is missing", () => {
  for (const k of ["machine", "mold", "order", "client"] as const) assert.equal(kindFromSheet(kindToSheet(k)), k);
  assert.equal(kindFromSheet("حاجة تانية"), "");
  assert.equal(parseYesNo("نعم"), true);
  assert.equal(parseYesNo("لا"), false);
  assert.equal(parseYesNo(""), null);
  const labels = ["PQ 1 — 550", "PQ 7 — 100"];
  assert.deepEqual(listFromSheet(listToSheet(labels)), labels);
  // Blank = never asked; «لا يوجد» = asked, nothing missing. They must differ.
  assert.equal(missingFromSheet(""), null);
  assert.deepEqual(missingFromSheet(NOTHING_MISSING), []);
  assert.equal(missingToSheet([]), NOTHING_MISSING);
  const keys = MISSING_ITEMS.map((m) => m.key);
  assert.deepEqual(missingFromSheet(missingToSheet(keys)), keys);
  assert.deepEqual(missingFromSheet("الخامة | الكراتين / الأكياس"), ["material", "packaging"]);
});

test("the last log row for a machine is what stands on it, whatever the dash", () => {
  const st = standingFromLog([
    { machine: "PQ 5 — 100", order: "Job 1", toProduct: "غطاء", toColour: "أبيض", material: "" },
    { machine: "PQ 7 — 100", order: "", toProduct: "عدسة", toColour: "شفاف", material: "" },
    { machine: "PQ 5 - 100", order: "Job 2", toProduct: "قاعدة", toColour: "أسود", material: "" },
    { machine: "PQ 9 — 140", order: "", toProduct: "", toColour: "", material: "" }, // no product: not a state
  ]);
  assert.equal(st.get(machineKey("PQ 5 — 100"))?.toProduct, "قاعدة");
  assert.equal(st.get(machineKey("PQ7—100"))?.toColour, "شفاف");
  assert.equal(st.has(machineKey("PQ 9 — 140")), false);
});

/* --------------------------------- ranking -------------------------------- */

test("the owner's order: key client, then late, then ease, then what is left, then due date", () => {
  const m = machine();
  const os = [
    order({ code: "due-later", dueDate: "2026-10-25" }),
    order({ code: "due-sooner", dueDate: "2026-10-05" }),
    order({ code: "less-left", remaining: 1_000 }),
    order({ code: "hard-colour", colour: "transparent" }),
    order({ code: "late", dueDate: "2026-09-20", colour: "transparent" }),
    order({ code: "key", keyClient: true, colour: "transparent", dueDate: "2026-11-30" }),
  ];
  assert.deepEqual(codes(m, os), ["key", "late", "less-left", "due-sooner", "due-later", "hard-colour"]);
});

test("a key client's hard colour goes before an ordinary client's same colour — his own example", () => {
  const m = machine({ now: { product: "غطاء", colour: "black", material: "بروبلين", order: "", source: "plan" } });
  const os = [
    order({ code: "same-colour", colour: "black" }),
    order({ code: "key-hard", colour: "white", keyClient: true }),
  ];
  assert.deepEqual(codes(m, os), ["key-hard", "same-colour"]);
});

test("a mould that fits only this machine goes before one that could go elsewhere", () => {
  const m = machine({ label: "PQ 1 — 550", tonnage: "550" });
  const os = [
    order({ code: "flexible", fits: ["PQ 1 — 550", "PQ 2 — 280"] }),
    order({ code: "only-here", fits: ["PQ 1 - 550"], colour: "black" }),
  ];
  const r = rankFor(m, os, ctx);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["only-here", "flexible"]);
  assert.ok(r.ranked[0].chips.some((c) => c.key === "onlyHere"));
});

test("four things take an order out of the ranking, each with its reason", () => {
  const m = machine();
  const r = rankFor(m, [
    // «جاري التشغيل» with nothing left to make — live on 2026-10-01 (Job 482),
    // and "least remaining first" had put it at the top.
    order({ code: "made", remaining: 0 }),
    order({ code: "elsewhere", fits: ["PQ 1 — 550"] }),
    order({ code: "clear", colour: "شفاف" }),
    order({ code: "not-ready", missing: ["material", "packaging"] }),
    order({ code: "fine" }),
  ], { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] });
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["fine"]);
  assert.deepEqual(r.blocked.map((b) => [b.order.code, b.reason]), [
    ["made", "finished"], ["elsewhere", "notFit"], ["clear", "transparentElsewhere"], ["not-ready", "missing"],
  ]);
});

test("transparent is free to go anywhere until a machine is kept for it, and that machine prefers it", () => {
  const clear = order({ code: "clear", colour: "transparent" });
  assert.deepEqual(codes(machine(), [clear]), ["clear"], "no machine marked: nothing is blocked");

  const lens = machine({ label: "PQ 7 — 100", transparentOnly: true, now: { product: "عدسة", colour: "transparent", material: "PC شفاف", order: "", source: "plan" } });
  const c = { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] };
  const r = rankFor(lens, [order({ code: "coloured", colour: "black" }), clear], c);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["clear", "coloured"]);
  assert.ok(r.ranked[1].chips.some((x) => x.key === "transparentMachine"));
});

test("an order standing on a machine is nobody's candidate", () => {
  assert.deepEqual(codes(machine(), [order({ code: "a", mountedOn: "PQ 2 — 280" }), order({ code: "b" })]), ["b"]);
});

test("on a running machine only a key client is worth taking the mould off", () => {
  const r = rankFor(machine({ state: "running" }), [order({ code: "key", keyClient: true }), order({ code: "plain" })], ctx);
  assert.ok(r.ranked[0].chips.some((c) => c.key === "worthInterrupt"));
  assert.ok(r.ranked[1].chips.some((c) => c.key === "machineBusy"));
});

test("the chips say what the engineer needs before he decides", () => {
  const m = machine();
  const [s] = rankFor(m, [order({
    code: "x", colour: "black", colourSource: "guess", material: "ABS اسود مخرز", dueDate: "2026-09-25",
    workers: 2, runHours: 5, missing: null, fitsHint: ["PQ 12 — 180"], fitsHintText: "180",
  })], ctx).ranked;
  const keys = s.chips.map((c) => c.key);
  for (const k of ["late", "darker", "colourGuess", "materialChange", "drying", "fitHintElsewhere", "workers", "shortRun", "readyNotAsked"]) {
    assert.ok(keys.includes(k), `missing chip ${k} in ${keys.join(",")}`);
  }
  assert.equal(s.late, 5);
  assert.deepEqual(s.chips.find((c) => c.key === "drying")?.vars, { h: "3" });
});

test("an order with no colour is ranked, flagged, and never treated as easy", () => {
  const [s] = rankFor(machine(), [order({ code: "x", colour: "", colourSource: "" })], ctx).ranked;
  assert.equal(s.estimate.ease, "unknown");
  assert.ok(s.chips.some((c) => c.key === "colourUnknown"));
});

/* ---------------------------------- the rest -------------------------------- */

test("night is 20:00–08:00 Cairo", () => {
  assert.equal(isNightHour(7), true);
  assert.equal(isNightHour(8), false);
  assert.equal(isNightHour(19), false);
  assert.equal(isNightHour(20), true);
  assert.equal(isNightHour(0), true);
});

test("minutes split for the eye, and a cell never starts a formula", () => {
  assert.deepEqual(splitMinutes(105), { h: 1, m: 45 });
  assert.deepEqual(splitMinutes(20), { h: 0, m: 20 });
  assert.deepEqual(splitMinutes(360), { h: 6, m: 0 });
  assert.equal(safeText("=IMPORTRANGE(1)"), "IMPORTRANGE(1)");
  assert.equal(safeText("  +1 أحمر "), "1 أحمر");
  assert.equal(safeText("x".repeat(500), 40).length, 40);
});
