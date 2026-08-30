/**
 * Storage («مخزن اتقان») search + location filtering.
 *
 * Pure and import-free on purpose: it is unit-tested (tests/storage-filter.test.ts)
 * and the page, the form and anything added later share ONE rule instead of each
 * re-deriving "what counts as the same location".
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
