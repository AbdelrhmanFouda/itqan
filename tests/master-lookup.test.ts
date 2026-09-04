/**
 * Master row lookup by product NAME (lib/master-lookup.ts), pinned with the
 * live work orders of 2026-09-04 and the Master rows they collided with.
 *
 * The failure this guards: matching "mould code OR name, first row wins"
 * returned another customer's product for five of the ten live jobs, because
 * customers number their own tool sets from 1 and codes repeat across Master.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { masterRowByName, masterRowForDisplay, nameKey } from "../lib/master-lookup.ts";
import { moldKey } from "../lib/mold-number.ts";

// The rows involved, as read through the bridge that day (name + code + client).
const MASTER = [
  { row: 173, name: "وش عداد 1", code: "3", client: "المصرية الذكية" },
  { row: 175, name: "كفر شفاف", code: "5", client: "المصرية الذكية" },
  { row: 176, name: "عدسه شفاف", code: "6", client: "المصرية الذكية" },
  { row: 177, name: "بطاريه كارت", code: "7", client: "المصرية الذكية" },
  { row: 289, name: "سماعة اريون", code: "332", client: "اريون" },
  { row: 448, name: "بصمه", code: "9", client: "مينا صبحي" },
  { row: 453, name: "سماعة اريون", code: "332", client: "اريون" },
  { row: 458, name: "منقار", code: "", client: "مينا صبحي" },
  { row: 460, name: "خابور", code: "", client: "مينا صبحي" },
  { row: 462, name: "حامل عجله", code: "11", client: "مينا صبحي" },
  { row: 465, name: "زراير\t", code: "6", client: "مينا صبحي" }, // the dropdown's trailing tab
];

// «أوامر العمل» rows: product + the customer's own mould code.
const JOBS = [
  { code: "1/1/26", product: "بصمه", moldCode: "9", expectRow: 448 },
  { code: "2/1/26", product: "خابور", moldCode: "12", expectRow: 460 },
  { code: "3/1/26", product: "زراير", moldCode: "6", expectRow: 465 },   // code 6 is ALSO «عدسه شفاف»
  { code: "4/1/26", product: "منقار", moldCode: "5", expectRow: 458 },   // code 5 is ALSO «كفر شفاف»
];

test("every live work order resolves to its OWN product, never to a row sharing its mould code", () => {
  for (const j of JOBS) {
    const m = masterRowByName(MASTER, j.product);
    assert.ok(m.ok, `${j.code} «${j.product}» should be found`);
    if (m.ok) assert.equal(m.row.row, j.expectRow, `${j.code} «${j.product}» resolved to the wrong row`);
  }
});

test("the three work orders whose product is not in Master are NOT_FOUND — not another customer's product", () => {
  // Their mould codes (3, 11, 7) all exist in Master on unrelated rows.
  for (const product of ["طقم محوري 44/29", "شاسية عجلة", "مسطره"]) {
    const m = masterRowByName(MASTER, product);
    assert.equal(m.ok, false);
    if (!m.ok) assert.equal(m.reason, "not_found", `«${product}» must be reported missing`);
  }
});

test("a duplicated name refuses to pick for a write, and says so", () => {
  const m = masterRowByName(MASTER, "سماعة اريون");
  assert.equal(m.ok, false);
  if (!m.ok) {
    assert.equal(m.reason, "identity_mismatch");
    assert.deepEqual(m.hits.map((r) => r.row), [289, 453]);
  }
});

test("a duplicated name still DISPLAYS the first row, flagged ambiguous", () => {
  const d = masterRowForDisplay(MASTER, "سماعة اريون");
  assert.equal(d.row?.row, 289);
  assert.equal(d.ambiguous, true);
  const u = masterRowForDisplay(MASTER, "بصمه");
  assert.equal(u.row?.row, 448);
  assert.equal(u.ambiguous, false);
  assert.equal(masterRowForDisplay(MASTER, "مسطره").row, null);
  assert.equal(masterRowForDisplay(MASTER, "").row, null);
});

test("the row the caller already holds wins while it still carries the name", () => {
  // The job page holds row 453 for «سماعة اريون» from an earlier read — an
  // edit must go to THAT row, not be refused for the duplicate.
  const m = masterRowByName(MASTER, "سماعة اريون", 453);
  assert.ok(m.ok);
  if (m.ok) assert.equal(m.row.row, 453);
  // …but a stale row that no longer carries the name is not trusted.
  const stale = masterRowByName(MASTER, "بصمه", 999);
  assert.ok(stale.ok);
  if (stale.ok) assert.equal(stale.row.row, 448, "re-resolved by name after the row moved");
});

test("nameKey and moldKey are the same folding — the two pure modules cannot import each other", () => {
  for (const v of ["زراير\t", "  وش عداد ١ ", "Product  ۱۲", "غير متاح / N/A", "N/A", "", undefined, "سماعة  اريون "]) {
    assert.equal(nameKey(v), moldKey(v), `«${v}» folds differently in the two modules`);
  }
});

test("whitespace, case and Arabic digits fold on both sides", () => {
  assert.equal((masterRowByName(MASTER, "زراير") as { ok: true; row: { row: number } }).row.row, 465);
  assert.equal((masterRowByName(MASTER, "  وش عداد ١ ") as { ok: true; row: { row: number } }).row.row, 173);
  const blank = masterRowByName(MASTER, "   ");
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.reason, "no_name");
});
