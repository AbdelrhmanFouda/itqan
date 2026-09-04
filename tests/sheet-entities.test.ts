/**
 * The sheet's shape (lib/sheet-entities.ts), pinned against the HEADER ROWS
 * the live workbook actually has — read through the bridge on 2026-09-04 and
 * copied here verbatim, bilingual "ar\nen" cells included.
 *
 * Two directions, both of which have bitten before:
 *
 *  READ   — for each field, which column it resolves to (colIndex: the first
 *           header containing any keyword). A field that resolves to the
 *           WRONG column reads someone else's data; one that resolves to −1
 *           reads nothing, silently — «plannedMin» on «الإنتاج» is the
 *           documented case (CLAUDE.md, "the trap").
 *  APPEND — for each real header, which field's value lands in it
 *           (appendRecord: the first FIELD whose keyword the header contains).
 *           A header claimed by the wrong field is a silent write into the
 *           wrong column: «تسمية الماكينة» was claimed by `name` until today.
 *
 * When the workbook gains a column, paste the new header row here and see
 * what moved — that is the whole point of this file.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ENTITIES, colIndex, findHeaderRow, normHeader, splitLabel, clean,
} from "../lib/sheet-entities.ts";

/* ------------------------------ fixtures --------------------------------- */
// Each value is the FULL tab prefix up to and including the header row, as the
// bridge returned it (title rows above the header are kept: findHeaderRow has
// to find the header among them).

const HEADERS: Record<string, string[][]> = {
  molds: [
    ["Molds — الاسطمبات (مرتبط)", "", "", "", "", "", "", ""],
    ["الرقم\nNo.", "العميل\nClient", "المنتج / الاسطمبة\nProduct / Mold", "كود الاسطمبة\nMold Code", "زمن الدورة\nCycle Time", "أسوأ زمن الدورة (ث)\nWorst Cycle (s)", "العامل\nWorker", "نشط\nActive"],
  ],
  products: [
    ["Products — المنتجات (مرتبط)", "", "", "", "", "", "", "", "", "", ""],
    ["الرقم\nNo.", "العميل\nClient", "المنتج\nProduct", "الوزن\nWeight", "نوع الخام\nMaterial", "عدد الكافيتي\nCavities", "زمن الدورة\nCycle", "أسوأ زمن الدورة (ث)\nWorst Cycle (s)", "الماكينة\nMachine", "العيوب المحتملة\nDefects", "التاريخ\nDate"],
  ],
  clients: [
    ["Clients — عملاء اتقان", "", "", "", "إجمالي العملاء", "64", "إجمالي المنتجات", "512", "", "", "", ""],
    ["عدد المنتجات يُحسب تلقائياً ", "", "", "", "", "", "", "", "", "", "", ""],
    ["الرقم\nNo.", "العميل\nClient", "عدد المنتجات\nProducts", "آخر طلب\nLast Order", "الشخص المسؤول\nContact Person", "الهاتف\nPhone", "البريد الإلكتروني\nEmail", "العنوان\nAddress", "نوع العميل\nType", "الحالة\nStatus", "شروط الدفع\nPayment Terms", "ملاحظات\nNotes"],
  ],
  production: [
    ["التاريخ\nDate", "الوردية\nShift", "الماكينة\nMachine", "كود الاسطمبة\nMold Code", "أسم المنتج\nProd name", "العميل\nClient", "نوع الخام\nMaterial", "إنتاج سليم\nGood Units", "الأجمالي سستم\n System Total", "هالك\nScrap Units", "حالة السجل\nRow Check", "زمن التوقف (دقيقة)\nDowntime Min", "سبب التوقف\nDowntime Reason", "العامل\nOperator", "ملاحظات\nNotes"],
  ],
  machines: [
    ["#", "الماكينة\nMachine", "أسم المنتج\nProd name", "كود الماكينة\nMachine code", "الشركة المصنعة\n manufacture", "الحالة\nStatus", "طول الوردية (دقيقة)\nShift Length", "Active on", "", "تسمية الماكينة\nMachine Label (auto)"],
  ],
  jobs: [
    ["كود الأمر\nJob Code", "تاريخ البدء\nStart Date", "العميل\nClient", "المنتج\nProduct", "كود الاسطمبة\nMold Code", "الكمية المطلوبة (كجم)\nQty Ordered (kg)", "الماكينة\nMachine", "الخامة المصروفة (كجم)\nMaterial Issued (kg)", "الماستر باتش\nMasterbatch", "تاريخ التسليم\nDue Date", "الحالة\nStatus", "الأولوية\nPriority", "التعليمات\nInstructions", "ملاحظات\nNotes", "حالة الربط\nLink Check", "الخامة (من الرئيسي)\nMaterial (Master)", "وزن الحبة (جم)\nPiece Weight (g)", "عدد الكافيتي\nCavities", "زمن الدورة (ث)\nCycle (s)", "المطلوب بالقطعة\nOrdered (pcs)", "الإنتاج الفعلي (قطعة)\nProduced (pcs)", "المتبقي (قطعة)\nRemaining (pcs)", "نسبة الإنجاز\nProgress %", "الزمن المتوقع (ساعة)\nEst. Hours"],
  ],
  downtime: [
    ["التاريخ\nDate", "الماكينة\nMachine", "سبب التوقف\nReason", "زمن التوقف (دقيقة)\nDowntime (min)", "بداية التوقف\nStarted", "نهاية التوقف\nEnded", "تقديري؟\nEstimated?", "سُجل بواسطة\nLogged by", "ملاحظات\nNotes"],
  ],
  issues: [
    ["التاريخ\nDate", "الماكينة\nMachine", "المنتج\nProduct", "التصنيف\nCategory", "الوصف\nDescription", "الإجراء\nAction", "الحالة\nStatus", "ملاحظات\nNotes"],
  ],
  master: [
    ["Master — المصدر الرئيسي (حرّر هنا فقط)", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["ID\nID", "العميل\nCustomer", "المنتج / الاسطمبة\nProduct / Mold", "كود الاسطمبة\nMold Code", "الفئة\nCategory", "الوزن\nWeight", "نوع الخام\nMaterial", "الإضافات\nAdditives", "عدد الكافيتي\nCavities", "زمن الدورة\nCycle", "أسوأ زمن الدورة (ث)\nWorst Cycle (s)", "الماكينة\nMachine", "العيوب المحتملة\nDefects", "العامل\nWorker", "التاريخ\nDate", "نشط\nActive", "ملاحظات\nNotes"],
  ],
};

/** field → column index, for every field of the entity (−1 = no column). */
function readMap(entity: string): Record<string, number> {
  const cfg = ENTITIES[entity];
  const values = HEADERS[entity];
  const headers = values[findHeaderRow(values, cfg.fields)];
  const out: Record<string, number> = {};
  for (const f of cfg.fields) out[f.key] = colIndex(headers, f.keywords);
  return out;
}

/** header → field key that an append hands the column to ("" = left blank). */
function appendMap(entity: string): string[] {
  const cfg = ENTITIES[entity];
  const values = HEADERS[entity];
  const headers = values[findHeaderRow(values, cfg.fields)];
  return headers.map((hd) => {
    const h = normHeader(hd);
    const f = cfg.fields.find((x) => x.keywords.some((k) => h.includes(k)));
    return f ? f.key : "";
  });
}

/* ------------------------------ coverage ---------------------------------- */

test("every entity the site reads has a header fixture here", () => {
  assert.deepEqual(Object.keys(ENTITIES).sort(), Object.keys(HEADERS).sort());
});

test("the header row is found beneath the title rows, not on them", () => {
  assert.equal(findHeaderRow(HEADERS.master, ENTITIES.master.fields), 1);
  assert.equal(findHeaderRow(HEADERS.molds, ENTITIES.molds.fields), 1);
  assert.equal(findHeaderRow(HEADERS.clients, ENTITIES.clients.fields), 2, "«العملاء» headers sit at row 3");
  assert.equal(findHeaderRow(HEADERS.production, ENTITIES.production.fields), 0);
  assert.equal(findHeaderRow(HEADERS.downtime, ENTITIES.downtime.fields), 0);
});

/* --------------------------- READ direction ------------------------------- */

test("«الرئيسي» (master): every field lands on its own column, including the three read since 2026-09-04", () => {
  assert.deepEqual(readMap("master"), {
    id: 0, client: 1, name: 2, code: 3, category: 4, cavities: 8, worstCycle: 10, cycle: 9,
    weight: 5, material: 6, defects: 12, machine: 11, active: 15, notes: 16,
  });
});

test("«الإنتاج» (production): what is there, and what is NOT", () => {
  assert.deepEqual(readMap("production"), {
    date: 0, shift: 1,
    // There is NO «كود الماكينة» column in this tab — the label («PQ 1 — 550»)
    // sits in C «الماكينة». machineKeyOf() falls back to `machine` for that.
    machineCode: -1, machine: 2,
    mold: 3, product: 4, client: 5, material: 6,
    // No planned-minutes column exists: every run arrives with plannedMin 0
    // and resolvePlannedMin() must supply the shift length (CLAUDE.md, "the trap").
    plannedMin: -1,
    goodUnits: 7, scrapUnits: 9, systemTotal: 8, rowCheck: 10,
    openCavities: -1, // vestigial — the per-run column was dropped from the workbook
    downtimeReason: 12, downtimeMin: 11, operator: 13, note: 14,
  });
});

test("«الإنتاج»: «هالك» and «الأجمالي سستم» are two different columns — scrap must never read the counter", () => {
  const m = readMap("production");
  assert.notEqual(m.scrapUnits, m.systemTotal);
  assert.equal(m.scrapUnits, 9);
  assert.equal(m.systemTotal, 8);
});

test("«التوقفات» (downtime): four headers contain «التوقف» and each field still gets its own", () => {
  assert.deepEqual(readMap("downtime"), {
    date: 0, machine: 1, reason: 2, minutes: 3, start: 4, end: 5, estimated: 6, loggedBy: 7, notes: 8,
  });
});

test("«أوامر العمل» (jobs): the manual columns A:N, and none of the computed O:X spill", () => {
  const m = readMap("jobs");
  assert.deepEqual(m, {
    moldCode: 4, code: 0, client: 2, product: 3, qty: 5, startDate: 1, dueDate: 9, machine: 6,
    materialIssued: 7, masterbatch: 8, status: 10, priority: 11, instructions: 12, notes: 13,
  });
  for (const [k, v] of Object.entries(m)) assert.ok(v < 14, `${k} points into the computed spill (col ${v})`);
});

test("«الماكينات» (machines): the registry columns, and the computed label read from J", () => {
  assert.deepEqual(readMap("machines"), {
    code: 3, label: 9, name: 1, product: 2, manufacturer: 4, shiftLength: 6, active: 5,
  });
});

test("«الاسطمبات» / «المنتجات» views and «العملاء» / «الأعطال»", () => {
  assert.deepEqual(readMap("molds"), { code: 3, name: 2, client: 1, worstCycle: 5, cycle: 4, operator: 6, active: 7 });
  assert.deepEqual(readMap("products"), {
    name: 2, client: 1, weight: 3, material: 4, cavities: 5, worstCycle: 7, cycle: 6, machine: 8, defects: 9, date: 10,
  });
  assert.deepEqual(readMap("clients"), {
    name: 1, products: 2, lastOrder: 3, contact: 4, phone: 5, email: 6, address: 7, type: 8, status: 9, payment: 10, notes: 11,
  });
  assert.deepEqual(readMap("issues"), {
    date: 0, machine: 1, product: 2, category: 3, description: 4, action: 5, status: 6, note: 7,
  });
});

test("no two fields of one entity resolve to the same column", () => {
  for (const entity of Object.keys(ENTITIES)) {
    const m = readMap(entity);
    const seen = new Map<number, string>();
    for (const [k, v] of Object.entries(m)) {
      if (v < 0) continue;
      assert.equal(seen.has(v), false, `${entity}: ${k} and ${seen.get(v)} both read column ${v}`);
      seen.set(v, k);
    }
  }
});

/* -------------------------- APPEND direction ------------------------------ */

test("«الإنتاج»: an appended run lands every value in its own column", () => {
  assert.deepEqual(appendMap("production"), [
    "date", "shift", "machine", "mold", "product", "client", "material", "goodUnits",
    "systemTotal", "scrapUnits", "rowCheck", "downtimeMin", "downtimeReason", "operator", "note",
  ]);
});

test("«التوقفات»: the field ORDER keeps a stoppage's minutes out of its reason column", () => {
  assert.deepEqual(appendMap("downtime"), [
    "date", "machine", "reason", "minutes", "start", "end", "estimated", "loggedBy", "notes",
  ]);
});

test("«أوامر العمل»: an appended job never writes into the computed O:X spill", () => {
  const m = appendMap("jobs");
  assert.deepEqual(m.slice(0, 14), [
    "code", "startDate", "client", "product", "moldCode", "qty", "machine", "materialIssued",
    "masterbatch", "dueDate", "status", "priority", "instructions", "notes",
  ]);
  assert.deepEqual(m.slice(14), Array(10).fill(""), "O:X must stay unclaimed — a value there breaks the spill for every row below");
});

test("«الماكينات»: an appended machine leaves «تسمية الماكينة» (J, computed) and «Active on» EMPTY", () => {
  // Found 2026-09-04: «تسمية الماكينة\nMachine Label (auto)» contains «الماكينة»
  // and «machine», so `name` used to claim it and "Add machine" wrote the
  // tonnage over the computed label. The `label` decoy field now takes it,
  // and appendRecord is never handed a value for it.
  assert.deepEqual(appendMap("machines"), [
    "", "name", "product", "code", "manufacturer", "active", "shiftLength", "", "", "label",
  ]);
  assert.equal(ENTITIES.machines.fields.findIndex((f) => f.key === "label") <
               ENTITIES.machines.fields.findIndex((f) => f.key === "name"), true,
               "`label` must be declared before `name` or the header goes to name again");
});

test("«الأعطال»: the assistant's log_issue append fills every column", () => {
  assert.deepEqual(appendMap("issues"), [
    "date", "machine", "product", "category", "description", "action", "status", "note",
  ]);
});

test("«العملاء»: «نوع العميل» would be claimed by `name` on an append — so nothing may append to clients", () => {
  // The header «نوع العميل\nType» contains «العميل». Reads are fine (name
  // resolves to B first); an APPEND would write the client's name into the
  // type column as well. Pinned so that whoever adds a clients append sees it.
  const m = appendMap("clients");
  assert.equal(m[1], "name");
  assert.equal(m[8], "name", "known: the type column is claimed by name — fix the keywords before appending clients");
  const src = allSource();
  assert.equal(/appendRecord\(\s*["']clients["']/.test(src), false, "a clients append exists — fix the «نوع العميل» collision first");
});

test("Master is never appended to (the register and the job page only update rows)", () => {
  assert.equal(/appendRecord\(\s*["']master["']/.test(allSource()), false);
});

/* --------------------------- the helpers ---------------------------------- */

test("normHeader zero-pads a bare hour and lowercases — the 8:00 / 9:00 fix", () => {
  assert.equal(normHeader("8:00"), "08:00");
  assert.equal(normHeader("9:00"), "09:00");
  assert.equal(normHeader("11:00"), "11:00");
  assert.equal(normHeader("21:00"), "21:00");
  assert.equal(normHeader("Mold Code"), "mold code");
  assert.equal(normHeader(undefined), "");
});

test("splitLabel gives both languages of a bilingual header, and the same text twice for a plain one", () => {
  assert.deepEqual(splitLabel("العميل\nClient"), { ar: "العميل", en: "Client" });
  assert.deepEqual(splitLabel("الأجمالي سستم\n System Total"), { ar: "الأجمالي سستم", en: "System Total" });
  assert.deepEqual(splitLabel("Active on"), { ar: "Active on", en: "Active on" });
});

test("clean() turns the deliberate filler into blank and collapses whitespace", () => {
  for (const v of ["غير متاح / N/A", "N/A", "n/a", "-", "—", "", "   "]) assert.equal(clean(v), "", `«${v}»`);
  assert.equal(clean("  PQ 7   —  100 "), "PQ 7 — 100");
  assert.equal(clean("زراير\t"), "زراير", "a trailing tab is whitespace");
});

/* -------------------------------- utils ----------------------------------- */

function allSource(): string {
  const root = path.resolve(import.meta.dirname, "..");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  for (const d of ["app", "lib", "components"]) walk(path.join(root, d));
  return out.join("\n");
}
