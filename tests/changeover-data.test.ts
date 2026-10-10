/**
 * «خطة الاسطمبات» — the SERVER half: which order is on which machine.
 *
 * lib/changeover-data.ts is run for real here, over in-memory tabs
 * (tests/_changeover-harness.ts swaps lib/sheets, lib/jobs and lib/db). Every
 * case is a defect one of the two review passes of 2026-10-05 reproduced —
 * several of them introduced by the fix for an earlier one, which is the
 * reason this file exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fresh, job, reg, setNow, shift, stockLine, stoppage, type Fixture } from "./_changeover-harness.ts";


const D = await import("../lib/changeover-data.ts");
const R = await import("../lib/changeover.ts");
// The page's own stamps are written with this — a test that needs "three hours
// ago" as a stamp asks the same clock rather than assuming Cairo's offset.
const { cairoStamp } = await import("../lib/customer-requests.ts");
// The page's strings — a refusal the engineer can really meet needs its own words there.
const { co } = await import("../lib/i18n.changeover.ts");

const P1 = "PQ 1 — 550", P2 = "PQ 2 — 180", P3 = "PQ 3 — 180";
const NOTE = R.BASELINE_REASON;

/** A floor of three machines; PQ 1 keeps the log's newest date at 4 Oct. */
function floor(now = "2026-10-05T10:00:00Z"): Fixture {
  setNow(now);
  const f = fresh();
  f.tabs.machines = reg([P1, P2, P3]);
  f.tabs.production = [shift("2026-10-04", P1, "كرسي")];
  return f;
}
type Plan = Awaited<ReturnType<typeof D.loadPlan>>;
const M = (p: Plan, label: string) => p.machines.find((m) => m.label === label)!;
const O = (p: Plan, code: string) => p.orders.find((o) => o.code === code)!;
const ranked = (p: Plan, label: string) =>
  R.rankFor(M(p, label), p.orders, { today: p.today, transparentMachines: [] }).ranked;
const logRow = (o: Record<string, string>) => ({
  date: "", machine: "", order: "", toProduct: "", toColour: "", nowColour: "", fromProduct: "", material: "", reasons: "", ...o,
});

test("one product ordered twice: the second order is NEXT on the running mould, on that machine only", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-10-04", P2, "كفر"));
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر", status: "In Production" }), job({ id: "6", code: "Job 11", product: "كفر" })];
  const p = await D.loadPlan();
  assert.equal(M(p, P2).now.order, "Job 10");
  assert.deepEqual([O(p, "Job 10").mountedOn, O(p, "Job 10").mountedRunning], [P2, true]);
  assert.deepEqual([O(p, "Job 11").mountedOn, O(p, "Job 11").mountedRunning, O(p, "Job 11").queuedBehind], [P2, false, "Job 10"]);
  assert.deepEqual(ranked(p, P2).map((s) => s.order.code), ["Job 11"]);
  assert.equal(ranked(p, P2)[0].chips.some((c) => c.key === "sameMouldNext"), true);
  assert.deepEqual(ranked(p, P3), [], "its mould is busy: not offered anywhere else");
});

test("a machine running a PAIR: the other half's order is running too, not 'next on the same mould'", async () => {
  const f = floor();
  for (const d of ["2026-10-03", "2026-10-04"]) f.tabs.production.push(shift(d, P2, "يمين"), shift(d, P2, "شمال"));
  f.jobs = [job({ id: "5", code: "Job 20", product: "يمين", status: "In Production" }), job({ id: "6", code: "Job 21", product: "شمال", status: "In Production" })];
  const p = await D.loadPlan();
  assert.equal(M(p, P2).now.mixedShift, false, "the two ran together the shift before as well");
  for (const code of ["Job 20", "Job 21"]) {
    assert.deepEqual([O(p, code).mountedOn, O(p, code).mountedRunning, O(p, code).queuedBehind], [P2, true, ""], code);
  }
  assert.deepEqual(ranked(p, P2), []);
  assert.deepEqual(ranked(p, P3), []);
});

test("a note written after «ركّب دي» does not send the machine back to idle", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-09-23", P3, "عظمة"));
  f.tabs.changeoverLog = [
    logRow({ date: "2026-10-04 10:05", machine: P3, order: "Job 30", toProduct: "غطاء", toColour: "أبيض | أسود", nowColour: "أبيض", fromProduct: "عظمة", reasons: "عميل مهم" }),
    logRow({ date: "2026-10-05 09:30", machine: P3, order: "Job 30", toProduct: "غطاء", toColour: "أبيض | أسود", nowColour: "أسود", reasons: NOTE }),
  ];
  f.jobs = [job({ id: "5", code: "Job 30", product: "غطاء" })];
  const p = await D.loadPlan();
  const m = M(p, P3);
  assert.deepEqual([m.state, m.now.source, m.now.since, m.now.products, m.now.colourNow], ["running", "plan", "2026-10-04", ["غطاء"], "black"]);
  assert.equal(O(p, "Job 30").mountedRunning, true);
  assert.deepEqual(ranked(p, P2), [], "the running order is not offered to other machines");
});

test("a mould confirmed onto another machine: the one it came off is ASKED, and takes no order", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-10-04", P2, "كفر"), shift("2026-10-04", P3, "غطاء"));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P3, order: "Job 10", toProduct: "كفر", fromProduct: "غطاء", reasons: "متأخر" })];
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 11", product: "كفر" })];
  const p = await D.loadPlan();
  assert.deepEqual([M(p, P3).now.products, M(p, P3).now.source, M(p, P3).state], [["كفر"], "plan", "running"]);
  assert.deepEqual([M(p, P2).now.alsoOn, M(p, P2).state, M(p, P2).now.order], [P3, "idle", ""]);
  // The second order of the product follows the mould to where it IS.
  assert.deepEqual([O(p, "Job 11").mountedOn, O(p, "Job 11").queuedBehind], [P3, "Job 10"]);
  // «لسه هنا» on the old machine — a note naming the product, the same day or later — ends the question.
  f.tabs.changeoverLog.push(logRow({ date: "2026-10-05 11:00", machine: P2, toProduct: "كفر", reasons: NOTE }));
  assert.equal(M(await D.loadPlan(), P2).now.alsoOn, "");
});

test("a note, then the mould is changed later the SAME day: the log wins — and a tie by another spelling holds", async () => {
  const note = logRow({ date: "2026-10-05 09:50", machine: P2, order: "Job 10", toProduct: "كفر", reasons: NOTE });
  const jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 12", product: "عدسة" })];

  const changed = floor("2026-10-07T10:00:00Z");
  changed.tabs.production.push(
    shift("2026-10-04", P2, "كفر 2"),
    shift("2026-10-05", P2, "كفر 2"), shift("2026-10-05", P2, "عدسة"),
    shift("2026-10-05", P2, "عدسة", { shift: "المسائية" }), shift("2026-10-06", P2, "عدسة"),
  );
  changed.tabs.changeoverLog = [note];
  changed.jobs = jobs;
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.source, M(p, P2).now.order], [["عدسة"], "production", "Job 12"]);
  assert.equal(O(p, "Job 10").mountedRunning, false, "the old order is not shown as running for ever");

  const carried = floor("2026-10-07T10:00:00Z");
  carried.tabs.production.push(shift("2026-10-04", P2, "كفر 2"), shift("2026-10-05", P2, "كفر 2"), shift("2026-10-06", P2, "كفر 2"));
  carried.tabs.changeoverLog = [note];
  carried.jobs = jobs;
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.source, M(p, P2).now.order], [["كفر"], "plan", "Job 10"]);
});

test("an order tied to a machine whose log spells the product another way keeps counting what is made", async () => {
  const f = floor();
  f.tabs.production.push(
    shift("2026-09-20", P2, "كفر 2", { goodUnits: "900" }),                 // before the order started
    shift("2026-10-02", P2, "كفر 2", { goodUnits: "1,664" }),
    shift("2026-10-03", P2, "كفر 2", { goodUnits: "720" }),
    shift("2026-10-04", P2, "كفر 2", { goodUnits: "1408" }),
  );
  f.tabs.changeoverLog = [logRow({ date: "2026-10-04 09:50", machine: P2, order: "Job 10", toProduct: "كفر", reasons: NOTE })];
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر", qtyOrdered: 50_000, remaining: 36_000, startDate: "2026-10-01" })];
  const p = await D.loadPlan();
  assert.equal(M(p, P2).now.order, "Job 10");
  assert.equal(O(p, "Job 10").remaining, 36_000 - (1664 + 720 + 1408));
  // A mould that went up AFTER the last logged shift is never credited with
  // the previous mould's pieces.
  const g = floor();
  g.tabs.production.push(shift("2026-10-04", P2, "عظمة", { goodUnits: "5000" }));
  g.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 10", toProduct: "كفر", fromProduct: "عظمة", reasons: "متأخر" })];
  g.jobs = [job({ id: "5", code: "Job 10", product: "كفر", qtyOrdered: 50_000, remaining: 36_000 })];
  assert.equal(O(await D.loadPlan(), "Job 10").remaining, 36_000);
});

test("a probable order under another spelling is ASKED — and «لا», or a mould answered for other machines, stops the asking", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-10-04", P2, "وش سمارت مباشر", { client: "الذكية" }));
  f.tabs.changeoverAnswers = [{ kind: R.kindToSheet("client"), name: "الذكية", keyClient: R.YES }];
  f.jobs = [job({ id: "5", code: "Job 506", product: "وش سمارت جديد مباشر", client: "الذكية" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.order, M(p, P2).now.orderMaybe], ["", "Job 506"]);
  // Whose job is standing here: the shift row's own client — a key client's
  // running job is not one to interrupt, tied order or not.
  assert.equal(M(p, P2).now.keyClient, true);
  assert.equal(ranked(p, P2).some((s) => s.chips.some((c) => c.key === "worthInterrupt")), false);

  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: R.NO_ORDER, toProduct: "وش سمارت مباشر", reasons: NOTE })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.order, M(p, P2).now.orderMaybe], ["", ""]);

  f.tabs.changeoverLog = [];
  f.tabs.changeoverAnswers.push({ kind: R.kindToSheet("mold"), name: "وش سمارت جديد مباشر", fits: P3 });
  assert.equal(M(await D.loadPlan(), P2).now.orderMaybe, "", "the engineer said that mould goes on PQ 3");
});

test("a name Master holds twice: the other customer's order is not tied by name, and reads its own twin's material", async () => {
  const f = floor();
  f.tabs.master = [
    { name: "غطاء احمر", client: "أشرف", material: "بروبلين", machine: "180" },
    { name: "غطاء احمر", client: "الهندي", material: "بولي ايثلين", machine: "550" },
  ];
  f.tabs.production.push(shift("2026-10-04", P2, "غطاء احمر", { client: "أشرف" }));
  f.jobs = [job({ id: "5", code: "Job 40", product: "غطاء احمر", client: "الهندي", masterClient: "أشرف", material: "بروبلين", ambiguous: true })];
  const p = await D.loadPlan();
  assert.equal(M(p, P2).now.order, "", "PQ 2 is running the OTHER customer's cap");
  assert.equal(M(p, P2).now.orderMaybe, "Job 40", "…so it asks instead of deciding");
  const o = O(p, "Job 40");
  assert.deepEqual([o.client, o.material, o.fitsHint, o.mountedOn, o.mountedRunning], ["الهندي", "بولي ايثلين", [P1], "", false]);
});

test("a change inside a shift: only the NEW mould is taken as the machine's until somebody says", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-10-03", P2, "كرسي صغير"), shift("2026-10-04", P2, "كرسي صغير"), shift("2026-10-04", P2, "طبق"));
  f.jobs = [job({ id: "5", code: "Job 50", product: "كرسي صغير", status: "In Production" }), job({ id: "6", code: "Job 51", product: "طبق" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.mixedShift, M(p, P2).now.order], [["طبق", "كرسي صغير"], true, "Job 51"]);
  assert.deepEqual([O(p, "Job 50").mountedOn, O(p, "Job 50").mountedRunning, O(p, "Job 50").queuedBehind], ["", false, ""]);

  // «اتغيّرت — الراكب طبق»: a note naming what stands and what came off.
  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 51", toProduct: "طبق", fromProduct: "كرسي صغير", reasons: NOTE })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.mixedShift], [["طبق"], false]);

  // «الاتنين راكبين»: a note naming both — a pair, and the other order runs alongside.
  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 51", toProduct: "طبق | كرسي صغير", reasons: NOTE })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products.length, M(p, P2).now.mixedShift], [2, false]);
  assert.deepEqual([O(p, "Job 50").mountedOn, O(p, "Job 50").mountedRunning], [P2, true]);
});

test("A → «ركّب دي» B → B is logged → A is logged again: the log wins, with A's order running", async () => {
  const build = (extra: ReturnType<typeof shift>[]) => {
    const f = floor("2026-10-06T10:00:00Z");
    f.tabs.production.push(shift("2026-10-01", P2, "غطاء"), shift("2026-10-02", P2, "غطاء"), ...extra);
    f.tabs.changeoverLog = [logRow({ date: "2026-10-02 10:05", machine: P2, order: "Job B", toProduct: "عدسة", fromProduct: "غطاء", reasons: "عميل مهم" })];
    f.jobs = [job({ id: "5", code: "Job A", product: "غطاء", status: "In Production" }), job({ id: "6", code: "Job B", product: "عدسة" })];
    return f;
  };
  // The interrupted job went back up and nobody tapped the page.
  build([shift("2026-10-03", P2, "عدسة"), shift("2026-10-04", P2, "عدسة"), shift("2026-10-05", P2, "غطاء")]);
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.source, M(p, P2).now.order], [["غطاء"], "production", "Job A"]);
  assert.deepEqual([O(p, "Job A").mountedRunning, O(p, "Job B").mountedRunning], [true, false]);
  // …also when the crew logged the confirmed mould under another spelling in between,
  build([shift("2026-10-03", P2, "عدسة 2"), shift("2026-10-05", P2, "غطاء")]);
  assert.deepEqual(M(await D.loadPlan(), P2).now.products, ["غطاء"]);
  // …and when the mould never went up at all: the log keeps naming A after the confirm's day.
  build([shift("2026-10-03", P2, "غطاء"), shift("2026-10-04", P2, "غطاء")]);
  assert.deepEqual(M(await D.loadPlan(), P2).now.products, ["غطاء"]);
  // While nothing is typed after the confirm's day, the confirm stands — the log is only behind.
  build([]);
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.source, M(p, P2).state], [["عدسة"], "plan", "running"]);
  // And a log that spells the confirmed mould its own way keeps the order tied.
  build([shift("2026-10-03", P2, "عدسة 2"), shift("2026-10-04", P2, "عدسة 2")]);
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.order], [["عدسة"], "Job B"]);
});

test("a pair with a SECOND order for one half: it is next on that mould, not hidden as running", async () => {
  const f = floor();
  for (const d of ["2026-10-03", "2026-10-04"]) f.tabs.production.push(shift(d, P2, "يمين"), shift(d, P2, "شمال"));
  f.jobs = [
    job({ id: "5", code: "Job 20", product: "يمين", status: "In Production" }),
    job({ id: "6", code: "Job 21", product: "شمال", status: "In Production" }),
    job({ id: "7", code: "Job 22", product: "شمال", dueDate: "2026-10-01" }),
  ];
  const p = await D.loadPlan();
  assert.deepEqual([O(p, "Job 21").mountedRunning, O(p, "Job 21").queuedBehind], [true, ""]);
  assert.deepEqual([O(p, "Job 22").mountedOn, O(p, "Job 22").mountedRunning, O(p, "Job 22").queuedBehind], [P2, false, "Job 21"]);
  assert.deepEqual(ranked(p, P2).map((s) => s.order.code), ["Job 22"]);
  assert.deepEqual(ranked(p, P3), []);
});

test("«اتغيّرت» on a machine whose tied order was the OLD mould's records the NEW mould, with no order and no colours", async () => {
  const f = floor();
  f.tabs.jobs = [{ code: "Job 50", product: "كرسي صغير", status: "جاري التشغيل", machine: "" }, { code: "Job 51", product: "طبق", status: "لم يبدأ", machine: "" }];
  f.tabs.production.push(shift("2026-10-03", P2, "كرسي صغير"), shift("2026-10-04", P2, "كرسي صغير"), shift("2026-10-04", P2, "طبق"));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-01 09:00", machine: P2, order: "Job 50", toProduct: "كرسي صغير", toColour: "أسود", nowColour: "أسود", reasons: "متأخر" })];
  f.jobs = [job({ id: "5", code: "Job 50", product: "كرسي صغير", status: "In Production" }), job({ id: "6", code: "Job 51", product: "طبق" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.mixedShift, M(p, P2).now.orderMaybe], [true, ""], "one question at a time");

  // What the page posts for that tap: the new mould, what came off, and — because
  // the tied order is not the new mould's — no order. The server guards it too.
  const tap = { machine: P2, products: ["طبق"], fromProducts: ["كرسي صغير"], colours: [], colourNow: "", fromColours: [], minutes: NaN, reasons: "", baseline: true };
  assert.equal((await D.recordMount({ ...tap, order: "Job 50" }, "t@x")).ok, true);
  const written = f.appends[0].values;
  assert.deepEqual([written.toProduct, written.fromProduct, written.order, written.toColour], ["طبق", "كرسي صغير", "", ""]);

  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.mixedShift, M(p, P2).now.order], [["طبق"], false, "Job 51"]);
  // A later note with nothing in «المنتج السابق» (a «لا», a colour tap) does not bring the old mould back…
  f.tabs.changeoverLog.push(logRow({ date: "2026-10-05 13:00", machine: P2, toProduct: "طبق", toColour: "أبيض", nowColour: "أبيض", reasons: NOTE }));
  assert.deepEqual(M(await D.loadPlan(), P2).now.products, ["طبق"]);
  // …and the next shift, the new mould alone, leaves the new mould's order running.
  f.tabs.production.push(shift("2026-10-05", P2, "طبق"));
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.order, O(p, "Job 50").mountedRunning], [["طبق"], "Job 51", false]);
});

test("a mould an old confirm took off goes back up later: a note does not hide it again", async () => {
  const f = floor("2026-10-05T10:00:00Z");
  f.tabs.production.push(shift("2026-09-20", P2, "ربر"), shift("2026-10-03", P2, "ربر"), shift("2026-10-04", P2, "ربر"), shift("2026-10-04", P2, "روزته"));
  const confirm = logRow({ date: "2026-09-20 10:00", machine: P2, order: "Job R", toProduct: "ربر", fromProduct: "روزته", reasons: "متأخر" });
  f.jobs = [job({ id: "5", code: "Job R", product: "ربر", status: "In Production" }), job({ id: "6", code: "Job Z", product: "روزته" })];
  // A colour tap the next morning: both moulds still show and the question is still asked.
  f.tabs.changeoverLog = [confirm, logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job R", toProduct: "ربر", nowColour: "أسود", reasons: NOTE })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.mixedShift], [["روزته", "ربر"], true]);
  // «الاتنين راكبين»: both stand, nothing more is asked, and both orders are on PQ 2.
  f.tabs.changeoverLog = [confirm, logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job R", toProduct: "ربر | روزته", reasons: NOTE })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products.length, M(p, P2).now.mixedShift], [2, false]);
  assert.deepEqual([O(p, "Job R").mountedOn, O(p, "Job Z").mountedOn], [P2, P2]);
  // The shift of the confirm ITSELF is still cleaned of what came off, note or no note.
  const g = floor("2026-10-05T10:00:00Z");
  g.tabs.production.push(shift("2026-10-03", P2, "روزته"), shift("2026-10-04", P2, "روزته"), shift("2026-10-04", P2, "ربر"));
  g.tabs.changeoverLog = [
    logRow({ date: "2026-10-04 10:00", machine: P2, order: "Job R", toProduct: "ربر", fromProduct: "روزته", reasons: "متأخر" }),
    logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job R", toProduct: "ربر", nowColour: "أسود", reasons: NOTE }),
  ];
  g.jobs = f.jobs;
  assert.deepEqual(M(await D.loadPlan(), P2).now.products, ["ربر"]);
});

test("a mould confirmed onto a machine that last LOGGED the same product, or off a machine standing by its own confirm", async () => {
  // «كفر» ran on PQ 2 in September, then on PQ 3; PQ 3 breaks down and it is confirmed back onto PQ 2.
  const f = floor();
  f.tabs.production.push(shift("2026-09-25", P2, "كفر"), shift("2026-10-03", P3, "كفر"), shift("2026-10-04", P3, "كفر"));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 10", toProduct: "كفر", fromProduct: "", reasons: "متأخر" })];
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 11", product: "كفر" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).state, M(p, P2).now.order, M(p, P2).now.alsoOn], ["running", "Job 10", ""]);
  assert.deepEqual([M(p, P3).now.alsoOn, M(p, P3).now.order], [P2, ""], "the machine it left is asked and takes no order");
  assert.deepEqual([O(p, "Job 11").mountedOn, O(p, "Job 11").queuedBehind], [P2, "Job 10"]);

  // Confirmed on PQ 2 (not logged yet), then confirmed on PQ 3 the next day.
  const g = floor("2026-10-06T10:00:00Z");
  g.tabs.production.push(shift("2026-10-04", P2, "غطاء"), shift("2026-10-04", P3, "طبق"));
  g.tabs.changeoverLog = [
    logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 10", toProduct: "كفر", fromProduct: "غطاء", reasons: "متأخر" }),
    logRow({ date: "2026-10-06 09:00", machine: P3, order: "Job 10", toProduct: "كفر", fromProduct: "طبق", reasons: "متأخر" }),
  ];
  g.jobs = f.jobs;
  p = await D.loadPlan();
  assert.deepEqual([M(p, P3).now.order, M(p, P3).state], ["Job 10", "running"]);
  assert.deepEqual([M(p, P2).now.alsoOn, M(p, P2).now.order, M(p, P2).state], [P3, "", "idle"]);
});

test("what is left follows the engineer's tie, whichever spelling the latest shift carries", async () => {
  const f = floor("2026-10-06T10:00:00Z");
  f.tabs.production.push(
    shift("2026-10-02", P2, "كفر 2", { goodUnits: "1,664" }), shift("2026-10-03", P2, "كفر 2", { goodUnits: "720" }),
    shift("2026-10-04", P2, "كفر 2", { goodUnits: "1408" }), shift("2026-10-05", P2, "كفر", { goodUnits: "1000" }),
  );
  f.tabs.changeoverLog = [logRow({ date: "2026-10-04 09:50", machine: P2, order: "Job 10", toProduct: "كفر", reasons: NOTE })];
  // lib/jobs.ts has already counted the shift typed under the order's own name.
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر", qtyOrdered: 50_000, remaining: 35_000, startDate: "2026-10-01" })];
  const p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.order, O(p, "Job 10").remaining], ["Job 10", 35_000 - 3792]);
});

test("a NOTE as the machine's last row does not pin a mould the log has seen leave", async () => {
  // «ركّب دي» B, a colour tap the next morning, B is logged, then A is logged again.
  const f = floor("2026-10-07T10:00:00Z");
  f.tabs.production.push(shift("2026-10-01", P2, "غطاء"), shift("2026-10-02", P2, "غطاء"),
    shift("2026-10-03", P2, "عدسة"), shift("2026-10-04", P2, "عدسة"), shift("2026-10-05", P2, "غطاء"), shift("2026-10-06", P2, "غطاء"));
  f.tabs.changeoverLog = [
    logRow({ date: "2026-10-02 10:05", machine: P2, order: "Job B", toProduct: "عدسة", toColour: "أبيض", fromProduct: "غطاء", reasons: "عميل مهم" }),
    logRow({ date: "2026-10-03 09:30", machine: P2, order: "Job B", toProduct: "عدسة", toColour: "أبيض | أسود", nowColour: "أسود", reasons: NOTE }),
  ];
  f.jobs = [job({ id: "5", code: "Job A", product: "غطاء", status: "In Production" }), job({ id: "6", code: "Job B", product: "عدسة" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.source, M(p, P2).now.order], [["غطاء"], "production", "Job A"]);
  assert.deepEqual([O(p, "Job A").mountedRunning, O(p, "Job B").mountedRunning], [true, false]);

  // «لا» tapped on a view one day behind — the mould had already changed, and
  // the shifts that say so were typed after the tap.
  const g = floor("2026-10-08T10:00:00Z");
  g.tabs.production.push(shift("2026-10-02", P2, "وش سمارت مباشر"), shift("2026-10-03", P2, "وش سمارت مباشر"),
    shift("2026-10-04", P2, "روزته"), shift("2026-10-05", P2, "روزته"), shift("2026-10-06", P2, "روزته"), shift("2026-10-07", P2, "روزته"));
  g.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: R.NO_ORDER, toProduct: "وش سمارت مباشر", reasons: NOTE })];
  g.jobs = [job({ id: "5", code: "Job Z", product: "روزته" })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.order, O(p, "Job Z").mountedRunning], [["روزته"], "Job Z", true]);

  // A sister product («رشاش 010» → «رشاش 030») is a change, not another spelling.
  const h = floor("2026-10-08T10:00:00Z");
  h.tabs.production.push(shift("2026-10-02", P2, "رشاش 010"), shift("2026-10-03", P2, "رشاش 010"), shift("2026-10-04", P2, "رشاش 010"),
    shift("2026-10-05", P2, "رشاش 030"), shift("2026-10-06", P2, "رشاش 030"), shift("2026-10-07", P2, "رشاش 030"));
  h.tabs.changeoverLog = [logRow({ date: "2026-10-04 09:00", machine: P2, order: "Job S10", toProduct: "رشاش 010", toColour: "أبيض", nowColour: "أبيض", reasons: NOTE })];
  h.jobs = [job({ id: "5", code: "Job S10", product: "رشاش 010", status: "In Production" }), job({ id: "6", code: "Job S30", product: "رشاش 030" })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.order], [["رشاش 030"], "Job S30"]);
  assert.equal(O(p, "Job S10").mountedRunning, false);
});

test("an order written on a PAIR's row is let go when its own half leaves", async () => {
  const f = floor("2026-10-07T10:00:00Z");
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) f.tabs.production.push(shift(d, P2, "يمين"), shift(d, P2, "شمال"));
  for (const d of ["2026-10-04", "2026-10-05", "2026-10-06"]) f.tabs.production.push(shift(d, P2, "شمال"));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-03 10:00", machine: P2, order: "Job 20", toProduct: "يمين | شمال", toColour: "أسود", nowColour: "أسود", reasons: NOTE })];
  f.jobs = [job({ id: "5", code: "Job 20", product: "يمين", status: "In Production" }), job({ id: "6", code: "Job 21", product: "شمال", status: "In Production" })];
  const p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.order], [["شمال"], "Job 21"]);
  assert.equal(O(p, "Job 20").mountedRunning, false, "it is waiting again, and listed");
  assert.equal(ranked(p, P3).some((s) => s.order.code === "Job 20"), true);
});

test("the machine a mould left keeps being asked — after day one, by a note, and across one day", async () => {
  const jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 11", product: "كفر" })];
  // Confirmed on PQ 2, then on PQ 3 the next day — and PQ 3's first shift has now been typed.
  const f = floor("2026-10-07T10:00:00Z");
  f.tabs.production.push(shift("2026-10-04", P2, "غطاء"), shift("2026-10-04", P3, "طبق"), shift("2026-10-06", P3, "كفر"));
  f.tabs.changeoverLog = [
    logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 10", toProduct: "كفر", fromProduct: "غطاء", reasons: "متأخر" }),
    logRow({ date: "2026-10-06 09:00", machine: P3, order: "Job 10", toProduct: "كفر", fromProduct: "طبق", reasons: "متأخر" }),
  ];
  f.jobs = jobs;
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.alsoOn, M(p, P2).now.order], [P3, ""], "it was asked for one day only");
  assert.deepEqual([O(p, "Job 11").mountedOn, O(p, "Job 11").queuedBehind], [P3, "Job 10"]);

  // PQ 2 stands by a NOTE (an order tied under another spelling), then the mould is confirmed onto PQ 3.
  const g = floor("2026-10-07T12:00:00Z");
  for (const d of ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]) g.tabs.production.push(shift(d, P2, "كفر 2"));
  g.tabs.production.push(shift("2026-10-06", P3, "طبق"));
  g.tabs.changeoverLog = [
    logRow({ date: "2026-10-06 09:00", machine: P2, order: "Job 10", toProduct: "كفر", reasons: NOTE }),
    logRow({ date: "2026-10-07 09:00", machine: P3, order: "Job 10", toProduct: "كفر", fromProduct: "طبق", reasons: "متأخر" }),
  ];
  g.jobs = jobs;
  p = await D.loadPlan();
  assert.deepEqual([M(p, P3).now.order, M(p, P2).now.alsoOn, M(p, P2).now.order], ["Job 10", P3, ""]);

  // A colour saved on PQ 2 in the MORNING is not «لسه هنا» said after the mould went onto PQ 3 that afternoon…
  const h = floor("2026-10-07T12:00:00Z");
  h.tabs.production.push(shift("2026-10-05", P2, "كفر"), shift("2026-10-06", P2, "كفر"), shift("2026-10-06", P3, "طبق"));
  h.tabs.changeoverLog = [
    logRow({ date: "2026-10-07 09:30", machine: P2, order: "Job 10", toProduct: "كفر", toColour: "أسود", nowColour: "أسود", reasons: NOTE }),
    logRow({ date: "2026-10-07 14:00", machine: P3, order: "Job 10", toProduct: "كفر", fromProduct: "طبق", reasons: "متأخر" }),
  ];
  h.jobs = jobs;
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.alsoOn, M(p, P3).now.order], [P3, "Job 10"]);
  // …while a row written for PQ 2 AFTER it is.
  h.tabs.changeoverLog.push(logRow({ date: "2026-10-07 15:00", machine: P2, toProduct: "كفر", reasons: NOTE }));
  assert.equal(M(await D.loadPlan(), P2).now.alsoOn, "");
});

test("a sibling product that ran on the machine is not counted as the order's own", async () => {
  const f = floor("2026-10-06T10:00:00Z");
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) f.tabs.production.push(shift(d, P2, "رشاش 030", { goodUnits: "5000" }));
  f.tabs.production.push(shift("2026-10-04", P2, "رشاش 010", { goodUnits: "2000" }), shift("2026-10-05", P2, "رشاش 010", { goodUnits: "2000" }));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-04 10:00", machine: P2, order: "Job 61", toProduct: "رشاش 010", fromProduct: "رشاش 030", reasons: "متأخر" })];
  // lib/jobs.ts has counted the two shifts under the order's own name: 14,000 − 4,000.
  f.jobs = [job({ id: "5", code: "Job 61", product: "رشاش 010", qtyOrdered: 14_000, remaining: 10_000, startDate: "2026-10-01" })];
  const p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.order, O(p, "Job 61").remaining], ["Job 61", 10_000], "«رشاش 030» was another product, not another spelling");
});

test("a job in several colours: a told barrel colour is trusted only until a later day is logged", async () => {
  const f = floor();
  f.tabs.production.push(shift("2026-10-04", P2, "غطاء"));
  f.tabs.changeoverLog = [logRow({ date: "2026-10-04 08:30", machine: P2, toProduct: "غطاء", toColour: "أبيض | أسود", nowColour: "أبيض", reasons: NOTE })];
  assert.equal(M(await D.loadPlan(), P2).now.colourNow, "white");
  f.tabs.production.push(shift("2026-10-05", P2, "غطاء"));
  const m = M(await D.loadPlan(), P2);
  assert.deepEqual([m.now.colours, m.now.colourNow], [["white", "black"], ""], "nobody tells the page when the run moves on to black");
});

test("the page's own tabs: 'exists with no rows' is a read that worked; a failed read is flagged", async () => {
  const f = floor();
  f.headerOnly.add("changeoverLog");
  f.tabs.changeoverAnswers = [{ kind: R.kindToSheet("machine"), name: P1, bigMachine: R.YES }];
  assert.equal((await D.loadPlan()).plannerRead, true, "an emptied log tab must not lock the page out of writing");
  f.headerOnly.clear();
  f.failRead.add("changeoverLog");
  assert.equal((await D.loadPlan()).plannerRead, false);
  f.lazyMissing.add(R.LOG_TAB);
  assert.equal((await D.loadPlan()).plannerRead, true, "not created yet is a normal empty state");
});

test("recording what stands: a pair beside its order, the «لا» answer, and a replay read month-first", async () => {
  const f = floor("2026-10-05T12:10:00Z"); // 15:10 in Cairo
  f.tabs.jobs = [{ code: "Job 20", product: "يمين", status: "جاري التشغيل", machine: "" }];
  const base = { machine: P2, colours: [], colourNow: "", fromProducts: [], fromColours: [], minutes: NaN, reasons: "", baseline: true };

  // The order's product is the sheet's — and a note may name the pair beside it, never instead of it.
  assert.equal((await D.recordMount({ ...base, order: "Job 20", products: ["يمين", "شمال"] }, "t@x")).ok, true);
  assert.deepEqual([f.appends[0].values.toProduct, f.appends[0].values.order], ["يمين | شمال", "Job 20"]);
  assert.equal((await D.recordMount({ ...base, machine: P3, order: "Job 20", products: ["حاجة تانية"] }, "t@x")).ok, true);
  assert.equal(f.appends[1].values.toProduct, "يمين");

  // «لا» has its own word in the order cell; an ordinary note leaves it blank.
  await D.recordMount({ ...base, machine: P1, order: "", noOrder: true, products: ["كرسي"] }, "t@x");
  assert.equal(f.appends[2].values.order, R.NO_ORDER);

  // The same save arriving twice: the row is there, stamped as Sheets re-types
  // it — «10/5/2026», the 5th of October, two minutes ago.
  const g = floor("2026-10-05T12:10:00Z");
  g.tabs.jobs = f.tabs.jobs;
  g.tabs.changeoverLog = [logRow({ date: "10/5/2026 15:08:00", machine: P2, toProduct: "كرسي", reasons: NOTE })];
  const again = await D.recordMount({ ...base, order: "", products: ["كرسي"] }, "t@x");
  assert.deepEqual([again.ok, again.ok && again.replay, g.appends.length], [true, true, 0]);
  // …and the same job going back up next week is a new row.
  g.tabs.changeoverLog = [logRow({ date: "9/28/2026 15:08:00", machine: P2, toProduct: "كرسي", reasons: NOTE })];
  await D.recordMount({ ...base, order: "", products: ["كرسي"] }, "t@x");
  assert.equal(g.appends.length, 1);
});

test("a confirmed mount starts the order: «لم يبدأ» becomes «جاري التشغيل» in the same write as its machine — and nothing else is touched", async () => {
  const f = floor();
  f.tabs.jobs = [
    { code: "Job 60", product: "طبق", status: "لم يبدأ", machine: "" },
    { code: "Job 61", product: "كوب", status: "جاري التشغيل", machine: P3 },
    { code: "Job 62", product: "غطا", status: "متوقف", machine: "" },
  ];
  const tap = { products: [], fromProducts: [], colours: [], colourNow: "", fromColours: [], minutes: 45, reasons: "متأخر", baseline: false };
  const a = await D.recordMount({ ...tap, machine: P2, order: "Job 60" }, "t@x");
  assert.equal(a.ok && a.started, true);
  assert.deepEqual(f.updates.filter((u) => u.entity === "jobs").map((u) => u.changes), [{ machine: P2, status: "جاري التشغيل" }]);
  // Already running on that machine: nothing to write, nothing "started".
  const b = await D.recordMount({ ...tap, machine: P3, order: "Job 61" }, "t@x");
  assert.equal(b.ok && !b.started && b.job === "unchanged", true);
  // «متوقف» is a person's decision: the machine is set, the status is left alone.
  const c = await D.recordMount({ ...tap, machine: P1, order: "Job 62" }, "t@x");
  assert.equal(c.ok && !c.started, true);
  assert.deepEqual(f.updates.filter((u) => u.entity === "jobs").map((u) => u.changes).at(-1), { machine: P1 });
});

test("a stoppage «لا يوجد أمر شغل» on a machine says its order is finished — whatever the count still shows", async () => {
  const f = floor();
  f.tabs.production = [shift("2026-10-04", P2, "طبق")];
  f.tabs.jobs = [{ code: "Job 70", product: "طبق", status: "جاري التشغيل", machine: P2 }, { code: "Job 71", product: "كوب", status: "لم يبدأ", machine: "" }];
  f.jobs = [job({ id: "7", code: "Job 70", product: "طبق", status: "In Production", machine: P2 }), job({ id: "8", code: "Job 71", product: "كوب" })];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).state, O(p, "Job 70").mountedRunning, !!O(p, "Job 70").doneByFloor], ["running", true, false]);

  f.stops = [{ machine: P2, reason: "No order", startedAt: Date.now() - 3_600_000 }];
  p = await D.loadPlan();
  assert.equal(M(p, P2).state, "stopped");
  assert.equal(R.machineFinished(M(p, P2)), true);
  assert.equal(O(p, "Job 70").doneByFloor, true);
  assert.deepEqual(ranked(p, P2).map((s) => s.order.code), ["Job 71"]);
  const day = R.planDay(p.machines, p.orders, { today: p.today, transparentMachines: [] }).entries;
  assert.deepEqual([day[0].machine.label, day[0].need, day[0].pick?.order.code], [P2, "finished", "Job 71"]);
  // Another reason is a stoppage like any other: the order still stands there.
  f.stops = [{ machine: P2, reason: "Mold maintenance", startedAt: Date.now() - 3_600_000 }];
  p = await D.loadPlan();
  assert.equal(!!O(p, "Job 70").doneByFloor, false);
  assert.equal(typeof p.friday, "boolean");
});

test("the day's plan over the real floor: an order stays with the machine its mould is on — a stoppage there sends it nowhere else", async () => {
  // Found by the review of 2026-10-07, each case run through loadPlan + planDay: the rules'
  // own tests had never put an order ON a stopped machine, which is where the server puts it.
  const day = (p: Plan) => {
    const d = R.planDay(p.machines, p.orders, { today: p.today, transparentMachines: [] });
    return [d.entries.map((e) => [e.machine.label, e.need, e.pick?.order.code ?? null]), d.unplaced.map((u) => [u.order.code, u.why])];
  };
  // PQ 2 is making Job 10, which is late; PQ 1 and PQ 3 run long jobs that are on time.
  const running = (o: Record<string, unknown>) => job({ status: "In Production", qtyOrdered: 90_000, remaining: 40_000, dueDate: "2026-11-20", ...o });
  const f = floor();
  f.tabs.production = [P1, P2, P3].map((m, i) => shift("2026-10-04", m, ["كرسي", "كفر", "غطاء"][i], { goodUnits: "1200" }));
  f.jobs = [
    running({ id: "1", code: "Job 1", product: "كرسي" }), running({ id: "5", code: "Job 10", product: "كفر", dueDate: "2026-09-27" }),
    running({ id: "9", code: "Job 3", product: "غطاء" }),
  ];
  assert.deepEqual(day(await D.loadPlan()), [[[P1, "running", null], [P2, "running", null], [P3, "running", null]], []]);
  // The floor taps «تغيير الاسطمبة» on PQ 2 ten minutes ago (or a set-up, or drying…).
  for (const reason of ["Mold change", "Setup", "Material drying"]) {
    f.stops = [{ machine: P2, reason, startedAt: Date.now() - 600_000 }];
    const p = await D.loadPlan();
    assert.deepEqual([O(p, "Job 10").mountedOn, O(p, "Job 10").mountedRunning], [P2, false], reason);
    // It was: PQ 1 «interrupt» — take the running mould off for Job 10 — and PQ 2 with nothing.
    assert.deepEqual(day(p), [[[P2, "down", null], [P1, "running", null], [P3, "running", null]], [["Job 10", "noMachine"]]], reason);
  }

  // «صيانة الاسطمبة» on PQ 2 with Job 10 (on time now) on it, and Job 40 waiting: the machine
  // can take ANOTHER mould — it was offered its own, the one that is out, to "carry on" with.
  f.jobs[1] = running({ id: "5", code: "Job 10", product: "كفر" });
  f.jobs.push(job({ id: "12", code: "Job 40", product: "طبق", dueDate: "2026-11-20" }));
  f.stops = [{ machine: P2, reason: "Mold maintenance", startedAt: Date.now() - 600_000 }];
  assert.deepEqual(day(await D.loadPlan()), [[[P2, "stopped", "Job 40"], [P1, "running", null], [P3, "running", null]], []]);

  // One product ordered twice while its mould STANDS on an idle machine (the second order is
  // «queuedBehind» only while the mould runs): one mould, one machine — PQ 3 was given Job 11.
  const g = floor();
  g.tabs.production.push(shift("2026-09-27", P2, "كفر"), shift("2026-09-26", P3, "غطاء"));
  g.jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 11", product: "كفر" })];
  const p = await D.loadPlan();
  assert.deepEqual([M(p, P2).state, ...["Job 10", "Job 11"].map((c) => [O(p, c).mountedOn, O(p, c).mountedRunning, O(p, c).queuedBehind].join("|"))],
    ["idle", `${P2}|false|`, `${P2}|false|`]);
  assert.deepEqual(day(p), [[[P2, "free", "Job 10"], [P3, "free", null], [P1, "running", null]], []]);
});

/* ------------------------------------------------------------------------------
 * The ten changes of 2026-10-07 — the FIELDS the server works out. What the rules
 * do with them (the ranking, the day's plan) is tests/changeover.test.ts's.
 * ---------------------------------------------------------------------------- */

test("where a mould has RUN is read off the shift log: most shifts first, the exact name, machines the registry still has", async () => {
  const f = floor();
  f.tabs.production.push(
    shift("2026-09-10", P3, "كفر"),
    shift("2026-09-20", P2, "كفر"), shift("2026-09-21", P2, "كفر"), shift("2026-09-21", P2, "كفر", { shift: "المسائية" }),
    // «كفر 2» is another name, however alike — where a mould fits is not guessed from a loose match.
    ...["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((d) => shift(d, P1, "كفر 2")),
    // A machine that has left the registry cannot be offered.
    ...["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"].map((d) => shift(d, "PQ 9 — 100", "كفر")),
    // A mistyped date, after today, is not history.
    shift("2026-11-01", P1, "كفر"),
  );
  f.jobs = [job({ id: "5", code: "Job 10", product: "كفر" }), job({ id: "6", code: "Job 12", product: "عدسة" })];
  let p = await D.loadPlan();
  assert.deepEqual(O(p, "Job 10").ranOn, [P2, P3]);
  assert.deepEqual(O(p, "Job 12").ranOn, [], "it never ran: nothing is known, nothing is invented");

  // A name Master holds twice is two customers' parts: the other one's shifts are not this order's history.
  const g = floor();
  g.tabs.master = [{ name: "غطاء احمر", client: "أشرف", material: "", machine: "" }, { name: "غطاء احمر", client: "الهندي", material: "", machine: "" }];
  g.tabs.production.push(
    shift("2026-09-20", P2, "غطاء احمر", { client: "أشرف" }), shift("2026-09-21", P2, "غطاء احمر", { client: "أشرف" }),
    shift("2026-09-22", P3, "غطاء احمر", { client: "الهندي" }),
  );
  g.jobs = [job({ id: "5", code: "Job 40", product: "غطاء احمر", client: "الهندي", masterClient: "أشرف", ambiguous: true })];
  p = await D.loadPlan();
  assert.deepEqual(O(p, "Job 40").ranOn, [P3]);
});

test("how long an order still needs comes from its OWN logged rate — its last five counted shifts — before Master's cycle", async () => {
  const f = floor();
  // «كفر» ran on PQ 2 in September; the machine is idle now, so nothing is estimated forward.
  f.tabs.production.push(
    shift("2026-09-01", P2, "كفر", { goodUnits: "9,000" }),               // before the order started
    shift("2026-09-10", P2, "كفر", { goodUnits: "6000" }),                // the sixth-newest counted shift
    shift("2026-09-11", P2, "كفر", { goodUnits: "1,000" }),
    shift("2026-09-11", P2, "كفر", { shift: "المسائية", goodUnits: "1400" }),
    shift("2026-09-12", P2, "كفر", { goodUnits: "1200" }), shift("2026-09-13", P2, "كفر", { goodUnits: "1300" }),
    shift("2026-09-14", P2, "كفر", { goodUnits: "1100" }),
    shift("2026-09-15", P2, "كفر"),                                       // «لم يُعد بعد» — no count is not a slow shift
  );
  // Master says 30 seconds a shot from 2 cavities — 240 an hour. The floor makes 1,200 a shift: 100.
  const std = { qtyOrdered: 50_000, remaining: 24_000, cycleSec: 30, cavities: 2 };
  f.jobs = [
    job({ id: "5", code: "Job 10", product: "كفر", startDate: "2026-09-05", ...std }),
    job({ id: "6", code: "Job 12", product: "عدسة", ...std }),                                   // never counted: Master's rate
    job({ id: "7", code: "Job 13", product: "طبق", qtyOrdered: 50_000, remaining: 24_000 }),     // neither is known
    job({ id: "8", code: "Job 14", product: "كوب", ...std, qtyOrdered: 0, remaining: 0 }),       // no piece weight: nothing to divide
    // A second order of the same product that started on 14 Sep: only ITS shifts are its rate (1,100 a shift).
    job({ id: "9", code: "Job 15", product: "كفر", startDate: "2026-09-14", ...std }),
  ];
  const p = await D.loadPlan();
  assert.equal(M(p, P2).state, "idle");
  assert.deepEqual([O(p, "Job 10").runHours, O(p, "Job 10").runBasis, O(p, "Job 10").asOf], [240, "logged", ""]);
  assert.deepEqual([O(p, "Job 15").runHours, O(p, "Job 15").runBasis], [261.8, "logged"]);
  assert.deepEqual([O(p, "Job 12").runHours, O(p, "Job 12").runBasis], [100, "master"]);
  assert.deepEqual([O(p, "Job 13").runHours, O(p, "Job 13").runBasis], [null, ""]);
  assert.deepEqual([O(p, "Job 14").remaining, O(p, "Job 14").runHours, O(p, "Job 14").runBasis], [null, null, ""]);
});

test("the log is typed late: a RUNNING order's hours allow for what was made since its machine's last logged day — «الباقي» stays the count", async () => {
  // 1,200 good pieces a shift = 100 an hour; 24,000 left by the count = 240 hours.
  const order = (o: Record<string, unknown> = {}) =>
    job({ id: "5", code: "Job 10", product: "كفر", status: "In Production", qtyOrdered: 50_000, remaining: 24_000, ...o });
  const build = (now: string, days: readonly string[], o: Record<string, unknown> = {}) => {
    const f = floor(now);
    f.tabs.production = days.map((d) => shift(d, P2, "كفر", { goodUnits: "1200" }));
    f.jobs = [order(o)];
    return f;
  };
  const seen = (p: Plan) => [O(p, "Job 10").remaining, O(p, "Job 10").runHours, O(p, "Job 10").asOf, O(p, "Job 10").runBasis];

  // Logged up to Sunday 4 Oct; it is Tuesday noon. That factory day ended Monday 08:00 — 28 hours ago.
  build("2026-10-06T10:00:00Z", ["2026-10-03", "2026-10-04"]);
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).state, O(p, "Job 10").mountedRunning], ["running", true]);
  assert.deepEqual(seen(p), [24_000, 212, "2026-10-04", "logged"]);

  // Friday is the day off: logged up to Wednesday, read on Saturday — 52 hours on the clock, 28 of running.
  build("2026-10-03T10:00:00Z", ["2026-09-29", "2026-09-30"]);
  assert.deepEqual(seen(await D.loadPlan()), [24_000, 212, "2026-09-30", "logged"]);

  // A log four days behind is not four days of certain running: three at most.
  build("2026-10-08T10:00:00Z", ["2026-10-02", "2026-10-03"]);
  assert.deepEqual(seen(await D.loadPlan()), [24_000, 168, "2026-10-03", "logged"]);

  // Never below nothing left — and the count itself is not rewritten.
  build("2026-10-06T10:00:00Z", ["2026-10-03", "2026-10-04"], { remaining: 2_000 });
  assert.deepEqual(seen(await D.loadPlan()), [2_000, 0, "2026-10-04", "logged"]);

  // Master's rate is estimated forward the same way while nothing is counted yet (36 s, one cavity = 100 an hour).
  const m = build("2026-10-06T10:00:00Z", ["2026-10-03", "2026-10-04"], { cycleSec: 36, cavities: 1 });
  for (const r of m.tabs.production) r.goodUnits = "";
  assert.deepEqual(seen(await D.loadPlan()), [24_000, 212, "2026-10-04", "master"]);

  // A machine that is STOPPED is not assumed to have been making anything.
  const s = build("2026-10-06T10:00:00Z", ["2026-10-03", "2026-10-04"]);
  s.stops = [{ machine: P2, reason: "Maintenance", startedAt: Date.now() - 3_600_000 }];
  assert.deepEqual(seen(await D.loadPlan()), [24_000, 240, "", "logged"]);

  // A pair: the order running ALONGSIDE the tied one is being made too, and is estimated forward with it.
  const pair = floor("2026-10-06T10:00:00Z");
  pair.tabs.production = ["2026-10-03", "2026-10-04"].flatMap((d) =>
    [shift(d, P2, "يمين", { goodUnits: "1200" }), shift(d, P2, "شمال", { goodUnits: "1200" })]);
  pair.jobs = [order({ code: "Job 20", product: "يمين" }), order({ id: "6", code: "Job 21", product: "شمال" })];
  p = await D.loadPlan();
  for (const code of ["Job 20", "Job 21"]) {
    assert.deepEqual([O(p, code).mountedRunning, O(p, code).runHours, O(p, code).asOf], [true, 212, "2026-10-04"], code);
  }

  // A mould that went up by «ركّب دي» three hours ago has run three hours — not since the
  // last day the log holds for that machine, when it was still making something else.
  const c = floor("2026-10-06T10:00:00Z");
  c.tabs.production = [
    shift("2026-09-20", P3, "كفر", { goodUnits: "1200" }),
    shift("2026-10-03", P2, "عظمة", { goodUnits: "500" }), shift("2026-10-04", P2, "عظمة", { goodUnits: "500" }),
  ];
  c.tabs.changeoverLog = [logRow({ date: cairoStamp(Date.now() - 3 * 3_600_000), machine: P2, order: "Job 10", toProduct: "كفر", fromProduct: "عظمة", reasons: "متأخر" })];
  c.jobs = [order()];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).state, O(p, "Job 10").mountedRunning], [["كفر"], "running", true]);
  assert.deepEqual(seen(p), [24_000, 237, "2026-10-04", "logged"]);

  // The same mould recorded by a NOTE («تعديل»: this is what stands now) three hours ago, the
  // log still ending on another product: three hours as well — it was credited with all 28.
  const n = floor("2026-10-06T10:00:00Z");
  n.tabs.production = c.tabs.production;
  n.tabs.changeoverLog = [logRow({ date: cairoStamp(Date.now() - 3 * 3_600_000), machine: P2, order: "Job 10", toProduct: "كفر", reasons: NOTE })];
  n.jobs = [order()];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.source, M(p, P2).now.startedOn, M(p, P2).state, O(p, "Job 10").mountedRunning], ["plan", "", "running", true]);
  assert.deepEqual(seen(p), [24_000, 237, "2026-10-04", "logged"]);
  // …counted from the FIRST note of that mould: a tap an hour ago on which colour is running does not move the start.
  n.tabs.changeoverLog.push(logRow({ date: cairoStamp(Date.now() - 3_600_000), machine: P2, order: "Job 10", toProduct: "كفر", toColour: "أسود", nowColour: "أسود", reasons: NOTE }));
  assert.equal(O(await D.loadPlan(), "Job 10").runHours, 237);
  // A note that only TIES the order to a mould the log spells another way keeps the log's day:
  // that mould has been running all along (the 2,400 logged as «كفر 2» are this order's, then 28 hours).
  const t = floor("2026-10-06T10:00:00Z");
  t.tabs.production = [shift("2026-10-03", P2, "كفر 2", { goodUnits: "1200" }), shift("2026-10-04", P2, "كفر 2", { goodUnits: "1200" })];
  t.tabs.changeoverLog = n.tabs.changeoverLog.slice(0, 1);
  t.jobs = [order()];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.source, O(p, "Job 10").mountedRunning], ["plan", true]);
  assert.deepEqual(seen(p), [21_600, 188, "2026-10-04", "logged"]);
});

test("a shift typed with no count yet is not a day that was counted: the allowance runs from the last day that IS", async () => {
  // «لم يُعد بعد»: the row says which mould was on, not how much it made. Starting the
  // allowance after such a row left its day in neither the count nor the allowance —
  // typing MORE of the log made the forecast two days worse.
  const build = (typed: readonly string[]) => {
    const f = floor("2026-10-06T10:00:00Z");
    f.tabs.production = [
      ...["2026-10-02", "2026-10-03"].map((d) => shift(d, P2, "كفر", { goodUnits: "1200" })),
      ...typed.map((d) => shift(d, P2, "كفر")),
    ];
    f.jobs = [job({ id: "5", code: "Job 10", product: "كفر", status: "In Production", qtyOrdered: 50_000, remaining: 24_000 })];
    return f;
  };
  const seen = (p: Plan) => [O(p, "Job 10").remaining, O(p, "Job 10").runHours, O(p, "Job 10").asOf];
  build([]);
  const untyped = seen(await D.loadPlan());
  assert.deepEqual(untyped, [24_000, 188, "2026-10-03"]);
  build(["2026-10-04", "2026-10-05"]);
  let p = await D.loadPlan();
  assert.equal(M(p, P2).now.since, "2026-10-05", "the rows still say what is on the machine, and until when");
  assert.deepEqual(seen(p), untyped, "typed without a count, or not typed at all: the same forecast");

  // Only the run the machine is on NOW: a count from before another mould was on it is not
  // where this one's untyped hours start (the log's own last day is, as before).
  const f = build([]);
  f.tabs.production.push(shift("2026-10-04", P2, "عظمة"), shift("2026-10-05", P2, "كفر"));
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.startedOn, ...seen(p)], ["2026-10-05", 24_000, 236, "2026-10-05"]);
});

test("«لا يوجد أمر شغل» is checked against the count: more than a shift still to run is not 'finished' — the engineer is asked", async () => {
  // PQ 2 makes 100 an hour and is logged up to 4 Oct; the floor taps «لا يوجد أمر شغل».
  const build = (remaining: number, now: string, stoppedHoursAgo: number, reason = "No order") => {
    const f = floor(now);
    f.tabs.production = [shift("2026-10-03", P2, "طبق", { goodUnits: "1200" }), shift("2026-10-04", P2, "طبق", { goodUnits: "1200" })];
    f.jobs = [job({ id: "7", code: "Job 70", product: "طبق", status: "In Production", qtyOrdered: 50_000, remaining })];
    f.stops = [{ machine: P2, reason, startedAt: Date.now() - stoppedHoursAgo * 3_600_000 }];
    return f;
  };
  const said = (p: Plan) => [!!O(p, "Job 70").doneByFloor, !!O(p, "Job 70").doneUnsure];

  // The next morning (the log is up to date but for three hours): ten hours by the count — finished.
  build(1_000, "2026-10-05T10:00:00Z", 1);
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).state, R.machineFinished(M(p, P2)), O(p, "Job 70").mountedOn], ["stopped", true, P2]);
  assert.deepEqual(said(p), [true, false]);

  // Forty hours by the count: the two disagree. Not finished, not blocked — asked about.
  build(4_000, "2026-10-05T10:00:00Z", 1);
  p = await D.loadPlan();
  assert.deepEqual(said(p), [false, true]);
  assert.deepEqual([O(p, "Job 70").remaining, O(p, "Job 70").runHours, O(p, "Job 70").asOf], [4_000, 40, ""], "what is shown is the count, as it is");

  // The same forty hours when the log is two days behind and the machine stopped this
  // morning: it ran 49 hours nobody has typed yet. The floor's word stands.
  build(4_000, "2026-10-07T10:00:00Z", 3);
  assert.deepEqual(said(await D.loadPlan()), [true, false]);
  // …but not for eighty.
  build(8_000, "2026-10-07T10:00:00Z", 3);
  assert.deepEqual(said(await D.loadPlan()), [false, true]);
  // Those two days typed with no count yet («لم يُعد بعد») are still two days nobody has
  // counted: the same answer — typing them had turned the finished order into a doubted one.
  const typed = build(4_000, "2026-10-07T10:00:00Z", 3);
  typed.tabs.production.push(shift("2026-10-05", P2, "طبق"), shift("2026-10-06", P2, "طبق"));
  assert.deepEqual(said(await D.loadPlan()), [true, false]);

  // A machine whose log has been SILENT for weeks did not run those weeks: «طبق» last ran on
  // PQ 2 on 20 Sep, every other machine is typed up to yesterday, sixty hours are left by the
  // count. Nothing is allowed for — the two disagree, and the engineer is asked.
  const stale = build(6_000, "2026-10-07T10:00:00Z", 3);
  stale.tabs.production = [
    shift("2026-10-06", P1, "كرسي"), shift("2026-10-06", P3, "غطاء"),
    shift("2026-09-19", P2, "طبق", { goodUnits: "1200" }), shift("2026-09-20", P2, "طبق", { goodUnits: "1200" }),
  ];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.since, O(p, "Job 70").mountedOn, O(p, "Job 70").runHours], ["2026-09-20", P2, 60]);
  assert.deepEqual(said(p), [false, true]);
  assert.deepEqual(ranked(p, P2).map((s) => s.order.code), ["Job 70"], "not blocked as finished: still a candidate on its own machine");

  // No rate at all: nothing to check the floor's word against — it stands.
  const blind = build(4_000, "2026-10-05T10:00:00Z", 1);
  for (const r of blind.tabs.production) r.goodUnits = "";
  p = await D.loadPlan();
  assert.deepEqual([O(p, "Job 70").runHours, ...said(p)], [null, true, false]);

  // Any other reason says nothing about the order.
  build(4_000, "2026-10-05T10:00:00Z", 1, "Mold maintenance");
  assert.deepEqual(said(await D.loadPlan()), [false, false]);
});

test("the day a mould went on: the change confirmed on this page when there is one, else the unbroken run of shifts naming it", async () => {
  // From the log alone: it came off on 30 Sep and went back up on 2 Oct.
  const f = floor();
  f.tabs.production.push(
    shift("2026-09-28", P2, "كفر"), shift("2026-09-30", P2, "عظمة"),
    shift("2026-10-02", P2, "كفر"), shift("2026-10-03", P2, "كفر"), shift("2026-10-04", P2, "كفر"),
  );
  let p = await D.loadPlan();
  assert.equal(M(p, P2).now.startedOn, "2026-10-02");
  assert.equal(M(p, P3).now.startedOn, "", "nothing is known about PQ 3 — and nothing is made up");

  // «ركّب دي» this morning: the log has not caught up, and the confirm's day is the start.
  f.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P2, order: "Job 12", toProduct: "عدسة", fromProduct: "كفر", reasons: "متأخر" })];
  f.jobs = [job({ id: "6", code: "Job 12", product: "عدسة" })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.startedOn, p.today], [["عدسة"], "2026-10-05", "2026-10-05"]);

  // The next day, behind a note (a tap on which colour is running) and with its first shift typed: still that day.
  const g = floor("2026-10-06T10:00:00Z");
  g.tabs.production.push(shift("2026-10-03", P2, "كفر"), shift("2026-10-04", P2, "كفر"), shift("2026-10-05", P2, "عدسة", { shift: "المسائية" }));
  g.tabs.changeoverLog = [
    ...f.tabs.changeoverLog,
    logRow({ date: "2026-10-06 08:30", machine: P2, order: "Job 12", toProduct: "عدسة", toColour: "أسود", nowColour: "أسود", reasons: NOTE }),
  ];
  g.jobs = f.jobs;
  assert.equal(M(await D.loadPlan(), P2).now.startedOn, "2026-10-05");

  // Confirmed on 1 Oct, then the log shows it came OFF and went back with no tap: the log's day.
  const h = floor();
  h.tabs.production.push(shift("2026-09-30", P2, "كفر"), shift("2026-10-02", P2, "عدسة"), shift("2026-10-03", P2, "كفر"), shift("2026-10-04", P2, "عدسة"));
  h.tabs.changeoverLog = [logRow({ date: "2026-10-01 09:00", machine: P2, order: "Job 12", toProduct: "عدسة", fromProduct: "كفر", reasons: "متأخر" })];
  h.jobs = f.jobs;
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.products, M(p, P2).now.startedOn], [["عدسة"], "2026-10-04"]);

  // A change inside the latest shift: the NEW mould is the machine's, and it started that day.
  const i = floor();
  i.tabs.production.push(shift("2026-10-02", P2, "كرسي صغير"), shift("2026-10-03", P2, "كرسي صغير"), shift("2026-10-04", P2, "كرسي صغير"), shift("2026-10-04", P2, "طبق"));
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).now.mixedShift, M(p, P2).now.startedOn], [true, "2026-10-04"]);

  // A note about what STANDS says nothing about when it went on.
  const n = floor();
  n.tabs.changeoverLog = [logRow({ date: "2026-10-05 09:00", machine: P3, toProduct: "طبق", reasons: NOTE })];
  p = await D.loadPlan();
  assert.deepEqual([M(p, P3).now.products, M(p, P3).now.startedOn], [["طبق"], ""]);
});

test("how long a mould change takes on a machine is its own history in «التوقفات»: the median of three or more, else unknown", async () => {
  const f = floor();
  f.tabs.downtime = [
    stoppage("2026-09-01", P2, 40), stoppage("2026-09-15", P2, 90), stoppage("01/10/2026", P2, "52"),
    // None of these is a measured mould change on PQ 2:
    stoppage("2026-09-20", P2, 300, { reason: "صيانة في الماكينة" }),
    stoppage("2026-09-21", P2, 10), stoppage("2026-09-22", P2, 800),     // a mis-tap; a stop nobody tapped
    stoppage("2026-06-01", P2, 200),                                     // more than 90 days back
    stoppage("2026-09-23", P2, 400, { estimated: "نعم" }),                // closed by an estimate, not a tap
    stoppage("2026-09-24", "PQ 9 — 100", 60),                            // not in the registry any more
    stoppage("2026-09-05", P3, 60), stoppage("2026-09-06", P3, 120),
  ];
  let p = await D.loadPlan();
  assert.deepEqual([M(p, P2).swapMin, M(p, P2).swapSamples], [50, 3], "40 · 52 · 90 → 52, to the nearest five");
  assert.deepEqual([M(p, P3).swapMin, M(p, P3).swapSamples], [null, 2], "two changes are not a habit yet");
  assert.deepEqual([M(p, P1).swapMin, M(p, P1).swapSamples], [null, 0]);

  // An even count: the two in the middle, averaged (40 · 52 · 60 · 90 → 56 → 55).
  f.tabs.downtime.push(stoppage("2026-10-02", P2, 60));
  p = await D.loadPlan();
  assert.deepEqual([M(p, P2).swapMin, M(p, P2).swapSamples], [55, 4]);

  // «التوقفات» not read: every machine is "not measured" and the plan still loads.
  f.failRead.add("downtime");
  p = await D.loadPlan();
  assert.deepEqual([p.ok, p.machines.length, p.machines.map((m) => m.swapMin), p.machines.map((m) => m.swapSamples)], [true, 3, [null, null, null], [0, 0, 0]]);
});

test("the material in the store: what is held for the order's client or for the factory itself, against what is left to make", async () => {
  const mold = R.kindToSheet("mold");
  const f = floor();
  f.store = {
    materials: ["بولي بروبلين", "ABS أسود", "كوبوليمر", "نايلون", "حبيبات"],
    balance: [
      stockLine("بولي بروبلين", "الهندي", "300"), stockLine("بولي بروبلين", "الهندي", "1,200.5", { loc: "B11" }),
      stockLine("بولي بروبلين", "اتقان", 150),
      stockLine("بولي بروبلين", "أشرف", 5000),                                                   // another customer's material
      stockLine("بولي بروبلين", "الهندي", 9000, { itemType: "منتج", unit: "قطعة" }),              // a PRODUCT of that name is not material
      stockLine("ABS أسود", "اتقان", 80),
      stockLine("كوبوليمر", "اتقان", 720), stockLine("كوبوليمر", "اتقان", -195, { loc: "" }),     // a withdrawal filed with no place
      stockLine("نايلون", "أشرف", 400),
      stockLine("حبيبات", "اتقان", -40),                                                         // the store's books are wrong for this one
      stockLine("ماستر باتش أحمر", "اتقان", 12),                                                 // held, but not on the sheet's list
    ],
  };
  f.tabs.changeoverAnswers = [
    { kind: mold, name: "طبق", storeMaterial: "بولي بروبلين" },
    { kind: mold, name: "غطاء", storeMaterial: "بولي بروبلين" },
    { kind: mold, name: "علبة", storeMaterial: "كوبوليمر" },
    { kind: mold, name: "مشط", storeMaterial: "نايلون" },
    { kind: mold, name: "سلة", storeMaterial: "حبيبات" },
    { kind: mold, name: "كرسي صغير", storeMaterial: "خامة اتشالت من المخزن" },
  ];
  const std = { qtyOrdered: 40_000, remaining: 10_000, pieceWeightG: 50 };
  f.jobs = [
    job({ id: "1", code: "Job 80", product: "طبق", client: "الهندي", ...std }),
    job({ id: "2", code: "Job 81", product: "غطاء", client: "سمير", qtyOrdered: 0, remaining: 0, pieceWeightG: 0 }),
    job({ id: "3", code: "Job 82", product: "كوب", client: "سمير", material: "abs  اسود", ...std }),   // nobody answered: Master's text
    job({ id: "4", code: "Job 83", product: "حلة", client: "سمير", material: "خامة مش في المخزن", ...std }),
    job({ id: "5", code: "Job 84", product: "علبة", client: "سمير", ...std }),
    job({ id: "6", code: "Job 85", product: "مشط", client: "سمير", ...std }),
    job({ id: "7", code: "Job 86", product: "سلة", client: "سمير", ...std }),
    job({ id: "8", code: "Job 87", product: "كرسي صغير", client: "سمير", ...std }),
  ];
  let p = await D.loadPlan();
  assert.equal(p.stockRead, true);
  assert.deepEqual(p.storeMaterials, ["بولي بروبلين", "ABS أسود", "كوبوليمر", "نايلون", "حبيبات", "ماستر باتش أحمر"]);
  // The client's own 1,500.5 kg and the factory's 150 — 10,000 pieces of 50 g need 500.
  assert.deepEqual(O(p, "Job 80").stock, { material: "بولي بروبلين", haveKg: 1650.5, needKg: 500, guessed: false });
  // Another client's order of the same material: only the factory's. No piece weight: the need is not known.
  assert.deepEqual(O(p, "Job 81").stock, { material: "بولي بروبلين", haveKg: 150, needKg: null, guessed: false });
  // Nobody said which store material: Master's text is exactly one store name — a guess, in the store's spelling.
  assert.deepEqual(O(p, "Job 82").stock, { material: "ABS أسود", haveKg: 80, needKg: 500, guessed: true });
  assert.equal(O(p, "Job 83").stock, null, "Master's text is no store name: not known, never 'none'");
  assert.equal(O(p, "Job 84").stock?.haveKg, 525, "720 on the shelf less the 195 drawn with no place typed");
  assert.equal(O(p, "Job 85").stock?.haveKg, 0, "all of it is another customer's: none for this order");
  assert.equal(O(p, "Job 86").stock, null, "a store total below zero is a mistake in the books, not a quantity");
  assert.equal(O(p, "Job 87").stock, null, "an answer naming a material the store no longer has says nothing");
  // What the supervisor ANSWERED is carried on its own (like «هوت رانر»): with no stock to
  // show, the question form read «غير محددة» again and every save added the same row.
  assert.deepEqual(["Job 80", "Job 86", "Job 87"].map((c) => O(p, c).storeMaterial), ["بولي بروبلين", "حبيبات", "خامة اتشالت من المخزن"]);
  assert.deepEqual(["Job 82", "Job 83"].map((c) => O(p, c).storeMaterial), ["", ""], "a guess is not an answer");

  // The store did not answer — it said nothing, it threw, or it hung: nothing is known, and the plan still loads.
  f.store = null;
  p = await D.loadPlan();
  assert.deepEqual([p.ok, p.stockRead, p.storeMaterials, p.orders.length, p.orders.every((o) => o.stock === null)], [true, false, [], 8, true]);
  assert.equal(O(p, "Job 80").storeMaterial, "بولي بروبلين", "the answer is the page's own tab: it does not go with the store");
  f.storeFault = "throws";
  p = await D.loadPlan();
  assert.deepEqual([p.ok, p.stockRead, p.storeMaterials, p.orders.every((o) => o.stock === null)], [true, false, [], true]);
});

test("a store that never answers costs the plan six seconds at most, and only its stock", async (t) => {
  const f = floor();
  f.store = { materials: ["كوبوليمر"], balance: [stockLine("كوبوليمر", "اتقان", 720)] };
  f.storeFault = "hangs";
  f.jobs = [job({ id: "1", code: "Job 80", product: "طبق" })];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const pending = D.loadPlan().then((p) => { settled = true; return p; });
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(5_999);
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, "still inside its bound");
  t.mock.timers.tick(1);
  const p = await pending;
  assert.deepEqual([p.ok, p.stockRead, p.storeMaterials, O(p, "Job 80").stock, p.machines.length], [true, false, [], null, 3]);
});

test("«خامة المخزن» is saved in the STORE's own spelling, only when the store knows it — and read back", async () => {
  const f = floor();
  f.tabs.jobs = [{ code: "Job 80", product: "طبق", status: "لم يبدأ", machine: "" }];
  f.jobs = [job({ id: "1", code: "Job 80", product: "طبق", client: "الهندي", qtyOrdered: 40_000, remaining: 10_000, pieceWeightG: 50 })];
  f.store = { materials: ["ABS أسود"], balance: [stockLine("ABS أسود", "الهندي", 700)] };
  const save = (v: unknown) => D.saveAnswers([{ kind: "mold", name: "طبق", values: { storeMaterial: v } }], "t@x", "production");

  assert.deepEqual(await save("  abs   اسود "), { ok: true, saved: 1 });
  assert.deepEqual([f.appends.length, f.appends[0].entity, f.appends[0].values.storeMaterial], [1, "changeoverAnswers", "ABS أسود"]);
  assert.deepEqual(O(await D.loadPlan(), "Job 80").stock, { material: "ABS أسود", haveKg: 700, needKg: 500, guessed: false });

  // A name the store does not hold is refused, not remembered.
  const unknown = await save("خامة مش موجودة");
  assert.deepEqual([unknown.ok, !unknown.ok && unknown.reason], [false, "unknown_store_material"]);
  // …and the page has WORDS for that refusal (a name renamed in the store since the page
  // loaded): the generic «حاول مرة أخرى» never works here — only a refresh does.
  for (const lang of ["en", "ar"] as const) {
    const errors = co[lang].errors as Record<string, string>;
    assert.ok(errors.unknown_store_material && errors.unknown_store_material !== errors.generic, lang);
  }
  const blank = await save("   ");
  assert.deepEqual([blank.ok, !blank.ok && blank.reason], [false, "bad_store_material"]);
  // …and a store that cannot be read does not cost the engineer the rest of
  // the form (it refused the whole save, colours and machines included): the
  // name came from the store's own list on the page, and is kept as sent.
  f.store = null;
  const down = await save("ABS أسود");
  assert.equal(down.ok, true);
  assert.equal(f.appends.length, 2);
  assert.equal(f.appends[1].values.storeMaterial, "ABS أسود");
});

test("today's «عطلة» row, the fortnight's days off, and the machines the log says run transparent", async () => {
  const f = floor(); // 5 Oct 2026, 13:00 in Cairo
  f.tabs.production = [
    ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03"].map((d) => shift(d, P2, "كفر شفاف فوكس")),
    shift("2026-10-04", P1, "كرسي"),
    { ...shift("2026-10-05", "", ""), shift: "عطلة" },
    { ...shift("2026-09-10", "", ""), shift: "عطلة" },
  ];
  const p = await D.loadPlan();
  assert.equal(p.dayOff, true);
  assert.deepEqual(p.daysOff, ["2026-10-05"], "a day off of a month ago is not sent");
  // Five shifts, all «شفاف»: suggested — and only suggested; nothing is marked.
  assert.deepEqual(p.transparentHint, [P2]);
  assert.equal(M(p, P2).transparentOnly, false);
});
