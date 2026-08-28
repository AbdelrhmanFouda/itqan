/**
 * The OEE path's cavity read. Run with `npm test`.
 *
 * lib/oee-data.ts builds each MoldStandard from Master with
 * `cavities: sumCavities(m.cavities)` — the same read lib/jobs.ts uses for
 * kg→pieces. Until 2026-08-28 it used a plain first-number parse, which read
 * the two-part mould «4+4» as 4: the standard then expected each piece to take
 * twice its real ideal time, so a mould running exactly at standard measured
 * ~200% of it — capped away as overspeedMin and flagged as a suspect standard,
 * losing the true speed signal for every multi-part mould.
 *
 * lib/oee-data.ts itself cannot be imported here (it pulls in "@/lib/sheets",
 * and Node's test runner does not resolve the @/ alias), so the wiring is
 * pinned two ways: the standard is built below exactly as oee-data builds it,
 * and the module's source is asserted directly — the same duplication-pinning
 * trick tests/arabic-only.test.ts uses on app/layout.tsx.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sumCavities } from "../lib/cavities.ts";
import { computeOEE, suspectStandards, type MoldStandard, type RunInput } from "../lib/oee.ts";

// A real Master row shape: cycle 30s, cavities «4+4» — 8 pieces per shot.
// Built the way buildOEEData builds it (cavities through sumCavities).
const standard: MoldStandard = { cycleSec: 30, cavities: sumCavities("4+4") };

// One 480-minute run at EXACTLY the mould's real rate:
// 30s ÷ 8 cavities = 0.0625 min/piece → 7680 pieces in 480 minutes.
const runs: RunInput[] = [{
  machine: "PQ 7 — 100", mold: "m1",
  plannedMin: 480, downtimeMin: 0, goodUnits: 7680, scrapUnits: 0,
}];

test("the standard built from Master's «4+4» carries 8 cavities", () => {
  assert.equal(standard.cavities, 8);
});

test("a two-part mould running at standard measures 100%, not a capped suspect", () => {
  const o = computeOEE(runs, new Map([["m1", standard]]));
  assert.equal(o.performance, 1);
  assert.equal(o.idealMin, 480);
  assert.equal(o.overspeedMin, 0); // nothing capped away — the rate is real
  assert.deepEqual(suspectStandards(runs, new Map([["m1", standard]])), []);
});

test("the old first-number read (4) misstated the same mould as a 200% suspect", () => {
  // What num(m.cavities) used to produce — kept as the contrast that shows
  // why the fix moves OEE numbers for multi-part moulds.
  const old: MoldStandard = { cycleSec: 30, cavities: 4 };
  const o = computeOEE(runs, new Map([["m1", old]]));
  assert.equal(o.overspeedMin, 480); // half the "ideal" minutes were phantom
  const sus = suspectStandards(runs, new Map([["m1", old]]));
  assert.equal(sus.length, 1);
  assert.equal(sus[0].ratio, 2);
});

test("lib/oee-data.ts routes Master's cavity cell through sumCavities", () => {
  const src = readFileSync(new URL("../lib/oee-data.ts", import.meta.url), "utf8");
  assert.match(src, /sumCavities\(m\.cavities\)/);
  assert.doesNotMatch(src, /num\(m\.cavities\)/);
});
