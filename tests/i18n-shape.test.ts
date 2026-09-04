/**
 * i18n: the `en` and `ar` halves of every string table MUST keep the same
 * shape (CLAUDE.md, Conventions). Until 2026-09-04 nothing checked it — a key
 * added to one language rendered `undefined` in the other, in production,
 * with every test green.
 *
 * Also pinned: the index-aligned arrays that `localize()` pairs with the
 * canonical lists in lib/prod-meta.ts (a label list one entry short shows the
 * wrong translation for every value after the gap), and the role labels the
 * layout looks up by role.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../lib/i18n.ts";
import { pd } from "../lib/i18n.prod.ts";
import { ad } from "../lib/i18n.auth.ts";
import { ag } from "../lib/i18n.agent.ts";
import { sd } from "../lib/i18n.storage.ts";
import { mr } from "../lib/i18n.register.ts";
import { ALL_ROLES } from "../lib/roles.ts";
import {
  MACHINE_STATUSES, MOLD_STATUSES, JOB_STATUSES, JOB_PRIORITIES, DOWNTIME_REASONS, SHIFTS,
} from "../lib/prod-meta.ts";

type Table = { en: unknown; ar: unknown };
const TABLES: Record<string, Table> = { t, pd, ad, ag, sd, mr };

/** Every leaf of a value as "path = kind" lines; arrays contribute their length. */
function shape(v: unknown, at = ""): string[] {
  if (Array.isArray(v)) return [`${at} = array[${v.length}]`, ...v.flatMap((x, i) => shape(x, `${at}[${i}]`))];
  if (v && typeof v === "object") {
    return Object.keys(v as object).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], at ? `${at}.${k}` : k));
  }
  return [`${at} = ${typeof v}`];
}

/** Every leaf string with its path. */
function leaves(v: unknown, at = ""): [string, string][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${at}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v as object).flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k));
  }
  return typeof v === "string" ? [[at, v]] : [];
}

test("every string table has the same shape in English and Arabic", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    assert.deepEqual(shape(table.en), shape(table.ar), `${name}: en and ar differ in shape`);
  }
});

test("no translation is an empty string", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    for (const lang of ["en", "ar"] as const) {
      for (const [at, s] of leaves(table[lang])) {
        assert.ok(s.trim().length > 0, `${name}.${lang}.${at} is empty`);
      }
    }
  }
});

test("the Arabic half is actually Arabic where it is prose (spot-check the page titles)", () => {
  // Product codes and brand names are allowed to be Latin; the titles are not.
  const arabic = /[؀-ۿ]/;
  for (const s of [pd.ar.overview.title, pd.ar.jobs.title, pd.ar.runs.title, mr.ar.title, mr.ar.number, sd.ar.title, ad.ar.auth.signOut]) {
    assert.ok(arabic.test(s), `«${s}» is not Arabic`);
  }
  for (const s of [pd.en.overview.title, pd.en.jobs.title, mr.en.title, mr.en.number]) {
    assert.equal(arabic.test(s), false, `«${s}» is not English`);
  }
});

test("localize() label lists are index-aligned with their canonical lists", () => {
  for (const lang of ["en", "ar"] as const) {
    assert.equal(pd[lang].runs.reasons.length, DOWNTIME_REASONS.length, `${lang} runs.reasons`);
    assert.equal(pd[lang].runs.shifts.length, SHIFTS.length, `${lang} runs.shifts`);
    assert.equal(pd[lang].jobs.statuses.length, JOB_STATUSES.length, `${lang} jobs.statuses`);
    assert.equal(pd[lang].jobs.priorities.length, JOB_PRIORITIES.length, `${lang} jobs.priorities`);
    assert.equal(pd[lang].molds.statuses.length, MOLD_STATUSES.length, `${lang} molds.statuses`);
    assert.equal(t[lang].dashboard.machineStatuses.length, MACHINE_STATUSES.length, `${lang} dashboard.machineStatuses`);
  }
  // The English half IS the canonical list, in order — that is what makes the
  // Arabic half's index meaningful.
  assert.deepEqual([...pd.en.runs.reasons], DOWNTIME_REASONS);
  assert.deepEqual([...pd.en.jobs.statuses], JOB_STATUSES);
  assert.deepEqual([...pd.en.jobs.priorities], JOB_PRIORITIES);
  assert.deepEqual([...pd.en.runs.shifts], SHIFTS);
});

test("every role has a label in both languages — the header shows a.roles[profile.role]", () => {
  for (const role of ALL_ROLES) {
    for (const lang of ["en", "ar"] as const) {
      const label = (ad[lang].roles as Record<string, string>)[role];
      assert.ok(label && label.trim(), `${lang}: no label for role ${role}`);
    }
  }
});

test("the mould-number strings exist in both languages (added 2026-09-04)", () => {
  for (const lang of ["en", "ar"] as const) {
    assert.ok(mr[lang].number && mr[lang].numberFromNotes && mr[lang].notesNumber && mr[lang].noNumber, lang);
    assert.ok(pd[lang].jobs.moldNumber && pd[lang].jobs.moldNumberNotes && pd[lang].runs.moldNumber, lang);
  }
});
