/**
 * «اسأل Claude» — what the sheet knows about the machine and the mould of an
 * issue, gathered for the listener, and the check that an issue the phone
 * sent is the row the sheet holds.
 *
 * Two rules decide everything here:
 *
 *  1. BOUNDED. All the reads share ONE budget (HISTORY_BUDGET_MS). A part
 *     that has not answered by then is left out and NAMED in `missing`; the
 *     question is handed over anyway. A slow sheet never holds a question
 *     back, and it never stops anybody logging an issue — this file is only
 *     reached from the «اسأل Claude» routes.
 *
 *  2. «غير متاح / N/A» IS NOT ZERO. `getRecords` has already turned the
 *     filler into "", and here a blank number stays `null` — "not recorded".
 *     A run's scrap goes through the one rule (lib/scrap.ts): `none` is
 *     unknown, and is sent as null with `scrapSource: "none"`.
 *
 * A tab that could not be read answers with no fields at all (lib/sheets.ts),
 * which is how "not read" is told from "read, nothing there".
 */
import { getRecords, type SheetRecord } from "@/lib/sheets";
import { loadDowntimeRecords } from "@/lib/downtime-data";
import { loadIssues, identityOf, type Issue } from "@/lib/issues-data";
import { sameIssue } from "@/lib/issues";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { machineKeyOf } from "@/lib/run-join";
import { resolveScrap } from "@/lib/scrap";
import { moldKey, resolveMoldNumber } from "@/lib/mold-number";
import { downtimeReasonAr } from "@/lib/prod-meta";
import type { AskIssue } from "@/lib/ask";

export const HISTORY_BUDGET_MS = 6000;
export const VERIFY_BUDGET_MS = 4000;
const STOPPAGE_DAYS = 30;
const MAX_STOPPAGES = 40;
const MAX_SHIFTS = 10;
const MAX_ISSUES = 10;

const LATE: unique symbol = Symbol("late");
type Late = typeof LATE;
/** `p`, or LATE when it has not answered in `ms` (or threw) — never a rejection. */
function within<T>(p: Promise<T>, ms: number): Promise<T | Late> {
  return new Promise<T | Late>((resolve) => {
    const timer = setTimeout(() => resolve(LATE), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(LATE); },
    );
  });
}

/** A cell as a number, or null when nothing was recorded there. */
function numOrNull(v: string | undefined): number | null {
  const s = latinDigits(String(v ?? "")).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const text = (v: string | undefined | null): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

/* ------------------------------ the issue check --------------------------- */

type ClientIssue = Record<string, unknown>;
const str = (v: unknown, max = 600) => String(v ?? "").trim().slice(0, max);

function fromSheet(i: Issue): AskIssue {
  return {
    row: i.row, date: i.date, machine: i.machine, product: i.product, category: i.category,
    description: i.description, action: i.action, status: i.status, note: i.note,
    issueAudioId: i.issueAudio?.id ?? "", solutionAudioId: i.solutionAudio?.id ?? "",
    verified: true,
  };
}

/**
 * The issue a question is about. The phone sends the issue as it saw it; the
 * sheet is asked (bounded) whether that row is still that issue. Yes → the
 * sheet's own row is kept. No, or no answer in time → what the phone sent is
 * kept, marked `verified: false`, with NO recording ids (an id is only
 * trusted when it came off the sheet).
 */
export async function resolveIssue(raw: unknown): Promise<AskIssue | null> {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as ClientIssue;
  const sent: AskIssue = {
    row: Number.isInteger(Number(c.row)) && Number(c.row) > 0 ? Number(c.row) : 0,
    date: str(c.date, 40), machine: str(c.machine, 80), product: str(c.product, 160), category: str(c.category, 40),
    description: str(c.description, 2000), action: str(c.action, 2000), status: str(c.status, 40), note: str(c.note, 1000),
    issueAudioId: "", solutionAudioId: "", verified: false,
  };
  if (!sent.date && !sent.machine && !sent.product && !sent.description) return null;

  const loaded = await within(loadIssues(), VERIFY_BUDGET_MS);
  if (loaded === LATE) return sent;
  const expect = { date: sent.date, machine: sent.machine, product: sent.product, description: sent.description };
  const at = loaded.issues.find((i) => i.row === sent.row && sameIssue(expect, identityOf(i)));
  // Rows shift when one is deleted above: the same issue on another row is still it.
  const hit = at ?? [...loaded.issues].reverse().find((i) => sameIssue(expect, identityOf(i)));
  return hit ? fromSheet(hit) : sent;
}

/* --------------------------------- history -------------------------------- */

export type AskHistory = {
  /** «الرئيسي» for the product — null when the name is not there, or is there twice. */
  mould: null | {
    number: string | null; numberSource: string; client: string | null; material: string | null;
    cavities: string | null; cycleSec: string | null; weightG: string | null;
    knownDefects: string | null; notes: string | null; duplicatedName: boolean;
  };
  /** «التوقفات» for the machine, last 30 days, newest first. */
  machineStoppages: { date: string; reason: string; minutes: number | null; estimated: boolean; loggedBy: string | null; note: string | null }[];
  /** «الإنتاج» — the machine's last shifts, newest first. */
  machineShifts: Shift[];
  /** «الإنتاج» — the product's last shifts, on any machine, newest first. */
  mouldShifts: Shift[];
  /** «الأعطال» — earlier issues on the same product, newest first. */
  mouldIssues: PastIssue[];
  /** «الأعطال» — earlier issues on the same machine, newest first. */
  machineIssues: PastIssue[];
};
type Shift = {
  date: string; shift: string | null; machine: string | null; product: string | null;
  goodUnits: number | null; scrapUnits: number | null; scrapSource: "logged" | "system" | "none"; rowCheck: string | null;
};
type PastIssue = { date: string; machine: string | null; product: string | null; category: string | null; description: string | null; action: string | null; status: string | null };

export type HistoryResult = { history: AskHistory | null; historyMissing: boolean; missing: string[] };

const isoDaysAgo = (days: number, now: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

function shiftOf(r: SheetRecord): Shift {
  const scrap = resolveScrap(r);
  return {
    date: normalizeDate(r.date),
    shift: text(r.shift),
    machine: text(machineKeyOf(r.machineCode, r.machine)),
    product: text(r.product),
    goodUnits: numOrNull(r.goodUnits),
    scrapUnits: scrap.source === "none" ? null : scrap.scrapUnits,
    scrapSource: scrap.source,
    rowCheck: text(r.rowCheck),
  };
}

const newestFirst = <T extends { date: string }>(list: T[]) => [...list].reverse().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/**
 * The sheet's history for one issue. `history` is null only for a general
 * question (no issue). Otherwise every part that answered in time is filled
 * and the rest are listed in `missing`; `historyMissing` is true when any is.
 */
export async function buildHistory(issue: AskIssue | null, now: number = Date.now()): Promise<HistoryResult> {
  if (!issue) return { history: null, historyMissing: false, missing: [] };
  const machine = issue.machine.trim();
  const product = moldKey(issue.product);
  const deadline = HISTORY_BUDGET_MS;

  const [stoppages, production, issues, master] = await Promise.all([
    machine ? within(loadDowntimeRecords(), deadline) : Promise.resolve([]),
    within(getRecords("production"), deadline),
    within(loadIssues(), deadline),
    product ? within(getRecords("master"), deadline) : Promise.resolve(null),
  ]);

  const missing: string[] = [];
  const h: AskHistory = { mould: null, machineStoppages: [], machineShifts: [], mouldShifts: [], mouldIssues: [], machineIssues: [] };

  // An empty «التوقفات» cannot be told from a failed read here, so an empty
  // answer is reported as missing rather than as "no stoppages".
  if (stoppages === LATE || (machine && stoppages.length === 0)) missing.push("stoppages");
  else {
    const since = isoDaysAgo(STOPPAGE_DAYS, now);
    h.machineStoppages = stoppages
      .filter((s) => s.machine === machine && s.date >= since)
      .slice(0, MAX_STOPPAGES)
      .map((s) => ({
        date: s.date, reason: downtimeReasonAr(s.reason), minutes: s.minutes > 0 ? s.minutes : null,
        estimated: s.estimated, loggedBy: text(s.createdBy), note: text(s.notes),
      }));
  }

  if (production === LATE || production.fields.length === 0) missing.push("shifts");
  else {
    const rows = production.records.filter((r) => normalizeDate(r.date) && (r.product || "").trim());
    const all = newestFirst(rows.map(shiftOf));
    if (machine) h.machineShifts = all.filter((s) => s.machine === machine).slice(0, MAX_SHIFTS);
    if (product) h.mouldShifts = all.filter((s) => moldKey(s.product) === product).slice(0, MAX_SHIFTS);
  }

  if (issues === LATE) missing.push("issues");
  else {
    const past = (i: Issue): PastIssue => ({
      date: normalizeDate(i.date) || i.date, machine: text(i.machine), product: text(i.product), category: text(i.category),
      description: text(i.description), action: text(i.action), status: text(i.status),
    });
    const others = issues.issues.filter((i) => !(issue.verified && i.row === issue.row)).reverse();
    if (product) h.mouldIssues = others.filter((i) => moldKey(i.product) === product).slice(0, MAX_ISSUES).map(past);
    if (machine) h.machineIssues = others.filter((i) => i.machine.trim() === machine).slice(0, MAX_ISSUES).map(past);
  }

  if (product) {
    if (master === LATE || master === null || master.fields.length === 0) missing.push("mould");
    else {
      const rows = master.records.filter((r) => moldKey(r.name) === product);
      if (rows.length > 0) {
        const m = rows[0];
        const n = resolveMoldNumber({ code: m.code, notes: m.notes });
        h.mould = {
          number: text(n.number), numberSource: n.source, client: text(m.client), material: text(m.material),
          cavities: text(m.cavities), cycleSec: text(m.cycle), weightG: text(m.weight),
          knownDefects: text(m.defects), notes: text(m.notes),
          // Master holds some names twice; the first row is shown and the listener is told.
          duplicatedName: rows.length > 1,
        };
      }
    }
  }

  return { history: h, historyMissing: missing.length > 0, missing };
}
