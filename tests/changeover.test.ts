/**
 * «خطة الاسطمبات» (lib/changeover.ts). Run with `npm test`.
 *
 * The fixtures are the live shapes of 2026-09-30 → 10-05: Master's «نوع الخام»
 * as it is actually spelled («بروبلين مخرز اسود», «pc ابيض»), work-order
 * instructions that name the colour in a sentence, registry labels with an em
 * dash, and «الإنتاج» rows where one machine changes mould between the
 * morning and the evening shift. The rules under test are the owner's and the
 * production engineer's own answers, in the order they gave them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANY_COLOUR, BASELINE_REASON, CHANGEOVER_NUMBERS, FITS_UNKNOWN, MAP_COLS, MAP_MAX_ROWS, MAP_TILE, MISSING_ITEMS,
  NOTHING_MISSING, freeSpot, fitFloor, tileHeightPx, tileWidthPx, MAP_READABLE,
  answersFor, barrelColours, bestStart, colourFromMaterial, colourKey, colourRelation, colourToSheet,
  coloursFromSheet, coloursIn, coloursToSheet, dryingFor, estimateChange, estimateFrom, formatLayout, guessColour,
  isBaselineRow, isNightHour, isRecent, kindFromSheet, kindToSheet, latestRuns, listFromSheet, listToSheet,
  looseNameKey, machineKey, machineState, mapRows, materialFamily, mergeAnswers, missingFromSheet, missingToSheet,
  newestHolders, parseLayout, parseYesNo, placeTile, rankFor, removeTile, resolveNow, safeText, splitMinutes,
  stampClockMinutes, stampDay, standingFromLog, standingWithStart, validLayout, barrelOf, logSinceTold, NO_ORDER,
  type LastRun, type MapTile, type PlanMachine, type PlanOrder, type PlanStanding,
} from "../lib/changeover.ts";

const machine = (o: Partial<PlanMachine> & { now?: Partial<PlanMachine["now"]> } = {}): PlanMachine => ({
  label: "PQ 5 — 100", tonnage: "100", state: "idle", stoppage: null, transparentOnly: false, bigMachine: false,
  ...o,
  now: {
    products: ["غطاء"], colours: ["white"], colourNow: "", coloursGuessed: false, material: "بروبلين بيور", order: "",
    keyClient: false, orderMaybe: "", noOrder: false, alsoOn: "", mixedShift: false,
    source: "production", since: "2026-10-01", shift: "الصباحية", ...(o.now ?? {}),
  },
});
const order = (o: Partial<PlanOrder> & { code: string }): PlanOrder => ({
  id: o.code, product: `منتج ${o.code}`, client: "عميل", material: "بروبلين", dueDate: "2026-10-20", status: "Not Started",
  qtyKg: 100, remaining: 50_000, runHours: 40, colours: ["white"], colourSource: "answer",
  fits: ["PQ 5 — 100", "PQ 7 — 100"], fitsHint: [], fitsHintText: "", workers: null, oilCores: null, hotRunner: null,
  missing: [], keyClient: false, mountedOn: "", mountedRunning: false, queuedBehind: "",
  ...o,
});
const ctx = { today: "2026-09-30", transparentMachines: [] as string[] };
const run = (o: Partial<LastRun> & { date: string; products: string[] }): LastRun => ({
  shift: "الصباحية", materials: o.products.map(() => ""), mixed: false, ...o,
});
const told = (o: Partial<PlanStanding> = {}): PlanStanding => ({
  date: "2026-10-01", products: ["غطاء"], colours: ["red"], colourNow: "", order: "Job 9", material: "",
  baseline: false, startedOn: "", from: [], ...o,
});
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
  // The floor's own spelling, as the product names carry it (live, 2026-10-05).
  assert.equal(guessColour(["روزته سودة العداد الثلاثي"]), "black");
  assert.equal(guessColour(["غطاء احمر جديد"]), "red");
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
  // Colours are not in the sheet, so "not recorded" is the usual state of a
  // machine — and a transparent job after an UNKNOWN colour is still the
  // worst change, not a middling "unknown".
  assert.equal(colourRelation("", "transparent"), "toTransparent");
  assert.equal(colourRelation(ANY_COLOUR, "transparent"), "toTransparent");
  assert.equal(colourRelation("transparent", "transparent"), "same");
  // Two colours outside the list: the same one is the same, two are unknown.
  assert.equal(colourRelation("فوشيا", "فوشيا"), "same");
  assert.equal(colourRelation("فوشيا", "تركواز"), "unknown");
});

test("a job has COLOURS: the cell is a list, however it was typed", () => {
  assert.deepEqual(coloursFromSheet("أبيض | رمادي | أسود"), ["white", "grey", "black"]);
  assert.deepEqual(coloursFromSheet("الرمادي / الاسود"), ["grey", "black"]);
  assert.deepEqual(coloursFromSheet("أبيض، ابيض"), ["white"]);
  assert.deepEqual(coloursFromSheet(""), []);
  assert.equal(coloursToSheet(["white", "grey"]), "أبيض | رمادي");
  assert.deepEqual(coloursFromSheet(coloursToSheet(["transparent", "فوشيا", "black"])), ["transparent", "فوشيا", "black"]);
});

test("what may be in the barrel: the one colour when it is known, else every colour the job runs in", () => {
  assert.deepEqual(barrelColours({ colourNow: "white", colours: ["white", "black"] }), ["white"]);
  assert.deepEqual(barrelColours({ colourNow: "", colours: ["white", "black", ANY_COLOUR] }), ["white", "black"]);
  assert.deepEqual(barrelColours({ colourNow: ANY_COLOUR, colours: [] }), []);
});

test("a machine running several colours is priced on the WORST of them, listed or not", () => {
  const to = { product: "ب", colour: "white", material: "بروبلين" };
  const from = (colours: string[]) => ({ product: "أ", colours, material: "بروبلين" });
  // White is on its list, but so is black: not "the same colour".
  assert.equal(estimateFrom(from(["white", "black"]), to).colour, "lighter");
  assert.equal(estimateFrom(from(["white"]), to).colour, "same");
  // A typed colour the list does not know used to HIDE the black beside it
  // (the old "darkest" returned the first unlisted colour and stopped).
  assert.equal(estimateFrom(from(["فوشيا", "black"]), to).colour, "lighter");
  assert.equal(estimateFrom(from(["black", "فوشيا"]), to).colour, "lighter");
  // Nothing known at all is one estimate, colour unknown.
  assert.equal(estimateFrom(from([]), to).colour, "unknown");
});

test("an order in several colours starts with the one that is easiest after what is on the machine", () => {
  const from = (colours: string[]) => ({ product: "أ", colours, material: "بروبلين" });
  const r = bestStart(from(["white"]), { product: "ب", colours: ["black", "white", "grey"], material: "بروبلين" });
  assert.equal(r.startColour, "white");
  assert.equal(r.estimate.ease, "same");
  // After black, nothing lighter is easy: black itself is the start.
  assert.equal(bestStart(from(["black"]), { product: "ب", colours: ["white", "black"], material: "بروبلين" }).startColour, "black");
  // No colours at all is one estimate, colour unknown.
  const none = bestStart(from(["white"]), { product: "ب", colours: [], material: "بروبلين" });
  assert.equal(none.startColour, "");
  assert.equal(none.estimate.ease, "unknown");
  // «أي لون» is an order's indifference, not something that goes in a barrel.
  assert.equal(bestStart(from(["black"]), { product: "ب", colours: [ANY_COLOUR], material: "بروبلين" }).startColour, "");
});

test("a colour read off a material cell: «مخرز شفاف» is regrind, not a transparent part", () => {
  // Seven products with that material have had orders; none was transparent
  // (أصفر, بيج, أبيض…). It made ordinary parts look like the one colour the
  // owner's worst-case rule hangs on.
  assert.equal(colourFromMaterial("مخرز شفاف"), "");
  assert.equal(colourFromMaterial("بروبلين مخرز شفاف"), "");
  assert.equal(colourFromMaterial("PC شفاف"), "transparent");
  assert.equal(colourFromMaterial("ABS اسود مخرز"), "black");
  assert.equal(colourFromMaterial("بروبلين مخرز احمر"), "red");
  assert.equal(colourFromMaterial("بروبلين بيور"), "");
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

test("a hot runner adds its heat-up whenever the mould goes up or its colour changes", () => {
  const from = { product: "أ", colour: "white", material: "بروبلين" };
  const to = { product: "ب", colour: "white", material: "بروبلين" };
  const plain = estimateChange(from, to);
  const hot = estimateChange(from, to, { hotRunner: true });
  assert.equal(plain.hotRunnerMin, 0);
  assert.equal(hot.hotRunnerMin, CHANGEOVER_NUMBERS.hotRunnerMin);
  assert.equal(hot.totalMin, plain.totalMin + CHANGEOVER_NUMBERS.hotRunnerMin);
  // The same mould carrying on in the same colour: nothing to heat or purge.
  assert.equal(estimateChange(from, { ...from }, { hotRunner: true }).hotRunnerMin, 0);
  // The same mould, another colour: the runner is purged through.
  assert.equal(estimateChange(from, { ...from, colour: "black" }, { hotRunner: true }).hotRunnerMin, CHANGEOVER_NUMBERS.hotRunnerMin);
});

test("a machine whose material is NOT KNOWN is priced slow, even for a PP order", () => {
  // The file's own rule — an unknown family is slow — was applied to the
  // order's side only: an unknown barrel + a PP order came out at 20 minutes.
  const e = estimateChange({ product: "أ", colour: "black", material: "" }, { product: "ب", colour: "white", material: "بروبلين" });
  assert.equal(e.materialChange, null);
  assert.equal(e.purgeMin, CHANGEOVER_NUMBERS.colourSlowMin);
});

test("two materials this file does not recognise are not 'the same material' unless they are the same text", () => {
  const from = { product: "أ", colour: "white", material: "TPR" };
  const same = estimateChange(from, { product: "ب", colour: "white", material: " tpr " });
  assert.deepEqual([same.materialChange, same.purgeMin], [false, 0]);
  // TPR → سان / PPT / مخرز شفاف used to read «نفس الخامة», 0 minutes of purge.
  for (const m of ["سان", "PPT", "مخرز شفاف"]) {
    const e = estimateChange(from, { product: "ب", colour: "white", material: m });
    assert.equal(e.materialChange, null, m);
    assert.notEqual(e.ease, "same", m);
    assert.ok(e.purgeMin > 0, m);
  }
});

test("an unknown material is not flattered: priced as slow, and never 'nothing to do'", () => {
  const e = estimateChange({ product: "أ", colour: "white", material: "" }, { product: "ب", colour: "white", material: "" });
  assert.equal(e.materialChange, null);
  assert.equal(e.ease, "easy");
  assert.ok(e.purgeMin > 0);
});

/* ------------------------------ what is running ----------------------------- */

const SHIFTS = [
  // PQ 9 changed mould between the morning and the evening of 3 Oct (live).
  { date: "2026-10-03", shift: "الصباحية", machine: "PQ 9 — 140", product: "غطاء امير احمر" },
  { date: "2026-10-03", shift: "المسائية", machine: "PQ 9 — 140", product: "الثلاثية" },
  { date: "2026-10-04", shift: "الصباحية", machine: "PQ 9 — 140", product: "الثلاثية" },
  // PQ 7 runs a left pair and a right pair in the same shift (live).
  { date: "2026-10-04", shift: "الصباحية", machine: "PQ 7 — 100", product: "EXT 51L + EXT 51R" },
  { date: "2026-10-04", shift: "الصباحية", machine: "PQ 7 - 100", product: "EXT 52L + EXT 52R" },
  { date: "2026-10-03", shift: "المسائية", machine: "PQ 7 — 100", product: "EXT 52L + EXT 52R" },
  // PQ 11 has not run since 23 Sep — the mould is still standing on it.
  { date: "2026-09-23", shift: "المسائية", machine: "PQ 11 — 180", product: "عظمة قشارة ثوم" },
  { date: "2026-09-23", shift: "الصباحية", machine: "PQ 11 — 180", product: "عظمة قشارة ثوم" },
  // Not shifts: no date, no product, and a year typed wrong.
  { date: "", shift: "الصباحية", machine: "PQ 13 — 150", product: "روزته" },
  { date: "2026-10-04", shift: "الصباحية", machine: "PQ 13 — 150", product: "" },
  { date: "2027-10-04", shift: "الصباحية", machine: "PQ 2 — 280", product: "وش" },
];

test("what a machine is running is its LATEST shift in «الإنتاج», evening after morning", () => {
  const r = latestRuns(SHIFTS, "2026-10-05");
  assert.equal(r.latestDate, "2026-10-04");
  assert.deepEqual(r.byMachine.get(machineKey("PQ 9 — 140")),
    { date: "2026-10-04", shift: "الصباحية", products: ["الثلاثية"], materials: [""], mixed: false });
  assert.deepEqual(r.byMachine.get(machineKey("PQ 7 — 100"))?.products, ["EXT 51L + EXT 51R", "EXT 52L + EXT 52R"], "a pair in one shift is both");
  assert.equal(r.byMachine.get(machineKey("PQ 11 — 180"))?.date, "2026-09-23");
  assert.equal(r.byMachine.has(machineKey("PQ 13 — 150")), false, "no date or no product is not a shift");
  assert.equal(r.byMachine.has(machineKey("PQ 2 — 280")), false, "a shift dated after today is a typo, not the newest shift");
});

test("on one date the evening shift is the later one — a mould changed at midday shows", () => {
  const r = latestRuns(SHIFTS.filter((x) => x.date <= "2026-10-03"), "2026-10-05");
  assert.deepEqual(r.byMachine.get(machineKey("PQ 9 — 140"))?.products, ["الثلاثية"]);
});

test("recent is measured against the newest date in the log, not against today — and three days back", () => {
  assert.equal(isRecent("2026-10-04", "2026-10-04"), true);
  assert.equal(isRecent("2026-10-03", "2026-10-04"), true, "typed up a day behind is still running");
  // The owner's correction (2026-10-05): PQ 1's last logged shift was 2 Oct,
  // the log ran to 4 Oct, the page called it idle — «PQ1 is working».
  assert.equal(isRecent("2026-10-02", "2026-10-04"), true);
  assert.equal(isRecent("2026-10-01", "2026-10-04"), true);
  assert.equal(isRecent("2026-09-30", "2026-10-04"), false);
  assert.equal(isRecent("2026-09-23", "2026-10-04"), false);
  assert.equal(isRecent("", "2026-10-04"), false);
  // The one-day rule that was wrong, for the record.
  assert.equal(isRecent("2026-10-02", "2026-10-04", 1), false);
});

test("a machine's state: a stoppage running on the downtime page beats whatever the log says", () => {
  const at = { latestDate: "2026-10-04", today: "2026-10-05", stopped: false };
  // Logged within three days of the newest log date: running.
  assert.equal(machineState({ ...at, source: "production", since: "2026-10-02" }), "running");
  // Nothing logged for a week and nothing said about it: idle.
  assert.equal(machineState({ ...at, source: "production", since: "2026-09-25" }), "idle");
  // A change confirmed on the page today, not in the log yet: running.
  assert.equal(machineState({ ...at, source: "plan", since: "2026-10-05" }), "running");
  // The log shows a shift yesterday, but the floor tapped a stoppage this
  // morning (PQ 13, «كسر المصب», live 2026-10-05): stopped.
  assert.equal(machineState({ ...at, source: "production", since: "2026-10-04", stopped: true }), "stopped");
  // Only the registry knows it, or nothing does: unknown — unless it is stopped.
  assert.equal(machineState({ ...at, source: "registry", since: "" }), "unknown");
  assert.equal(machineState({ ...at, source: "none", since: "" }), "unknown");
  assert.equal(machineState({ ...at, source: "none", since: "", stopped: true }), "stopped");
});

test("two products in the latest shift: a pair that was already together, or a change inside the shift", () => {
  const rows = [
    // PQ 13, live 4 Oct: «ربر سماعة» all morning (14,000 pcs), then the mould
    // was changed and «روزته» made 162 — both rows carry the same shift.
    { date: "2026-10-03", shift: "المسائية", machine: "PQ 13 — 150", product: "ربر سماعة", material: "TPR" },
    { date: "2026-10-04", shift: "الصباحية", machine: "PQ 13 — 150", product: "ربر سماعة", material: "TPR" },
    { date: "2026-10-04", shift: "الصباحية", machine: "PQ 13 — 150", product: "روزته سودة", material: "ABS" },
    // PQ 7: the two EXT pairs ran together the shift before as well.
    { date: "2026-10-03", shift: "المسائية", machine: "PQ 7 — 100", product: "EXT 51", material: "بولي اميد" },
    { date: "2026-10-03", shift: "المسائية", machine: "PQ 7 — 100", product: "EXT 52", material: "" },
    { date: "2026-10-04", shift: "الصباحية", machine: "PQ 7 — 100", product: "EXT 52", material: "بولي اميد" },
    { date: "2026-10-04", shift: "الصباحية", machine: "PQ 7 — 100", product: "EXT 51", material: "" },
  ];
  const r = latestRuns(rows, "2026-10-05");
  // A carried-over product beside a NEW one: the new one first (the from-side
  // and the material are read off it), and the page is told to ask.
  assert.deepEqual(r.byMachine.get(machineKey("PQ 13 — 150")),
    { date: "2026-10-04", shift: "الصباحية", products: ["روزته سودة", "ربر سماعة"], materials: ["ABS", "TPR"], mixed: true });
  // A pair that was already a pair: not a question.
  const pair = r.byMachine.get(machineKey("PQ 7 — 100"))!;
  assert.equal(pair.mixed, false);
  assert.deepEqual(pair.products, ["EXT 52", "EXT 51"]);
  assert.deepEqual(pair.materials, ["بولي اميد", ""], "each row keeps its own material");
});

test("the same product on two machines: the NEWER shift has the mould", () => {
  // Live 5 Oct: «روزته سودة العداد الثلاثي» ran one shift on PQ 10 (3 Oct
  // evening) and then both shifts of 4 Oct on PQ 13; both stood green.
  const h = newestHolders([
    { date: "2026-10-03", shift: "المسائية", machine: "PQ 10 — 150", product: "روزته سودة" },
    { date: "2026-10-04", shift: "الصباحية", machine: "PQ 13 — 150", product: "روزته سودة" },
    { date: "2026-10-04", shift: "المسائية", machine: "PQ 13 - 150", product: " روزته  سودة " },
    { date: "2027-01-01", shift: "الصباحية", machine: "PQ 2 — 280", product: "روزته سودة" }, // a typo'd year
  ], "2026-10-05");
  assert.deepEqual(h.get("روزته سوده"), { machine: machineKey("PQ 13 — 150"), date: "2026-10-04", rank: 2 });
});

test("a looser name key, for ASKING only: «جديد» comes out, a trailing mould number comes off, a middle one stays", () => {
  assert.equal(looseNameKey("كفر شفاف فوكس 2"), looseNameKey("كفر شفاف فوكس"));
  assert.equal(looseNameKey("غطاء احمر جديد"), looseNameKey("غطاء احمر"));
  // «ضهر عداد 1 فوكس» and «ضهر عداد 2 فوكس» are different parts.
  assert.notEqual(looseNameKey("ضهر عداد 1 فوكس"), looseNameKey("ضهر عداد 2 فوكس"));
  // «جديد» wherever it stands: Jobs 506–508 are Master's three newest parts
  // with «جديد» typed into the middle, and the log's dropdown only offers
  // Master's spelling — so the running job was offered as card 1 with
  // «يستاهل نفك الشغال» and nothing asked. It only ASKS; nothing is tied.
  assert.equal(looseNameKey("وش سمارت جديد مباشر"), looseNameKey("وش سمارت مباشر"));
  assert.equal(looseNameKey("برميل قديم"), looseNameKey("برميل"));
  assert.equal(looseNameKey("2"), "2", "a name is never stripped to nothing");
  assert.equal(looseNameKey("جديد"), "جديد");
});

test("the day of one of the page's own stamps, however Sheets hands it back", () => {
  assert.equal(stampDay("2026-10-05 9:50"), "2026-10-05");
  assert.equal(stampDay("2026-10-05 10:53"), "2026-10-05");
  // Re-typed in the workbook's locale it is MONTH first — and the padding
  // trick the other tabs need would read 10/5 as the 10th of May.
  assert.equal(stampDay("10/5/2026 14:05:00"), "2026-10-05");
  assert.equal(stampDay("10/11/2026 09:00:00"), "2026-10-11");
  assert.equal(stampDay("9/23/2026 14:05:00"), "2026-09-23");
  assert.equal(stampDay("23/9/2026 14:05"), "2026-09-23", "a day over 12 can only be the day");
  assert.equal(stampDay("'2026-10-05 09:50"), "2026-10-05", "a text-forced cell");
  assert.equal(stampDay(""), "");
  assert.equal(stampDay("غدا"), "");
  // A day after today is a misread or a wrong clock: a confirm dated in the
  // future would stand for ever.
  assert.equal(stampDay("2026-11-10 09:00", "2026-10-11"), "2026-10-11");
});

test("the shift log and what was told on this page: the same product is both, another one is whoever is newer", () => {
  const log = run({ date: "2026-10-04", products: ["الثلاثية"] });

  // Nothing told: the log speaks, and it knows no colours.
  assert.deepEqual(resolveNow(null, log, "قديم"),
    { products: ["الثلاثية"], colours: [], colourNow: "", order: "", material: "", source: "production", since: "2026-10-04", shift: "الصباحية" });
  // An OLD confirm for another product: the machine has moved on.
  assert.equal(resolveNow(told(), log, "").products[0], "الثلاثية");
  assert.deepEqual(resolveNow(told(), log, "").colours, []);
  // Told about the SAME product: the log dates it, the page supplies the rest.
  const same = resolveNow(told({ products: ["الثلاثية"], colourNow: "red" }), log, "");
  assert.deepEqual([same.source, same.since, same.colours, same.colourNow, same.order], ["production", "2026-10-04", ["red"], "red", "Job 9"]);
  // A confirm NEWER than the log: a mould went up and has not been logged yet.
  const newer = resolveNow(told({ date: "2026-10-05" }), log, "");
  assert.deepEqual([newer.source, newer.products, newer.since], ["plan", ["غطاء"], "2026-10-05"]);
  // No log at all: the registry's stale cell is better than nothing, and says so.
  assert.equal(resolveNow(null, null, " كرسي ").source, "registry");
  assert.deepEqual(resolveNow(null, null, " كرسي ").products, ["كرسي"]);
  assert.equal(resolveNow(null, null, "").source, "none");
});

test("only a CONFIRMED change says the machine was started — recording what stands does not", () => {
  // PQ 11 has stood idle with «عظمة» on it since 23 Sep.
  const log = run({ date: "2026-09-23", products: ["عظمة"] });
  const at = { latestDate: "2026-10-04", today: "2026-10-05", stopped: false };
  const state = (p: PlanStanding) => { const n = resolveNow(p, log, ""); return machineState({ ...at, source: n.source, since: n.since }); };

  // «ركّب دي» on the mould that is already up: it is being started today.
  // (This used to stay idle for ever — the log's old date was kept — and the
  // order was offered again on every machine.)
  assert.equal(state(told({ date: "2026-10-05", products: ["عظمة"] })), "running");
  // «تعديل» on the same machine only RECORDS what stands: saving its colours
  // must not turn an idle press green for three days and hide its order.
  assert.equal(state(told({ date: "2026-10-05", products: ["عظمة"], baseline: true })), "idle");
  // A recorded mould that differs from the log, with nothing logged since.
  const other = resolveNow(told({ date: "2026-10-05", products: ["غطاء"], baseline: true }), log, "", log);
  assert.deepEqual([other.source, other.products, other.since], ["plan", ["غطاء"], "2026-09-23"]);
  // …and one recorded on a machine the log has never seen has no day at all.
  assert.equal(resolveNow(told({ baseline: true }), null, "").since, "");
  assert.equal(resolveNow(told({ date: "2026-10-05" }), null, "").since, "2026-10-05");
});

test("what a confirm said came OFF is not shown as still standing beside the new mould", () => {
  // A change inside a shift leaves both moulds in that shift's rows.
  const log = run({ date: "2026-10-04", products: ["روزته", "ربر سماعة"], mixed: true });
  const n = resolveNow(told({ date: "2026-10-04", products: ["روزته"], from: ["ربر سماعة"] }), log, "");
  assert.deepEqual(n.products, ["روزته"]);
  // A real pair — nothing was said to have come off — stays a pair.
  assert.deepEqual(resolveNow(told({ products: ["روزته"] }), log, "").products, ["روزته", "ربر سماعة"]);
});

test("a note written AFTER a confirm does not un-start the machine", () => {
  // PQ 11 stood idle since 23 Sep. «ركّب دي» on 5 Oct started it. On 6 Oct the
  // engineer taps which colour is running — a «الراكب الآن» row, now the LAST
  // row for the machine. It used to send the press back to «واقفة» and offer
  // its running order to every other machine until the log was typed.
  const rows = [
    { machine: "PQ 11 — 180", order: "Job 30", toProduct: "غطاء", toColour: "أبيض | أسود", material: "", date: "2026-10-05 10:05", fromProduct: "عظمة", nowColour: "أبيض", reasons: "عميل مهم" },
    { machine: "PQ 11 — 180", order: "Job 30", toProduct: "غطاء", toColour: "أبيض | أسود", material: "", date: "2026-10-06 09:30", fromProduct: "", nowColour: "أسود", reasons: BASELINE_REASON },
  ];
  const st = standingWithStart(rows).get(machineKey("PQ 11 — 180"))!;
  assert.equal(st.row.nowColour, "أسود", "the last row is what stands");
  assert.equal(st.started?.date, "2026-10-05 10:05", "…and the confirm is still behind it");

  const log = run({ date: "2026-09-23", products: ["عظمة"] });
  const plan = told({ date: "2026-10-06", products: ["غطاء"], baseline: true, startedOn: "2026-10-05", from: ["عظمة"] });
  const n = resolveNow(plan, log, "", log);
  assert.deepEqual([n.source, n.products, n.since], ["plan", ["غطاء"], "2026-10-05"]);
  assert.equal(machineState({ source: n.source, since: n.since, latestDate: "2026-10-04", today: "2026-10-06", stopped: false }), "running");

  // A note naming ANOTHER mould drops the confirm: that one is not standing.
  const other = standingWithStart([rows[0], { ...rows[1], toProduct: "كرسي" }]).get(machineKey("PQ 11 — 180"))!;
  assert.equal(other.started, null);
  // A lone note has no confirm behind it, and a later confirm replaces both.
  assert.equal(standingWithStart([rows[1]]).get(machineKey("PQ 11 — 180"))!.started, null);
  assert.equal(standingWithStart([rows[1], rows[0]]).get(machineKey("PQ 11 — 180"))!.started, rows[0]);
});

test("what came off stays off only for the shifts up to the day the page was told", () => {
  // A confirm on 20 Sep: «روزته» came off PQ 13, «ربر سماعة» went up. On 4 Oct
  // «روزته» goes back up inside a shift, without the page. Filtering it out
  // for ever showed the mould that came OFF as standing, and asked nothing.
  const plan = told({ date: "2026-09-20", products: ["ربر سماعة"], from: ["روزته"] });
  const later = run({ date: "2026-10-04", products: ["روزته", "ربر سماعة"], mixed: true });
  assert.deepEqual(resolveNow(plan, later, "").products, ["روزته", "ربر سماعة"]);
  // The shift of the change itself is still cleaned of what came off.
  const sameDay = run({ date: "2026-09-20", products: ["ربر سماعة", "روزته"], mixed: true });
  assert.deepEqual(resolveNow(plan, sameDay, "").products, ["ربر سماعة"]);
});

test("a NOTE gives way to a mould change logged later the same day; a confirmed change does not", () => {
  // PQ 12, 5 Oct: a note at 9:50 says «كفر شفاف فوكس» (the log spells it «… 2»).
  // That afternoon the mould is changed to «عدسة» with no «ركّب دي». The caller
  // measures a note against the shifts BEFORE its day, so the change shows.
  const note = told({ date: "2026-10-05", products: ["كفر شفاف فوكس"], baseline: true });
  const before = run({ date: "2026-10-04", products: ["كفر شفاف فوكس 2"] });
  const lens = run({ date: "2026-10-05", shift: "المسائية", products: ["عدسة شفافة فوكس"] });
  assert.deepEqual(resolveNow(note, lens, "", before).products, ["عدسة شفافة فوكس"]);
  assert.equal(resolveNow(note, lens, "", before).source, "production");
  // …while the same spelling carrying on keeps the note (and its order tie).
  assert.equal(resolveNow(note, run({ date: "2026-10-07", products: ["كفر شفاف فوكس 2"] }), "", before).source, "plan");
  // With no earlier shift at all, a note yields to anything logged that day
  // or later; a confirmed change stands through its own day.
  assert.equal(resolveNow(note, lens, "", null).source, "production");
  assert.equal(resolveNow({ ...note, baseline: false, startedOn: "2026-10-05" }, lens, "", null).source, "plan");
});

test("has the log moved on since the page was told? every shift since is looked at, not only the latest", () => {
  const A = run({ date: "2026-10-02", products: ["غطاء"] });
  const confirmB = told({ date: "2026-10-02", products: ["عدسة"], from: ["غطاء"] });
  // A → «ركّب دي» B → B logged → A logged again (the interrupted job resumed,
  // nobody tapped). Comparing the two ENDS read that as "nothing changed" and
  // showed B as running for the whole second run of A.
  assert.equal(logSinceTold(confirmB, A, [["عدسة"], ["عدسة"], ["غطاء"]], run({ date: "2026-10-05", products: ["غطاء"] })), null);
  // …also when the confirm was never followed (A, then a third mould, then A),
  // and when the log simply keeps naming A on days AFTER the confirm.
  assert.equal(logSinceTold(confirmB, A, [["كرسي"], ["غطاء"]], run({ date: "2026-10-05", products: ["غطاء"] })), null);
  assert.equal(logSinceTold(confirmB, A, [["غطاء"]], run({ date: "2026-10-03", products: ["غطاء"] })), null);
  // The log is BEHIND (nothing typed after the confirm's day): the confirm stands.
  assert.equal(logSinceTold(confirmB, A, [], A), A);
  // The log spells the confirmed mould its own way: that IS the mould.
  const B2 = run({ date: "2026-10-04", products: ["عدسة 2"] });
  assert.equal(logSinceTold(confirmB, A, [["عدسة 2"], ["عدسة 2"]], B2), B2);

  // A NOTE: the machine goes on running what it ran when the note was written.
  const note = told({ date: "2026-10-05", products: ["كفر"], baseline: true });
  const at = run({ date: "2026-10-04", products: ["كفر 2"] });
  const still = run({ date: "2026-10-07", products: ["كفر 2"] });
  assert.equal(logSinceTold(note, at, [["كفر 2"], ["كفر"], ["كفر 2"]], still), still, "the crew alternating two spellings keeps the tie");
  assert.equal(logSinceTold(note, at, [["كفر 2", "عدسة"], ["عدسة"]], run({ date: "2026-10-06", products: ["عدسة"] })), null);
  // A tie to a name the log spells quite differently holds while the log does not change.
  const odd = told({ date: "2026-10-05", products: ["طلبية خاصة"], baseline: true });
  assert.equal(logSinceTold(odd, at, [["كفر 2"]], still), at);
  // With no shift before the note at all: a respelling stands, anything else is the log's.
  assert.equal(logSinceTold(note, null, [["كفر 2"]], still), still);
  assert.equal(logSinceTold(note, null, [["عدسة"]], run({ date: "2026-10-06", products: ["عدسة"] })), null);
});

test("a note does not hold a mould the log itself has seen leave", () => {
  const A = run({ date: "2026-10-02", products: ["غطاء"] });
  const backToA = run({ date: "2026-10-06", products: ["غطاء"] });
  // «ركّب دي» B, then a colour tap (a NOTE, now the machine's last row), then
  // B is logged and A comes back. The confirm's rule must survive the note —
  // it used to read "A again" as "still what it ran when the note was written".
  const noteOnConfirm = told({ date: "2026-10-03", products: ["عدسة"], baseline: true, startedOn: "2026-10-02", from: ["غطاء"] });
  assert.equal(logSinceTold(noteOnConfirm, A, [["عدسة"], ["عدسة"], ["غطاء"], ["غطاء"]], backToA), null);
  // A «لا» tapped on a view one day behind: the change had already happened
  // and was typed afterwards. The log KNOWS this mould on this machine, so a
  // shift that stops naming it is a change.
  const no = told({ date: "2026-10-05", products: ["وش سمارت مباشر"], baseline: true, order: NO_ORDER });
  const other = run({ date: "2026-10-04", products: ["روزته"] });
  assert.equal(logSinceTold(no, other, [["روزته"], ["روزته"]], run({ date: "2026-10-07", products: ["روزته"] }), true), null);
  // A sister product is not a respelling: «رشاش 010» moving on to «رشاش 030»
  // kept the old one "running" for the whole run of the new one.
  const s10 = told({ date: "2026-10-04", products: ["رشاش 010"], baseline: true });
  const was = run({ date: "2026-10-03", products: ["رشاش 010"] });
  assert.equal(logSinceTold(s10, was, [["رشاش 010"], ["رشاش 030"], ["رشاش 030"]], run({ date: "2026-10-07", products: ["رشاش 030"] }), true), null);
  assert.equal(logSinceTold(told({ date: "2026-10-02", products: ["رشاش 010"], from: ["غطاء"] }), A,
    [["رشاش 010"], ["رشاش 030"]], run({ date: "2026-10-05", products: ["رشاش 030"] })), null, "…after a confirm as well");
});

test("the log named the page's mould when it was told and no longer does: it came off", () => {
  // The note «ربر» was written while the shift of the change (ربر carried +
  // روزته new) was still untyped; then «روزته» runs alone.
  const note = told({ date: "2026-10-05", products: ["ربر"], baseline: true });
  const mixed = run({ date: "2026-10-04", products: ["روزته", "ربر"], mixed: true });
  const now = run({ date: "2026-10-06", products: ["روزته"] });
  assert.deepEqual([resolveNow(note, now, "", mixed).source, resolveNow(note, now, "", mixed).products], ["production", ["روزته"]]);
});

test("what came off is remembered across notes, each with the day it was told", () => {
  const P = "PQ 2 — 180";
  const row = (o: Record<string, string>) => ({ machine: P, order: "", toProduct: "", toColour: "", material: "", date: "", fromProduct: "", nowColour: "", reasons: BASELINE_REASON, ...o });
  const off = (rows: ReturnType<typeof row>[]) => standingWithStart(rows).get(machineKey(P))!.cameOff;
  const changed = row({ date: "2026-10-05 09:00", toProduct: "طبق", fromProduct: "كرسي" });
  // «اتغيّرت», then a «لا» or a colour tap: the later note has no «المنتج السابق»
  // of its own — and used to bring the old mould (and the question) back.
  assert.deepEqual(off([changed, row({ date: "2026-10-05 09:01", toProduct: "طبق", order: NO_ORDER })]),
    [{ product: "كرسي", date: "2026-10-05 09:00" }]);
  // «الاتنين راكبين» afterwards names it as standing: it is no longer "off".
  assert.deepEqual(off([changed, row({ date: "2026-10-06 08:00", toProduct: "طبق | كرسي" })]), []);
  // A confirm's «المنتج السابق» stays behind the notes with the CONFIRM's day.
  const confirm = row({ date: "2026-09-20 10:00", toProduct: "ربر", fromProduct: "روزته", reasons: "عميل مهم" });
  assert.deepEqual(off([confirm, row({ date: "2026-10-05 09:00", toProduct: "ربر", nowColour: "أسود" })]),
    [{ product: "روزته", date: "2026-09-20 10:00" }]);
  // Another mould altogether starts clean; the next order on the SAME mould took nothing off.
  assert.deepEqual(off([confirm, row({ date: "2026-10-05 09:00", toProduct: "غطاء" })]), []);
  assert.deepEqual(off([row({ date: "2026-10-05 09:00", toProduct: "ربر", fromProduct: "ربر", reasons: "نفس الاسطمبة" })]), []);
});

test("the «لا» answer has its own word in the order cell", () => {
  assert.equal(NO_ORDER, "بدون أمر شغل");
  assert.equal(machineKey(NO_ORDER).includes("pq"), false, "never mistaken for a machine or a code");
});

test("two of the page's own stamps on one clock, read the way stampDay reads the day", () => {
  const m = (a: string, b: string) => stampClockMinutes(b)! - stampClockMinutes(a)!;
  assert.equal(m("2026-10-05 15:08", "2026-10-05 15:10"), 2);
  // Re-typed by Sheets, month first — 5 Oct, not 10 May: the replay check
  // was off on the first twelve days of October with the day-first reader.
  assert.equal(m("10/5/2026 15:08:00", "2026-10-05 15:10"), 2);
  assert.equal(m("2026-10-05 23:58", "10/6/2026 0:03:00"), 5);
  assert.equal(m("10/5/2026 3:08:00 PM", "2026-10-05 15:10"), 2);
  assert.equal(m("2026-10-05 9:50", "2026-10-05 09:55"), 5);
  assert.equal(stampClockMinutes("2026-10-05"), null, "no clock, no answer");
  assert.equal(stampClockMinutes(""), null);
});

test("a «الراكب الآن» row is told from a confirmed change by its reason", () => {
  assert.equal(isBaselineRow({ reasons: BASELINE_REASON }), true);
  assert.equal(isBaselineRow({ reasons: " تسجيل الراكب الحالى " }), true, "ى/ي is one spelling");
  assert.equal(isBaselineRow({ reasons: "عميل مهم · نفس اللون" }), false);
  assert.equal(isBaselineRow({ reasons: "" }), false);
});

/* --------------------------------- answers -------------------------------- */

test("the latest non-blank answer wins, per thing and per question", () => {
  const all = mergeAnswers([
    { kind: "order", key: "job 1", colour: "أبيض", missing: "الخامة" },
    { kind: "order", key: "job 1", colour: "", missing: NOTHING_MISSING },   // colour left alone
    { kind: "order", key: "job 1", colour: "أسود | أبيض" },
    { kind: "mold", key: "غطاء", fits: "PQ 1 — 550" },
    { kind: "map", key: "الارضيه", layout: "PQ 1 — 550@1,3,2,2" },
    { kind: "", key: "x", colour: "أحمر" },                                    // an unreadable kind is ignored
    { kind: "order", key: "", colour: "أحمر" },
  ]);
  assert.deepEqual(answersFor(all, "order", "job 1"), { colour: "أسود | أبيض", missing: NOTHING_MISSING });
  assert.deepEqual(answersFor(all, "mold", "غطاء"), { fits: "PQ 1 — 550" });
  assert.deepEqual(answersFor(all, "map", "الارضيه"), { layout: "PQ 1 — 550@1,3,2,2" });
  assert.deepEqual(answersFor(all, "client", "nobody"), {});
});

test("cells round-trip: kinds, yes/no, lists, and what is missing", () => {
  for (const k of ["machine", "mold", "order", "client", "map"] as const) assert.equal(kindFromSheet(kindToSheet(k)), k);
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
  // Words this list does not know (typed in the tab by hand) are NOT "nothing
  // missing": read as never asked, so the order is not waved through as ready.
  assert.equal(missingFromSheet("مستنيين العميل"), null);
  // «تركب على أنهي ماكينات؟» taken back names no machine at all.
  assert.deepEqual(listFromSheet(FITS_UNKNOWN), [FITS_UNKNOWN]);
  assert.equal(machineKey(FITS_UNKNOWN).includes("pq"), false);
});

test("the last log row for a machine is what was confirmed on it, whatever the dash", () => {
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
    order({ code: "hard-colour", colours: ["transparent"] }),
    order({ code: "late", dueDate: "2026-09-20", colours: ["transparent"] }),
    order({ code: "key", keyClient: true, colours: ["transparent"], dueDate: "2026-11-30" }),
  ];
  assert.deepEqual(codes(m, os), ["key", "late", "less-left", "due-sooner", "due-later", "hard-colour"]);
});

test("a key client's hard colour goes before an ordinary client's same colour — his own example", () => {
  const m = machine({ now: { colours: ["black"] } });
  const os = [
    order({ code: "same-colour", colours: ["black"] }),
    order({ code: "key-hard", colours: ["white"], keyClient: true }),
  ];
  assert.deepEqual(codes(m, os), ["key-hard", "same-colour"]);
});

test("a confirm survives new shift rows for as long as the log has not changed mould", () => {
  // The engineer tied PQ 12 to the order for «كفر شفاف فوكس» on 5 Oct; the
  // crew logs that mould as «كفر شفاف فوكس 2». The names never match, so the
  // only honest test is whether the log's product CHANGED since the confirm.
  const plan = told({ date: "2026-10-05", products: ["كفر شفاف فوكس"], colours: ["transparent"], order: "Job 494", baseline: true });
  const atPlan = run({ date: "2026-10-04", products: ["كفر شفاف فوكس 2"] });

  // Two more days of the same mould: the tie stands, dated by the newest shift.
  const later = run({ date: "2026-10-07", shift: "المسائية", products: ["كفر شفاف فوكس 2"] });
  const kept = resolveNow(plan, later, "", atPlan);
  assert.deepEqual([kept.source, kept.products, kept.order, kept.colours, kept.since, kept.shift],
    ["plan", ["كفر شفاف فوكس"], "Job 494", ["transparent"], "2026-10-07", "المسائية"]);

  // The log moves to another mould: the machine was changed without telling
  // the page, and the log is right.
  const moved = resolveNow(plan, run({ date: "2026-10-08", products: ["عدسة شفافة فوكس"] }), "", atPlan);
  assert.deepEqual([moved.source, moved.products, moved.order, moved.colours], ["production", ["عدسة شفافة فوكس"], "", []]);

  // The morning shift of the confirm's own day ran the OLD mould and is typed
  // up later: still the same product as before the change — the confirm stands.
  const sameDay = run({ date: "2026-10-05", products: ["كفر شفاف فوكس 2"] });
  assert.equal(resolveNow(plan, sameDay, "", sameDay).source, "plan");

  // Nothing was logged for the machine before the confirm, and something else
  // is logged after it: the log.
  assert.equal(resolveNow(plan, later, "", null).source, "production");
});

test("the colour in the barrel is what the machine is cleaned of, when it is known", () => {
  // The job is made in white and black; white is the one running now.
  const m = machine({ now: { colours: ["white", "black"], colourNow: "white" } });
  const [s] = rankFor(m, [order({ code: "x", colours: ["white"] })], ctx).ranked;
  assert.equal(s.estimate.colour, "same", "white is in the barrel — nothing to clean");
  // Not known which: the darkest is assumed, and white after black is hard.
  const unsure = machine({ now: { colours: ["white", "black"], colourNow: "" } });
  assert.equal(rankFor(unsure, [order({ code: "x", colours: ["white"] })], ctx).ranked[0].estimate.colour, "lighter");
});

test("the owner's own case: one product ordered in two colours — the second order is NEXT on that mould, not hidden", () => {
  // «كفر» runs on PQ 6 under Job 10 (white). Job 11 is the same product in
  // black for a key client, 15 days late. It used to be treated as "running
  // too" and appeared on no machine, in no list, in no count.
  const pq6 = machine({ label: "PQ 6 — 220", state: "running", now: { products: ["كفر"], colours: ["white"], colourNow: "white", order: "Job 10" } });
  const job10 = order({ code: "Job 10", product: "كفر", mountedOn: "PQ 6 — 220", mountedRunning: true });
  const job11 = order({ code: "Job 11", product: "كفر", colours: ["black"], keyClient: true, dueDate: "2026-09-15",
    fits: null, mountedOn: "PQ 6 — 220", queuedBehind: "Job 10" });

  const here = rankFor(pq6, [job10, job11], ctx);
  assert.deepEqual(here.ranked.map((s) => s.order.code), ["Job 11"], "the running job itself is not a candidate; the next one is");
  const s = here.ranked[0];
  assert.equal(s.estimate.swapMin, 0, "no mould change at all");
  assert.deepEqual(s.chips.find((c) => c.key === "sameMouldNext")?.vars, { order: "Job 10" });
  assert.equal(s.chips.some((c) => c.key === "worthInterrupt"), false, "it follows the running job, it does not interrupt it");
  // On any other machine it is not offered: its mould is busy.
  assert.deepEqual(codes(machine(), [job10, job11]), []);
});

test("an order on hold is listed with its reason, never suggested", () => {
  const r = rankFor(machine(), [order({ code: "held", status: "On Hold", keyClient: true }), order({ code: "fine" })], ctx);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["fine"]);
  assert.deepEqual(r.blocked.map((b) => [b.order.code, b.reason]), [["held", "onHold"]]);
});

test("an order that is RUNNING on another machine is not waiting for anything", () => {
  // The fault of the first version: it read a stale registry and offered
  // every «جاري التشغيل» order to every machine.
  const os = [
    order({ code: "running-elsewhere", mountedOn: "PQ 2 — 280", mountedRunning: true }),
    order({ code: "waiting" }),
  ];
  assert.deepEqual(codes(machine(), os), ["waiting"]);
});

test("the job a machine is running is not offered to that machine", () => {
  const m = machine({ state: "running", now: { products: ["منتج a"] } });
  assert.deepEqual(codes(m, [order({ code: "a", mountedOn: "PQ 5 - 100", mountedRunning: true }), order({ code: "b" })]), ["b"]);
});

test("a mould still standing on an IDLE machine: cheapest to restart there, and says where it is elsewhere", () => {
  const o = order({ code: "a", product: "عظمة", mountedOn: "PQ 11 — 180", mountedRunning: false, colours: ["black"], fits: null });
  const other = order({ code: "b", colours: ["white"], fits: null });

  // On the idle machine that holds it: first, even after a same-colour rival.
  const holder = machine({ label: "PQ 11 — 180", now: { products: ["عظمة"], colours: ["white"] } });
  const r = rankFor(holder, [other, o], ctx);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["a", "b"]);
  assert.equal(r.ranked[0].mountedHere, true);
  assert.equal(r.ranked[0].estimate.swapMin, 0, "the mould is already up");
  assert.ok(r.ranked[0].chips.some((c) => c.key === "mountedHere"));

  // On another machine: still a candidate, with the mould's whereabouts.
  const chip = rankFor(machine(), [o], ctx).ranked[0].chips.find((c) => c.key === "mountedElsewhere");
  assert.deepEqual(chip?.vars, { machine: "PQ 11 — 180" });
});

test("a STOPPED machine is offered its own mould's order first, like an idle one", () => {
  // Stopped for «لا يوجد أمر شغل» or a mould change is exactly when the
  // engineer opens this page; the order whose mould is already up is cheapest.
  const stopped = machine({ state: "stopped", stoppage: { reason: "No order", since: 1 }, now: { products: ["عظمة"] } });
  const mine = order({ code: "mine", product: "عظمة", mountedOn: "PQ 5 — 100", mountedRunning: false, colours: ["black"] });
  const r = rankFor(stopped, [order({ code: "other" }), mine], ctx);
  assert.deepEqual(r.ranked.map((x) => x.order.code), ["mine", "other"]);
  assert.equal(r.ranked[0].mountedHere, true);
});

test("a mould that fits only this machine goes before one that could go elsewhere", () => {
  const m = machine({ label: "PQ 1 — 550", tonnage: "550" });
  const os = [
    order({ code: "flexible", fits: ["PQ 1 — 550", "PQ 2 — 280"] }),
    order({ code: "only-here", fits: ["PQ 1 - 550"], colours: ["black"] }),
  ];
  const r = rankFor(m, os, ctx);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["only-here", "flexible"]);
  assert.ok(r.ranked[0].chips.some((c) => c.key === "onlyHere"));
});

test("a GUESSED transparent never blocks — only the engineer's own answer does", () => {
  // «منقار» (Master: «مخرز شفاف», really beige) was refused on every ordinary
  // machine the moment one press was kept for transparent.
  const c = { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] };
  const guessed = rankFor(machine(), [order({ code: "g", colours: ["transparent"], colourSource: "guess" })], c);
  assert.deepEqual(guessed.blocked, []);
  assert.deepEqual(guessed.ranked[0].chips.find((x) => x.key === "transparentElsewhereMaybe")?.vars, { machines: "PQ 7 — 100" });
  assert.equal(rankFor(machine(), [order({ code: "a", colours: ["transparent"] })], c).blocked[0].reason, "transparentElsewhere");
});

test("four things take an order out of the ranking, each with its reason", () => {
  const m = machine();
  const r = rankFor(m, [
    // «جاري التشغيل» with nothing left to make — live on 2026-10-01 (Job 482),
    // and "least remaining first" had put it at the top.
    order({ code: "made", remaining: 0 }),
    order({ code: "elsewhere", fits: ["PQ 1 — 550"] }),
    order({ code: "clear", colours: ["transparent"] }),
    order({ code: "not-ready", missing: ["material", "packaging"] }),
    order({ code: "fine" }),
  ], { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] });
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["fine"]);
  assert.deepEqual(r.blocked.map((b) => [b.order.code, b.reason]), [
    ["made", "finished"], ["elsewhere", "notFit"], ["clear", "transparentElsewhere"], ["not-ready", "missing"],
  ]);
});

test("a machine KEPT for transparent with no colour on record is taken to hold transparent", () => {
  // «عدسة عداد» on PQ 12, nothing answered or guessable. Reading the unknown
  // barrel as "anything → transparent" priced the transparent order as the
  // worst change and put a black order ahead of it on the transparent machine.
  const lens = machine({ label: "PQ 12 — 180", transparentOnly: true, now: { products: ["عدسة عداد"], colours: [], colourNow: "", material: "PC" } });
  assert.deepEqual(barrelOf(lens), ["transparent"]);
  assert.deepEqual(barrelOf(machine({ now: { colours: [], colourNow: "" } })), [], "an ordinary machine stays unknown");
  assert.deepEqual(barrelOf(machine({ transparentOnly: true, now: { colours: ["black"], colourNow: "black" } })), ["black"], "a told colour always wins");

  const c = { today: "2026-09-30", transparentMachines: ["PQ 12 — 180"] };
  const r = rankFor(lens, [
    order({ code: "black", colours: ["black"], material: "PC", remaining: 20_000, fits: null }),
    order({ code: "clear", colours: ["transparent"], material: "PC", remaining: 60_000, fits: null }),
  ], c).ranked;
  assert.deepEqual(r.map((x) => x.order.code), ["clear", "black"]);
  const clear = r[0];
  assert.equal(clear.estimate.purgeMin, 0);
  // Priced as transparent, but the card never CALLS it the same colour: it
  // says the colour is not recorded.
  assert.equal(clear.chips.some((x) => x.key === "sameColour" || x.key === "toTransparent"), false);
  assert.equal(clear.chips.some((x) => x.key === "nowColourUnknown"), true);
});

test("a transparent mould the engineer said fits only ORDINARY machines is not sent to the transparent one", () => {
  // Job 508: شفاف, «تركب على PQ 4 فقط». With PQ 12 kept for transparent it was
  // blocked on PQ 4 for being transparent and on PQ 12 for not fitting — the
  // two reasons pointed at each other and no machine offered «ركّب دي».
  const c = { today: "2026-09-30", transparentMachines: ["PQ 12 — 180"] };
  const pq4 = machine({ label: "PQ 4 — 138" });
  const lens = order({ code: "lens", colours: ["transparent"], fits: ["PQ 4 — 138"] });
  const r = rankFor(pq4, [lens], c);
  assert.deepEqual([r.ranked.map((s) => s.order.code), r.blocked], [["lens"], []]);
  assert.equal(r.ranked[0].chips.some((x) => x.key === "transparentElsewhereMaybe"), false);
  // A mould that CAN go on the kept machine is still sent there.
  const either = order({ code: "either", colours: ["transparent"], fits: ["PQ 4 — 138", "PQ 12 — 180"] });
  assert.equal(rankFor(pq4, [either], c).blocked[0].reason, "transparentElsewhere");
});

test("a colour outside the list is said to be off the list — not that the MACHINE's colour is unknown", () => {
  const white = machine({ now: { colours: ["white"], colourNow: "white" } });
  const [s1] = rankFor(white, [order({ code: "x", colours: ["أزرق فاتح"] })], ctx).ranked;
  assert.equal(s1.chips.some((c) => c.key === "colourUnranked"), true);
  assert.equal(s1.chips.some((c) => c.key === "nowColourUnknown"), false);
  const [s2] = rankFor(machine({ now: { colours: [], colourNow: "" } }), [order({ code: "y", colours: ["black"] })], ctx).ranked;
  assert.equal(s2.chips.some((c) => c.key === "nowColourUnknown"), true);
});

test("an order with no material on record says so — it is not 'no drying needed'", () => {
  const [s1] = rankFor(machine(), [order({ code: "x", material: "" })], ctx).ranked;
  assert.equal(s1.chips.some((c) => c.key === "materialUnknown"), true);
  assert.equal(s1.chips.some((c) => c.key === "drying"), false);
  const [s2] = rankFor(machine(), [order({ code: "y", material: "بولي كربونيت" })], ctx).ranked;
  assert.equal(s2.chips.some((c) => c.key === "materialUnknown"), false);
});

test("transparent is free to go anywhere until a machine is kept for it, and that machine prefers it", () => {
  const clear = order({ code: "clear", colours: ["transparent"] });
  assert.deepEqual(codes(machine(), [clear]), ["clear"], "no machine marked: nothing is blocked");

  const lens = machine({ label: "PQ 7 — 100", transparentOnly: true, now: { products: ["عدسة"], colours: ["transparent"], material: "PC شفاف" } });
  const c = { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] };
  const r = rankFor(lens, [order({ code: "coloured", colours: ["black"] }), clear], c);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["clear", "coloured"]);
  // On a machine KEPT for transparent a coloured job is a red flag, and
  // "after transparent" is not the good news it is elsewhere: the press has
  // to be cleaned back to transparent afterwards.
  assert.equal(r.ranked[1].chips.find((x) => x.key === "transparentMachine")?.tone, "bad");
  assert.equal(r.ranked[1].chips.some((x) => x.key === "fromTransparent"), false);

  // An order made in transparent AND a colour is not "all transparent": it is
  // not shut out of the other machines.
  const mixed = order({ code: "mixed", colours: ["transparent", "white"] });
  assert.deepEqual(rankFor(machine(), [mixed], c).blocked, []);
});

test("on a running machine only a key client is worth taking the mould off", () => {
  const interrupts = (m: PlanMachine, o: PlanOrder) => rankFor(m, [o], ctx).ranked[0].chips.some((c) => c.key === "worthInterrupt");
  const busy = machine({ state: "running" });
  assert.equal(interrupts(busy, order({ code: "key", keyClient: true })), true);
  // "The machine is running" is said once above the list, not on every card.
  const plain = rankFor(busy, [order({ code: "plain" })], ctx).ranked[0];
  assert.equal(plain.chips.some((c) => c.key === "worthInterrupt" || c.key === "machineBusy"), false);
  // Not when the running job is an important client's too…
  assert.equal(interrupts(machine({ state: "running", now: { keyClient: true } }), order({ code: "key", keyClient: true })), false);
  // …nor when the mould does not belong on this machine at all…
  assert.equal(interrupts(busy, order({ code: "key", keyClient: true, fits: null, fitsHint: ["PQ 1 — 550"], fitsHintText: "550" })), false);
  // …nor when it is probably the very job that is running here.
  assert.equal(interrupts(machine({ state: "running", now: { orderMaybe: "key" } }), order({ code: "key", keyClient: true })), false);
});

test("an order in several colours is ranked on its easiest start, and the card says which", () => {
  // The machine runs white and grey, and grey is what is in it now.
  const m = machine({ now: { colours: ["white", "grey"], colourNow: "grey" } });
  const [s] = rankFor(m, [order({ code: "x", colours: ["white", "black", "grey"] })], ctx).ranked;
  assert.equal(s.startColour, "grey");
  assert.equal(s.estimate.colour, "same");
  assert.deepEqual(s.chips.find((c) => c.key === "startWith")?.vars, { colour: "grey" });
  // Nobody said which of the two is in the barrel: no start is "the same".
  const unsure = rankFor(machine({ now: { colours: ["white", "grey"] } }), [order({ code: "x", colours: ["white", "black", "grey"] })], ctx).ranked[0];
  assert.notEqual(unsure.estimate.colour, "same");
});

test("the chips say what the engineer needs — and unanswered questions are ONE hint, not a row of grey", () => {
  const m = machine();
  const [s] = rankFor(m, [order({
    code: "x", colours: ["black"], colourSource: "guess", material: "ABS اسود مخرز", dueDate: "2026-09-25",
    workers: 2, runHours: 5, missing: null, fits: null, fitsHint: ["PQ 12 — 180"], fitsHintText: "180",
  })], ctx).ranked;
  const keys = s.chips.map((c) => c.key);
  for (const k of ["late", "darker", "materialChange", "drying", "fitHintElsewhere", "workers", "shortRun"]) {
    assert.ok(keys.includes(k), `missing chip ${k} in ${keys.join(",")}`);
  }
  for (const k of ["fitUnknown", "readyNotAsked", "colourGuess", "materialUnknown"]) {
    assert.equal(keys.includes(k), false, `${k} is noise the owner asked to lose`);
  }
  assert.equal(s.needsAnswers, true);
  assert.equal(s.late, 5);
  assert.deepEqual(s.chips.find((c) => c.key === "drying")?.vars, { h: "3" });
  // Everything answered: no hint.
  assert.equal(rankFor(m, [order({ code: "y" })], ctx).ranked[0].needsAnswers, false);
});

test("only a mould Master puts on ANOTHER machine goes after the rest — the owner's order decides everything else", () => {
  const m = machine({ label: "PQ 1 — 550", tonnage: "550" });
  const r = rankFor(m, [
    order({ code: "elsewhere-key", fits: null, fitsHint: ["PQ 12 — 180"], fitsHintText: "180", keyClient: true }),
    order({ code: "hinted-here", fits: null, fitsHint: ["PQ 1 — 550"], fitsHintText: "550" }),
    order({ code: "answered-here", fits: ["PQ 1 — 550", "PQ 2 — 280"], colours: ["black"] }),
    // Nobody said, and Master's tonnage is blank — the NORMAL case, not a
    // second-class one: a key client's late order here is the top of the list.
    order({ code: "unknown-key-late", fits: null, keyClient: true, dueDate: "2026-09-10" }),
    // Master names a tonnage no machine has («136» — a mould that ran on the
    // 140 every day for a fortnight): "another machine" does not exist.
    order({ code: "no-such-tonnage", fits: null, fitsHint: [], fitsHintText: "136", dueDate: "2026-09-20" }),
  ], ctx).ranked;
  assert.deepEqual(r.map((s) => [s.order.code, s.fit]), [
    ["unknown-key-late", "unknown"], ["no-such-tonnage", "unknown"], ["hinted-here", "here"],
    ["answered-here", "here"], ["elsewhere-key", "elsewhere"],
  ]);
  assert.equal(r[1].chips.some((c) => c.key === "fitHintElsewhere"), false);
});

test("ease of change is decided BEFORE what is left — the owner's order, pinned on its own", () => {
  // Same client standing, neither late: the easy change with a lot left goes
  // before the hard change that is nearly finished.
  const m = machine({ now: { colours: ["black"], colourNow: "black" } });
  assert.deepEqual(codes(m, [
    order({ code: "hard-nearly-done", colours: ["white"], remaining: 100 }),
    order({ code: "easy-lots-left", colours: ["black"], remaining: 90_000 }),
  ]), ["easy-lots-left", "hard-nearly-done"]);
});

test("an order with no colour is ranked, flagged, and never treated as easy", () => {
  const [s] = rankFor(machine(), [order({ code: "x", colours: [], colourSource: "" })], ctx).ranked;
  assert.equal(s.estimate.ease, "unknown");
  assert.ok(s.chips.some((c) => c.key === "colourUnknown"));
  assert.equal(s.needsAnswers, true);
});

/* ----------------------------------- the map -------------------------------- */

// The owner's sketch of 2026-10-05, as it was first entered — on the 7-column map.
const FLOOR_V1 = "PQ 13 — 150@3,1,2,1 ; PQ 14 — 180@6,1,2,1 ; PQ 1 — 550@1,3,2,2 ; PQ 2 — 280@1,7,4,1 ; PQ 3 — 280@5,7,3,1";
const at = (tiles: readonly MapTile[], label: string) => tiles.find((t) => t.label === label);

test("the first, 7-column map is scaled onto the landscape sheet when read — nobody arranges the floor twice", () => {
  const tiles = parseLayout(FLOOR_V1);
  assert.equal(tiles.length, 5);
  // A column was 8 units; seven rows are packed 4 units each.
  assert.deepEqual(at(tiles, "PQ 13 — 150"), { label: "PQ 13 — 150", c: 17, r: 1, w: 16, h: 4 });
  assert.deepEqual(at(tiles, "PQ 14 — 180"), { label: "PQ 14 — 180", c: 41, r: 1, w: 16, h: 4 });
  assert.deepEqual(at(tiles, "PQ 1 — 550"), { label: "PQ 1 — 550", c: 1, r: 9, w: 16, h: 8 });
  assert.deepEqual(at(tiles, "PQ 2 — 280"), { label: "PQ 2 — 280", c: 1, r: 25, w: 32, h: 4 });
  assert.deepEqual(at(tiles, "PQ 3 — 280"), { label: "PQ 3 — 280", c: 33, r: 25, w: 24, h: 4 }, "it still touches PQ 2, and does not overlap it");
  assert.equal(validLayout(tiles), true);
  // The owner asked for LANDSCAPE: the same floor is now twice as wide as tall.
  assert.equal(mapRows(tiles), 28);
  assert.ok(MAP_COLS >= mapRows(tiles) * 2);
  assert.ok(MAP_COLS > MAP_MAX_ROWS);
});

test("the floor map is one cell: written with the sheet it is on, and read back the same", () => {
  const tiles = parseLayout(FLOOR_V1);
  const cell = formatLayout(tiles);
  assert.ok(cell.startsWith(`grid ${MAP_COLS}x${MAP_MAX_ROWS} ; `), cell.slice(0, 30));
  assert.deepEqual(parseLayout(cell), tiles, "a cell that says its sheet is NOT scaled again");
  assert.deepEqual(parseLayout(""), []);
  // A cell written for another sheet is scaled by its EDGES: what touched still touches.
  assert.deepEqual(parseLayout("grid 28x16 ; A — 1@1,1,5,3 ; B — 2@6,1,5,3"), [
    { label: "A — 1", c: 1, r: 1, w: 10, h: 6 }, { label: "B — 2", c: 11, r: 1, w: 10, h: 6 },
  ]);
});

test("a damaged map cell loses the bad tile, not the map", () => {
  const tiles = parseLayout("grid 56x32 ; PQ 1 — 550@1,3,10,6 ; nonsense ; PQ 2 — 280@1,x,4,3 ; PQ 3 — 280@50,7,10,6 ; PQ 1 - 550@20,20,4,3 ; PQ 4 — 138@٢٠,٦,١٠,٦ ; PQ 5 — 100@0,1,4,3");
  assert.deepEqual(tiles.map((t) => t.label), ["PQ 1 — 550", "PQ 4 — 138"], "bad numbers, off the sheet, a zero and a second copy are dropped");
  assert.deepEqual(tiles[1], { label: "PQ 4 — 138", c: 20, r: 6, w: 10, h: 6 }, "Arabic digits are read");
});

test("placing a machine: one unit at a time, pulled inside the sheet, never stacked, never too small to read", () => {
  let tiles: MapTile[] = parseLayout(FLOOR_V1);
  // A new machine drops in at the default size.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: 20, r: 10 })!;
  assert.deepEqual(at(tiles, "PQ 9 — 140"), { label: "PQ 9 — 140", c: 20, r: 10, w: MAP_TILE.w, h: MAP_TILE.h });
  // Moving keeps its size; hanging over the right edge is pulled back in.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: MAP_COLS, r: 17 })!;
  assert.equal(at(tiles, "PQ 9 — 140")?.c, MAP_COLS - MAP_TILE.w + 1);
  // A drag hands in fractions of a unit: they snap to the nearest one —
  // 56 places across where the first map had seven.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: 30.4, r: 17.6 })!;
  assert.deepEqual([at(tiles, "PQ 9 — 140")?.c, at(tiles, "PQ 9 — 140")?.r], [30, 18]);
  // Onto another machine: refused, and nothing moved.
  assert.equal(placeTile(tiles, "PQ 9 — 140", { c: 1, r: 9 }), null);
  // Resizing in place is a placement too — refused when it would overlap, and held at the minimum.
  assert.equal(placeTile(tiles, "PQ 2 — 280", { c: 1, r: 25, w: 40 }), null, "PQ 3 is in the way");
  assert.equal(at(placeTile(tiles, "PQ 1 — 550", { c: 1, r: 9, h: 12 })!, "PQ 1 — 550")?.h, 12);
  const tiny = at(placeTile(tiles, "PQ 9 — 140", { c: 30, r: 18, w: 1, h: 1 })!, "PQ 9 — 140")!;
  assert.deepEqual([tiny.w, tiny.h], [MAP_TILE.minW, MAP_TILE.minH]);
  assert.equal(validLayout(tiles), true);
  assert.equal(removeTile(tiles, "PQ 9 - 140").some((t) => t.label === "PQ 9 — 140"), false);
});

test("a machine coming onto the map takes the first free spot; a full sheet says so", () => {
  assert.deepEqual(freeSpot([]), { c: 1, r: 1 });
  let tiles: MapTile[] = parseLayout(FLOOR_V1);
  // Every machine of the tray can be dropped in turn without landing on another.
  for (const label of ["A — 1", "B — 2", "C — 3", "D — 4"]) {
    const spot = freeSpot(tiles);
    assert.ok(spot, label);
    tiles = placeTile(tiles, label, spot!)!;
    assert.ok(tiles, label);
  }
  assert.equal(validLayout(tiles), true);
  assert.equal(freeSpot([{ label: "ALL", c: 1, r: 1, w: MAP_COLS, h: MAP_MAX_ROWS }]), null);
});

// The owner's own arrangement of 2026-10-06, as he saved it from his phone:
// every machine in the left 33 units of the 56-unit sheet (all he could see of
// a sheet that panned sideways), PQ 1 nine units wide.
const FLOOR_PHONE = "grid 56x32 ; PQ 1 — 550@1,9,9,5 ; PQ 13 — 150@10,1,11,4 ; PQ 11 — 180@10,5,11,4 ; PQ 9 — 140@10,9,11,4 ; "
  + "PQ 14 — 180@24,1,10,4 ; PQ 12 — 180@24,5,10,4 ; PQ 10 — 150@24,9,10,4 ; PQ 2 — 280@2,28,15,4 ; PQ 3 — 280@19,28,15,4";

test("on a phone the floor fills the width, wherever on the sheet it was arranged — nothing pans, every tile is readable", () => {
  const tiles = parseLayout(FLOOR_PHONE);
  const fit = fitFloor(tiles, 342);
  assert.equal(fit.pans, false, "the page never asks him to pan sideways for this floor");
  assert.ok(Math.abs(fit.width - 342) < 0.01);
  // The empty right part of the sheet and its empty top are not drawn at all;
  // the three empty units between the two columns of presses are a sliver.
  assert.equal(fit.colFr[33], 0);
  assert.equal(fit.colFr[55], 0);
  assert.ok(fit.colFr[20] > 0 && fit.colFr[20] < 0.5);
  assert.equal(fit.colFr[0], 1);
  // Rows 25–27 hold nothing: slivers too.
  assert.ok(fit.rowFr[24] > 0 && fit.rowFr[24] < 0.5);
  for (const t of tiles) {
    assert.ok(tileWidthPx(fit, t) >= 96, `${t.label} is ${Math.round(tileWidthPx(fit, t))}px wide`);
    assert.ok(tileHeightPx(fit, t) >= MAP_READABLE.stackedH - 0.01, `${t.label} is ${Math.round(tileHeightPx(fit, t))}px tall`);
  }
  // It was 186 × 42 px per machine on the sheet that panned.
  const pq13 = tiles.find((t) => t.label === "PQ 13 — 150")!;
  assert.ok(tileWidthPx(fit, pq13) > 115 && tileHeightPx(fit, pq13) > 110);
});

test("on a desk the same floor is drawn wide and flat — the drawing beside the words — and still fills the width", () => {
  const tiles = parseLayout(FLOOR_PHONE);
  const fit = fitFloor(tiles, 761);
  assert.equal(fit.pans, false);
  assert.equal(fit.colFr[20], 1, "no slivers on a wide screen: the aisles are drawn as arranged");
  assert.equal(fit.colFr[40], 0, "…but the empty edge of the sheet still is not");
  const pq13 = tiles.find((t) => t.label === "PQ 13 — 150")!;
  assert.ok(tileWidthPx(fit, pq13) >= 240);
  assert.ok(Math.abs(tileHeightPx(fit, pq13) - MAP_READABLE.sideH) < 0.01);
  // The whole floor is wider than it is tall.
  const height = fit.rowFr.reduce((x, y) => x + y, 0) * fit.unitH;
  assert.ok(fit.width > height);
});

test("a machine too narrow to read makes the sheet pan — and only then", () => {
  // Six presses side by side, each 9 units: 58px each on a phone.
  const row = Array.from({ length: 6 }, (_, i) => ({ label: `P — ${i + 1}`, c: 1 + i * 9, r: 1, w: 9, h: 4 }));
  const fit = fitFloor(row, 342);
  assert.equal(fit.pans, true);
  assert.ok(Math.abs(tileWidthPx(fit, row[0]) - MAP_READABLE.stackedW) < 0.01, "never narrower than a tile that can be read");
  assert.equal(fitFloor(row.slice(0, 3), 342).pans, false);
});

test("the editor always shows the whole sheet, fitted, every unit the same", () => {
  const tiles = parseLayout(FLOOR_PHONE);
  for (const frame of [324, 735]) {
    const fit = fitFloor(tiles, frame, { whole: true });
    assert.equal(fit.pans, false);
    assert.deepEqual([fit.colFr.length, fit.rowFr.length], [MAP_COLS, MAP_MAX_ROWS]);
    assert.ok(fit.colFr.every((f) => f === 1) && fit.rowFr.every((f) => f === 1));
    assert.ok(Math.abs(fit.unitW * MAP_COLS - frame) < 0.01);
    assert.ok(fit.unitH >= 12);
  }
  // Before the frame is measured, and with nothing placed, nothing blows up.
  assert.equal(fitFloor([], 0).width, 0);
  assert.equal(fitFloor(tiles, 0, { whole: true }).unitW, 0);
});

test("a layout with two machines on one square, or one machine twice, is not valid", () => {
  const a = { label: "PQ 1 — 550", c: 1, r: 1, w: 2, h: 2 };
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: 2, r: 2, w: 2, h: 1 }]), false);
  assert.equal(validLayout([a, { label: "PQ 1 - 550", c: 5, r: 5, w: 1, h: 1 }]), false);
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: MAP_COLS, r: 1, w: 2, h: 1 }]), false, "off the right edge");
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: 3, r: MAP_MAX_ROWS, w: 2, h: 2 }]), false, "off the bottom");
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: 3, r: 1, w: 2, h: 1 }]), true);
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
  // One pass used to leave «=1+1» behind «= =1+1»…
  assert.equal(safeText("= =1+1"), "1+1");
  assert.equal(safeText("@-+= SUM(A1)"), "SUM(A1)");
  // …and a zero-width space in front of the «=» hid it from the check, to be
  // folded away later on the way to the sheet.
  assert.equal(safeText("\u200B=HYPERLINK(1)"), "HYPERLINK(1)");
  assert.equal(safeText("x".repeat(500), 40).length, 40);
});
