/**
 * Work-order rules (lib/work-orders.ts). Run with `npm test`.
 *
 * The fixtures are the LIVE rows of «أوامر العمل» as read through the bridge
 * on 2026-09-09 — the duplicated `Pro/tec 01`, the «ماكينة 100» / «220» /
 * «280» machine cells, the «3.1طن» quantity and the seven undated orders are
 * all real, which is why each rule exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_ORDER_STATUSES, codeKey, compareByDue, daysLate, duplicateCodes, foldWord, groupOrders,
  hasNoDue, isLate, isOpenOrder, machineLabelKey, machineMatch, nextActions, parseQuantity, statusAfter,
} from "../lib/work-orders.ts";
import { JOB_STATUSES } from "../lib/prod-meta.ts";

// «الماكينات»!J on 2026-09-09 — the registry, never hardcoded in app code.
const REGISTRY = [
  "PQ 1 — 550", "PQ 2 — 280", "PQ 3 — 280", "PQ 4 — 138", "PQ 5 — 100", "PQ 6 — 220", "PQ 7 — 100",
  "PQ 8 — 220", "PQ 9 — 140", "PQ 10 — 150", "PQ 11 — 180", "PQ 12 — 180", "PQ 13 — 150", "PQ 14 — 180",
];

/* -------------------------------- statuses -------------------------------- */

test("open = not completed / delivered / a cancelled word; blank is open (not started yet)", () => {
  for (const s of ["Not Started", "In Production", "On Hold", ""]) assert.equal(isOpenOrder(s), true, s);
  for (const s of ["Completed", "Delivered", "ملغي", "ملغى", "مكتمل", "cancelled", "Canceled", "تم التسليم"]) {
    assert.equal(isOpenOrder(s), false, s);
  }
  // an unknown word a colleague typed stays OPEN — hiding it would drop an order from the list
  assert.equal(isOpenOrder("قيد المراجعة"), true);
});

test("the open statuses are three of the four canonical tokens, and Completed is the fourth", () => {
  assert.deepEqual([...OPEN_ORDER_STATUSES].sort(), JOB_STATUSES.filter((s) => s !== "Completed").sort());
});

test("foldWord folds the spellings that are not meaningful in a status cell", () => {
  assert.equal(foldWord("ملغى"), foldWord("ملغي"));
  assert.equal(foldWord("  مُكتمل "), foldWord("مكتمل"));
  assert.equal(foldWord("ملغاة"), foldWord("ملغاه"));
});

/* -------------------------------- job codes ------------------------------- */

test("codeKey folds digits, case and whitespace; filler is no code at all", () => {
  assert.equal(codeKey("Pro/tec 01"), codeKey("pro/tec  01"));
  assert.equal(codeKey("Pro/tec ٠١"), codeKey("Pro/tec 01"));
  assert.notEqual(codeKey("Pro/tec 01"), codeKey("Pro/tec 02"));
  for (const f of ["", " ", "-", "غير متاح / N/A", "n/a"]) assert.equal(codeKey(f), "", JSON.stringify(f));
});

test("duplicateCodes finds the live Pro/tec 01 pair and nothing else", () => {
  const jobs = [
    { id: "2", code: "1/1/26" }, { id: "3", code: "2/1/26" }, { id: "14", code: "Ma-01" },
    { id: "15", code: "Pro/tec 01" }, { id: "16", code: "Pro/tec 01" },
    { id: "17", code: "" }, { id: "18", code: "-" },
  ];
  assert.deepEqual(duplicateCodes(jobs), [{ key: "pro/tec 01", code: "Pro/tec 01", ids: ["15", "16"] }]);
});

/* -------------------------------- quantities ------------------------------ */

test("a quantity cell is a plain number in the column's unit, or it is unreadable", () => {
  assert.deepEqual(parseQuantity("3100"), { value: 3100, unreadable: false, raw: "3100" });
  assert.deepEqual(parseQuantity("3,100"), { value: 3100, unreadable: false, raw: "3,100" });
  assert.deepEqual(parseQuantity(" 30 "), { value: 30, unreadable: false, raw: "30" });
  assert.deepEqual(parseQuantity("٥٠٠"), { value: 500, unreadable: false, raw: "٥٠٠" });
  assert.deepEqual(parseQuantity("12.5"), { value: 12.5, unreadable: false, raw: "12.5" });
  assert.deepEqual(parseQuantity(1400), { value: 1400, unreadable: false, raw: "1400" });
});

test("«3.1طن» is UNREADABLE — never 3.1, never 3,100", () => {
  const q = parseQuantity("3.1طن");
  assert.equal(q.value, null);
  assert.equal(q.unreadable, true);
  for (const s of ["كتير", "30 كجم", "1400kg", "١٤ك", "4.5ك"]) {
    assert.equal(parseQuantity(s).unreadable, true, s);
    assert.equal(parseQuantity(s).value, null, s);
  }
});

test("blank and filler are no quantity, and NOT unreadable — nothing was typed", () => {
  for (const s of ["", "-", "—", "غير متاح / N/A", undefined, null]) {
    assert.deepEqual(parseQuantity(s), { value: null, unreadable: false, raw: s ? String(s) : "" }, String(s));
  }
});

/* -------------------------------- machines -------------------------------- */

test("a registry label matches itself, with any dash and any spacing; the registry's spelling is returned", () => {
  assert.deepEqual(machineMatch("PQ 7 — 100", REGISTRY), { matched: true, label: "PQ 7 — 100" });
  assert.deepEqual(machineMatch("PQ 7 - 100", REGISTRY), { matched: true, label: "PQ 7 — 100" });
  assert.deepEqual(machineMatch("PQ7—100", REGISTRY), { matched: true, label: "PQ 7 — 100" });
  assert.deepEqual(machineMatch("pq 12 – 180", REGISTRY), { matched: true, label: "PQ 12 — 180" });
  assert.equal(machineLabelKey("PQ 7 — 100"), machineLabelKey("PQ 7 - 100"));
});

test("the live legacy cells do not match — tonnage alone is ambiguous and is never guessed", () => {
  for (const v of ["ماكينة 100", "220", "280", "100", "PQ 99 — 100"]) {
    const m = machineMatch(v, REGISTRY);
    assert.equal(m.matched, false, v);
    assert.equal(m.label, v, "an unmatched value is shown as it is, never rewritten");
  }
  assert.deepEqual(machineMatch("", REGISTRY), { matched: false, label: "" });
});

/* ------------------------------- lateness --------------------------------- */

test("late = open AND due before today; a done order is never late; no due date is its own state", () => {
  const today = "2026-09-09";
  assert.equal(isLate({ status: "In Production", dueDate: "2026-08-23" }, today), true);
  assert.equal(isLate({ status: "Completed", dueDate: "2026-08-23" }, today), false);
  assert.equal(isLate({ status: "In Production", dueDate: "2026-09-09" }, today), false, "due today is not late");
  assert.equal(isLate({ status: "Not Started", dueDate: "" }, today), false);
  assert.equal(hasNoDue({ status: "Not Started", dueDate: "" }), true);
  assert.equal(hasNoDue({ status: "Completed", dueDate: "" }), false, "a finished order needs no due date");
  assert.equal(daysLate("2026-08-23", "2026-09-09"), 17);
  assert.equal(daysLate("2026-09-10", "2026-09-09"), -1);
});

/* ------------------------------- grouping --------------------------------- */

const LIVE = [
  { id: "2", code: "1/1/26", status: "On Hold", dueDate: "" },
  { id: "3", code: "2/1/26", status: "Not Started", dueDate: "" },
  { id: "4", code: "3/1/26", status: "Not Started", dueDate: "" },
  { id: "5", code: "4/1/26", status: "Not Started", dueDate: "" },
  { id: "6", code: "5/1/26", status: "In Production", dueDate: "" },
  { id: "7", code: "6/1/26", status: "Not Started", dueDate: "" },
  { id: "8", code: "7/1/26", status: "Not Started", dueDate: "" },
  { id: "14", code: "Ma-01", status: "In Production", dueDate: "2026-08-23" },
  { id: "15", code: "Pro/tec 01", status: "In Production", dueDate: "2026-08-27" },
  { id: "16", code: "Pro/tec 01", status: "In Production", dueDate: "2026-08-23" },
];

test("groups: running first, then not started, then on hold; each by due date with undated LAST", () => {
  const g = groupOrders(LIVE);
  assert.deepEqual(g.map((x) => x.status), ["In Production", "Not Started", "On Hold"]);
  assert.deepEqual(g[0].jobs.map((j) => j.id), ["16", "14", "15", "6"], "23 Aug twice (newest row first), 27 Aug, then the undated one");
  assert.deepEqual(g[1].jobs.map((j) => j.id), ["8", "7", "5", "4", "3"], "all undated → newest row first");
  assert.equal(g.every((x) => x.open), true);
});

test("done orders come last, unknown typed words get their own group before them, empty groups are omitted", () => {
  const g = groupOrders([
    { id: "1", status: "Completed", dueDate: "2026-08-01" },
    { id: "2", status: "Not Started", dueDate: "" },
    { id: "3", status: "قيد المراجعة", dueDate: "2026-09-01" },
    { id: "4", status: "ملغي", dueDate: "" },
  ]);
  assert.deepEqual(g.map((x) => [x.status, x.open]), [
    ["Not Started", true], ["قيد المراجعة", true], ["ملغي", false], ["Completed", false],
  ]);
});

test("compareByDue: due ascending, undated last, then newest row", () => {
  const sorted = [
    { id: "1", dueDate: "" }, { id: "2", dueDate: "2026-09-02" }, { id: "3", dueDate: "2026-09-01" }, { id: "9", dueDate: "" },
  ].sort(compareByDue);
  assert.deepEqual(sorted.map((x) => x.id), ["3", "2", "9", "1"]);
});

/* -------------------------------- actions --------------------------------- */

test("one-tap actions per status, and every target is a value «أوامر العمل»!K accepts", () => {
  assert.deepEqual(nextActions("Not Started"), ["start"]);
  assert.deepEqual(nextActions(""), ["start"]);
  assert.deepEqual(nextActions("On Hold"), ["resume"]);
  assert.deepEqual(nextActions("In Production"), ["complete", "hold"]);
  assert.deepEqual(nextActions("Completed"), []);
  assert.deepEqual(nextActions("قيد المراجعة"), [], "an unknown status gets no blind transition");
  for (const a of ["start", "resume", "hold", "complete"] as const) {
    assert.ok(JOB_STATUSES.includes(statusAfter(a)), `${a} → ${statusAfter(a)} is not a sheet value`);
  }
  assert.equal(statusAfter("start"), "In Production", "status is the go-ahead");
});
