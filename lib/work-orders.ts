/**
 * Work-order rules — «أوامر العمل» as the production manager uses it from a
 * phone (2026-09-09 brief: the order flow screens).
 *
 * Pure and import-free on purpose, like lib/run-join.ts and lib/scrap.ts:
 * Node's test runner loads it directly (tests/work-orders.test.ts) and the
 * list page, the API and the stock screen share ONE reading of each rule
 * instead of re-deriving "is this order still open" three ways.
 *
 * Every rule here answers a defect that is LIVE in the tab today (read through
 * the bridge on 2026-09-09):
 *
 *  - `Pro/tec 01` exists twice (rows 15 and 16, due 27 and 23 Aug) — a job
 *    code is not unique unless something refuses the second one;
 *  - the machine column holds «ماكينة 100», «220», «280» while the registry
 *    («الماكينات»!J) speaks «PQ 7 — 100» — no work order can be joined to a
 *    production row, so a machine value must be a registry label or be shown
 *    as unmatched, never guessed;
 *  - one row holds «3100» and «3.1طن» in the same kilogram column — a quantity
 *    is a plain number in the column's unit or it is UNREADABLE; a unit is
 *    never parsed out of free text (3.1 is not 3,100);
 *  - 7 of 10 orders sit at «لم يبدأ» / «متوقف» with no due date — the list
 *    must show that state, not hide it.
 */

/* ------------------------------- statuses -------------------------------- */

/** The app's status tokens (lib/prod-meta.ts JOB_STATUSES), in the order the
 *  list shows them: what is running first, then what is waiting to start,
 *  then what is paused. Done orders come last (collapsed). */
export const OPEN_ORDER_STATUSES = ["In Production", "Not Started", "On Hold"] as const;
export const DONE_ORDER_STATUSES = ["Completed", "Delivered"] as const;

/**
 * Words a hand-typed status cell may hold for a finished or cancelled order,
 * outside the sheet's four validated values (the brief names «ملغي», which is
 * NOT in «أوامر العمل»!K's dropdown — it can only arrive typed). Compared after
 * `foldWord`, so «ملغى» and «ملغي» are one word.
 */
const CLOSED_WORDS = new Set([
  "مكتمل", "ملغي", "ملغاه", "منتهي", "تم التسليم", "تم", "completed", "delivered", "cancelled", "canceled", "done", "closed",
].map(foldWord));

/** Fold Arabic spelling choices + case + whitespace for word comparison. */
export function foldWord(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "")   // harakat, superscript alef, Quranic marks
    .replace(/ـ/g, "")                                           // tatweel
    .replace(/[​-‏؜﻿]/g, "")                      // zero-width + bidi marks
    .replace(/[أإآٱ]/g, "ا")                 // أ إ آ ٱ → ا
    .replace(/[ىئ]/g, "ي")                             // ى ئ → ي
    .replace(/ة/g, "ه")                                     // ة → ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this order still OPEN — i.e. does it still reserve its quantity and
 * belong at the top of the list? Open = not completed, not delivered, not a
 * cancelled/finished word. A blank status is "not started yet" → open.
 */
export function isOpenOrder(status: string | undefined | null): boolean {
  const s = String(status ?? "").trim();
  if (!s) return true;
  if ((DONE_ORDER_STATUSES as readonly string[]).includes(s)) return false;
  return !CLOSED_WORDS.has(foldWord(s));
}

/* ------------------------------ job codes -------------------------------- */

/** Arabic-Indic / Persian digits → ASCII. Copied from lib/dates.ts (zero imports). */
export function latinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

const FILLER = new Set(["", "-", "—", "–", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح"]);

/**
 * The identity of a job code for the duplicate check: digits Latin, case and
 * whitespace folded. `Pro/tec 01` and `pro/tec  01` are the same order;
 * `Pro/tec 02` is not. Filler («-», blank) is "" — a row with no code is not
 * a duplicate of another row with no code, it is a row with no code.
 */
export function codeKey(code: string | undefined | null): string {
  const k = latinDigits(String(code ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
  return FILLER.has(k) ? "" : k;
}

export type DuplicateCode = { key: string; code: string; ids: string[] };

/** Every code that appears on more than one row, with the rows that carry it. */
export function duplicateCodes<T extends { id: string; code: string }>(jobs: readonly T[]): DuplicateCode[] {
  const byKey = new Map<string, { code: string; ids: string[] }>();
  for (const j of jobs) {
    const k = codeKey(j.code);
    if (!k) continue;
    const e = byKey.get(k) ?? { code: j.code.trim(), ids: [] };
    e.ids.push(j.id);
    byKey.set(k, e);
  }
  return Array.from(byKey.entries())
    .filter(([, e]) => e.ids.length > 1)
    .map(([key, e]) => ({ key, code: e.code, ids: e.ids }));
}

/* ------------------------------ quantities ------------------------------- */

export type ParsedQuantity = {
  /** The number, when the cell IS a plain number in the column's unit. */
  value: number | null;
  /** The cell holds something that is not a plain number («3.1طن», «كتير»).
   *  Never parsed: a unit written inside the cell cannot be trusted to be the
   *  column's unit, and 3.1 read out of «3.1طن» is wrong by a thousand. */
  unreadable: boolean;
  raw: string;
};

/**
 * A quantity cell → a number in the COLUMN's unit, or nothing.
 *
 * Accepts digits (Latin or Arabic-Indic), one decimal point, thousands
 * separators («3,100» — Sheets renders them) and a leading minus. Blank and
 * the house filler are `null` and NOT unreadable — the planner has not typed
 * a quantity yet, which the UI states as such. Anything else is unreadable.
 */
export function parseQuantity(raw: string | number | undefined | null): ParsedQuantity {
  const text = String(raw ?? "").trim();
  const folded = latinDigits(text).replace(/\s+/g, " ").toLowerCase();
  if (FILLER.has(folded)) return { value: null, unreadable: false, raw: text };
  const s = folded.replace(/[،٫٬,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: Number(s), unreadable: false, raw: text };
  return { value: null, unreadable: true, raw: text };
}

/* ------------------------------- machines -------------------------------- */

/**
 * A machine label's comparison key. The registry writes «PQ 7 — 100» (an em
 * dash, from the J formula); a hand-typed «PQ 7 - 100» or «PQ7—100» is the
 * same machine and must match; «ماكينة 100» and «220» are not registry
 * values and must not — tonnage alone is ambiguous (PQ 5 and PQ 7 are both
 * 100 t), so nothing here guesses a machine from a number.
 */
export function machineLabelKey(label: string | undefined | null): string {
  return latinDigits(String(label ?? ""))
    .replace(/[—–‒‐‑−\-]+/g, "-") // every dash → "-"
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export type MachineMatch = { matched: boolean; label: string };

/**
 * Resolve a work order's machine cell against the registry labels. `label` is
 * the REGISTRY's spelling when matched (what the site should write back), else
 * the cell as it is (shown as unmatched, never rewritten).
 */
export function machineMatch(value: string | undefined | null, registryLabels: readonly string[]): MachineMatch {
  const v = String(value ?? "").trim();
  if (!v) return { matched: false, label: "" };
  const k = machineLabelKey(v);
  const hit = registryLabels.find((l) => machineLabelKey(l) === k);
  return hit ? { matched: true, label: hit } : { matched: false, label: v };
}

/* ---------------------------- dates and lateness ------------------------- */

/** Whole days from `dueIso` to `todayIso` (positive = late). ISO yyyy-mm-dd both. */
export function daysLate(dueIso: string, todayIso: string): number {
  const d = Date.UTC(+dueIso.slice(0, 4), +dueIso.slice(5, 7) - 1, +dueIso.slice(8, 10));
  const t = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  return Math.round((t - d) / 86_400_000);
}

/** An OPEN order whose due date has passed. A done order is never late. */
export function isLate(o: { status: string; dueDate: string }, todayIso: string): boolean {
  return isOpenOrder(o.status) && !!o.dueDate && o.dueDate < todayIso;
}

/** An OPEN order with no due date — the "visibly incomplete" state. */
export function hasNoDue(o: { status: string; dueDate: string }): boolean {
  return isOpenOrder(o.status) && !o.dueDate;
}

/* -------------------------------- ordering -------------------------------- */

/**
 * Due date ascending, no due date LAST (it is flagged, not hidden), then the
 * newest row first so two undated orders keep a stable order.
 */
export function compareByDue(a: { dueDate: string; id: string }, b: { dueDate: string; id: string }): number {
  const ad = a.dueDate || "9999", bd = b.dueDate || "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return Number(b.id) - Number(a.id);
}

export type OrderGroup<T> = { status: string; open: boolean; jobs: T[] };

/**
 * The list's shape: open orders first, grouped by status in
 * OPEN_ORDER_STATUSES order, each group sorted by due date; any status the
 * sheet holds outside the four (a hand-typed word) gets its own group after
 * the three, still counted as open unless it is a closed word; done orders
 * last. Empty groups are omitted.
 */
export function groupOrders<T extends { status: string; dueDate: string; id: string }>(jobs: readonly T[]): OrderGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const j of jobs) {
    const s = j.status || "Not Started";
    const arr = buckets.get(s) ?? [];
    arr.push(j);
    buckets.set(s, arr);
  }
  const order: string[] = [...OPEN_ORDER_STATUSES];
  const others = Array.from(buckets.keys()).filter(
    (s) => !(OPEN_ORDER_STATUSES as readonly string[]).includes(s) && !(DONE_ORDER_STATUSES as readonly string[]).includes(s),
  );
  // unknown OPEN words before unknown CLOSED words, both alphabetically stable
  others.sort((a, b) => Number(isOpenOrder(b)) - Number(isOpenOrder(a)) || a.localeCompare(b));
  order.push(...others, ...DONE_ORDER_STATUSES);
  const out: OrderGroup<T>[] = [];
  for (const s of order) {
    const arr = buckets.get(s);
    if (!arr || arr.length === 0) continue;
    out.push({ status: s, open: isOpenOrder(s), jobs: [...arr].sort(compareByDue) });
  }
  return out;
}

/* -------------------------------- actions --------------------------------- */

/**
 * The one-tap transitions the list offers. "Status is the go-ahead": moving
 * an order to «جاري التشغيل» IS the instruction to start — there is no
 * separate approval step (owner's brief). Every target is one of the four
 * values «أوامر العمل»!K accepts, so a tap can never write a value the
 * sheet's validation refuses.
 */
export type OrderAction = "start" | "resume" | "hold" | "complete";

export function nextActions(status: string | undefined | null): OrderAction[] {
  switch ((status ?? "").trim()) {
    case "":
    case "Not Started": return ["start"];
    case "On Hold": return ["resume"];
    case "In Production": return ["complete", "hold"];
    default: return [];
  }
}

export function statusAfter(action: OrderAction): string {
  switch (action) {
    case "start":
    case "resume": return "In Production";
    case "hold": return "On Hold";
    case "complete": return "Completed";
  }
}
