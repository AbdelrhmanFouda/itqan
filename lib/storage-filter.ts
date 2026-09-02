/**
 * Storage («مخزن اتقان») search + location filtering.
 *
 * Pure and import-free on purpose: it is unit-tested (tests/storage-filter.test.ts)
 * and the page, the form and anything added later share ONE rule instead of each
 * re-deriving "what counts as the same location" or "which movements belong to
 * this stock line".
 *
 * Three things here are not obvious:
 *
 * 1. **Search is Arabic-folded.** The warehouse writes «إسطمبة» and «اسطمبه» for
 *    the same thing, and the sheet holds both spellings. Folding the alef family,
 *    ى/ي, ة/ه, tatweel, diacritics and Arabic-Indic digits is the difference
 *    between a search box that works and one that reads as broken. Terms are
 *    ANDed, so «A12 نايلون» narrows instead of returning everything.
 *
 * 2. **The location filter FOLDS CASE — the sheet deliberately does not.**
 *    «الرصيد الحالي» keys stock on the location string exactly as typed, so `a12`
 *    and `A12` are two separate balance lines (storage/CLAUDE.md open item 4: two
 *    stale lowercase rows are still in there). Physically they are one slot, so
 *    picking A12 must show both. Each row still displays its own spelling.
 *    ⚠ Never use locKey() to WRITE — a write must carry the exact string.
 *
 * 3. **"No location" is a filter value, not the absence of one.** A blank
 *    «الموقع» is stored as «غير متاح / N/A» and means "not filed anywhere yet" —
 *    worth being able to list on its own, so it gets the NO_LOCATION sentinel
 *    rather than being lumped in with "all".
 */

/* -------------------------------- numbers -------------------------------- */

/** "1,234.5" → 1234.5 ; anything unparseable → 0. */
export function toNumber(v: string | number | undefined | null): number {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* --------------------------------- search -------------------------------- */

// harakat + superscript alef + Quranic marks, and the decorative stretch
const AR_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

/** Fold a string to its searchable form. Latin lowercases; Arabic loses the
 *  spelling choices that are not meaningful when looking something up. */
export function normalizeText(s: string | number | undefined | null): string {
  return String(s ?? "")
    .replace(AR_DIACRITICS, "")
    .replace(TATWEEL, "")
    // Arabic-Indic and Persian digits → ASCII, so ٣ finds 3
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0623\u0625\u0622\u0671\u0672\u0673]/g, "\u0627") // أ إ آ ٱ ٲ ٳ → ا
    .replace(/[\u0649\u0626]/g, "\u064A")                        // ى ئ → ي
    .replace(/\u0624/g, "\u0648")                                // ؤ → و
    .replace(/\u0629/g, "\u0647")                                // ة → ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Split what the user typed into ANDed terms. */
export function searchTerms(q: string): string[] {
  return normalizeText(q).split(" ").filter(Boolean);
}

/** True when every term appears somewhere in the row's searchable fields. */
export function matchesTerms(fields: (string | undefined)[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = fields.map(normalizeText).filter(Boolean).join(" ");
  return terms.every((t) => hay.includes(t));
}

/* -------------------------------- locations ------------------------------- */

/** Sentinel for "rows with no location recorded". It cannot collide with a real
 *  location because locKey() upper-cases everything it returns. */
export const NO_LOCATION = "__none__";

// «غير متاح / N/A» never reaches here (lib/storage.ts cleans it to ""), but a
// hand-typed dash might.
const BLANK = new Set(["", "-", "—", "–"]);

/** The canonical grouping key for a location: trimmed, single-spaced, upper-cased. */
export function locKey(loc: string | undefined | null): string {
  const s = String(loc ?? "").replace(/\s+/g, " ").trim();
  return BLANK.has(s) ? "" : s.toUpperCase();
}

/** Does this row belong under the chosen filter? An empty filter means "all". */
export function sameLocation(rowLoc: string | undefined, filterKey: string): boolean {
  if (!filterKey) return true;
  const k = locKey(rowLoc);
  return filterKey === NO_LOCATION ? k === "" : k === filterKey;
}

/** The line a slot sits on — "A" for A11…A28, "F" for the floor zones, "" for
 *  named places like T or «رف». Used to group the chips the way the room is
 *  actually laid out (storage/CLAUDE.md → Location codes). */
export function locGroup(key: string): string {
  const m = /^([A-Z])\d+$/.exec(key);
  return m ? m[1] : "";
}

/** Shelf slots sort by line then by number (A2 before A11, which a string sort
 *  gets wrong); named zones come last, alphabetically. */
export function compareLocKey(a: string, b: string): number {
  if (a === b) return 0;
  // "no location" always sits at the end
  if (a === NO_LOCATION) return 1;
  if (b === NO_LOCATION) return -1;
  const ma = /^([A-Z])(\d+)$/.exec(a);
  const mb = /^([A-Z])(\d+)$/.exec(b);
  if (ma && mb) return ma[1] === mb[1] ? Number(ma[2]) - Number(mb[2]) : (ma[1] < mb[1] ? -1 : 1);
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, "ar");
}

export type LocationStat = {
  /** grouping key, or NO_LOCATION for the unfiled rows */
  key: string;
  /** how to print it — the sheet's own spelling wins over a row's */
  label: string;
  /** "A" | "B" | "C" | "F" | "" (named zone) */
  group: string;
  /** balance lines standing at this location */
  lines: number;
  /** movements ever logged at this location */
  moves: number;
  /** any balance line here is below zero */
  negative: boolean;
  /** has stock lines or history — as opposed to a slot that only exists on the list */
  inUse: boolean;
};

type LocRow = { loc?: string; avail?: string };

/**
 * Every location worth offering: the ones «أماكن التخزين» defines (through the
 * bridge's `lists.locations`), plus any that only appear in the data — a v3/v4.0
 * bridge does not send the list at all, and this page must still filter.
 */
export function collectLocations(
  balance: LocRow[],
  movements: { loc?: string }[],
  known: string[] = [],
): LocationStat[] {
  const map = new Map<string, LocationStat>();
  const at = (raw: string | undefined): LocationStat | null => {
    const key = locKey(raw);
    if (!key) return null;
    let s = map.get(key);
    if (!s) {
      s = { key, label: String(raw).trim(), group: locGroup(key), lines: 0, moves: 0, negative: false, inUse: false };
      map.set(key, s);
    }
    return s;
  };

  // the sheet's list first, so its spelling is the label
  known.forEach((k) => at(k));
  let unfiledLines = 0;
  let unfiledMoves = 0;

  balance.forEach((b) => {
    const s = at(b.loc);
    if (!s) { unfiledLines++; return; }
    s.lines++;
    s.inUse = true;
    if (toNumber(b.avail) < 0) s.negative = true;
  });
  movements.forEach((m) => {
    const s = at(m.loc);
    if (!s) { unfiledMoves++; return; }
    s.moves++;
    s.inUse = true;
  });

  const out = [...map.values()].sort((a, b) => compareLocKey(a.key, b.key));
  if (unfiledLines || unfiledMoves) {
    out.push({
      key: NO_LOCATION, label: "", group: "", lines: unfiledLines, moves: unfiledMoves,
      negative: false, inUse: true,
    });
  }
  return out;
}

/** Where an item is standing right now, biggest pile first — what a storekeeper
 *  needs before a withdrawal. Matches «الرصيد الحالي» on the balance KEY
 *  (item type + item + client), which is what the sheet sums on. */
export function whereIs(
  balance: { itemType: string; item: string; client: string; loc: string; avail: string; unit: string }[],
  item: string,
  itemType: string,
  client?: string,
): { loc: string; qty: number; unit: string }[] {
  const want = normalizeText(item);
  if (!want) return [];
  return balance
    .filter((b) =>
      normalizeText(b.item) === want &&
      normalizeText(b.itemType) === normalizeText(itemType) &&
      (client === undefined || normalizeText(b.client) === normalizeText(client)))
    .map((b) => ({ loc: b.loc, qty: toNumber(b.avail), unit: b.unit }))
    .filter((r) => r.qty !== 0)
    .sort((a, b) => b.qty - a.qty);
}

/* ------------------------------- the floor plan ------------------------------ */

/**
 * The room as it is actually built, from the owner's own hand drawing
 * (30 Aug 2026): **each box on the paper is a physical column**, and the four
 * numbers written around it are the four storage places on that column's two
 * sides. Line A is one row of columns, line B another, and the codes are
 * `<line><side><slot>` — so `A23` is line A, side 2, place 3.
 *
 * The drawing pins the grouping exactly: the bottom column carries 11 and 21
 * alone, then each column up carries a PAIR per side (12+13 / 22+23, then
 * 14+15 / 24+25, then 16+17 / 26+27), and the top one carries 18 and 28 alone.
 * That is `Math.floor(slot / 2) + 1` for every slot from 1 to 8 — no table
 * needed, and it keeps working if a line ever grows a ninth place.
 *
 * A line is only ever drawn if the data or «أماكن التخزين» mentions it: the
 * paper shows A and B, the code scheme allows C, and inventing a row of
 * columns that does not exist in the room would be worse than showing none.
 * Within a line the FULL grid is drawn, holes included — a place with nothing
 * in it is the whole point of a plan.
 */
const SLOT_RE = /^([A-Z])([12])([1-9])$/;
const ZONE_RE = /^([A-Z])([1-9])$/;

export function parseSlot(key: string): { line: string; side: 1 | 2; slot: number } | null {
  const m = SLOT_RE.exec(key);
  return m ? { line: m[1], side: Number(m[2]) as 1 | 2, slot: Number(m[3]) } : null;
}

/** Which column of the line a place hangs on. See the note above. */
export const pillarOf = (slot: number): number => Math.floor(slot / 2) + 1;

export type PlanSlot = {
  /** the full code, e.g. "A23" — what the filter is set to */
  key: string;
  /** what the paper writes next to the box, e.g. "23" */
  short: string;
  stat: LocationStat;
};
/** One physical column: what hangs on side 1 and on side 2, top place first. */
export type PlanPillar = { index: number; side1: PlanSlot[]; side2: PlanSlot[] };
export type PlanLine = { line: string; pillars: PlanPillar[] };
export type FloorPlan = {
  /** columns per line, each ordered TOP of the drawing first */
  lines: PlanLine[];
  /** floor areas — F1…F5 */
  zones: LocationStat[];
  /** named places — «رف», T … */
  named: LocationStat[];
  unfiled: LocationStat | null;
};

const blankStat = (key: string, group: string): LocationStat => ({
  key, label: key, group, lines: 0, moves: 0, negative: false, inUse: false,
});

export function buildFloorPlan(stats: LocationStat[]): FloorPlan {
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const lineMax = new Map<string, number>();
  const zones: LocationStat[] = [];
  const named: LocationStat[] = [];
  let unfiled: LocationStat | null = null;

  for (const s of stats) {
    if (s.key === NO_LOCATION) { unfiled = s; continue; }
    const p = parseSlot(s.key);
    if (p) {
      // eight places a side is the built room; only stretch if the sheet says so
      lineMax.set(p.line, Math.max(lineMax.get(p.line) ?? 8, p.slot));
      continue;
    }
    (ZONE_RE.test(s.key) ? zones : named).push(s);
  }

  const lines: PlanLine[] = [...lineMax.keys()].sort().map((line) => {
    const max = lineMax.get(line) ?? 8;
    const pillars: PlanPillar[] = [];
    for (let p = pillarOf(max); p >= 1; p--) {
      const slots: number[] = [];
      for (let n = max; n >= 1; n--) if (pillarOf(n) === p) slots.push(n);
      const side = (which: 1 | 2): PlanSlot[] => slots.map((n) => {
        const key = `${line}${which}${n}`;
        return { key, short: `${which}${n}`, stat: byKey.get(key) ?? blankStat(key, line) };
      });
      pillars.push({ index: p, side1: side(1), side2: side(2) });
    }
    return { line, pillars };
  });

  return { lines, zones: zones.sort((a, b) => compareLocKey(a.key, b.key)), named, unfiled };
}

/* ------------------------------- the stock line ------------------------------ */

/**
 * A line of «الرصيد الحالي» is keyed on FOUR exact strings — item type, item,
 * owner client, location — and the sheet sums every movement whose four cells
 * match exactly (`available_` in storage-setup-v3.gs compares raw values, with
 * a blank client/location stored as «غير متاح / N/A»). So "the movements of
 * this line" must match the same way: exact, not folded. The one concession is
 * whitespace, which lib/storage.ts already collapses on both sides.
 *
 * That exactness is also why a withdrawal filed without a location goes
 * NEGATIVE instead of drawing on the A12 pile of the same item: it is a
 * different line. The page surfaces that pairing rather than hiding it.
 */
export type StockLine = { itemType: string; item: string; client: string; loc: string };
export type Movement = StockLine & {
  log: "إيداع" | "سحب"; num: string; date: string; net: string;
};

const sameKind = (a: string, b: string) =>
  String(a ?? "").trim().startsWith("خام") === String(b ?? "").trim().startsWith("خام");
const eq = (a: string | undefined, b: string | undefined) =>
  String(a ?? "").replace(/\s+/g, " ").trim() === String(b ?? "").replace(/\s+/g, " ").trim();

export function sameLine(a: StockLine, b: StockLine): boolean {
  return sameKind(a.itemType, b.itemType) && eq(a.item, b.item) && eq(a.client, b.client) && eq(a.loc, b.loc);
}

/** Same item and owner, ANY place — what a v4 bridge draws on when a سحب names
 *  no location. */
export function sameOwnerItem(a: StockLine, b: StockLine): boolean {
  return sameKind(a.itemType, b.itemType) && eq(a.item, b.item) && eq(a.client, b.client);
}

/**
 * The storage sheet's date cell → "YYYY-MM-DD", or "" when it is not a date at
 * all (a location code has been seen in that column — ITQ0167, 2026-09-02).
 *
 * Deliberately NOT lib/dates.ts normalizeDate(): that one juggles the main DB
 * workbook's two conventions (hand-typed day-first vs Sheets-rendered
 * month-first) with a padding heuristic. «مخزن اتقان» is built with
 * setSpreadsheetLocale('en_US') (storage-setup-*.gs → setupAll), so every date
 * it renders is month-first, and the only other shape is the ISO text the
 * website itself writes. Two patterns, no guessing.
 */
export function storageDate(raw: string | number | undefined | null): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
       .replace(/[‎‏؜]/g, "");
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) =>
    y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s);
  if (m) return ok(+m[3], +m[1], +m[2]);
  return "";
}

/** The movements that make up one balance line, newest first. Ties (same day)
 *  fall back to the invoice number, so two saves on one day keep their order. */
export function historyFor<M extends Movement>(movements: M[], line: StockLine): M[] {
  return movements
    .filter((m) => sameLine(m, line))
    .sort((a, b) =>
      storageDate(b.date).localeCompare(storageDate(a.date)) || b.num.localeCompare(a.num, "en", { numeric: true }));
}

/**
 * Σ deposits − Σ withdrawals of «صافي الكمية».
 *
 * This is ALSO what the bridge checks a withdrawal against: `available_()` in
 * storage-setup-v3.gs re-sums the logs itself and never reads «الرصيد الحالي».
 * So this figure, not the balance tab's column, is the one that decides whether
 * a سحب is accepted — and on 2026-09-02 two rows of the balance tab had their
 * SUMIFS overwritten by hand (a blank «الكمية المضافة» on a line with five
 * deposits), which is exactly when the two disagree.
 */
export function sumNet(movements: Movement[]): number {
  const t = movements.reduce((acc, m) => acc + (m.log === "سحب" ? -1 : 1) * toNumber(m.net), 0);
  return Math.round(t * 100) / 100;
}

/** The other lines of the SAME item and owner — the ones a negative balance is
 *  usually hiding behind. Excludes the line itself. */
export function siblingLines<B extends StockLine>(balance: B[], line: StockLine): B[] {
  return balance.filter((b) =>
    sameKind(b.itemType, line.itemType) && eq(b.item, line.item) && eq(b.client, line.client) && !eq(b.loc, line.loc));
}

/** A line whose location differs from this one's only by case — the stale
 *  `a12`/`A12` pair. The sheet counts them apart; a person should know. */
export function caseTwin<B extends StockLine>(balance: B[], line: StockLine): B | undefined {
  return siblingLines(balance, line).find((b) => locKey(b.loc) === locKey(line.loc));
}

/**
 * Moving stock between two places is a withdrawal here and a deposit there —
 * the sheet has no "move", and inventing one would break the balance formula.
 * Both payloads carry the line's EXACT strings, because that is what the bridge
 * checks the available balance against; the withdrawal must fail, not silently
 * succeed against a different line, if the quantity is not really there.
 *
 * Products move by piece count (`qtyCount`); materials by weight (`qtyKg`).
 * `grams` rides along for products so the sheet keeps the piece weight it
 * already knows — `validate_` only needs it when kg are being converted.
 */
export function movePayloads(
  line: StockLine, toLoc: string, qty: number, date: string, notes: string, grams?: number,
): [Record<string, unknown>, Record<string, unknown>] {
  const material = String(line.itemType).trim().startsWith("خام");
  const base = {
    action: "save", itemType: material ? "خامة" : "منتج", item: line.item, client: line.client,
    date, notes, loss: 0,
    ...(material ? { qtyCount: 0, qtyKg: qty, grams: 0 } : { qtyCount: qty, qtyKg: 0, grams: grams ?? 0 }),
  };
  return [
    { ...base, moveType: "سحب", loc: line.loc },
    { ...base, moveType: "إيداع", loc: toLoc },
  ];
}

/* ------------------------------ duplicated numbers ----------------------------- */

/**
 * Numbers that appear more than once within the same log. The v3 bridge had no
 * lock around a save, so two saves landing together could both take max+1 —
 * «سحب» held two identical ITQ0030 rows on 2026-09-02. v4 serialises saves, but
 * the twins stay in the log, and `webFindRow_` locates a row by its number: an
 * edit or delete on such a number can land on the wrong twin. The page must
 * refuse and point at the sheet.
 */
export const dupKey = (m: { log: string; num: string }): string => `${m.log}|${m.num}`;

export function duplicateNums(movements: { log: string; num: string }[]): Set<string> {
  const seen = new Map<string, number>();
  movements.forEach((m) => { const k = dupKey(m); seen.set(k, (seen.get(k) ?? 0) + 1); });
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}
