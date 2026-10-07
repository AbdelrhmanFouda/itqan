/**
 * «طلبات العملاء» — the rules a customer's request obeys (lib/customer-requests.ts).
 *
 * Five of these pin something that, if it drifted, would be wrong QUIETLY:
 *
 *  1. the reference number, which is the only way back to an appended row and
 *     the replay key that stops an at-least-once bridge booking one request
 *     twice — a repeat would be two orders for one customer's one intention;
 *  2. the replay window itself;
 *  3. the unit rule, which decides whether a buyer types pieces or kilograms
 *     and therefore what number the factory buys material against;
 *  4. the state map, where an unknown word must pass through on READ and
 *     THROW on write — a request stuck in a state no screen can explain is
 *     worse than a refused save;
 *  5. the two response whitelists, EXACTLY — this is the boundary between one
 *     company's screen and another company's order book, and the failure mode
 *     of a field riding along is silence.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REQUEST_HEADERS, REQUEST_TAB, REQUEST_STATES, isRequestState,
  requestStateFromSheet, requestStateToSheet, isCancellable,
  cairoStamp, cairoYear, stampMinutes, canonicalStamp, latinDigits,
  reqIdKey, nextReqId, jobMarker, reqIdFromNotes,
  pieceWeightG, requestUnit, qtyKgFor, piecesForKg, UNIT_PIECES, UNIT_KG,
  findReplay, REPLAY_WINDOW_MIN, MAX_OPEN_REQUESTS,
  PORTAL_REQUEST_KEYS, PORTAL_ORDER_KEYS, portalRequest, portalOrder,
  portalOrderStatus, cardStep,
} from "../lib/customer-requests.ts";
import { clientKey, clientKeysOf, belongsToCustomer } from "../lib/customer-link.ts";

/* ------------------------------- the tab --------------------------------- */

test("the header row is sixteen bilingual cells in the declared field order", () => {
  assert.equal(REQUEST_HEADERS.length, 16);
  assert.equal(REQUEST_TAB, "طلبات العملاء");
  for (const h of REQUEST_HEADERS) {
    const [ar, en] = h.split("\n");
    assert.ok(ar && en, `«${h}» must be "ar\\nen"`);
  }
  // The four collisions designed out of the wording (lib/sheet-entities.ts
  // pins where each one lands; these are the words that make that possible).
  const ar = REQUEST_HEADERS.map((h) => h.split("\n")[0]);
  assert.equal(ar[1], "تاريخ الطلب");
  assert.equal(ar[9], "التاريخ المطلوب");
  assert.equal(ar[15], "تاريخ القرار");
  assert.ok(ar.every((x) => x !== "تاريخ"), "no bare «تاريخ» header");
  assert.equal(ar[6], "العدد المطلوب");
  assert.equal(ar[8], "الكمية بالكيلو");
  assert.equal(ar[11], "حالة الطلب");
  // D is «اسم العميل», not «العميل» — C contains the latter whole.
  assert.equal(ar[2], "رقم العميل");
  assert.equal(ar[3], "اسم العميل");
  assert.ok(REQUEST_HEADERS[2].toLowerCase().includes("العميل\nclient"), "the collision that forced the rename");
});

/* -------------------------------- states --------------------------------- */

test("the four states map both ways, and the Arabic is the sheet's", () => {
  assert.deepEqual([...REQUEST_STATES], ["pending", "accepted", "rejected", "cancelled"]);
  assert.equal(requestStateToSheet("pending"), "قيد المراجعة");
  assert.equal(requestStateToSheet("accepted"), "مقبول");
  assert.equal(requestStateToSheet("rejected"), "مرفوض");
  assert.equal(requestStateToSheet("cancelled"), "ألغاه العميل");
  for (const s of REQUEST_STATES) {
    assert.equal(requestStateFromSheet(requestStateToSheet(s)), s, s);
    assert.ok(isRequestState(s));
  }
});

test("an unknown state passes through on READ and THROWS on write", () => {
  // Read: a word typed by hand in the sheet renders as itself. Forcing it into
  // «قيد المراجعة» would make a decided request look open again.
  assert.equal(requestStateFromSheet("تحت التسعير"), "تحت التسعير");
  assert.equal(requestStateFromSheet("  مقبول  "), "accepted", "whitespace folds");
  // A blank cell is a row nobody has decided.
  assert.equal(requestStateFromSheet(""), "pending");
  assert.equal(requestStateFromSheet(null), "pending");
  // Write: refuse, never guess.
  for (const junk of ["Pending", "open", "accepted ", "", "قيد المراجعه"]) {
    assert.throws(() => requestStateToSheet(junk), /unknown request state/, JSON.stringify(junk));
  }
  assert.equal(isRequestState("Pending"), false);
});

test("only a pending request can be withdrawn", () => {
  assert.ok(isCancellable("pending"));
  for (const s of ["accepted", "rejected", "cancelled", "تحت التسعير", ""]) {
    assert.equal(isCancellable(s), false, s);
  }
});

/* ---------------------------- reference numbers --------------------------- */

test("the next reference number follows the highest of ITS OWN year", () => {
  assert.equal(nextReqId([], 2026), "REQ-2026-0001");
  assert.equal(nextReqId(["REQ-2026-0001", "REQ-2026-0002"], 2026), "REQ-2026-0003");
  // A gap is left alone — the highest wins, not the count.
  assert.equal(nextReqId(["REQ-2026-0001", "REQ-2026-0007"], 2026), "REQ-2026-0008");
  // The YEAR ROLL: last year's numbers do not carry over.
  assert.equal(nextReqId(["REQ-2026-0041", "REQ-2026-0042"], 2027), "REQ-2027-0001");
  // …and a row already carrying next year's number is still not reissued.
  assert.equal(nextReqId(["REQ-2026-0041", "REQ-2027-0001"], 2027), "REQ-2027-0002");
  // Four digits, and past 9999 it simply grows.
  assert.equal(nextReqId(["REQ-2026-9999"], 2026), "REQ-2026-10000");
});

test("a reference number is never one the tab already holds", () => {
  // Typed by hand, in Arabic digits, lower case, with stray spaces — every
  // shape that a naive max() would hand out a second time.
  assert.equal(reqIdKey("req-2026-0003"), "REQ-2026-0003");
  assert.equal(reqIdKey(" REQ-٢٠٢٦-٠٠٠٤ "), "REQ-2026-0004");
  assert.equal(reqIdKey(""), "");
  assert.equal(reqIdKey(null), "");
  const held = ["REQ-2026-0001", "req-2026-0002", "REQ-٢٠٢٦-٠٠٠٣"];
  const next = nextReqId(held, 2026);
  assert.equal(next, "REQ-2026-0004");
  assert.ok(!held.map(reqIdKey).includes(next));
  // A row whose number is junk contributes nothing and breaks nothing.
  assert.equal(nextReqId(["", null, undefined, "غير متاح", "Job 12"], 2026), "REQ-2026-0001");
});

test("the work order's hidden marker round-trips", () => {
  assert.equal(jobMarker("REQ-2026-0001"), "[REQ-2026-0001]");
  assert.equal(jobMarker("req-2026-0001"), "[REQ-2026-0001]");
  assert.equal(reqIdFromNotes("طلب عميل [REQ-2026-0001] — مستعجل"), "REQ-2026-0001");
  assert.equal(reqIdFromNotes("[req-2026-0012]"), "REQ-2026-0012");
  assert.equal(reqIdFromNotes("[REQ-٢٠٢٦-٠٠٩٩]"), "REQ-2026-0099");
  assert.equal(reqIdFromNotes(reqIdFromNotes("x") + jobMarker("REQ-2027-0005")), "REQ-2027-0005");
  // Nothing that is not a marker is read as one.
  for (const s of ["", "REQ-2026-0001", "[REQ-2026]", "[JOB-2026-0001]", null, undefined]) {
    assert.equal(reqIdFromNotes(s), "", JSON.stringify(s));
  }
});

/* ------------------------------- the clock -------------------------------- */

test("the Cairo stamp is «yyyy-mm-dd HH:MM», and its year is the number's year", () => {
  const stamp = cairoStamp(Date.UTC(2026, 8, 23, 10, 30)); // 23 Sep 2026, 12:30 Cairo
  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(stamp.slice(0, 10), "2026-09-23");
  assert.equal(cairoYear(Date.UTC(2026, 8, 23, 10, 30)), 2026);
  // Midnight is 00:xx, never 24:xx (Intl's hour12:false can answer 24).
  // January, because Cairo keeps summer time from April to October and the
  // offset would otherwise have to be restated every time tzdata moves.
  assert.match(cairoStamp(Date.UTC(2026, 0, 22, 22, 5)), /^2026-01-23 00:05$/);
});

test("two stamps compare in whole minutes", () => {
  assert.equal(stampMinutes("2026-09-23 12:30")! - stampMinutes("2026-09-23 12:15")!, 15);
  assert.equal(stampMinutes("2026-09-24 00:00")! - stampMinutes("2026-09-23 23:45")!, 15);
  assert.equal(stampMinutes("2026-09-23 9:05"), stampMinutes("2026-09-23 09:05"), "Sheets drops a leading zero");
  for (const junk of ["", "23/09/2026", "2026-09-23", "غير متاح", null, undefined]) {
    assert.equal(stampMinutes(junk), null, JSON.stringify(junk));
  }
  assert.equal(latinDigits("٢٠٢٦"), "2026");
});

test("a stamp is read back the way SHEETS renders it, not the way it was written", () => {
  // The site appends «2026-09-23 14:05» as text, but both transports enter a
  // value USER_ENTERED: Sheets parses it into a DateTime cell and hands back
  // its own rendering. A strict ISO match answered null for every row in the
  // tab, which made findReplay — the at-least-once protection — INERT.
  const iso = stampMinutes("2026-09-23 14:05");
  assert.equal(stampMinutes("9/23/2026 14:05:00"), iso, "the workbook's m/d/yyyy rendering");
  assert.equal(stampMinutes("09/23/2026 14:05"), iso, "padded, still unambiguous");
  assert.equal(stampMinutes("23/09/2026 14:05:00"), iso, "day-first, unambiguous the other way");
  assert.equal(stampMinutes("2026/9/23 14:05"), iso, "ISO-ish with slashes");
  assert.equal(stampMinutes("'2026-09-23 14:05"), iso, "a text-forced cell keeps its apostrophe");
  assert.equal(stampMinutes("٢٠٢٦-٠٩-٢٣ ١٤:٠٥"), iso, "Arabic-Indic digits");
  // Ambiguous pairs follow the workbook's own rule (lib/dates.ts): whichever
  // part exceeds 12 wins, else the zero-padding tell — unpadded is
  // Sheets-rendered and therefore month-first.
  assert.equal(stampMinutes("9/5/2026 08:00"), stampMinutes("2026-09-05 08:00"));
  assert.equal(stampMinutes("09/05/2026 08:00"), stampMinutes("2026-05-09 08:00"));
  // Still refused: no clock at all, or a clock that is not one.
  for (const junk of ["9/23/2026", "2026-09-23 25:00", "2026-09-23 12:75", "غير متاح", ""]) {
    assert.equal(stampMinutes(junk), null, JSON.stringify(junk));
  }
});

test("canonicalStamp puts every shape back into «yyyy-mm-dd HH:MM»", () => {
  // One conversion on read is what keeps the staff queue's sort, the portal
  // card's date and the replay guard reading the same thing.
  assert.equal(canonicalStamp("9/23/2026 14:05:00"), "2026-09-23 14:05");
  assert.equal(canonicalStamp("2026-09-23 9:05"), "2026-09-23 09:05");
  assert.equal(canonicalStamp("2026-09-23 14:05"), "2026-09-23 14:05", "already canonical");
  assert.equal(canonicalStamp("غير متاح"), "", "unreadable is empty, never a guess");
  assert.equal(canonicalStamp(""), "");
  assert.equal(canonicalStamp(null), "");
  // What it produces must read back as itself.
  assert.equal(stampMinutes(canonicalStamp("9/23/2026 14:05:00")), stampMinutes("2026-09-23 14:05"));
});

/* --------------------------- quantities and units ------------------------- */

test("the unit follows Master's weight cell — the first number in it, or nothing", () => {
  // Every shape the live column holds.
  assert.equal(pieceWeightG("14جم للقطعه"), 14);
  assert.equal(pieceWeightG("0.9 للقطعة (21.6 للطلقة)"), 0.9);
  assert.equal(pieceWeightG("21.6 ALL pieces"), 21.6);
  assert.equal(pieceWeightG(15), 15);
  for (const junk of ["", "غير متاح / N/A", "حسب الطلب", null, undefined, "0", "0 جم"]) {
    assert.equal(pieceWeightG(junk), 0, JSON.stringify(junk));
  }
  assert.equal(requestUnit("14جم للقطعه"), UNIT_PIECES);
  assert.equal(requestUnit("حسب الطلب"), UNIT_KG, "no readable weight ⇒ kilograms");
  assert.equal(requestUnit(""), UNIT_KG);
});

test("kilograms are derived from pieces, and never the other way round by accident", () => {
  assert.equal(qtyKgFor(5000, UNIT_PIECES, 12.5), 62.5);
  assert.equal(qtyKgFor(3, UNIT_PIECES, 14), 0);        // 42 g rounds to 0.0 kg
  assert.equal(qtyKgFor(1000, UNIT_PIECES, 0), 1000, "no weight ⇒ the number is already kg");
  assert.equal(qtyKgFor(120.44, UNIT_KG, 14), 120.4, "one decimal, the kilogram column's precision");
  for (const bad of [0, -5, NaN]) assert.equal(qtyKgFor(bad, UNIT_PIECES, 14), 0, String(bad));
  // Back the other way, for a work order the factory typed in kilograms.
  assert.equal(piecesForKg(62.5, 12.5), 5000);
  assert.equal(piecesForKg(62.5, 0), null, "never a zero piece count");
  assert.equal(piecesForKg(0, 12.5), null);
});

/* -------------------------------- replay ---------------------------------- */

const row = (over: Partial<Parameters<typeof findReplay>[0][number]> = {}) => ({
  reqId: "REQ-2026-0001",
  productKey: "غطاء احمر جديد",
  qtyAsked: 5000,
  unit: UNIT_PIECES,
  wantedDate: "2026-10-01",
  submittedAt: "2026-09-23 12:00",
  ...over,
});

test("the same submit inside the window is the SAME request, not a second one", () => {
  const want = { productKey: "غطاء احمر جديد", qtyAsked: 5000, unit: UNIT_PIECES, wantedDate: "2026-10-01" };
  assert.equal(findReplay([row()], want, "2026-09-23 12:00"), "REQ-2026-0001", "the instant retry");
  assert.equal(findReplay([row()], want, "2026-09-23 12:14"), "REQ-2026-0001");
  assert.equal(findReplay([row()], want, `2026-09-23 12:${REPLAY_WINDOW_MIN}`), "REQ-2026-0001", "the edge is inside");
  // Past the window it is a person ordering the same thing again, which they
  // are entitled to do.
  assert.equal(findReplay([row()], want, "2026-09-23 12:16"), "");
  assert.equal(findReplay([row()], want, "2026-09-24 12:00"), "");
});

test("a replay differs in NOTHING — one field apart is a new request", () => {
  const base = { productKey: "غطاء احمر جديد", qtyAsked: 5000, unit: UNIT_PIECES, wantedDate: "2026-10-01" };
  const now = "2026-09-23 12:05";
  assert.equal(findReplay([row()], base, now), "REQ-2026-0001");
  assert.equal(findReplay([row()], { ...base, qtyAsked: 5001 }, now), "");
  assert.equal(findReplay([row()], { ...base, productKey: "غطاء احمر قديم" }, now), "");
  assert.equal(findReplay([row()], { ...base, unit: UNIT_KG }, now), "");
  assert.equal(findReplay([row()], { ...base, wantedDate: "2026-10-02" }, now), "");
  // A row whose stamp cannot be read is skipped, never matched by default.
  assert.equal(findReplay([row({ submittedAt: "" })], base, now), "");
  // And a submit with no product key matches nothing at all.
  assert.equal(findReplay([row()], { ...base, productKey: "" }, now), "");
  assert.equal(findReplay([], base, now), "");
});

test("a retry still matches when the sheet hands the stamp back re-rendered", () => {
  // The live failure this pins: the row is in the tab, its «تاريخ الطلب» cell
  // reads «9/23/2026 12:00:00», and the phone retries on factory wifi. Before
  // the fix every row was skipped and the retry wrote a SECOND request row
  // with a new reference number.
  const want = { productKey: "غطاء احمر جديد", qtyAsked: 5000, unit: UNIT_PIECES, wantedDate: "2026-10-01" };
  assert.equal(findReplay([row({ submittedAt: "9/23/2026 12:00:00" })], want, "2026-09-23 12:05"), "REQ-2026-0001");
  assert.equal(findReplay([row({ submittedAt: "9/23/2026 12:00:00" })], want, "2026-09-23 12:30"), "", "and the window still ends");
});

test("five open requests is the cap", () => {
  assert.equal(MAX_OPEN_REQUESTS, 5);
});

/* ------------------------------ whitelists -------------------------------- */

test("a request answers with EXACTLY these twelve keys", () => {
  assert.deepEqual(Object.keys(portalRequest({})), [...PORTAL_REQUEST_KEYS]);
  // Anything handed in that is not on the list is dropped, not passed through.
  const built = portalRequest({ reqId: "REQ-2026-0001", product: "غطاء", ...( {
    client: "المصرية الذكية", clientNo: 7, masterRow: 412, decidedBy: "sales@x",
    note: "ok", row: 9,
  } as Record<string, unknown>) });
  assert.deepEqual(Object.keys(built), [...PORTAL_REQUEST_KEYS]);
  for (const leak of ["client", "clientNo", "masterRow", "decidedBy", "row"]) {
    assert.equal(leak in built, false, `${leak} leaked into a portal request`);
  }
});

test("an order answers with EXACTLY these nine keys — no machine, no scrap, no staff progress", () => {
  // MOVED DELIBERATELY on 2026-10-07, at the owner's word after he signed in
  // with a customer account ("I only see my orders, not how many were made"):
  // `produced` was on the leak list below and is now the ninth key. It is the
  // ONLY key that moved — and what it carries is the attributed, client-
  // filtered count from lib/customer-progress.ts, never a job's own figure
  // (tests/portal-access.test.ts pins that the route does not read one).
  assert.deepEqual([...PORTAL_ORDER_KEYS], [
    "code", "product", "qtyKg", "qtyPieces", "startDate", "dueDate", "status", "reqId",
    "produced",
  ]);
  assert.deepEqual(Object.keys(portalOrder({ status: "not_started" })), [...PORTAL_ORDER_KEYS]);
  const built = portalOrder({ code: "Job 012", status: "in_production", ...({
    machine: "PQ 7 — 100", moldCode: "6", material: "ABS", remaining: 1000,
    scrapped: 12, operator: "أحمد", priority: "High", notes: "[REQ-2026-0001] عاجل",
    pieceWeightG: 12.5, cavities: 4, cycleSec: 18, client: "المصرية الذكية",
    lastMachine: "PQ 7 — 100", progress: 80, percent: 80, runs: [], estHours: 12,
  } as Record<string, unknown>) });
  assert.deepEqual(Object.keys(built), [...PORTAL_ORDER_KEYS]);
  for (const leak of [
    "machine", "moldCode", "material", "remaining", "scrapped",
    "operator", "priority", "notes", "pieceWeightG", "cavities", "cycleSec", "client",
    "lastMachine", "progress", "percent", "runs", "estHours",
  ]) {
    assert.equal(leak in built, false, `${leak} leaked into a portal order`);
  }
  // The two keys the whitelists share are the only ones that may.
  const shared = [...PORTAL_REQUEST_KEYS].filter((k) => ([...PORTAL_ORDER_KEYS] as string[]).includes(k));
  assert.deepEqual(shared.sort(), ["product", "qtyKg", "reqId"].sort());
});

test("the produced count is null unless the route hands one in — never a zero by default", () => {
  assert.equal(portalOrder({ status: "in_production" }).produced, null);
  assert.equal(portalOrder({ status: "in_production", produced: null }).produced, null);
  assert.equal(portalOrder({ status: "in_production", produced: 0 }).produced, 0, "a real zero is kept");
  assert.equal(portalOrder({ status: "in_production", produced: 4000 }).produced, 4000);
  // Whole pieces, and nothing that is not a count gets through.
  assert.equal(portalOrder({ status: "in_production", produced: 12.6 }).produced, 13);
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "4000", {}, undefined]) {
    assert.equal(
      portalOrder({ status: "in_production", produced: bad as unknown as number }).produced, null,
      `${String(bad)} must not reach the customer as a count`,
    );
  }
});

test("a piece count is null, never zero, when Master has no weight", () => {
  assert.equal(portalOrder({ status: "completed" }).qtyPieces, null);
  assert.equal(portalOrder({ status: "completed", qtyPieces: 0 }).qtyPieces, 0, "a real zero is kept");
});

/* ----------------------------- the status ladder -------------------------- */

test("«متوقف» is shown as «جاري التشغيل» — a stoppage is not an order state", () => {
  assert.equal(portalOrderStatus("On Hold", true), "in_production");
  assert.equal(portalOrderStatus("In Production", true), "in_production");
  assert.equal(portalOrderStatus("Not Started", true), "not_started");
  assert.equal(portalOrderStatus("", true), "not_started");
  assert.equal(portalOrderStatus("Completed", false), "completed");
  assert.equal(portalOrderStatus("Delivered", false), "completed");
  // A hand-typed closing word arrives as `open: false` from isOpenOrder.
  assert.equal(portalOrderStatus("ملغي", false), "completed");
  // …and a hand-typed word that is NOT closing is a row nobody has moved.
  assert.equal(portalOrderStatus("تحت التسعير", true), "not_started");
});

test("one card, six steps — the request's state until it is accepted, the order's after", () => {
  assert.equal(cardStep("pending", null), "submitted");
  assert.equal(cardStep("rejected", null), "rejected");
  assert.equal(cardStep("cancelled", null), "cancelled");
  assert.equal(cardStep("accepted", null), "approved", "approved but the order has not appeared yet");
  assert.equal(cardStep("accepted", { status: "not_started" }), "approved");
  assert.equal(cardStep("accepted", { status: "in_production" }), "running");
  assert.equal(cardStep("accepted", { status: "completed" }), "done");
  // A refusal or a withdrawal wins over whatever an order row says — those two
  // are the customer's own half of the story.
  assert.equal(cardStep("rejected", { status: "in_production" }), "rejected");
  assert.equal(cardStep("cancelled", { status: "completed" }), "cancelled");
  // An unknown sheet word is not "approved".
  assert.equal(cardStep("تحت التسعير", null), "submitted");
});

/* ----------------------- the filter these rows are read by ---------------- */

test("a request row belongs to the account by the SAME exact rule as a work order", () => {
  const keys = clientKeysOf([{ no: 7, name: "المصرية الذكية", aliases: ["المصريه الذكيه للعدادات", "ايداكو "] }]);
  assert.ok(belongsToCustomer("المصرية الذكية", keys), "the canonical name");
  assert.ok(belongsToCustomer("المصريه الذكيه للعدادات", keys), "an owner-approved alias");
  assert.ok(belongsToCustomer("ايداكو", keys), "the live trailing space folds");
  assert.equal(belongsToCustomer("المصرية", keys), false, "never a substring");
  assert.equal(belongsToCustomer("غير متاح / N/A", keys), false, "the house filler is not a client");
  assert.equal(belongsToCustomer("", keys), false);
  // The row the site WRITES carries the canonical name, so it matches by
  // construction — which is what makes a customer's own request visible to
  // them however the factory spells the name elsewhere.
  assert.ok(keys.has(clientKey("المصرية الذكية")));
});
