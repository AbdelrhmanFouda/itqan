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
import { fresh, job, reg, setNow, shift, type Fixture } from "./_changeover-harness.ts";


const D = await import("../lib/changeover-data.ts");
const R = await import("../lib/changeover.ts");

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
