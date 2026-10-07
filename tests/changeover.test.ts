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
  NOTHING_MISSING, freeSpot, fitFloor, tileHeightPx, tileWidthPx, MAP_READABLE, standsTall, turnLayout, isFriday, machineFinished, planDay, sortByUrgency, urgencyChips, KEY_URGENT_DAYS, NO_ORDER_STOPPAGE,
  answersFor, barrelColours, bestStart, colourFromMaterial, colourKey, colourRelation, colourToSheet,
  coloursFromSheet, coloursIn, coloursToSheet, dryingFor, estimateChange, estimateFrom, formatLayout, guessColour,
  isBaselineRow, isNightHour, isRecent, kindFromSheet, kindToSheet, latestRuns, listFromSheet, listToSheet,
  looseNameKey, machineKey, machineState, mapRows, materialFamily, mergeAnswers, missingFromSheet, missingToSheet,
  newestHolders, parseLayout, parseYesNo, placeTile, rankFor, removeTile, resolveNow, safeText, splitMinutes,
  stampClockMinutes, stampDay, standingFromLog, standingWithStart, validLayout, barrelOf, logSinceTold, NO_ORDER,
  calendarHours, orderUrgency, stockState, stoppageKind, workingDaysUntil, SHIFT_HOURS, SOON_HOURS,
  type LastRun, type MapTile, type PlanMachine, type PlanOrder, type PlanStanding,
} from "../lib/changeover.ts";
// Only to pin the keys lib/changeover.ts COPIES (it must stay import-free).
import { DOWNTIME_CAPTURE_REASONS } from "../lib/prod-meta.ts";
// Only for the last test: the page's own source and strings.
import { readFileSync } from "node:fs";
import { co } from "../lib/i18n.changeover.ts";

const machine = (o: Partial<PlanMachine> & { now?: Partial<PlanMachine["now"]> } = {}): PlanMachine => ({
  label: "PQ 5 — 100", tonnage: "100", state: "idle", stoppage: null, transparentOnly: false, bigMachine: false,
  swapMin: null, swapSamples: 0,
  ...o,
  now: {
    products: ["غطاء"], colours: ["white"], colourNow: "", coloursGuessed: false, material: "بروبلين بيور", order: "",
    keyClient: false, orderMaybe: "", noOrder: false, alsoOn: "", mixedShift: false,
    source: "production", since: "2026-10-01", shift: "الصباحية", startedOn: "", ...(o.now ?? {}),
  },
});
const order = (o: Partial<PlanOrder> & { code: string }): PlanOrder => ({
  id: o.code, product: `منتج ${o.code}`, client: "عميل", material: "بروبلين", dueDate: "2026-10-20", status: "Not Started",
  qtyKg: 100, remaining: 50_000, runHours: 40, runBasis: "", asOf: "", ranOn: [], colours: ["white"], colourSource: "answer",
  fits: ["PQ 5 — 100", "PQ 7 — 100"], fitsHint: [], fitsHintText: "", workers: null, oilCores: null, hotRunner: null,
  missing: [], keyClient: false, mountedOn: "", mountedRunning: false, queuedBehind: "", storeMaterial: "", stock: null,
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

test("the owner's order (2026-10-07): an URGENT key client, then late, then dated before undated, then ease, what is left, due date", () => {
  const m = machine();
  const os = [
    order({ code: "no-date", dueDate: "" }),
    order({ code: "due-later", dueDate: "2026-10-25" }),
    order({ code: "due-sooner", dueDate: "2026-10-05" }),
    order({ code: "less-left", remaining: 1_000 }),
    order({ code: "hard-colour", colours: ["transparent"] }),
    order({ code: "late", dueDate: "2026-09-20", colours: ["transparent"] }),
    // A key client with weeks to go is an ordinary order now…
    order({ code: "key", keyClient: true, colours: ["transparent"], dueDate: "2026-11-30" }),
    // …and one due within three days goes first, whatever its colour costs.
    // (Ten hours of running left: it fits before its date, so it is urgent for
    // its DATE — an order that cannot fit is the next tests' subject.)
    order({ code: "key-urgent", keyClient: true, colours: ["transparent"], dueDate: "2026-10-02", runHours: 10 }),
  ];
  assert.deepEqual(codes(m, os), ["key-urgent", "late", "less-left", "due-sooner", "due-later", "hard-colour", "key", "no-date"]);
  // The chips say why: due soon, late, no date.
  const chipsOf = (code: string) => rankFor(m, os, ctx).ranked.find((x) => x.order.code === code)!.chips.map((c) => c.key);
  assert.ok(chipsOf("key-urgent").includes("dueTwoDays") && chipsOf("key-urgent").includes("keyClient"));
  assert.ok(chipsOf("no-date").includes("noDueDate"));
  assert.ok(chipsOf("late").includes("late") && !chipsOf("late").includes("dueToday"));
  assert.equal(KEY_URGENT_DAYS, 3);
});

test("a key client's hard colour goes before an ordinary client's same colour — only when its date is close", () => {
  const m = machine({ now: { colours: ["black"] } });
  const same = order({ code: "same-colour", colours: ["black"] });
  assert.deepEqual(codes(m, [same, order({ code: "key-hard", colours: ["white"], keyClient: true, dueDate: "2026-10-03" })]), ["key-hard", "same-colour"]);
  assert.deepEqual(codes(m, [same, order({ code: "key-hard", colours: ["white"], keyClient: true, dueDate: "2026-09-29" })]), ["key-hard", "same-colour"], "late is urgent too");
  assert.deepEqual(codes(m, [same, order({ code: "key-hard", colours: ["white"], keyClient: true })]), ["same-colour", "key-hard"]);
});

test("orders by their dates alone, for the orders tab: the same order, and the same chips", () => {
  const os = [
    order({ code: "c", dueDate: "" }), order({ code: "b", dueDate: "2026-10-20" }),
    order({ code: "a", dueDate: "2026-09-25" }),
    // Due today, and nobody knows how long it still has to run.
    order({ code: "k", keyClient: true, dueDate: "2026-09-30", runHours: null }),
  ];
  assert.deepEqual(sortByUrgency(os, ctx.today).map((o) => o.code), ["k", "a", "b", "c"]);
  assert.deepEqual(urgencyChips(os[3], ctx.today).map((c) => c.key), ["keyClient", "dueToday"]);
  assert.deepEqual(urgencyChips(os[2], ctx.today), [{ key: "late", tone: "warn", vars: { n: 5 } }]);
  assert.deepEqual(urgencyChips(os[1], ctx.today), []);
  // Due today with forty hours still to run: "due today" would be the kind
  // way to say it — the chip says it will not make it.
  assert.deepEqual(urgencyChips({ ...os[3], runHours: 40 }, ctx.today),
    [{ key: "keyClient", tone: "good" }, { key: "atRisk", tone: "warn", vars: { need: 2, have: 0 } }]);
});

test("days to a due date are WORKING days — Friday is not counted; lateness stays the customer's calendar", () => {
  // Wednesday 30 Sep 2026; Friday 2 Oct is the day off.
  const u = (dueDate: string, o: Partial<PlanOrder> = {}) => orderUrgency(order({ code: "x", dueDate, runHours: null, ...o }), ctx.today);
  assert.equal(u("2026-10-03").dueIn, 2, "Thursday and Saturday");
  assert.equal(u("2026-10-02").dueIn, 1, "due ON the Friday: only Thursday runs before it");
  // A key client is urgent within KEY_URGENT_DAYS *working* days: Sunday is
  // three of them away, four on the calendar.
  assert.equal(u("2026-10-04", { keyClient: true }).urgentKey, true);
  assert.equal(u("2026-10-05", { keyClient: true }).urgentKey, false);
  assert.equal(u("2026-10-04").urgentKey, false, "an ordinary client is never 'urgent key'");
  assert.deepEqual(u("2026-09-25"), { dueIn: -5, late: 5, atRisk: false, urgentKey: false });
  assert.deepEqual(u(""), { dueIn: null, late: 0, atRisk: false, urgentKey: false });
  assert.deepEqual(u("غدا"), { dueIn: null, late: 0, atRisk: false, urgentKey: false }, "a date nobody can read is no date");

  // The chip WORDS the date the way a calendar reads: the Friday is two days
  // off, Sunday four — "tomorrow" must never mean the day after tomorrow.
  const chip = (dueDate: string, today = ctx.today) => urgencyChips(order({ code: "x", dueDate, runHours: null }), today);
  assert.deepEqual(chip("2026-10-02"), [{ key: "dueTwoDays", tone: "warn", vars: { n: 2 } }]);
  assert.deepEqual(chip("2026-10-04"), [{ key: "dueSoon", tone: "warn", vars: { n: 4 } }]);
  assert.deepEqual(chip("2026-10-05"), [], "four working days away: no chip yet");
  assert.deepEqual(chip("2026-10-02", "2026-10-01").map((c) => c.key), ["dueTomorrow"], "seen on Thursday, the Friday is tomorrow — not today");

  // Thursday and Friday are both one working day away; the earlier date is still first.
  const thu = order({ code: "b", dueDate: "2026-10-01" }), fri = order({ code: "a", dueDate: "2026-10-02" });
  assert.deepEqual(sortByUrgency([fri, thu], ctx.today).map((o) => o.code), ["b", "a"]);
});

test("a key client's order due in 5 working days that needs 8 days of running is URGENT — it will be late", () => {
  // Wed 30 Sep → Tue 6 Oct: Thu, Sat, Sun, Mon, Tue. Five days is past
  // KEY_URGENT_DAYS, so by its date alone this is an ordinary order.
  const key = order({ code: "Job 512", product: "وش سمارت مباشر", keyClient: true, dueDate: "2026-10-06", runHours: 8 * 24 });
  assert.deepEqual(orderUrgency(key, ctx.today), { dueIn: 5, late: 0, atRisk: true, urgentKey: true });
  assert.deepEqual(orderUrgency({ ...key, runHours: 4 * 24 }, ctx.today), { dueIn: 5, late: 0, atRisk: false, urgentKey: false });
  assert.equal(orderUrgency({ ...key, runHours: 5 * 24 }, ctx.today).atRisk, false, "exactly the time there is, is enough");
  // The chip says what it needs against what there is — instead of a "due in" chip.
  assert.deepEqual(urgencyChips(key, ctx.today), [{ key: "keyClient", tone: "good" }, { key: "atRisk", tone: "warn", vars: { need: 8, have: 5 } }]);
  assert.deepEqual(urgencyChips({ ...key, runHours: 140 }, ctx.today)[1].vars, { need: 6, have: 5 }, "a part of a day is a day");
  // What is left of TODAY runs too (half a day, on average): an order due today
  // with three hours to go is not "going to be late".
  assert.equal(orderUrgency({ ...key, dueDate: ctx.today, runHours: 3 }, ctx.today).atRisk, false);
  assert.equal(orderUrgency({ ...key, dueDate: ctx.today, runHours: 20 }, ctx.today).atRisk, true);
  // It goes ahead of an ordinary client's order that is already late.
  const late = order({ code: "Job 498", product: "غطاء احمر بروبلين 58", dueDate: "2026-09-20" });
  assert.deepEqual(codes(machine(), [late, key]), ["Job 512", "Job 498"]);
  assert.deepEqual(sortByUrgency([late, key], ctx.today).map((o) => o.code), ["Job 512", "Job 498"]);
});

test("an order that WILL be late is ranked with the late ones — ahead of every order that still has time", () => {
  const m = machine();
  const os = [
    // Easy, nearly finished and due SOONER: it used to go first on all three.
    order({ code: "has-time", dueDate: "2026-10-05", remaining: 100, runHours: 2 }),
    // Six days away, nine days of running left: not late YET.
    order({ code: "will-be-late", product: "روزته سودة العداد الثلاثي", dueDate: "2026-10-07", runHours: 200, colours: ["transparent"] }),
    order({ code: "late", product: "كفر شفاف فوكس", dueDate: "2026-09-28", colours: ["transparent"] }),
  ];
  const r = rankFor(m, os, ctx).ranked;
  assert.deepEqual(r.map((s) => s.order.code), ["late", "will-be-late", "has-time"]);
  const risk = r[1];
  assert.deepEqual([risk.atRisk, risk.late, risk.dueIn, risk.urgentKey], [true, 0, 6, false]);
  assert.deepEqual(risk.chips.find((c) => c.key === "atRisk"), { key: "atRisk", tone: "warn", vars: { need: 9, have: 6 } });
  assert.equal(risk.chips.some((c) => /^due/.test(c.key) || c.key === "late"), false);
  assert.equal(r[2].atRisk, false);
  // The same order on the «الأوامر» tab, where there is no machine.
  assert.deepEqual(sortByUrgency(os, ctx.today).map((o) => o.code), ["late", "will-be-late", "has-time"]);
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

test("taking a RUNNING mould off: for an urgent key client, a late order or one that will be late — never when the job ends within a shift, or is late, will be late or a key client's itself", () => {
  const P = "PQ 5 — 100";
  const running = (o: Partial<PlanOrder> = {}) => order({ code: "run", mountedOn: P, mountedRunning: true, runHours: 60, ...o });
  const interrupts = (m: PlanMachine, o: PlanOrder, on: PlanOrder | null = running()) =>
    rankFor(m, on ? [on, o] : [o], ctx).ranked.find((x) => x.order.code === o.code)!.interrupt;
  const busy = machine({ state: "running", now: { order: "run" } });
  assert.equal(interrupts(busy, order({ code: "key", keyClient: true, dueDate: "2026-10-01" })), true);
  assert.equal(interrupts(busy, order({ code: "late", dueDate: "2026-09-20" })), true);
  // A key client with time to spare, and an ordinary on-time order: no.
  assert.equal(interrupts(busy, order({ code: "key", keyClient: true })), false);
  const plain = rankFor(busy, [running(), order({ code: "plain" })], ctx).ranked[0];
  assert.equal(plain.chips.some((c) => c.key === "worthInterrupt" || c.key === "machineBusy"), false, "'the machine is running' is said once, above the list");
  const late = order({ code: "late", dueDate: "2026-09-20" });
  // The running job ends within a shift: let it finish.
  assert.equal(interrupts(busy, late, running({ runHours: 5 })), false);
  assert.equal(SHIFT_HOURS, 12);
  // The running job is late itself, or a key client's.
  assert.equal(interrupts(busy, late, running({ dueDate: "2026-09-25" })), false);
  assert.equal(interrupts(machine({ state: "running", now: { order: "run", keyClient: true } }), late), false);
  // At risk counts as late, on both sides (approved 2026-10-07): an order that
  // WILL be late is worth the running mould…
  const risk = order({ code: "risk", dueDate: "2026-10-07", runHours: 200 });
  assert.equal(interrupts(busy, risk), true);
  assert.ok(rankFor(busy, [running(), risk], ctx).ranked[0].chips.some((c) => c.key === "worthInterrupt"));
  // …and a running job that will itself be late (two working days to its
  // date, sixty hours to run) is not taken off for anybody.
  assert.equal(interrupts(busy, late, running({ dueDate: "2026-10-01" })), false);
  assert.equal(interrupts(busy, risk, running({ dueDate: "2026-10-01" })), false);
  // Nobody knows how long the running job has left: the limit cannot be applied.
  assert.equal(interrupts(busy, late, running({ runHours: null })), true);
  // It is probably the very job that is running here; a machine that is not running has nothing to interrupt.
  assert.equal(interrupts(machine({ state: "running", now: { orderMaybe: "late" } }), late, null), false);
  assert.equal(interrupts(machine({ state: "idle" }), late, null), false);
  assert.ok(rankFor(busy, [running(), late], ctx).ranked[0].chips.some((c) => c.key === "worthInterrupt"));
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
  for (const k of ["late", "darker", "materialChange", "drying", "workers", "shortRun"]) {
    assert.ok(keys.includes(k), `missing chip ${k} in ${keys.join(",")}`);
  }
  for (const k of ["fitUnknown", "fitHintElsewhere", "readyNotAsked", "colourGuess", "materialUnknown"]) {
    assert.equal(keys.includes(k), false, `${k} is noise the owner asked to lose`);
  }
  assert.equal(s.needsAnswers, true);
  assert.equal(s.late, 5);
  assert.deepEqual(s.chips.find((c) => c.key === "drying")?.vars, { h: "3" });
  // Everything answered: no hint.
  assert.equal(rankFor(m, [order({ code: "y" })], ctx).ranked[0].needsAnswers, false);
});

test("which machines a mould goes on is the SUPERVISOR's answer — Master's tonnage neither sorts an order nor hides it", () => {
  const m = machine({ label: "PQ 1 — 550", tonnage: "550" });
  const r = rankFor(m, [
    order({ code: "elsewhere-key", fits: null, fitsHint: ["PQ 12 — 180"], fitsHintText: "180", keyClient: true }),
    order({ code: "hinted-here", fits: null, fitsHint: ["PQ 1 — 550"], fitsHintText: "550" }),
    order({ code: "answered-here", fits: ["PQ 1 — 550", "PQ 2 — 280"], colours: ["black"] }),
    order({ code: "unknown-key-late", fits: null, keyClient: true, dueDate: "2026-09-10" }),
    order({ code: "no-such-tonnage", fits: null, fitsHint: [], fitsHintText: "136", dueDate: "2026-09-20" }),
    // The supervisor said: other machines only. That, and only that, takes it off this list.
    order({ code: "said-elsewhere", fits: ["PQ 12 — 180"] }),
  ], ctx);
  assert.deepEqual(r.ranked.map((s) => [s.order.code, s.fit]), [
    ["unknown-key-late", "unknown"], ["no-such-tonnage", "unknown"], ["answered-here", "here"],
    ["elsewhere-key", "unknown"], ["hinted-here", "unknown"],
  ]);
  assert.ok(r.ranked.every((s) => !s.chips.some((c) => c.key === "fitHintElsewhere")));
  assert.deepEqual(r.blocked.map((b) => [b.order.code, b.reason]), [["said-elsewhere", "notFit"]]);
  // Nobody has said → the questions button carries the hint.
  assert.equal(r.ranked[3].needsAnswers, true);
});

test("a machine recorded «لا يوجد أمر شغل» has FINISHED: its order is done, and is offered nowhere", () => {
  const P = "PQ 5 — 100";
  const done = machine({ state: "stopped", stoppage: { reason: NO_ORDER_STOPPAGE, since: 0 }, now: { order: "Job 1" } });
  assert.equal(machineFinished(done), true);
  assert.equal(machineFinished(machine({ state: "stopped", stoppage: { reason: "Mold change", since: 0 } })), false);
  assert.equal(machineFinished(machine()), false);
  // The count is typed a day or two behind: the order still shows 50,000 to make.
  const os = [order({ code: "Job 1", mountedOn: P, doneByFloor: true }), order({ code: "Job 2" })];
  const here = rankFor(done, os, ctx);
  assert.deepEqual(here.ranked.map((x) => x.order.code), ["Job 2"]);
  assert.deepEqual(here.blocked.map((b) => [b.order.code, b.reason]), [["Job 1", "doneByFloor"]]);
  const other = rankFor(machine({ label: "PQ 7 — 100" }), os, ctx);
  assert.deepEqual([other.ranked.map((x) => x.order.code), other.blocked.length], [["Job 2"], 0], "said once, on its own machine");
});

test("the floor's «لا يوجد أمر شغل» against a count that says days are left: the order is NOT blocked — it stays a candidate", () => {
  // Approved 2026-10-07: the floor's word is checked against the count. When
  // more than a shift is still left the two disagree (`doneUnsure`), and the
  // page asks the engineer which is right; the rules block nothing meanwhile.
  const P = "PQ 5 — 100";
  const done = machine({ state: "stopped", stoppage: { reason: NO_ORDER_STOPPAGE, since: 0 }, now: { products: ["وش سمارت مباشر"], order: "Job 1" } });
  const unsure = order({ code: "Job 1", product: "وش سمارت مباشر", mountedOn: P, doneUnsure: true, runHours: 60, colours: ["black"] });
  const r = rankFor(done, [order({ code: "Job 2" }), unsure], ctx);
  assert.deepEqual(r.blocked, []);
  assert.deepEqual(r.ranked.map((x) => x.order.code), ["Job 1", "Job 2"], "its mould is already up: the cheapest thing to start");
  // …and the day's plan offers it on its own machine, like any standing mould.
  const [e] = planDay([done], [order({ code: "Job 2" }), unsure], ctx).entries;
  assert.deepEqual([e.need, e.pick?.order.code, e.pick?.mountedHere], ["finished", "Job 1", true]);
});

test("where a mould goes is learned from where it has RUN — until the supervisor answers", () => {
  const P = "PQ 9 — 140";
  const m = machine({ label: P, tonnage: "140" });
  const r = rankFor(m, [
    order({ code: "nobody-said", fits: null }),
    // The shift log shows it on this machine (and, more often, on PQ 3).
    order({ code: "ran-here", product: "غطاء امير احمر", fits: null, ranOn: ["PQ 3 — 280", "PQ 9 - 140"], colours: ["transparent"] }),
    order({ code: "said-here", fits: [P, "PQ 3 — 280"], colours: ["transparent"] }),
    order({ code: "ran-elsewhere", fits: null, ranOn: ["PQ 3 — 280"], remaining: 10 }),
    // The supervisor's word beats the log: it ran here once, he says it goes on PQ 3.
    order({ code: "said-not-here", fits: ["PQ 3 — 280"], ranOn: [P] }),
  ], ctx);
  // Said → ran → nobody knows; within "nobody knows" the owner's order goes on.
  assert.deepEqual(r.ranked.map((s) => [s.order.code, s.fit]), [
    ["said-here", "here"], ["ran-here", "ran"], ["ran-elsewhere", "unknown"], ["nobody-said", "unknown"],
  ]);
  assert.deepEqual(r.blocked.map((b) => [b.order.code, b.reason]), [["said-not-here", "notFit"]]);
  const chip = (code: string) => r.ranked.find((s) => s.order.code === code)!.chips.find((c) => c.key === "ranHere");
  assert.deepEqual(chip("ran-here"), { key: "ranHere", tone: "good" });
  assert.equal(chip("said-here"), undefined);
  assert.equal(chip("ran-elsewhere"), undefined);
  // It is still a question for him: the hint on the questions button stays.
  assert.equal(r.ranked[1].needsAnswers, true);
  // A mould STANDING here is "here" — where it stands says more than where it ran.
  const [standing] = rankFor(m, [order({ code: "up", fits: null, ranOn: [P], mountedOn: P })], ctx).ranked;
  assert.deepEqual([standing.fit, standing.chips.some((c) => c.key === "ranHere")], ["here", false]);
});

test("a machine's measured change time replaces the fixed minutes — the factory's own history", () => {
  const from = { product: "غطاء", colour: "white", material: "بروبلين" };
  const to = { product: "قاعدة", colour: "white", material: "بروبلين" };
  const swap = (o: Parameters<typeof estimateChange>[2]) => { const e = estimateChange(from, to, o); return [e.swapMin, e.swapMeasured, e.totalMin]; };
  // Not measured (too few changes logged, or «التوقفات» unread): the fixed numbers.
  assert.deepEqual(swap({}), [45, false, 45]);
  assert.deepEqual(swap({ swapMin: null }), [45, false, 45]);
  assert.deepEqual(swap({ bigMachine: true, swapMin: null }), [360, false, 360]);
  // Measured: that machine's own median, ordinary and big machine alike.
  assert.deepEqual(swap({ swapMin: 70 }), [70, true, 70]);
  assert.deepEqual(swap({ bigMachine: true, swapMin: 240 }), [240, true, 240]);
  // Oil cores are the MOULD's cost («ساعتين ثلاثة»): a machine that is quick
  // with ordinary moulds does not make such a mould quick.
  assert.deepEqual(swap({ oilCores: true, swapMin: 70 }), [150, false, 150]);
  assert.deepEqual(swap({ oilCores: true, swapMin: 200 }), [200, true, 200]);
  // The same mould carrying on is no change of mould, measured or not.
  const same = estimateChange(from, { ...from, colour: "black" }, { swapMin: 70 });
  assert.deepEqual([same.swapMin, same.swapMeasured], [0, false]);
  // A number that is not a time is not a measurement.
  assert.deepEqual(swap({ swapMin: 0 }), [45, false, 45]);
  assert.deepEqual(swap({ swapMin: Number.NaN }), [45, false, 45]);

  // rankFor hands the estimate the machine's own number.
  const [measured] = rankFor(machine({ swapMin: 70, swapSamples: 5 }), [order({ code: "x" })], ctx).ranked;
  assert.deepEqual([measured.estimate.swapMin, measured.estimate.swapMeasured], [70, true]);
  const [fixed] = rankFor(machine(), [order({ code: "x" })], ctx).ranked;
  assert.deepEqual([fixed.estimate.swapMin, fixed.estimate.swapMeasured], [CHANGEOVER_NUMBERS.swapMin, false]);
});

test("a mould that went on TODAY is not taken off again — whatever is waiting", () => {
  const P = "PQ 5 — 100";
  const job = order({ code: "run", product: "كفر شفاف فوكس", mountedOn: P, mountedRunning: true, runHours: 60 });
  const late = order({ code: "late", product: "عدسة شفافة فوكس", dueDate: "2026-09-20" });
  const on = (startedOn: string) => machine({ state: "running", now: { products: ["كفر شفاف فوكس"], order: "run", startedOn } });
  const interrupt = (m: PlanMachine) => rankFor(m, [job, late], ctx).ranked[0].interrupt;
  assert.equal(interrupt(on(ctx.today)), false, "mounted this morning");
  assert.equal(interrupt(on("2026-09-29")), true, "yesterday's mould may come off for a late order");
  assert.equal(interrupt(on("")), true, "nobody knows when it went on: the rule cannot be applied");
  assert.equal(interrupt(on("2026-10-01")), false, "a start dated after today is not before today");
  // On the day's plan the machine just runs, and the late order is SAID to have
  // no machine — it is not quietly dropped.
  const day = planDay([on(ctx.today)], [job, late], ctx);
  assert.deepEqual(day.entries.map((e) => [e.need, e.pick]), [["running", null]]);
  assert.deepEqual(day.unplaced.map((u) => [u.order.code, u.why]), [["late", "noMachine"]]);
  const yesterday = planDay([on("2026-09-29")], [job, late], ctx);
  assert.deepEqual([yesterday.entries[0].need, yesterday.entries[0].pick?.order.code, yesterday.unplaced], ["interrupt", "late", []]);
});

test("the store is short of an order's material: the card says so — a warning in the ranking, never a block", () => {
  const st = (code: string, haveKg: number, needKg: number | null) =>
    order({ code, stock: { material: "بروبلين هومو", haveKg, needKg, guessed: false } });
  const m = machine();
  const stockChips = (o: PlanOrder) => rankFor(m, [o], ctx).ranked[0].chips.filter((c) => c.key.startsWith("stock"));
  assert.deepEqual(stockChips(st("x", 0, 120)), [{ key: "stockNone", tone: "bad", vars: { material: "بروبلين هومو" } }]);
  assert.deepEqual(stockChips(st("x", 80.4, 119.6)), [{ key: "stockLow", tone: "warn", vars: { have: 80, need: 120 } }]);
  assert.deepEqual(stockChips(st("x", 500, 120)), []);
  assert.deepEqual(stockChips(st("x", 500, null)), [], "some is there and nothing says it is short");
  assert.deepEqual(stockChips(order({ code: "x" })), [], "not known is not 'none': nothing is said");
  // Stock is not a tier: the owner's order is untouched by it.
  const r = rankFor(m, [st("b-none", 0, 120), st("a-plenty", 500, 120), st("c-low", 80, 120)], ctx);
  assert.deepEqual(r.ranked.map((s) => [s.order.code, s.stock]), [["a-plenty", "ok"], ["b-none", "none"], ["c-low", "low"]]);
  assert.deepEqual(r.blocked, []);
});

test("the day's plan: who needs a mould first, one order to one machine, and when to start drying", () => {
  const A = "PQ 1 — 100", B = "PQ 2 — 100", C = "PQ 3 — 100", D2 = "PQ 4 — 100", E = "PQ 5 — 100";
  const all = [A, B, C, D2, E];
  const ms = [
    machine({ label: D2, state: "running", now: { order: "run-d" } }),
    machine({ label: C, state: "running", now: { order: "run-c" } }),
    machine({ label: E, state: "stopped", stoppage: { reason: "Mold maintenance", since: 0 }, now: { order: "" } }),
    machine({ label: B, state: "idle", now: { order: "" } }),
    machine({ label: A, state: "stopped", stoppage: { reason: NO_ORDER_STOPPAGE, since: 0 }, now: { order: "done-a" } }),
  ];
  const os = [
    order({ code: "done-a", mountedOn: A, doneByFloor: true, fits: all }),
    order({ code: "run-c", mountedOn: C, mountedRunning: true, runHours: 5, fits: all }),
    order({ code: "run-d", mountedOn: D2, mountedRunning: true, runHours: 200, fits: all }),
    order({ code: "w-late", dueDate: "2026-09-20", fits: all }),
    order({ code: "w-abs", material: "ABS اسود", dueDate: "2026-10-10", fits: all }),
    order({ code: "w-plain", dueDate: "2026-10-15", fits: all }),
  ];
  const plan = planDay(ms, os, ctx);
  const day = plan.entries;
  // Finished first, then standing, then stopped, then the one that ends soon.
  // The long job would be worth interrupting for the late order — but that
  // order already went to a machine with nothing on it, so it just runs.
  assert.deepEqual(day.map((e) => [e.machine.label, e.need]), [[A, "finished"], [B, "free"], [E, "stopped"], [C, "soon"], [D2, "running"]]);
  const urgent = planDay([ms[0]], [os[2], os[3]], ctx).entries;
  assert.deepEqual([urgent[0].need, urgent[0].pick?.order.code], ["interrupt", "w-late"], "with no free machine, the late order is worth the running mould");
  // The late order goes to the machine that needs one most — and to no other;
  // the next machine takes the easy change (same material) before the hard one.
  assert.deepEqual(day.map((e) => e.pick?.order.code ?? null), ["w-late", "w-plain", "w-abs", null, null]);
  assert.deepEqual(plan.unplaced, [], "every urgent order found a machine");
  assert.deepEqual([day[3].hoursLeft, day[3].finishIn], [5, 5]);
  assert.deepEqual([day[0].hoursLeft, day[0].finishIn], [null, null], "a machine that is not running has no end to wait for");
  assert.equal(day[0].current?.code, "done-a");
  // ABS dries three hours: on a machine waiting now, before it can run at all.
  assert.equal(day[2].dryIn, 0);
  assert.equal(day[1].dryIn, null, "polypropylene needs none");

  // With nothing urgent, the long job just runs — and the one ending in five
  // hours is told what comes next and when its material has to go in the dryer.
  const calm = planDay(ms.slice(0, 2), [os[1], os[2], os[4]], ctx).entries;
  assert.deepEqual(calm.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null, e.dryIn]), [[C, "soon", "w-abs", 2], [D2, "running", null, null]]);
});

test("a machine down for machine maintenance never takes an order — the late one goes to a machine that can run it", () => {
  // Before 2026-10-07 the plan went machine by machine and «توقف» was one
  // state: a press down for repair was handed the late order.
  const A = "PQ 1 — 100", B = "PQ 2 — 100";
  const down = (reason: string) => machine({ label: A, state: "stopped", stoppage: { reason, since: 0 }, now: { products: ["كرسي"] } });
  const free = machine({ label: B });
  const late = order({ code: "late", product: "غطاء احمر بروبلين 58", dueDate: "2026-09-20", fits: null });
  const next = order({ code: "next", fits: null });

  // Alone, the broken machine is given nothing — and the late order is SAID to have no machine.
  const alone = planDay([down("Maintenance")], [late, next], ctx);
  assert.deepEqual(alone.entries.map((e) => [e.need, e.pick]), [["down", null]]);
  assert.deepEqual(alone.unplaced.map((u) => [u.order.code, u.why]), [["late", "noMachine"]]);
  // With a machine that can run beside it, the late order goes there.
  const both = planDay([down("Maintenance"), free], [late, next], ctx);
  assert.deepEqual(both.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]), [[B, "free", "late"], [A, "down", null]]);
  assert.deepEqual(both.unplaced, []);

  // Every reason the downtime page can record, by what it says about the MACHINE.
  const needOf = (reason: string) => { const [e] = planDay([down(reason)], [late, next], ctx).entries; return [e.need, e.pick?.order.code ?? null]; };
  for (const reason of ["Maintenance", "Mold change", "Material drying", "No operator", "Setup", "Nozzle burn", "Sprue broken", "Other", "سبب جديد"]) {
    assert.deepEqual(needOf(reason), ["down", null], reason);
  }
  // Its mould is out, or its job's material is: the machine itself can take another.
  for (const reason of ["Mold maintenance", "No material"]) assert.deepEqual(needOf(reason), ["stopped", "late"], reason);
  assert.deepEqual(needOf(NO_ORDER_STOPPAGE), ["finished", "late"]);
});

/* Where the mould STANDS (review of 2026-10-07). Every fixture above puts a
 * stopped machine on the plan with NO order on it; on the floor a stoppage is
 * tapped on a machine that has one. The three tests below tie the order to it. */

test("an order whose mould is ON a machine that is down stays with it — no other machine is planned, or interrupted, for it", () => {
  // The normal flow: «ركّب دي», then the floor taps «تغيير الاسطمبة» on that
  // machine. The plan took a RUNNING mould off another machine for the order
  // that was being mounted — and with a free machine beside it, sent it there.
  const A = "PQ 1 — 100", B = "PQ 2 — 100", C = "PQ 3 — 100", F = "PQ 4 — 100";
  const down = (reason: string | null) => machine({
    label: B, state: "stopped", stoppage: reason === null ? null : { reason, since: 0 }, now: { products: ["كفر"], order: "Job 10" },
  });
  const busy = (label: string, code: string) => machine({ label, state: "running", now: { order: code } });
  const late = order({ code: "Job 10", product: "كفر", dueDate: "2026-09-20", mountedOn: B, fits: null });
  const os = [
    late, order({ code: "next", fits: null }),
    order({ code: "run-a", mountedOn: A, mountedRunning: true, runHours: 200 }),
    order({ code: "run-c", mountedOn: C, mountedRunning: true, runHours: 200 }),
  ];
  const seen = (ms: PlanMachine[], orders: PlanOrder[] = os) => {
    const p = planDay(ms, orders, ctx);
    return [p.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]), p.unplaced.map((u) => [u.order.code, u.why])];
  };
  // Every reason but a repair of the machine itself — a key nobody knows, and
  // a machine called stopped with no reason on record, included.
  for (const reason of ["Mold change", "Setup", "Material drying", "No operator", "Nozzle burn", "Sprue broken", "Other", "سبب جديد", null]) {
    assert.deepEqual(seen([busy(A, "run-a"), down(reason), busy(C, "run-c")]),
      [[[B, "down", null], [A, "running", null], [C, "running", null]], [["Job 10", "noMachine"]]], `${reason}`);
    // A free machine beside it takes what is WAITING — not the mould that is on PQ 2.
    assert.deepEqual(seen([down(reason), machine({ label: F })]),
      [[[F, "free", "next"], [B, "down", null]], [["Job 10", "noMachine"]]], `${reason}`);
  }
  // Not urgent: it is simply not offered anywhere — and is not "unplaced".
  const calm = [{ ...late, dueDate: "2026-10-20" }, os[1]];
  assert.deepEqual(seen([down("Mold change"), machine({ label: F })], calm), [[[F, "free", "next"], [B, "down", null]], []]);
  assert.deepEqual(seen([down("Mold change"), machine({ label: F })], [calm[0]]), [[[F, "free", null], [B, "down", null]], []]);
  // Another order of the SAME product is on that mould too: it waits with it.
  const twin = order({ code: "Job 11", product: "كفر", mountedOn: B, fits: null });
  assert.deepEqual(seen([down("Setup"), machine({ label: F })], [calm[0], twin]), [[[F, "free", null], [B, "down", null]], []]);
  // «صيانة في الماكينة» is the machine itself under repair: there the plan is
  // left as it was — the late order goes to a machine that can run it.
  assert.deepEqual(seen([down("Maintenance"), machine({ label: F })]), [[[F, "free", "Job 10"], [B, "down", null]], []]);
});

test("a machine stopped for its MOULD or its MATERIAL takes ANOTHER mould — never the job that stoppage is about", () => {
  // «صيانة الاسطمبة» / «عدم وجود خامة» with the order still tied to the
  // machine: its own job topped its own list (the mould is "already up"), so
  // the card said «اسطمبتها راكبة — تكمّل» about the mould that is out, and no
  // other mould was offered.
  const B = "PQ 2 — 100", F = "PQ 4 — 100";
  const stopped = (reason: string) => machine({ label: B, state: "stopped", stoppage: { reason, since: 0 }, now: { products: ["كفر"], order: "Job 10" } });
  const own = (o: Partial<PlanOrder> = {}) => order({ code: "Job 10", product: "كفر", mountedOn: B, fits: null, ...o });
  const other = order({ code: "Job 40", fits: null });
  for (const reason of ["Mold maintenance", "No material"]) {
    // The machine's own screen still lists its mould first: only the DAY's plan decides here.
    assert.deepEqual(codes(stopped(reason), [other, own()]), ["Job 10", "Job 40"], reason);
    const day = planDay([stopped(reason)], [other, own()], ctx);
    assert.deepEqual(day.entries.map((e) => [e.need, e.current?.code, e.pick?.order.code ?? null, e.pick?.mountedHere ?? null]),
      [["stopped", "Job 10", "Job 40", false]], reason);
    assert.deepEqual(day.unplaced, [], reason);
    // Nothing else waits: no pick, rather than that one.
    assert.equal(planDay([stopped(reason)], [own()], ctx).entries[0].pick, null, reason);
    // The stopped job is not sent to a free machine either (its mould is out,
    // or its material is) — and when it is LATE it is said to have no machine.
    const late = planDay([stopped(reason), machine({ label: F })], [other, own({ dueDate: "2026-09-20" })], ctx);
    assert.deepEqual(late.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]), [[F, "free", "Job 40"], [B, "stopped", null]], reason);
    assert.deepEqual(late.unplaced.map((u) => [u.order.code, u.why]), [["Job 10", "noMachine"]], reason);
  }
  // «لا يوجد أمر شغل» is not such a stoppage: a mould the count still doubts is offered back there (see above).
  const done = machine({ label: B, state: "stopped", stoppage: { reason: NO_ORDER_STOPPAGE, since: 0 }, now: { products: ["كفر"], order: "Job 10" } });
  assert.equal(planDay([done], [other, own({ doneUnsure: true })], ctx).entries[0].pick?.order.code, "Job 10");
});

test("one mould goes on ONE machine: a second order of the product standing on an idle machine is next on that mould, not a job for another", () => {
  // The owner's own case — one product in two colours — while the mould STANDS
  // (`queuedBehind` is only set while it runs): the plan put Job 10 on the
  // machine holding the mould and Job 11, the same mould, on the one beside it.
  const B = "PQ 2 — 100", C = "PQ 3 — 100";
  const holding = machine({ label: B, now: { products: ["كفر"], order: "Job 10" } });
  const beside = machine({ label: C });
  const first = (o: Partial<PlanOrder> = {}) => order({ code: "Job 10", product: "كفر", mountedOn: B, fits: null, ...o });
  const second = (o: Partial<PlanOrder> = {}) => order({ code: "Job 11", product: "كفر", mountedOn: B, fits: null, ...o });
  const other = order({ code: "Job 40", fits: null });
  const picks = (os: PlanOrder[]) => {
    const p = planDay([holding, beside], os, ctx);
    return [p.entries.map((e) => [e.machine.label, e.pick?.order.code ?? null]), p.unplaced.map((u) => u.order.code)];
  };
  // PQ 3's own list has Job 11 above Job 40 — the day's plan passes over it.
  assert.deepEqual(codes(beside, [first(), second(), other]), ["Job 10", "Job 11", "Job 40"]);
  assert.deepEqual(picks([first(), second(), other]), [[[B, "Job 10"], [C, "Job 40"]], []]);
  assert.deepEqual(picks([first(), second()]), [[[B, "Job 10"], [C, null]], []]);
  // Both late — the ORDER picks: the second is still next on that mould, and is not called "unplaced".
  const late = { dueDate: "2026-09-20" };
  assert.deepEqual(picks([first(late), second(late), other]), [[[B, "Job 10"], [C, "Job 40"]], []]);
  // The more urgent of the two is the one the mould carries on with.
  assert.deepEqual(picks([first(), second(late), other]), [[[B, "Job 11"], [C, "Job 40"]], []]);
  // Another product whose mould stands nowhere, and the same NAME with no mould up anywhere, are untouched.
  assert.deepEqual(picks([first(), order({ code: "Job 12", product: "كفر", fits: null }), other]), [[[B, "Job 10"], [C, "Job 12"]], []]);
});

test("urgent orders choose their machine FIRST: where the supervisor said, then where the mould stands or has run, before a machine nobody has spoken for", () => {
  const A = "PQ 1 — 100", B = "PQ 2 — 100", C = "PQ 3 — 100";
  const ms = [A, B, C].map((label) => machine({ label }));
  const late = (o: Partial<PlanOrder> = {}) => order({ code: "late", product: "روزته سودة العداد الثلاثي", dueDate: "2026-09-20", fits: null, ...o });
  const plain = order({ code: "plain", fits: null });
  const picks = (o: PlanOrder) => planDay(ms, [plain, o], ctx).entries.map((e) => [e.machine.label, e.pick?.order.code ?? null]);

  // Nobody has said and it has never run: every free machine is the same
  // guess, so the first by number.
  assert.deepEqual(picks(late()), [[A, "late"], [B, "plain"], [C, null]]);
  // The shift log shows it on PQ 3. Machine by machine, PQ 1 came first and
  // took it (it tops PQ 1's own list too); now the ORDER picks, and PQ 1 gets
  // what is left.
  assert.deepEqual(picks(late({ ranOn: [C] })), [[A, "plain"], [B, null], [C, "late"]]);
  // The supervisor named PQ 2 and PQ 3: his word, the first of them.
  assert.deepEqual(picks(late({ fits: [B, C], ranOn: [C] })), [[A, "plain"], [B, "late"], [C, null]]);
  // Its mould is STANDING on PQ 3, which the log says it never ran on: "here"
  // beats "ran" — and nothing is cheaper to start.
  assert.deepEqual(picks(late({ ranOn: [B], mountedOn: C })), [[A, "plain"], [B, null], [C, "late"]]);

  // Equal fit: the easier change, then the shorter one, then the number.
  const black = (label: string, o: Partial<PlanMachine> = {}) => machine({ label, ...o, now: { colours: ["black"], colourNow: "black" } });
  const goesTo = (machines: PlanMachine[]) => planDay(machines, [late()], ctx).entries.find((e) => e.pick)?.machine.label;
  assert.equal(goesTo([black(A), machine({ label: B })]), B, "white after white, not white after black");
  // …the easier change even where it is the LONGER one: nothing to purge and a
  // slow crew (90 min) before a dark barrel and a quick one (20 + 30).
  assert.equal(goesTo([black(A, { swapMin: 30, swapSamples: 4 }), machine({ label: B, swapMin: 90, swapSamples: 4 })]), B);
  assert.equal(goesTo([machine({ label: A, swapMin: 90, swapSamples: 4 }), machine({ label: B, swapMin: 30, swapSamples: 4 })]), B, "the machine that changes faster");
  assert.equal(goesTo([machine({ label: "PQ 10 — 100" }), machine({ label: "PQ 9 — 100" })]), "PQ 9 — 100", "9 before 10");
});

test("an urgent order takes a free machine before one that ends soon, and one that ends soon before a mould worth taking off", () => {
  // (The free machine has the HIGHEST number: it is chosen for being free,
  // not for coming first.)
  const F = "PQ 3 — 100", S = "PQ 1 — 100", L = "PQ 2 — 100";
  const free = machine({ label: F });
  const soon = machine({ label: S, state: "running", now: { order: "run-s" } });
  const long = machine({ label: L, state: "running", now: { order: "run-l" } });
  const os = [
    order({ code: "run-s", mountedOn: S, mountedRunning: true, runHours: 6 }),
    order({ code: "run-l", mountedOn: L, mountedRunning: true, runHours: 300 }),
    order({ code: "late-1", dueDate: "2026-09-10" }),
    order({ code: "late-2", dueDate: "2026-09-15" }),
    order({ code: "late-3", product: "عظمة قشارة ثوم", material: "ABS اسود مخرز", dueDate: "2026-09-20" }),
    order({ code: "late-4", dueDate: "2026-09-25" }),
  ];
  const fitsAll = os.map((o) => ({ ...o, fits: [F, S, L] }));
  const plan = planDay([long, soon, free], fitsAll, ctx);
  // The most urgent order gets the free machine, the next the one ending in
  // six hours, the third is worth the long job's mould — and the fourth is
  // told it has no machine today.
  assert.deepEqual(plan.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]),
    [[F, "free", "late-1"], [L, "interrupt", "late-3"], [S, "soon", "late-2"]]);
  assert.deepEqual(plan.unplaced.map((u) => [u.order.code, u.why]), [["late-4", "noMachine"]]);
  // A mould taken off NOW needs its ABS dry now — not when the long job would have ended.
  assert.deepEqual(plan.entries.map((e) => e.dryIn), [null, 0, null]);
  // With only one late order, the long job is not disturbed: it just runs.
  const one = planDay([long, soon, free], fitsAll.slice(0, 3), ctx);
  assert.deepEqual(one.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]),
    [[F, "free", "late-1"], [S, "soon", null], [L, "running", null]]);
  // An order is offered to ONE machine.
  const given = plan.entries.map((e) => e.pick?.order.code).filter(Boolean);
  assert.equal(new Set(given).size, given.length);
});

test("an urgent order with none of its material in the store is given to NO machine — it is said to be unplaced", () => {
  const free = machine();
  const empty = { material: "ABS اسود مخرز", haveKg: 0, needKg: 300, guessed: false };
  const late = order({ code: "late", product: "عظمة قشارة ثوم", dueDate: "2026-09-20", stock: empty });
  const plain = order({ code: "plain" });
  const day = planDay([free], [late, plain], ctx);
  assert.deepEqual(day.unplaced.map((u) => [u.order.code, u.why]), [["late", "noMaterial"]]);
  assert.equal(day.entries[0].pick?.order.code, "plain", "the machine is not kept empty for it");
  // The machine's own list still shows it first, with its red chip: only the
  // day's plan refuses to PICK it.
  assert.deepEqual(codes(free, [late, plain]), ["late", "plain"]);
  assert.equal(planDay([free], [late], ctx).entries[0].pick, null, "nothing else waits: no pick, rather than that one");
  // An order that is not urgent is simply never picked — it is not "unplaced".
  const calm = planDay([free], [order({ code: "no-stock", stock: empty, remaining: 10 }), plain], ctx);
  assert.deepEqual([calm.entries[0].pick?.order.code, calm.unplaced], ["plain", []]);
  // Too little is a warning, not a refusal; and "not known" is never "none".
  const low = planDay([free], [{ ...late, stock: { ...empty, haveKg: 100 } }, plain], ctx);
  assert.deepEqual([low.entries[0].pick?.order.code, low.entries[0].pick?.stock, low.unplaced], ["late", "low", []]);
  assert.equal(planDay([free], [{ ...late, stock: null }, plain], ctx).entries[0].pick?.order.code, "late");
});

test("a machine still RUNNING an order the count says is complete has overrun: it is on the plan like a free one", () => {
  // The opposite of «لا يوجد أمر شغل»: the count says done, the floor has not said so.
  const P = "PQ 5 — 100", Q = "PQ 7 — 100";
  const over = machine({ label: P, state: "running", now: { products: ["غطاء جوان"], order: "made" } });
  const made = order({ code: "made", product: "غطاء جوان", mountedOn: P, mountedRunning: true, remaining: 0, runHours: 0 });
  const next = order({ code: "next" });
  const day = planDay([over], [made, next], ctx);
  assert.deepEqual(day.entries.map((e) => [e.need, e.current?.code, e.pick?.order.code]), [["overrun", "made", "next"]]);
  // It takes a late order before a machine that only ends soon does…
  const soon = machine({ label: Q, state: "running", now: { order: "run-q" } });
  const late = order({ code: "late", dueDate: "2026-09-20" });
  const two = planDay([soon, over], [made, order({ code: "run-q", mountedOn: Q, mountedRunning: true, runHours: 4 }), late], ctx);
  assert.deepEqual(two.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]), [[P, "overrun", "late"], [Q, "soon", null]]);
  // …and a running order with pieces still to make, or a count nobody has, is not one.
  const need = (o: Partial<PlanOrder>) => planDay([over], [{ ...made, ...o }, next], ctx).entries[0].need;
  assert.equal(need({ remaining: 1, runHours: 0.1 }), "soon");
  assert.equal(need({ remaining: null, runHours: null }), "running");
});

test("«ends soon» is on the clock: a Friday before the end is a day in which nothing runs", () => {
  const P = "PQ 5 — 100";
  const m = machine({ label: P, state: "running", now: { order: "run" } });
  const job = (runHours: number | null) => order({ code: "run", mountedOn: P, mountedRunning: true, runHours });
  const abs = order({ code: "abs", product: "روزته سودة العداد الثلاثي", material: "ABS اسود مخرز", dueDate: "2026-10-30" });
  const at = (today: string, hourNow?: number) => ({ today, transparentMachines: [] as string[], hourNow });
  const entry = (runHours: number | null, c: ReturnType<typeof at>) => {
    const [e] = planDay([m], [job(runHours), abs], c).entries;
    return [e.need, e.hoursLeft, e.finishIn, e.pick?.order.code ?? null, e.dryIn];
  };
  assert.equal(SOON_HOURS, 24);
  // Wednesday 7 Oct, noon: twenty hours of running end tomorrow morning —
  // and ABS dries three hours, so it goes in the dryer in seventeen.
  assert.deepEqual(entry(20, at("2026-10-07", 12)), ["soon", 20, 20, "abs", 17]);
  // Thursday 8 Oct, noon: the same twenty hours are twelve today and eight on
  // SATURDAY — forty-four hours away. Not today's decision.
  assert.deepEqual(entry(20, at("2026-10-08", 12)), ["running", 20, 44, null, null]);
  // Ten hours on that Thursday still end before midnight.
  assert.deepEqual(entry(10, at("2026-10-08", 12)), ["soon", 10, 10, "abs", 7]);
  // …but not when the plan is made at 20:00: four hours today, six on Saturday.
  assert.deepEqual(entry(10, at("2026-10-08", 20)), ["running", 10, 34, null, null]);
  // No hour given: noon.
  assert.deepEqual(entry(10, at("2026-10-08")), ["soon", 10, 10, "abs", 7]);
  // Nobody knows how long is left: it is running, with nothing to say about when.
  assert.deepEqual(entry(null, at("2026-10-07", 12)), ["running", null, null, null, null]);
  // A job with two hours left dries nothing "in minus one hour": now.
  assert.deepEqual(entry(2, at("2026-10-07", 12)), ["soon", 2, 2, "abs", 0]);
  // ON the Friday, five hours of running end at five on Saturday morning:
  // the dryer is counted back from the clock, not from the hours of running.
  assert.deepEqual(entry(5, at("2026-10-09", 12)), ["soon", 5, 17, "abs", 14]);
});

test("the day's plan is read top to bottom: finished, free, stopped, overrun, interrupt, soon, down, running", () => {
  const L = (n: number) => `PQ ${n} — 100`;
  const runs = (n: number, o: Partial<PlanOrder> = {}) => order({ code: `run-${n}`, mountedOn: L(n), mountedRunning: true, ...o });
  const busy = (n: number) => machine({ label: L(n), state: "running", now: { order: `run-${n}` } });
  const stop = (n: number, reason: string) => machine({ label: L(n), state: "stopped", stoppage: { reason, since: 0 }, now: { order: "" } });
  const ms = [
    busy(14),                                   // 60 h left
    busy(13),                                   // 200 h left
    busy(12),                                   // runs, nobody knows for how long
    stop(11, "Maintenance"),                    // down
    busy(9),                                    // ends in 3 h
    busy(8),                                    // ends in 10 h
    busy(7),                                    // long job — the only machine the late order goes on
    busy(6),                                    // its order's count is complete
    stop(5, "No material"),
    machine({ label: L(10), state: "unknown" }),
    machine({ label: L(2), state: "idle" }),
    stop(1, NO_ORDER_STOPPAGE),
  ];
  const os = [
    runs(14, { runHours: 60 }), runs(13, { runHours: 200 }), runs(12, { runHours: null }), runs(9, { runHours: 3 }),
    runs(8, { runHours: 10 }), runs(7, { runHours: 100 }), runs(6, { remaining: 0, runHours: 0 }),
    order({ code: "late", dueDate: "2026-09-20", fits: [L(7)] }),
    order({ code: "w1", fits: null }), order({ code: "w2", fits: null }),
  ];
  const plan = planDay(ms, os, ctx);
  assert.deepEqual(plan.entries.map((e) => [e.machine.label, e.need]), [
    [L(1), "finished"],
    [L(2), "free"], [L(10), "free"],            // 2 before 10: by number, not by letter
    [L(5), "stopped"],
    [L(6), "overrun"],
    [L(7), "interrupt"],
    [L(9), "soon"], [L(8), "soon"],             // the one that ends first, whatever its number
    [L(11), "down"],
    [L(14), "running"], [L(13), "running"], [L(12), "running"],   // least left first, unknown last
  ]);
  const pick = (n: number) => plan.entries.find((e) => e.machine.label === L(n))!.pick?.order.code ?? null;
  assert.equal(pick(7), "late");
  // The two waiting orders go to the two machines that need one most.
  assert.deepEqual([pick(1), pick(2), pick(10), pick(5), pick(6), pick(8), pick(9)], ["w1", "w2", null, null, null, null, null]);
  // A machine that is down, or simply running, is never given one.
  assert.deepEqual([pick(11), pick(12), pick(13), pick(14)], [null, null, null, null]);
  assert.deepEqual(plan.unplaced, []);
});

test("Friday is the day off — changes are allowed at night since 2026-10-07", () => {
  assert.equal(isFriday("2026-10-09"), true);
  assert.equal(isFriday("2026-10-08"), false);
  assert.equal(isFriday("2026-10-10"), false);
  assert.equal(isFriday(""), false);
});

test("a stoppage's reason says whether the MACHINE can take a mould — an unknown reason never can", () => {
  assert.equal(stoppageKind(NO_ORDER_STOPPAGE), "finished");
  // The mould is out, or the job's material is: the machine itself is fine.
  for (const r of ["Mold maintenance", "No material"]) assert.equal(stoppageKind(r), "open", r);
  // A repair, a change already in progress, drying, nobody to run it…
  for (const r of ["Maintenance", "Mold change", "Material drying", "No operator", "Setup", "Nozzle burn", "Sprue broken", "Other", "a key nobody knows", ""]) {
    assert.equal(stoppageKind(r), "blocked", r);
  }
  // The keys are COPIED from lib/prod-meta.ts (the rules file imports
  // nothing): every button of the downtime page is sorted here, key by key —
  // a renamed key would otherwise turn «لا يوجد أمر شغل» into "down" unnoticed.
  assert.deepEqual(Object.fromEntries(DOWNTIME_CAPTURE_REASONS.map((r) => [r.key, stoppageKind(r.key)])), {
    "Setup": "blocked", "Nozzle burn": "blocked", "Mold change": "blocked", "Mold maintenance": "open",
    "Maintenance": "blocked", "Material drying": "blocked", "No operator": "blocked", "No material": "open",
    "No order": "finished", "Sprue broken": "blocked", "Other": "blocked",
  });
});

test("working time: Friday is the day off — days to a due date, and hours on the clock", () => {
  // 2026-10-09 is a Friday.
  assert.equal(workingDaysUntil("2026-10-08", "2026-10-08"), 0, "due today");
  assert.equal(workingDaysUntil("2026-10-10", "2026-10-08"), 1, "the Friday between does not count");
  assert.equal(workingDaysUntil("2026-10-09", "2026-10-08"), 0, "due ON the Friday: nothing runs before it");
  assert.equal(workingDaysUntil("2026-10-22", "2026-10-08"), 12, "two weeks, two Fridays");
  // Late is counted the way the customer counts it: calendar days.
  assert.equal(workingDaysUntil("2026-10-03", "2026-10-08"), -5);
  assert.equal(workingDaysUntil("", "2026-10-08"), null);
  assert.equal(workingDaysUntil("2026-10-10", ""), null);

  // Thursday noon: 12 hours of today are left, then a Friday of nothing.
  assert.equal(calendarHours(5, "2026-10-08", 12), 5);
  assert.equal(calendarHours(12, "2026-10-08", 12), 12);
  assert.equal(calendarHours(20, "2026-10-08", 12), 44);
  assert.equal(calendarHours(5, "2026-10-09", 12), 17, "on the Friday itself nothing runs until midnight");
  assert.equal(calendarHours(30, "2026-10-06"), 30, "no Friday in the way; noon when no hour is given");
  assert.equal(calendarHours(300, "2026-10-06", 8), 300 + 2 * 24, "two Fridays inside twelve and a half days of running");
  assert.equal(calendarHours(0, "2026-10-08"), 0);
  assert.equal(calendarHours(40, ""), 40, "no day to walk from: the hours as they are");
  // Across the Friday, hour by hour: Thursday 20:00 leaves four hours of today.
  assert.equal(calendarHours(4, "2026-10-08", 20), 4, "done at midnight, before the day off");
  assert.equal(calendarHours(4.5, "2026-10-08", 20), 4.5 + 24, "half an hour short: it waits out the whole Friday");
  assert.equal(calendarHours(24, "2026-10-09", 0), 48, "a full day of running, asked at the first minute of the Friday");
  // A quantity typed with three zeros too many must not spin, and a clock
  // that is not a clock is read as noon.
  assert.equal(calendarHours(144_000, "2026-10-06", 12), 144_000 + 1000 * 24, "a thousand weeks, a thousand Fridays");
  assert.equal(calendarHours(5, "2026-10-08", Number.NaN), 5);
});

test("at risk = WILL be late: the running left does not fit in the working days before the date", () => {
  const at = (o: Partial<PlanOrder>) => orderUrgency(order({ code: "x", dueDate: "2026-10-10", ...o }), "2026-10-08");
  // One working day (the Friday is off) is 24 hours of running.
  assert.equal(at({ runHours: 40 }).atRisk, true);
  assert.equal(at({ runHours: 24 }).atRisk, false);
  assert.equal(at({ runHours: null }).atRisk, false, "unknown hours are never 'at risk'");
  assert.equal(at({ runHours: 40, dueDate: "" }).atRisk, false);
  const late = at({ runHours: 40, dueDate: "2026-10-01" });
  assert.deepEqual([late.late, late.atRisk], [7, false], "late already is late, not at risk");
  assert.equal(rankFor(machine(), [order({ code: "x", dueDate: "2026-10-01", runHours: 40 })], ctx).ranked[0].atRisk, true, "…and the suggestion carries it");
});

test("material in the store: unknown is never 'none', and a need that cannot be worked out is not 'low'", () => {
  const st = (haveKg: number, needKg: number | null) => order({ code: "x", stock: { material: "بروبلين", haveKg, needKg, guessed: false } });
  assert.equal(stockState(order({ code: "x" })), "unknown");
  assert.equal(stockState(st(0, 120)), "none");
  assert.equal(stockState(st(80, 120)), "low");
  assert.equal(stockState(st(120, 120)), "ok");
  assert.equal(stockState(st(80, null)), "ok");
  assert.equal(rankFor(machine(), [st(80, 120)], ctx).ranked[0].stock, "low");
  assert.equal(rankFor(machine(), [st(0, 120)], ctx).blocked.length, 0, "the ranking never blocks on stock");
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
  assert.ok(cell.startsWith(`grid ${MAP_COLS}x${MAP_MAX_ROWS} ; wide ; `), cell.slice(0, 30));
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
  tiles = placeTile(tiles, "PQ 9 — 140", { c: MAP_COLS, r: 13 })!;
  assert.equal(at(tiles, "PQ 9 — 140")?.c, MAP_COLS - MAP_TILE.w + 1);
  // A drag hands in fractions of a unit: they snap to the nearest one —
  // 56 places across where the first map had seven.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: 30.4, r: 12.6 })!;
  assert.deepEqual([at(tiles, "PQ 9 — 140")?.c, at(tiles, "PQ 9 — 140")?.r], [30, 13]);
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

// The owner's own arrangement of 2026-10-06, exactly as he saved it from his
// phone: two columns of presses in the left 33 units of the sheet, PQ 1 beside
// them, the two 280s along the bottom — a floor standing TALL.
const FLOOR_TALL = "grid 56x32 ; PQ 1 — 550@1,9,9,5 ; PQ 13 — 150@10,1,11,4 ; PQ 11 — 180@10,5,11,4 ; PQ 9 — 140@10,9,11,4 ; "
  + "PQ 7 — 100@10,13,11,4 ; PQ 5 — 100@10,17,11,4 ; PQ 4 — 138@10,21,11,4 ; PQ 14 — 180@24,1,10,4 ; PQ 12 — 180@24,5,10,4 ; "
  + "PQ 10 — 150@24,9,10,4 ; PQ 8 — 138@24,13,10,4 ; PQ 6 — 220@24,17,10,4 ; PQ 2 — 280@2,28,15,4 ; PQ 3 — 280@19,28,15,4";
const heightOf = (fit: ReturnType<typeof fitFloor>) => fit.rowFr.reduce((x, y) => x + y, 0) * fit.unitH;

test("the map itself is landscape: a floor saved standing tall is read turned a quarter — turned, never mirrored", () => {
  const tiles = parseLayout(FLOOR_TALL);
  assert.equal(tiles.length, 14);
  assert.equal(validLayout(tiles), true);
  assert.equal(standsTall(tiles), false, "more machines across it than down it now");
  const p = (label: string) => at(tiles, label)!;
  // Its top went to the LEFT — the way a phone is turned sideways: the line
  // that ran down the sheet now runs across it, in the same order.
  const line = ["PQ 13 — 150", "PQ 11 — 180", "PQ 9 — 140", "PQ 7 — 100", "PQ 5 — 100", "PQ 4 — 138"].map(p);
  for (let i = 1; i < line.length; i++) {
    assert.equal(line[i].r, line[0].r);
    assert.equal(line[i].c, line[i - 1].c + line[i - 1].w, "what touched still touches");
  }
  // What was on the RIGHT is now above, what was on the left below, what was
  // at the bottom at the right end: a turn. (A mirror would put PQ 1 on top.)
  assert.ok(p("PQ 14 — 180").r + p("PQ 14 — 180").h <= p("PQ 13 — 150").r);
  assert.equal(p("PQ 14 — 180").c, p("PQ 13 — 150").c);
  assert.ok(p("PQ 1 — 550").r >= p("PQ 13 — 150").r + p("PQ 13 — 150").h);
  assert.ok(p("PQ 2 — 280").c >= p("PQ 4 — 138").c + p("PQ 4 — 138").w && p("PQ 3 — 280").c === p("PQ 2 — 280").c);
  assert.ok(p("PQ 3 — 280").r < p("PQ 2 — 280").r, "PQ 3 stood right of PQ 2, so it is above it");
  // The ordinary machine has the ordinary tile again.
  assert.deepEqual([p("PQ 13 — 150").w, p("PQ 13 — 150").h], [MAP_TILE.w, MAP_TILE.h]);

  // Reading the same cell again gives the same floor; and once it is SAVED
  // wide it is never turned again — whatever shape he arranges after that.
  assert.deepEqual(parseLayout(FLOOR_TALL), tiles);
  assert.deepEqual(parseLayout(formatLayout(tiles)), tiles);
  const tall = "grid 56x32 ; wide ; A — 1@1,1,7,10 ; B — 2@1,11,7,10 ; C — 3@1,21,7,10";
  assert.deepEqual(parseLayout(tall).map((t) => t.r), [1, 11, 21]);
  assert.deepEqual(parseLayout(tall.replace("wide ; ", "")).map((t) => t.r), [1, 1, 1], "the same three, saved before: laid across");
});

test("turning the map in the editor: a quarter each press, upside down is lossless, four presses are back", () => {
  const base = parseLayout(FLOOR_TALL.replace("grid 56x32 ; ", "grid 56x32 ; wide ; "));
  assert.equal(standsTall(base), true);
  assert.deepEqual(turnLayout(base, 0), base);
  assert.deepEqual(turnLayout(base, 4), base);
  const p = (tiles: MapTile[], label: string) => at(tiles, label)!;
  // Clockwise: the top goes to the right — PQ 13 (top of its line) ends right of PQ 4.
  const cw = turnLayout(base, 1), ccw = turnLayout(base, 3);
  for (const t of [cw, ccw]) { assert.equal(t.length, 14); assert.equal(validLayout(t), true); assert.equal(standsTall(t), false); }
  assert.ok(p(cw, "PQ 13 — 150").c > p(cw, "PQ 4 — 138").c);
  assert.ok(p(ccw, "PQ 13 — 150").c < p(ccw, "PQ 4 — 138").c);
  assert.ok(p(cw, "PQ 1 — 550").r < p(cw, "PQ 13 — 150").r, "clockwise, what was on the left is on top");
  // Upside down keeps every size and is undone by itself.
  const flip = turnLayout(base, 2);
  assert.equal(validLayout(flip), true);
  assert.deepEqual([p(flip, "PQ 2 — 280").w, p(flip, "PQ 2 — 280").h], [15, 4]);
  assert.ok(p(flip, "PQ 2 — 280").r < p(flip, "PQ 13 — 150").r);
  assert.deepEqual(turnLayout(flip, 2).map((t) => `${t.label}@${t.c},${t.r},${t.w},${t.h}`).sort(), base.map((t) => `${t.label}@${t.c},${t.r},${t.w},${t.h}`).sort());
  assert.deepEqual(turnLayout([], 1), []);
});

test("a phone held sideways gets the whole floor on its screen: nothing pans, every machine can be read", () => {
  const tiles = parseLayout(FLOOR_TALL);
  for (const [w, h] of [[800, 290], [915, 330], [640, 270]]) {
    const fit = fitFloor(tiles, w, { fill: h });
    assert.equal(fit.pans, false);
    assert.ok(Math.abs(fit.width - w) < 0.01);
    assert.ok(heightOf(fit) <= h + 0.01, `${Math.round(heightOf(fit))} of ${h}`);
    assert.ok(fit.width > heightOf(fit) * 2, "landscape");
    for (const t of tiles) {
      assert.ok(tileWidthPx(fit, t) >= 88, `${t.label} is ${Math.round(tileWidthPx(fit, t))}px wide in ${w}`);
      assert.ok(tileHeightPx(fit, t) >= 68, `${t.label} is ${Math.round(tileHeightPx(fit, t))}px tall in ${h}`);
    }
  }
  // On a big screen a tile is not stretched into a pillar.
  const big = fitFloor(tiles, 1400, { fill: 2000 });
  assert.ok(heightOf(big) < 1400);
  // Before the frame is measured nothing blows up.
  assert.equal(fitFloor(tiles, 0, { fill: 0 }).unitH, 0);
});

test("in the page the plan stays landscape: it fills a desk, and on a phone held upright it pans rather than stand up", () => {
  const tiles = parseLayout(FLOOR_TALL);
  const desk = fitFloor(tiles, 761);
  assert.equal(desk.pans, false);
  assert.ok(Math.abs(desk.width - 761) < 0.01);
  assert.ok(desk.width > heightOf(desk) * 1.5);
  assert.equal(desk.colFr[MAP_COLS - 1], 0, "the empty edge of the sheet is not drawn");
  const phone = fitFloor(tiles, 341);
  assert.equal(phone.pans, true, "fourteen machines across 341px would be 40px each");
  assert.ok(phone.width > heightOf(phone), "…and it is still wider than tall");
  for (const fit of [desk, phone]) {
    for (const t of tiles) {
      assert.ok(tileWidthPx(fit, t) >= MAP_READABLE.stackedW - 0.01, `${t.label} is ${Math.round(tileWidthPx(fit, t))}px wide`);
      assert.ok(tileHeightPx(fit, t) >= MAP_READABLE.stackedH - 0.01, `${t.label} is ${Math.round(tileHeightPx(fit, t))}px tall`);
    }
  }
});

test("a machine too narrow to read makes the sheet pan — and only then", () => {
  // Six presses side by side, each 9 units: 58px each on a phone.
  const row = Array.from({ length: 6 }, (_, i) => ({ label: `P — ${i + 1}`, c: 1 + i * 9, r: 1, w: 9, h: 4 }));
  const fit = fitFloor(row, 342);
  assert.equal(fit.pans, true);
  assert.ok(Math.abs(tileWidthPx(fit, row[0]) - MAP_READABLE.stackedW) < 0.01, "never narrower than a tile that can be read");
  assert.equal(fitFloor(row.slice(0, 3), 342).pans, false);
});

test("the editor always shows the whole sheet, fitted, every unit the same — and the sheet is landscape there too", () => {
  const tiles = parseLayout(FLOOR_TALL);
  for (const frame of [324, 735]) {
    const fit = fitFloor(tiles, frame, { whole: true });
    assert.equal(fit.pans, false);
    assert.deepEqual([fit.colFr.length, fit.rowFr.length], [MAP_COLS, MAP_MAX_ROWS]);
    assert.ok(fit.colFr.every((f) => f === 1) && fit.rowFr.every((f) => f === 1));
    assert.ok(Math.abs(fit.unitW * MAP_COLS - frame) < 0.01);
    assert.ok(fit.unitH >= 7, "a finger has to land on a machine");
    assert.ok(heightOf(fit) < frame, "wider than tall, on a phone as on a desk");
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

/* ------------------------- what the page does with the rules ------------------------ */

/**
 * The page is not run here, so the four places where it had a rule or a number
 * of its OWN (review of 2026-10-07) are pinned on its source and its strings:
 * each one contradicted, or invented on top of, what the rules above decide.
 */
test("the page words what the rules decided \u2014 it has no rule and no number of its own", () => {
  const page = readFileSync(new URL("../app/dashboard/changeover/page.tsx", import.meta.url), "utf8");
  const between = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));

  // 1. A forecast that has run out. The rules say "soon" with nothing left \u2014
  //    an order whose count still shows pieces, every one of them probably made
  //    since the last counted day. The card read "finishes in about 10 min".
  const P = "PQ 5 \u2014 100";
  const spent = order({ code: "run", mountedOn: P, mountedRunning: true, remaining: 5_000, runHours: 0, asOf: "2026-09-28" });
  const [e] = planDay([machine({ label: P, state: "running", now: { order: "run" } })], [spent], ctx).entries;
  assert.deepEqual([e.need, e.hoursLeft, e.finishIn], ["soon", 0, 0]);
  assert.match(page, /e\.need === "soon" && e\.hoursLeft === 0 \? s\.day\.need\.dueNow/);
  for (const lang of ["en", "ar"] as const) assert.doesNotMatch(co[lang].day.need.dueNow, /\{|\d/, `${lang}: words, not a time`);

  // 2. \u00AB\u0631\u0643\u0651\u0628 \u062F\u064A\u00BB on a running machine warns by the RANKING's word (Suggestion.interrupt),
  //    not by "is it a key client": the plan said \u00AB\u064A\u0633\u062A\u0627\u0647\u0644 \u0646\u0641\u0643 \u0627\u0644\u0634\u063A\u0627\u0644\u00BB and the dialog said no.
  assert.match(page, /const interrupting = machine\.state === "running" && !pick\.interrupt && !o\.queuedBehind;/);
  for (const lang of ["en", "ar"] as const) {
    for (const text of [co[lang].confirm.runningWarn, co[lang].rank.busyNote]) {
      assert.match(text, lang === "en" ? /late or will be late/ : /\u0645\u062A\u0623\u062E\u0631 \u0623\u0648 \u0647\u064A\u062A\u0623\u062E\u0631/, `${lang}: a late order takes a running mould off too`);
      assert.match(text, lang === "en" ? /went on today/ : /\u0631\u0627\u0643\u0628 \u0645\u0646 \u0627\u0644\u0646\u0647\u0627\u0631\u062F\u0629/, `${lang}: never a mould that went on today`);
    }
  }

  // 3. A store material that is only a GUESS is said to be one wherever it reads "none" or
  //    "short" \u2014 and the urgent order it leaves with no machine can be answered for in place.
  const unplaced = between("dayPlan.unplaced.map(", "day.length === 0");
  assert.match(unplaced, /why === "noMaterial" && stockGuessNote\(o\)/);
  assert.match(unplaced, /onClick=\{\(\) => setOrderForm\(o\)\} disabled=\{!canWrite\}/);
  assert.match(between("const card = (", "const dayCard = ("), /stockGuessNote\(o\)/);
  assert.match(between("const dayCard = (", "const needNow ="), /stockGuessNote\(sg\.order\)/);

  // 4. Where the mould is: said on a day card whose order's mould stands on ANOTHER machine,
  //    and under an urgent order the plan holds with a stopped one.
  assert.match(between("const DAY_CHIPS", "]);"), /"mountedElsewhere"/);
  assert.match(unplaced, /why === "noMachine" && on &&/);

  // \u2026and the question form reads the supervisor's ANSWER, not only what the store makes of it.
  assert.match(between("function OrderForm(", "async function save()"), /order\.storeMaterial/);
});
