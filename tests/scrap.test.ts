/**
 * The scrap rules — pinned because Quality is computed from them on every page
 * and a wrong answer here is silent everywhere.
 *
 * These replaced the «تسجيل الإنتاج» distribution tests on 2026-08-27, when that
 * tab was removed from the workbook and «الإنتاج» became the only place a run's
 * scrap lives. The behaviour the old tests protected — logged scrap wins, and
 * nothing is ever invented for a row that was not counted — is still pinned
 * below, because those were the properties that mattered, not the join.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScrap } from "../lib/scrap.ts";

const row = (good: string, scrap: string, system: string) => ({
  goodUnits: good, scrapUnits: scrap, systemTotal: system,
});

test("«هالك» wins whenever it is filled", () => {
  assert.deepEqual(resolveScrap(row("560", "140", "700")), { scrapUnits: 140, source: "logged" });
});

test("a logged ZERO is a real answer, not a blank", () => {
  // «سليم» with nothing scrapped is a measurement. It must not fall through to
  // the سستم rule and it must not read as "unknown".
  assert.deepEqual(resolveScrap(row("560", "0", "999")), { scrapUnits: 0, source: "logged" });
});

test("blank «هالك» falls back to سستم − سليم", () => {
  assert.deepEqual(resolveScrap(row("594", "", "614")), { scrapUnits: 20, source: "system" });
});

test("«الفعلي أكبر من العداد» yields no scrap, not a negative one", () => {
  // 56 rows read this on the day the rule landed: the hand count exceeds the
  // machine counter. The difference is not scrap and is refused, not clamped.
  assert.deepEqual(resolveScrap(row("700", "", "560")), { scrapUnits: 0, source: "none" });
});

test("«لم يُعد بعد» — no هالك and no سستم — is UNKNOWN, reported as source none", () => {
  assert.deepEqual(resolveScrap(row("4850", "", "")), { scrapUnits: 0, source: "none" });
});

test("«غير متاح / N/A» filler counts as blank, never as a zero", () => {
  assert.deepEqual(resolveScrap(row("500", "غير متاح / N/A", "غير متاح / N/A")), {
    scrapUnits: 0, source: "none",
  });
  assert.deepEqual(resolveScrap(row("500", "N/A", "600")), { scrapUnits: 100, source: "system" });
});

test("display formatting survives: thousands separators and Arabic-Indic digits", () => {
  assert.deepEqual(resolveScrap(row("4,850", "", "5,000")), { scrapUnits: 150, source: "system" });
  assert.deepEqual(resolveScrap(row("٥٠٠", "٢٥", "")), { scrapUnits: 25, source: "logged" });
});

test("a negative «هالك» never leaves the module negative", () => {
  assert.deepEqual(resolveScrap(row("500", "-10", "")), { scrapUnits: 0, source: "logged" });
});

test("سستم equal to سليم is measured zero scrap, not unknown", () => {
  assert.deepEqual(resolveScrap(row("600", "", "600")), { scrapUnits: 0, source: "system" });
});

test("numbers pass through as numbers, not only as sheet text", () => {
  assert.deepEqual(resolveScrap({ goodUnits: 560, scrapUnits: null, systemTotal: 700 }), {
    scrapUnits: 140, source: "system",
  });
});
