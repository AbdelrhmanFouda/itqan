/**
 * The rules for joining outside data onto a sheet production run.
 *
 * Downtime is not in the workbook: «الإنتاج»!J «زمن التوقف» has never been
 * filled in 418 rows and will not be — the sheet is frozen and stoppages are
 * captured on a phone into Firestore instead. THREE places now join those
 * minutes onto runs:
 *
 *   lib/oee-data.ts   → /performance, /api/oee, the AI review
 *   app/api/runs      → Overview, production, quality, finance
 *   lib/jobs.ts       → /api/jobs/[id], the job detail page
 *
 * They only produce the same total if the machine key, the planned minutes and
 * the stub rule are identical in all three, so those three rules live here and
 * are imported — never re-derived. Re-deriving them is exactly how the Overview
 * tile came to report 0 while /performance reported the real figure.
 *
 * This module has ZERO imports so Node's test runner can load it directly —
 * the same trade lib/downtime.ts and lib/oee.ts make. The digit fold below is
 * therefore a copy of latinDigits() from lib/dates; tests/run-join.test.ts
 * asserts the two still agree, so the copy cannot quietly drift.
 */

// Mirrors lib/dates.ts — both Arabic-Indic ranges fold to 0-9.
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
/** Arabic-Indic digits → Latin. Behaviour matches latinDigits() in lib/dates. */
export const latinDigits = (s: string): string =>
  s.replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10));

export const DEFAULT_SHIFT_MIN = 720; // 12h shift — also the capture form's default

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Arabic digits → Latin, lowercase, collapsed spaces. */
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The physical machine id for a run: the code label when logged, else the
 * tonnage. Tonnage alone is ambiguous — PQ 5 and PQ 7 are both 100 t — so the
 * code wins wherever the crew wrote one.
 */
export const machineKeyOf = (machineCode: string | undefined, machine: string | undefined) =>
  (machineCode || "").trim() || latinDigits((machine || "—").trim());

/** One row of the machines REGISTRY, structurally typed so this module needs no sheet types.
 *  The index signature matters: callers pass a SheetRecord ({row:number} &
 *  Record<string,string>), and TypeScript's weak-type check rejects that against
 *  an all-optional shape with no declared property in common. */
export type MachineRegistryRow = {
  shiftLength?: string;
  code?: string;
  name?: string;
  [k: string]: unknown;
};

/**
 * Planned minutes per machine, from the machines registry (one row per physical
 * machine, no dates). Indexed by code label ("PQ 7 — 100"), bare code and
 * tonnage, so whichever of the three spellings a run carries will hit.
 */
export function buildShiftLengthIndex(records: MachineRegistryRow[]): Map<string, number> {
  const lenByKey = new Map<string, number>();
  for (const m of records) {
    const len = num(m.shiftLength);
    if (len <= 0) continue;
    const code = (m.code || "").trim();
    const name = latinDigits((m.name || "").trim());
    const label = code ? `${code} — ${name}` : name ? `${name} — بدون كود` : "";
    for (const k of [label, code, name]) {
      const nk = normKey(k);
      if (nk && !lenByKey.has(nk)) lenByKey.set(nk, len);
    }
  }
  return lenByKey;
}

/** Which of the three sources supplied a run's planned time. */
export type PlannedSource = "column" | "registry" | "default";

export function plannedMinSource(
  ownPlannedMin: number,
  machineKey: string,
  rawMachine: string | undefined,
  lenByKey: Map<string, number>,
): PlannedSource {
  if (ownPlannedMin > 0) return "column";
  if (lenByKey.has(normKey(machineKey)) || lenByKey.has(normKey(rawMachine))) return "registry";
  return "default";
}

/**
 * Planned time for one run: its own planned column → the machine's registry
 * shift length → DEFAULT_SHIFT_MIN.
 *
 * This matters far more than it looks. «الإنتاج» has no planned-minutes column
 * at all, so `ownPlannedMin` is 0 on every row and the fallback is what supplies
 * the number. distributeDowntime() gives each run only `plannedMin − downtimeMin`
 * of headroom — leave plannedMin at 0 and there is no headroom anywhere, every
 * captured minute returns as `unallocatedMin`, and the join silently yields zero
 * while looking like it ran.
 */
export function resolvePlannedMin(
  ownPlannedMin: number,
  machineKey: string,
  rawMachine: string | undefined,
  lenByKey: Map<string, number>,
): number {
  if (ownPlannedMin > 0) return ownPlannedMin;
  return lenByKey.get(normKey(machineKey)) ?? lenByKey.get(normKey(rawMachine)) ?? DEFAULT_SHIFT_MIN;
}

/**
 * A row with nothing logged at all — no good units, no scrap, no downtime.
 *
 * Excluded from OEE, and held out of the downtime spread as well: an empty row
 * still carries planned minutes, so letting it absorb a share of the day's
 * stoppage in one place and not in another is precisely what makes two pages
 * print different totals for the same metric.
 */
// Takes Record<string, unknown> for the same weak-type reason as
// MachineRegistryRow above — the call sites pass a SheetRecord.
export const isStubRun = (r: Record<string, unknown>): boolean => {
  const blank = (v: unknown) => !v || !String(v).trim();
  return blank(r.goodUnits) && blank(r.scrapUnits) && blank(r.downtimeMin);
};
