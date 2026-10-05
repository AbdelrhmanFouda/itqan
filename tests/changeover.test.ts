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
  ANY_COLOUR, CHANGEOVER_NUMBERS, MAP_COLS, MISSING_ITEMS, NOTHING_MISSING,
  answersFor, bestStart, colourKey, colourRelation, colourToSheet, coloursFromSheet, coloursIn, coloursToSheet,
  darkestColour, dryingFor, estimateChange, formatLayout, guessColour, isNightHour, isRecent, kindFromSheet,
  kindToSheet, latestRuns, listFromSheet, listToSheet, machineKey, machineState, mapRows, materialFamily, mergeAnswers,
  missingFromSheet, missingToSheet, parseLayout, parseYesNo, placeTile, rankFor, removeTile, resolveNow,
  safeText, splitMinutes, standingFromLog, validLayout,
  type MapTile, type PlanMachine, type PlanOrder,
} from "../lib/changeover.ts";

const machine = (o: Partial<PlanMachine> & { now?: Partial<PlanMachine["now"]> } = {}): PlanMachine => ({
  label: "PQ 5 — 100", tonnage: "100", state: "idle", stoppage: null, transparentOnly: false, bigMachine: false,
  ...o,
  now: {
    products: ["غطاء"], colours: ["white"], colourNow: "", coloursGuessed: false, material: "بروبلين بيور", order: "",
    source: "production", since: "2026-10-01", shift: "الصباحية", ...(o.now ?? {}),
  },
});
const order = (o: Partial<PlanOrder> & { code: string }): PlanOrder => ({
  id: o.code, product: `منتج ${o.code}`, client: "عميل", material: "بروبلين", dueDate: "2026-10-20", status: "Not Started",
  qtyKg: 100, remaining: 50_000, runHours: 40, colours: ["white"], colourSource: "answer",
  fits: ["PQ 5 — 100", "PQ 7 — 100"], fitsHint: [], fitsHintText: "", workers: null, oilCores: null, missing: [],
  keyClient: false, mountedOn: "", mountedRunning: false,
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

test("a machine running several colours is cleaned of the DARKEST one", () => {
  assert.equal(darkestColour(["white", "black", "grey"]), "black");
  assert.equal(darkestColour(["transparent"]), "transparent");
  assert.equal(darkestColour([]), "");
  assert.equal(darkestColour([ANY_COLOUR]), "");
  // An unlisted colour has no rank — returned as it is, so it compares as unknown.
  assert.equal(darkestColour(["white", "فوشيا"]), "فوشيا");
});

test("an order in several colours starts with the one that is easiest after what is on the machine", () => {
  const from = { product: "أ", colour: "white", material: "بروبلين" };
  const r = bestStart(from, { product: "ب", colours: ["black", "white", "grey"], material: "بروبلين" });
  assert.equal(r.startColour, "white");
  assert.equal(r.estimate.ease, "same");
  // After black, nothing lighter is easy: black itself is the start.
  assert.equal(bestStart({ ...from, colour: "black" }, { product: "ب", colours: ["white", "black"], material: "بروبلين" }).startColour, "black");
  // No colours at all is one estimate, colour unknown.
  const none = bestStart(from, { product: "ب", colours: [], material: "بروبلين" });
  assert.equal(none.startColour, "");
  assert.equal(none.estimate.ease, "unknown");
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
  assert.deepEqual(r.byMachine.get(machineKey("PQ 9 — 140")), { date: "2026-10-04", shift: "الصباحية", products: ["الثلاثية"] });
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

test("the shift log and a confirm on this page: whichever is newer is what stands on the machine", () => {
  const run = { date: "2026-10-04", shift: "الصباحية", products: ["الثلاثية"] };
  const plan = (o: Partial<{ date: string; products: string[]; colours: string[]; order: string; material: string }>) =>
    ({ date: "2026-10-01", products: ["غطاء"], colours: ["red"], order: "Job 9", material: "", ...o });

  // Nothing confirmed: the log speaks, and it knows no colours.
  assert.deepEqual(resolveNow(null, run, "قديم"), { products: ["الثلاثية"], colours: [], order: "", material: "", source: "production", since: "2026-10-04", shift: "الصباحية" });
  // An OLD confirm for another product: the machine has moved on.
  assert.equal(resolveNow(plan({}), run, "").products[0], "الثلاثية");
  assert.deepEqual(resolveNow(plan({}), run, "").colours, []);
  // A confirm for the SAME product: the log dates it, the confirm supplies colours and order.
  const same = resolveNow(plan({ products: ["الثلاثية"] }), run, "");
  assert.deepEqual([same.source, same.since, same.colours, same.order], ["production", "2026-10-04", ["red"], "Job 9"]);
  // A confirm NEWER than the log: a mould went up and has not been logged yet.
  const newer = resolveNow(plan({ date: "2026-10-05" }), run, "");
  assert.deepEqual([newer.source, newer.products, newer.since], ["plan", ["غطاء"], "2026-10-05"]);
  // No log at all: the registry's stale cell is better than nothing, and says so.
  assert.equal(resolveNow(null, null, " كرسي ").source, "registry");
  assert.deepEqual(resolveNow(null, null, " كرسي ").products, ["كرسي"]);
  assert.equal(resolveNow(null, null, "").source, "none");
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
  const plan = { date: "2026-10-05", products: ["كفر شفاف فوكس"], colours: ["transparent"], order: "Job 494", material: "" };
  const atPlan = { date: "2026-10-04", shift: "الصباحية", products: ["كفر شفاف فوكس 2"] };

  // Two more days of the same mould: the tie stands, dated by the newest shift.
  const later = { date: "2026-10-07", shift: "المسائية", products: ["كفر شفاف فوكس 2"] };
  const kept = resolveNow(plan, later, "", atPlan);
  assert.deepEqual([kept.source, kept.products, kept.order, kept.colours, kept.since, kept.shift],
    ["plan", ["كفر شفاف فوكس"], "Job 494", ["transparent"], "2026-10-07", "المسائية"]);

  // The log moves to another mould: the machine was changed without telling
  // the page, and the log is right.
  const moved = resolveNow(plan, { date: "2026-10-08", shift: "الصباحية", products: ["عدسة شفافة فوكس"] }, "", atPlan);
  assert.deepEqual([moved.source, moved.products, moved.order, moved.colours], ["production", ["عدسة شفافة فوكس"], "", []]);

  // The morning shift of the confirm's own day ran the OLD mould and is typed
  // up later: still the same product as before the change — the confirm stands.
  const sameDay = { date: "2026-10-05", shift: "الصباحية", products: ["كفر شفاف فوكس 2"] };
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

test("transparent is free to go anywhere until a machine is kept for it, and that machine prefers it", () => {
  const clear = order({ code: "clear", colours: ["transparent"] });
  assert.deepEqual(codes(machine(), [clear]), ["clear"], "no machine marked: nothing is blocked");

  const lens = machine({ label: "PQ 7 — 100", transparentOnly: true, now: { products: ["عدسة"], colours: ["transparent"], material: "PC شفاف" } });
  const c = { today: "2026-09-30", transparentMachines: ["PQ 7 — 100"] };
  const r = rankFor(lens, [order({ code: "coloured", colours: ["black"] }), clear], c);
  assert.deepEqual(r.ranked.map((s) => s.order.code), ["clear", "coloured"]);
  assert.ok(r.ranked[1].chips.some((x) => x.key === "transparentMachine"));

  // An order made in transparent AND a colour is not "all transparent": it is
  // not shut out of the other machines.
  const mixed = order({ code: "mixed", colours: ["transparent", "white"] });
  assert.deepEqual(rankFor(machine(), [mixed], c).blocked, []);
});

test("on a running machine only a key client is worth taking the mould off", () => {
  const r = rankFor(machine({ state: "running" }), [order({ code: "key", keyClient: true }), order({ code: "plain" })], ctx);
  assert.ok(r.ranked[0].chips.some((c) => c.key === "worthInterrupt"));
  // "The machine is running" is said once above the list, not on every card.
  assert.equal(r.ranked[1].chips.some((c) => c.key === "worthInterrupt" || c.key === "machineBusy"), false);
});

test("an order in several colours is ranked on its easiest start, and the card says which", () => {
  const m = machine({ now: { colours: ["white", "grey"] } }); // cleaned of grey
  const [s] = rankFor(m, [order({ code: "x", colours: ["white", "black", "grey"] })], ctx).ranked;
  assert.equal(s.startColour, "grey");
  assert.equal(s.estimate.colour, "same");
  assert.deepEqual(s.chips.find((c) => c.key === "startWith")?.vars, { colour: "grey" });
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

test("whether the mould belongs here sorts the list first — even above a key client", () => {
  // Twenty-odd orders wait at once (live, 2026-10-05); most were never going
  // on this machine. Master's tonnage is only a hint, but it orders the list.
  const m = machine({ label: "PQ 1 — 550", tonnage: "550" });
  const r = rankFor(m, [
    order({ code: "elsewhere-key", fits: null, fitsHint: ["PQ 12 — 180"], fitsHintText: "180", keyClient: true }),
    order({ code: "unknown", fits: null }),
    order({ code: "hinted-here", fits: null, fitsHint: ["PQ 1 — 550"], fitsHintText: "550" }),
    order({ code: "answered-here", fits: ["PQ 1 — 550", "PQ 2 — 280"], colours: ["black"] }),
    // Master names a tonnage no machine has any more («158»): still "elsewhere".
    order({ code: "old-tonnage", fits: null, fitsHint: [], fitsHintText: "158" }),
  ], ctx).ranked;
  assert.deepEqual(r.map((s) => [s.order.code, s.fit]), [
    ["hinted-here", "here"], ["answered-here", "here"], ["unknown", "unknown"],
    ["elsewhere-key", "elsewhere"], ["old-tonnage", "elsewhere"],
  ]);
});

test("an order with no colour is ranked, flagged, and never treated as easy", () => {
  const [s] = rankFor(machine(), [order({ code: "x", colours: [], colourSource: "" })], ctx).ranked;
  assert.equal(s.estimate.ease, "unknown");
  assert.ok(s.chips.some((c) => c.key === "colourUnknown"));
  assert.equal(s.needsAnswers, true);
});

/* ----------------------------------- the map -------------------------------- */

// The owner's sketch of 2026-10-05, as it was entered.
const FLOOR = "PQ 13 — 150@3,1,2,1 ; PQ 14 — 180@6,1,2,1 ; PQ 1 — 550@1,3,2,2 ; PQ 2 — 280@1,7,4,1 ; PQ 3 — 280@5,7,3,1";

test("the floor map is one cell: it parses, and writes back the same", () => {
  const tiles = parseLayout(FLOOR);
  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles[2], { label: "PQ 1 — 550", c: 1, r: 3, w: 2, h: 2 });
  assert.equal(formatLayout(tiles), FLOOR);
  assert.equal(validLayout(tiles), true);
  assert.equal(mapRows(tiles), 7);
  assert.deepEqual(parseLayout(""), []);
});

test("a damaged map cell loses the bad tile, not the map", () => {
  const tiles = parseLayout("PQ 1 — 550@1,3,2,2 ; nonsense ; PQ 2 — 280@1,x,4,1 ; PQ 3 — 280@9,7,3,1 ; PQ 1 - 550@4,4,1,1 ; PQ 4 — 138@٣,٦,٢,١");
  assert.deepEqual(tiles.map((t) => t.label), ["PQ 1 — 550", "PQ 4 — 138"], "bad numbers, off the grid and a second copy are dropped");
  assert.deepEqual(tiles[1], { label: "PQ 4 — 138", c: 3, r: 6, w: 2, h: 1 }, "Arabic digits are read");
});

test("placing a machine: it is pulled inside the grid, and never stacked on another", () => {
  let tiles: MapTile[] = parseLayout(FLOOR);
  // A new machine drops in at the default size.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: 3, r: 3 })!;
  assert.deepEqual(tiles.find((t) => t.label === "PQ 9 — 140"), { label: "PQ 9 — 140", c: 3, r: 3, w: 2, h: 1 });
  // Moving keeps its size; hanging over the right edge is pulled back in.
  tiles = placeTile(tiles, "PQ 9 — 140", { c: MAP_COLS, r: 5 })!;
  assert.equal(tiles.find((t) => t.label === "PQ 9 — 140")?.c, MAP_COLS - 1);
  // Onto another machine: refused, and nothing moved.
  assert.equal(placeTile(tiles, "PQ 9 — 140", { c: 1, r: 3 }), null);
  // Resizing in place is a placement too — and is refused when it would overlap.
  assert.equal(placeTile(tiles, "PQ 2 — 280", { c: 1, r: 7, w: 5 }), null, "PQ 3 is in the way");
  assert.equal(placeTile(tiles, "PQ 1 — 550", { c: 1, r: 3, h: 3 })!.find((t) => t.label === "PQ 1 — 550")?.h, 3);
  assert.equal(validLayout(tiles), true);
  assert.equal(removeTile(tiles, "PQ 9 - 140").some((t) => t.label === "PQ 9 — 140"), false);
});

test("a layout with two machines on one square, or one machine twice, is not valid", () => {
  const a = { label: "PQ 1 — 550", c: 1, r: 1, w: 2, h: 2 };
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: 2, r: 2, w: 2, h: 1 }]), false);
  assert.equal(validLayout([a, { label: "PQ 1 - 550", c: 5, r: 5, w: 1, h: 1 }]), false);
  assert.equal(validLayout([a, { label: "PQ 2 — 280", c: 7, r: 1, w: 2, h: 1 }]), false, "off the right edge");
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
  assert.equal(safeText("x".repeat(500), 40).length, 40);
});
