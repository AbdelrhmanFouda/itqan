/**
 * «خطة الاسطمبات» — which mould goes on which machine next (2026-09-30).
 *
 * The owner's brief, in his and the production engineer's words: today the
 * engineer decides "by what is priority and what finished"; the page should
 * ASK him what the sheet does not know, remember the answers, and rank the
 * open work orders for a machine with the reason beside each one. It
 * SUGGESTS — the engineer decides, and only his confirm writes anything.
 *
 * Pure and import-free on purpose, like lib/work-orders.ts and lib/scrap.ts:
 * Node's test runner loads it directly (tests/changeover.test.ts), and the
 * page ranks with the SAME functions the tests pin, in the browser, so an
 * answer re-ranks the list at once without a round trip.
 *
 * Every rule below is an answer he gave on 2026-09-30:
 *
 *  ORDER      عميل مهم → أمر متأخر → سهولة التغيير → الكمية المتبقية → تاريخ التسليم
 *  COLOUR     the WORK ORDER carries the colour (one product is ordered in
 *             several). Light → dark is easy; dark → light is hard; anything →
 *             transparent is the worst («أي لون بيبوظ»).
 *  MATERIAL   nothing is forbidden; a different material costs time and
 *             material (PP runs 160–220°, PC 220–360°), cleaned with «أوميا».
 *  TIME       a colour change takes 15–20 min on بروبلين and 1.5–2 h on ABS,
 *             بولي أمايد and بولي كربونيت. The big machine takes about 6 h to
 *             mount, run and pass samples.
 *  DRYING     PC 3–4 h, ABS 3 h, بولي أمايد 3 h with fibre and 4–5 h without.
 *  TRANSPARENT stays on the machines kept for it.
 *  READY      nothing is mounted until its material, packaging, connections
 *             and sample are ready.
 *  A RUNNING mould comes off only for an important client.
 *
 * What is NOT his and is an assumption of this file is marked ASSUMPTION —
 * three numbers and one tie-break. They are in one place so he can correct
 * them.
 */

/* --------------------------------- folding -------------------------------- */

/** Arabic-Indic / Persian digits → ASCII. Copied (zero imports), as elsewhere. */
function latinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Fold Arabic spelling choices + case + whitespace — the same folding as
 *  lib/work-orders.ts `foldWord`, so «أبيض» and «ابيض» are one word. */
export function fold(s: string | undefined | null): string {
  return latinDigits(String(s ?? ""))
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[​-‏؜﻿]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A machine label's comparison key — every dash and space folded, the same
 *  rule as lib/work-orders.ts `machineLabelKey` («PQ 7 — 100» = «PQ7-100»). */
export function machineKey(label: string | undefined | null): string {
  return latinDigits(String(label ?? ""))
    .replace(/[—–‒‐‑−\-]+/g, "-")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

/* --------------------------------- colours -------------------------------- */

/**
 * The colour vocabulary, lightest first. `rank` IS the rule: a change to a
 * higher rank is light → dark (easy), to a lower one dark → light (hard).
 * The order — clear, white, then warm to cool, black last — is the usual
 * moulding sequence; the owner adds or reorders colours here.
 */
export type ColourDef = { key: string; ar: string; en: string; rank: number; swatch: string; words: string[] };

export const COLOURS: readonly ColourDef[] = [
  { key: "transparent", ar: "شفاف", en: "Transparent", rank: 0, swatch: "#e0f2fe", words: ["شفاف", "شفافه", "clear", "transparent"] },
  { key: "white", ar: "أبيض", en: "White", rank: 1, swatch: "#ffffff", words: ["ابيض", "بيضاء", "بيضه", "بيضا", "white"] },
  { key: "beige", ar: "بيج", en: "Beige", rank: 2, swatch: "#e8dcc0", words: ["بيج", "beige"] },
  { key: "yellow", ar: "أصفر", en: "Yellow", rank: 3, swatch: "#facc15", words: ["اصفر", "صفراء", "صفرا", "صفره", "yellow"] },
  { key: "grey", ar: "رمادي", en: "Grey", rank: 4, swatch: "#9ca3af", words: ["رمادي", "رصاصي", "فضي", "سلفر", "grey", "gray"] },
  { key: "orange", ar: "برتقالي", en: "Orange", rank: 5, swatch: "#f97316", words: ["برتقالي", "اورنج", "orange"] },
  { key: "red", ar: "أحمر", en: "Red", rank: 6, swatch: "#dc2626", words: ["احمر", "حمراء", "حمرا", "حمره", "red"] },
  { key: "green", ar: "أخضر", en: "Green", rank: 7, swatch: "#16a34a", words: ["اخضر", "خضراء", "خضرا", "خضره", "green"] },
  { key: "blue", ar: "أزرق", en: "Blue", rank: 8, swatch: "#2563eb", words: ["ازرق", "زرقاء", "زرقا", "زرقه", "لبني", "blue"] },
  { key: "brown", ar: "بني", en: "Brown", rank: 9, swatch: "#78350f", words: ["بني", "brown"] },
  { key: "black", ar: "أسود", en: "Black", rank: 10, swatch: "#111827", words: ["اسود", "سوداء", "سودا", "سوده", "black"] },
];

/** «أي لون» — the order does not care (the sheet's own masterbatch wording). */
export const ANY_COLOUR = "any";
const ANY_WORDS = ["اي لون", "any", "any colour", "any color"];

const WORD_TO_KEY = new Map<string, string>();
for (const c of COLOURS) for (const w of c.words) WORD_TO_KEY.set(fold(w), c.key);

/** One word → a colour key, tolerating «ال» / «و» / «بال» in front of it. */
function wordKey(word: string): string {
  const w = fold(word);
  if (!w) return "";
  for (const cand of [w, w.replace(/^(و|ب|ل)?ال/, ""), w.replace(/^(و|ب|ل)/, "")]) {
    const k = WORD_TO_KEY.get(cand);
    if (k) return k;
  }
  return "";
}

/**
 * A colour CELL → its key. A vocabulary word gives its key, «أي لون» gives
 * ANY_COLOUR, blank gives "", and anything else is kept as its folded text —
 * a colour the vocabulary does not know is still a colour, it just has no
 * rank (two such colours compare as same-or-unknown, never as lighter).
 */
export function colourKey(text: string | undefined | null): string {
  const f = fold(text);
  if (!f) return "";
  if (ANY_WORDS.includes(f)) return ANY_COLOUR;
  return wordKey(f) || f;
}

export const colourDef = (key: string): ColourDef | undefined => COLOURS.find((c) => c.key === key);

/** What the sheet holds for a key — the Arabic word, readable in the tab. */
export function colourToSheet(key: string): string {
  if (key === ANY_COLOUR) return "أي لون";
  return colourDef(key)?.ar ?? key;
}

/** Every vocabulary colour named in a piece of free text, once each. */
export function coloursIn(text: string | undefined | null): string[] {
  const out: string[] = [];
  for (const w of fold(text).split(/[^\p{L}]+/u)) {
    const k = wordKey(w);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * A colour GUESS from what the sheet already says — the order's own
 * instructions («اللون ابيض ماستر 4٪»), then the product name («محقن شفاف»),
 * then Master's material («ABS اسود مخرز»). The first source naming EXACTLY
 * one colour wins; a text naming two («الرمادي 4٪ / الاسود 2٪») is no guess
 * at all. Only ever a suggestion: the page shows it as one until the engineer
 * taps a colour.
 */
export function guessColour(sources: readonly (string | undefined | null)[]): string {
  for (const s of sources) {
    const found = coloursIn(s);
    if (found.length === 1) return found[0];
    if (found.length > 1) return "";
  }
  return "";
}

export type ColourRelation = "same" | "any" | "darker" | "fromTransparent" | "lighter" | "toTransparent" | "unknown";

/** How the NEXT colour sits against the one on the machine now. */
export function colourRelation(fromKey: string, toKey: string): ColourRelation {
  if (toKey === ANY_COLOUR) return "any";
  if (!fromKey || !toKey || fromKey === ANY_COLOUR) return "unknown";
  if (fromKey === toKey) return "same";
  if (toKey === "transparent") return "toTransparent";
  if (fromKey === "transparent") return "fromTransparent";
  const a = colourDef(fromKey), b = colourDef(toKey);
  if (!a || !b) return "unknown";
  return b.rank > a.rank ? "darker" : "lighter";
}

/* -------------------------------- materials ------------------------------- */

export type MaterialFamily = "PP" | "PE" | "ABS" | "PC" | "PA" | "POM" | "PVC" | "other" | "";

/**
 * «نوع الخام» is free text («بروبلين مخرز اسود», «ABS&بولي كربونيت», «pc ابيض»);
 * the FAMILY is what decides temperature, purge time and drying. Read off the
 * values Master actually holds (41 distinct on 2026-09-30).
 */
export function materialFamily(text: string | undefined | null): MaterialFamily {
  const f = fold(text);
  if (!f || f === "غير متاح" || f === "غير متاح / n/a" || f === "n/a") return "";
  if (/abs|اي بي اس/.test(f)) return "ABS";
  if (/كربون|(^|[^a-z])pc([^a-z]|$)/.test(f)) return "PC";
  if (/اميد|امايد|نايلون|(^|[^a-z])pa([^a-z]|$)/.test(f)) return "PA";
  if (/ايستال|اسيتال|(^|[^a-z])pom([^a-z]|$)/.test(f)) return "POM";
  if (/pvc/.test(f)) return "PVC";
  if (/ايثلين|ايثيلين|(^|[^a-z])pe([^a-z]|$)/.test(f)) return "PE";
  if (/بروبلين|بروبيلين|كوبل|كوبوليمر|راندم|هومو|(^|[^a-z])p\.?p([^a-z]|$)/.test(f)) return "PP";
  return "other";
}

/** PP / PE settle in minutes; ABS, PA and PC take an hour and a half or more.
 *  An unknown family is priced as slow — the estimate must not flatter. */
const isFast = (f: MaterialFamily) => f === "PP" || f === "PE";

export type Drying = { minH: number; maxH: number };

/** The owner's drying hours. null = no drying needed (or family unknown). */
export function dryingFor(text: string | undefined | null): Drying | null {
  switch (materialFamily(text)) {
    case "PC": return { minH: 3, maxH: 4 };
    case "ABS": return { minH: 3, maxH: 3 };
    case "PA": return /فايبر|fib|gf/.test(fold(text)) ? { minH: 3, maxH: 3 } : { minH: 4, maxH: 5 };
    default: return null;
  }
}

/* ------------------------------- the estimate ------------------------------ */

/**
 * The minutes, in one place. The first two and the last are the owner's own
 * (2026-09-30); the three marked ASSUMPTION are not, and the page prints every
 * estimate with «≈».
 */
export const CHANGEOVER_NUMBERS = {
  /** A hard colour change (dark → light) on PP / PE: «ربع ساعة تلت ساعة». */
  colourFastMin: 20,
  /** The same on ABS / PA / PC: «ساعة ونص ساعتين». */
  colourSlowMin: 105,
  /** ASSUMPTION: light → dark costs half of a hard change. */
  easyFactor: 0.5,
  /** ASSUMPTION: anything → transparent costs twice a hard change. */
  toTransparentFactor: 2,
  /** ASSUMPTION: swapping a mould on an ordinary machine (his TARGET is 20). */
  swapMin: 45,
  /** A mould with oil cores («بساتم زيت»): «ساعتين ثلاثة». */
  swapOilCoresMin: 150,
  /** The big machine, mount + run + samples: «حوالي 6 ساعات». */
  swapBigMin: 360,
} as const;

export type Ease = "same" | "easy" | "unknown" | "hard" | "veryHard";
const EASE_ORDER: Record<Ease, number> = { same: 0, easy: 1, unknown: 2, hard: 3, veryHard: 4 };

export type Side = { product: string; colour: string; material: string };

export type Estimate = {
  ease: Ease;
  colour: ColourRelation;
  /** true = a different family, false = the same, null = one side unknown. */
  materialChange: boolean | null;
  sameMould: boolean;
  purgeMin: number;
  swapMin: number;
  totalMin: number;
  drying: Drying | null;
};

/**
 * What it costs to go from what is on the machine to `to`.
 *
 * `ease` is the tier the ranking sorts on; the minutes are for the eye. A
 * different material is never better than "hard", whatever the colours say —
 * the barrel is purged either way.
 */
export function estimateChange(
  from: Side, to: Side, opts: { bigMachine?: boolean; oilCores?: boolean | null } = {},
): Estimate {
  const N = CHANGEOVER_NUMBERS;
  const colour = colourRelation(colourKey(from.colour), colourKey(to.colour));
  const ff = materialFamily(from.material), tf = materialFamily(to.material);
  const materialChange = ff && tf ? ff !== tf : null;

  let ease: Ease =
    colour === "same" ? "same"
    : colour === "toTransparent" ? "veryHard"
    : colour === "lighter" ? "hard"
    : colour === "unknown" ? "unknown"
    : "easy";
  if (materialChange && EASE_ORDER[ease] < EASE_ORDER.hard) ease = "hard";
  // The same colour on an unknown material is not provably "nothing to do".
  if (ease === "same" && materialChange === null) ease = "easy";

  const base = (f: MaterialFamily) => (isFast(f) ? N.colourFastMin : N.colourSlowMin);
  const b = materialChange ? Math.max(base(ff), base(tf)) : base(tf);
  const purgeMin =
    ease === "same" ? 0
    : ease === "easy" ? Math.round(b * N.easyFactor)
    : ease === "veryHard" ? b * N.toTransparentFactor
    : b;

  const sameMould = !!fold(from.product) && fold(from.product) === fold(to.product);
  const swapMin = sameMould ? 0 : opts.bigMachine ? N.swapBigMin : opts.oilCores ? N.swapOilCoresMin : N.swapMin;

  return {
    ease, colour, materialChange, sameMould, purgeMin, swapMin,
    totalMin: purgeMin + swapMin,
    drying: dryingFor(to.material),
  };
}

/* --------------------------------- answers -------------------------------- */

/**
 * What the engineer has told the page, as the tab «إجابات خطة الاسطمبات» holds
 * it: one row per save, one column per question, Arabic words in the cells so
 * the owner can read the tab with his eyes. The LATEST non-blank cell per
 * (kind, name, column) wins — an answer is corrected by answering again, never
 * by editing a row, which is what makes the bridge's at-least-once delivery
 * harmless here (a duplicated row says the same thing twice).
 */
export const ANSWER_KINDS = ["machine", "mold", "order", "client", "map"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

const KIND_AR: Record<AnswerKind, string> = { machine: "ماكينة", mold: "اسطمبة", order: "أمر شغل", client: "عميل", map: "خريطة" };
export const kindToSheet = (k: AnswerKind): string => KIND_AR[k];
export function kindFromSheet(v: string | undefined | null): AnswerKind | "" {
  const f = fold(v);
  for (const k of ANSWER_KINDS) if (fold(KIND_AR[k]) === f || k === f) return k;
  return "";
}

/** The question columns, and which kind of thing each one is asked about. */
export const ANSWER_COLUMNS = {
  colour: "order",
  missing: "order",
  fits: "mold",
  workers: "mold",
  oilCores: "mold",
  keyClient: "client",
  transparentOnly: "machine",
  bigMachine: "machine",
  // The floor map (2026-10-05): ONE cell holding every tile — see parseLayout.
  layout: "map",
} as const satisfies Record<string, AnswerKind>;
export type AnswerColumn = keyof typeof ANSWER_COLUMNS;
export const ANSWER_COLUMN_KEYS = Object.keys(ANSWER_COLUMNS) as AnswerColumn[];

export const YES = "نعم";
export const NO = "لا";
export const yesNo = (b: boolean): string => (b ? YES : NO);
export function parseYesNo(v: string | undefined | null): boolean | null {
  const f = fold(v);
  if (["نعم", "yes", "true", "1", "اه", "ايوه"].includes(f)) return true;
  if (["لا", "no", "false", "0"].includes(f)) return false;
  return null;
}

/** A list cell: labels joined with « | » (a machine label holds «—» and «،»
 *  is the Arabic comma a name may carry, so neither can be the separator). */
export const LIST_SEP = " | ";
export const listToSheet = (items: readonly string[]): string => items.join(LIST_SEP);
export const listFromSheet = (v: string | undefined | null): string[] =>
  String(v ?? "").split("|").map((x) => x.trim()).filter(Boolean);

/**
 * The things an order can still be waiting for — the engineer's own list:
 * «ما برفعش اسطمبة إلا لما بكون مجهز لها…». «لا يوجد» is the explicit "nothing
 * missing": a blank cell cannot say it, because blank means "not asked".
 */
export const MISSING_ITEMS = [
  { key: "material", ar: "الخامة", en: "Material" },
  { key: "masterbatch", ar: "الماستر باتش", en: "Masterbatch" },
  { key: "packaging", ar: "الكراتين / الأكياس", en: "Cartons / bags" },
  { key: "mould", ar: "صيانة الاسطمبة", en: "Mould maintenance" },
  { key: "sample", ar: "اعتماد العينة", en: "Sample approval" },
  { key: "workers", ar: "العمال", en: "Workers" },
] as const;
export type MissingKey = (typeof MISSING_ITEMS)[number]["key"];
export const NOTHING_MISSING = "لا يوجد";

export function missingToSheet(keys: readonly string[]): string {
  const ar = MISSING_ITEMS.filter((m) => keys.includes(m.key)).map((m) => m.ar);
  return ar.length ? listToSheet(ar) : NOTHING_MISSING;
}
/** null = never asked; [] = asked, nothing missing. */
export function missingFromSheet(v: string | undefined | null): MissingKey[] | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (fold(raw) === fold(NOTHING_MISSING)) return [];
  const out: MissingKey[] = [];
  for (const part of listFromSheet(raw)) {
    const hit = MISSING_ITEMS.find((m) => fold(m.ar) === fold(part) || m.key === fold(part));
    if (hit && !out.includes(hit.key)) out.push(hit.key);
  }
  return out;
}

export type AnswerRow = { kind: AnswerKind | ""; key: string } & Partial<Record<AnswerColumn, string>>;
export type AnswerSet = Partial<Record<AnswerColumn, string>>;

/**
 * Rows in SHEET ORDER → the standing answer per (kind, key). `key` is already
 * folded by the caller with that kind's own rule (machineKey for a machine,
 * the product-name key for a mould, the job-code key for an order).
 */
export function mergeAnswers(rows: readonly AnswerRow[]): Map<string, AnswerSet> {
  const out = new Map<string, AnswerSet>();
  for (const r of rows) {
    if (!r.kind || !r.key) continue;
    const id = `${r.kind}:${r.key}`;
    const set = out.get(id) ?? {};
    for (const col of ANSWER_COLUMN_KEYS) {
      const v = (r[col] ?? "").trim();
      if (v) set[col] = v;
    }
    out.set(id, set);
  }
  return out;
}

export const answersFor = (all: Map<string, AnswerSet>, kind: AnswerKind, key: string): AnswerSet =>
  all.get(`${kind}:${key}`) ?? {};

/* --------------------------------- the tabs -------------------------------- */

/**
 * The two tabs this page owns, created lazily by the first save (the same
 * shape «طلبات العملاء» uses). NOTHING is added to «الرئيسي», «أوامر العمل»,
 * «الماكينات» or «العملاء»: those carry validation rules, a formula spill and
 * hidden computed columns, and a colleague edits them daily. Headers are
 * bilingual "ar\nen" like every other tab, and each one is worded so that no
 * field's keyword is contained in another header (tests/sheet-entities.test.ts
 * pins both directions).
 */
export const ANSWERS_TAB = "إجابات خطة الاسطمبات";
export const ANSWERS_HEADERS: string[] = [
  "التاريخ\nDate",
  "النوع\nKind",
  "الاسم\nName",
  "اللون\nColour",
  "الماكينات المناسبة\nFits machines",
  "عدد العمال\nWorkers",
  "بساتم زيت\nOil cores",
  "النواقص\nMissing",
  "عميل مهم\nKey client",
  "مخصصة للشفاف\nTransparent only",
  "ماكينة كبيرة\nBig machine",
  "بواسطة\nRecorded by",
  // Added 2026-10-05 and LAST on purpose: the live tab already existed, and
  // ensureHeaders adds a missing header at the right-hand end.
  "ترتيب الخريطة\nMap layout",
];

/** One row per confirmed change — and per «الراكب الآن» declaration, which is
 *  the same row with nothing before it. The LAST row for a machine is what is
 *  standing on it. */
export const LOG_TAB = "تغييرات الاسطمبات";
export const LOG_HEADERS: string[] = [
  "التاريخ\nDate",
  "الماكينة\nMachine",
  "المنتج السابق\nFrom product",
  "اللون السابق\nFrom colour",
  "أمر الشغل\nWork order",
  "المنتج الجديد\nTo product",
  "اللون الجديد\nTo colour",
  "الخامة\nMaterial",
  "الوقت المتوقع (دقيقة)\nEst. minutes",
  "الأسباب\nReasons",
  "بواسطة\nRecorded by",
];

export type LogRow = {
  machine: string; order: string; toProduct: string; toColour: string; material: string;
  /** The row's own stamp, as the sheet holds it — the caller normalises it. */
  date?: string;
};

/** Rows in SHEET ORDER → what is standing on each machine (by machineKey). */
export function standingFromLog<T extends LogRow>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = machineKey(r.machine);
    if (k && (r.toProduct || "").trim()) out.set(k, r);
  }
  return out;
}

/* ------------------------------ what is running ----------------------------- */

/**
 * «الإنتاج» is the truth about what a machine is running. The crew logs every
 * shift there, while «الماكينات»'s product cell and its Active flag are typed
 * once and go stale: on 2026-10-05 the registry called PQ 6, PQ 10 and PQ 13
 * inactive while each had run a shift the day before. The first version of
 * this page read the registry — it hid those machines, showed products that
 * had come off days earlier, and suggested mounting orders that were already
 * running somewhere (the owner: "the logic doesn't seem correct").
 *
 * A machine's standing job is the product(s) of its LATEST shift row. Two
 * products in one shift is real (PQ 7 runs a left pair and a right pair), so
 * it is a list.
 */
export type ShiftRow = { date: string; shift: string; machine: string; product: string };
export type LastRun = { date: string; shift: string; products: string[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** «المسائية» comes after «الصباحية» on the same date. Matched on the FOLDED
 *  word — `fold` turns «ئ» into «ي», so the pattern is «مساي», not «مسائ». */
const shiftRank = (shift: string): number => (/مساي|ليل|night|evening/.test(fold(shift)) ? 2 : 1);

/**
 * The last shift of every machine, and the newest date in the whole log.
 * Rows dated after `today` are ignored — a mistyped year must not become
 * "the latest shift" and make every real machine look idle.
 */
export function latestRuns(rows: readonly ShiftRow[], today: string): { byMachine: Map<string, LastRun>; latestDate: string } {
  const seen = new Map<string, LastRun & { rank: number }>();
  let latestDate = "";
  for (const r of rows) {
    const mk = machineKey(r.machine);
    const product = String(r.product ?? "").replace(/\s+/g, " ").trim();
    if (!mk || !product || !ISO.test(r.date) || (ISO.test(today) && r.date > today)) continue;
    if (r.date > latestDate) latestDate = r.date;
    const rank = shiftRank(r.shift);
    const cur = seen.get(mk);
    if (!cur || r.date > cur.date || (r.date === cur.date && rank > cur.rank)) {
      seen.set(mk, { date: r.date, shift: r.shift, products: [product], rank });
    } else if (r.date === cur.date && rank === cur.rank && !cur.products.some((p) => fold(p) === fold(product))) {
      cur.products.push(product);
    }
  }
  const byMachine = new Map<string, LastRun>();
  for (const [k, v] of seen) byMachine.set(k, { date: v.date, shift: v.shift, products: v.products });
  return { byMachine, latestDate };
}

const daysBefore = (iso: string, days: number): string => {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * How far back a machine's last logged shift may be and still count as
 * running. ONE day was the first rule and it was wrong (owner, 2026-10-05:
 * «PQ1 is working» while the page called it idle): the log is typed up
 * machine by machine, a day or two behind, and a press that runs every day
 * still shows two-day gaps in it — PQ 5 went 30 Sep → 3 Oct without stopping
 * being a mould change. Three days is the widest gap the live log shows
 * between two shifts of one uninterrupted job.
 */
export const RECENT_DAYS = 3;

/**
 * Is this date recent, measured against the NEWEST date in the log — not
 * against today, because the log is typed up behind and "today" would call
 * the whole factory idle every morning.
 */
export const isRecent = (date: string, latestDate: string, days: number = RECENT_DAYS): boolean =>
  ISO.test(date) && ISO.test(latestDate) && date >= daysBefore(latestDate, days);

/* ----------------------------- machines and orders ------------------------- */

export type MachineNow = {
  /** What stands on the machine — usually one product, sometimes a pair. */
  products: string[];
  /** Colour keys; a product may run in several («رمادي» then «أسود»). */
  colours: string[];
  /** The ONE colour in the barrel right now, when that is known — the colour
   *  a confirmed change started with, or the only colour there is. "" when
   *  the job runs in several and nobody said which; the ranking then cleans
   *  the machine of the darkest, which is the careful answer. */
  colourNow: string;
  /** The colours are a guess or a memory, not anybody's tap on this job. */
  coloursGuessed: boolean;
  material: string;
  /** The work order standing on the machine, "" when it runs without one. */
  order: string;
  /** "production" = the shift log says so; "plan" = confirmed on this page
   *  after the last logged shift; "registry" = only «الماكينات» says so;
   *  "none" = nothing is known. */
  source: "plan" | "production" | "registry" | "none";
  /** ISO day of the shift (or confirm) behind `products`; "" when unknown. */
  since: string;
  shift: string;
};

/**
 * running = logged in the last few days and nothing says it stopped;
 * stopped = a stoppage is RUNNING on the downtime page right now — the
 *           floor's own, real-time word, so it beats anything the log says;
 * idle    = a mould is standing but no shift has been logged lately and no
 *           stoppage is recorded either;
 * unknown = nothing is known at all.
 * stopped and idle are the machines a decision is needed for.
 */
export type MachineState = "running" | "stopped" | "idle" | "unknown";

/** A stoppage running now on /dashboard/downtime: its reason key
 *  (lib/prod-meta.ts DOWNTIME_CAPTURE_REASONS) and when it started (epoch ms). */
export type Stoppage = { reason: string; since: number };

export type PlanMachine = {
  label: string;
  tonnage: string;
  now: MachineNow;
  state: MachineState;
  /** The stoppage running on it now, null when there is none (or it could not be read). */
  stoppage: Stoppage | null;
  transparentOnly: boolean;
  bigMachine: boolean;
};

/**
 * The one place a machine's state is decided.
 *
 * `since` is the day of the newest evidence for what stands on it — a logged
 * shift, or a change confirmed on this page — and it is recent when it is
 * within RECENT_DAYS of the newest date the log holds, OR of today (a mould
 * that went up after the log was last typed).
 */
export function machineState(o: {
  source: MachineNow["source"]; since: string; latestDate: string; today: string; stopped: boolean;
}): MachineState {
  if (o.stopped) return "stopped";
  if (o.source !== "plan" && o.source !== "production") return "unknown";
  return isRecent(o.since, o.latestDate) || isRecent(o.since, o.today) ? "running" : "idle";
}

/** What was confirmed on this page for a machine, from «تغييرات الاسطمبات». */
export type PlanStanding = { date: string; products: string[]; colours: string[]; order: string; material: string };

const sameProduct = (a: readonly string[], b: readonly string[]): boolean =>
  a.some((x) => b.some((y) => fold(x) === fold(y)));

/**
 * Who is right about a machine: this page's last confirm, or the shift log?
 *
 *  - They name the same product: both. The log's shift dates it; the confirm
 *    supplies what the log does not hold (the colours, the work order).
 *  - They differ, and the log has NOT changed mould since the confirm
 *    (`runAtPlan` — the machine's last shift as of the confirm's day — is the
 *    same product as its last shift now): the confirm stands. Two cases, one
 *    rule: a mould that went up after the last logged shift, and an order the
 *    engineer tied to a machine whose log spells the product another way
 *    («كفر شفاف فوكس 2» for the order's «كفر شفاف فوكس»). Without this the
 *    tie was dropped by the very next shift row.
 *  - They differ and the log HAS moved on: the log. The machine was changed
 *    without telling this page.
 */
export function resolveNow(
  plan: PlanStanding | null, run: LastRun | null, registryProduct: string, runAtPlan: LastRun | null = null,
): Pick<MachineNow, "products" | "colours" | "order" | "source" | "since" | "shift"> & { material: string } {
  if (plan && plan.products.length > 0) {
    const fromPlan = (since: string, shift: string) =>
      ({ products: plan.products, colours: plan.colours, order: plan.order, material: plan.material, source: "plan" as const, since, shift });
    if (!run) return fromPlan(plan.date, "");
    if (sameProduct(plan.products, run.products)) {
      return { products: run.products, colours: plan.colours, order: plan.order, material: plan.material, source: "production", since: run.date, shift: run.shift };
    }
    // Nothing logged on or before the confirm's day counts as "unchanged"
    // only while nothing has been logged after it either.
    const unchanged = runAtPlan ? sameProduct(runAtPlan.products, run.products) : run.date <= plan.date;
    if (unchanged) return run.date > plan.date ? fromPlan(run.date, run.shift) : fromPlan(plan.date, "");
  }
  if (run) return { products: run.products, colours: [], order: "", material: "", source: "production", since: run.date, shift: run.shift };
  const reg = registryProduct.replace(/\s+/g, " ").trim();
  if (reg) return { products: [reg], colours: [], order: "", material: "", source: "registry", since: "", shift: "" };
  return { products: [], colours: [], order: "", material: "", source: "none", since: "", shift: "" };
}

export type PlanOrder = {
  id: string;
  code: string;
  product: string;
  client: string;
  material: string;
  dueDate: string;
  status: string;
  qtyKg: number;
  /** Pieces still to make; null when Master has no piece weight for it. */
  remaining: number | null;
  /** Hours of running left at Master's cycle; null when it cannot be stated. */
  runHours: number | null;
  /** Colour keys — one order is often made in several. */
  colours: string[];
  colourSource: "answer" | "guess" | "";
  /** The engineer's answer — the machines this mould fits. null = not asked. */
  fits: string[] | null;
  /** «الرئيسي»'s tonnage turned into registry labels — a HINT, never a gate. */
  fitsHint: string[];
  /** Master's own text for that hint («180», «100&180»). */
  fitsHintText: string;
  workers: number | null;
  oilCores: boolean | null;
  missing: MissingKey[] | null;
  keyClient: boolean;
  /** The machine whose standing product is this order's product, "" if none. */
  mountedOn: string;
  /** …and that machine is RUNNING it now (not merely holding the mould). */
  mountedRunning: boolean;
};

/* --------------------------------- colours, plural -------------------------- */

/** A colours cell («أبيض | رمادي», «رمادي / أسود») → keys, in order, once each. */
export function coloursFromSheet(text: string | undefined | null): string[] {
  const out: string[] = [];
  for (const part of String(text ?? "").split(/[|/،,]+/)) {
    const k = colourKey(part);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}
export const coloursToSheet = (keys: readonly string[]): string =>
  listToSheet(keys.map((k) => colourToSheet(k)).filter(Boolean));

/**
 * The colour the barrel has to be cleaned OF when a machine runs several —
 * the darkest. A colour outside the list has no rank; it is returned as it is
 * and compares as "unknown", which is the honest answer.
 */
export function darkestColour(colours: readonly string[]): string {
  let best = "", bestRank = -1;
  for (const c of colours) {
    const k = colourKey(c);
    if (!k || k === ANY_COLOUR) continue;
    const d = colourDef(k);
    if (!d) return k;
    if (d.rank > bestRank) { best = k; bestRank = d.rank; }
  }
  return best;
}

/**
 * An order made in several colours can START with any of them — pick the one
 * that is easiest after what is on the machine (white first after white, not
 * black). No colours at all is one estimate with the colour unknown.
 */
export function bestStart(
  from: Side, to: { product: string; colours: readonly string[]; material: string },
  opts: { bigMachine?: boolean; oilCores?: boolean | null } = {},
): { estimate: Estimate; startColour: string } {
  if (to.colours.length === 0) {
    return { estimate: estimateChange(from, { product: to.product, colour: "", material: to.material }, opts), startColour: "" };
  }
  let best: { estimate: Estimate; startColour: string } | null = null;
  for (const colour of to.colours) {
    const estimate = estimateChange(from, { product: to.product, colour, material: to.material }, opts);
    if (!best
      || EASE_ORDER[estimate.ease] < EASE_ORDER[best.estimate.ease]
      || (estimate.ease === best.estimate.ease && estimate.totalMin < best.estimate.totalMin)) {
      best = { estimate, startColour: colourKey(colour) };
    }
  }
  return best!;
}

/* --------------------------------- ranking -------------------------------- */

export type ChipTone = "good" | "warn" | "bad" | "info";
export type Chip = { key: string; tone: ChipTone; vars?: Record<string, string | number> };

export type Suggestion = {
  order: PlanOrder;
  estimate: Estimate;
  /** The colour to start with, when the order has several; "" when unknown. */
  startColour: string;
  late: number;       // whole days past due, 0 when not late
  onlyHere: boolean;
  /** The order's mould is already standing on THIS machine. */
  mountedHere: boolean;
  /**
   * Does the mould belong on this machine? "here" = the engineer said so, or
   * Master's tonnage names it; "unknown" = nobody said; "elsewhere" = nobody
   * answered and Master names OTHER machines. Never a gate — Master's
   * tonnage column is half empty and partly stale — but it is the first
   * thing the list is sorted on, and the page folds "elsewhere" away: with
   * twenty-odd orders waiting, a machine's list is otherwise mostly moulds
   * that were never going to go on it.
   */
  fit: "here" | "unknown" | "elsewhere";
  /** Something the ranking wanted to know is not answered yet (colour, which
   *  machines the mould fits, whether it is ready). A hint on the questions
   *  button — never a row of grey chips, which is what made the first version
   *  of the list unreadable. */
  needsAnswers: boolean;
  chips: Chip[];
};

export type BlockReason = "finished" | "notFit" | "transparentElsewhere" | "missing";
export type Blocked = { order: PlanOrder; reason: BlockReason; vars?: Record<string, string | number> };

/** Whole days from `dueIso` to `todayIso` (positive = late). */
function daysLate(dueIso: string, todayIso: string): number {
  if (!ISO.test(dueIso) || !ISO.test(todayIso)) return 0;
  const d = Date.UTC(+dueIso.slice(0, 4), +dueIso.slice(5, 7) - 1, +dueIso.slice(8, 10));
  const t = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  return Math.max(0, Math.round((t - d) / 86_400_000));
}

const SHIFT_HOURS = 12;

/**
 * Rank the WAITING orders for one machine.
 *
 * Not a candidate at all: the job this machine is running now, and any order
 * that is running on another machine — it is not waiting for anything.
 * An order whose mould is merely STANDING on an idle machine still is one:
 * here it is the cheapest thing to start («الاسطمبة راكبة هنا»), elsewhere it
 * says where the mould is.
 *
 * Four things take an order out of the ranking and into `blocked`, each with
 * its reason: its quantity is already made (still «جاري التشغيل» only because
 * nobody closed it); the engineer said the mould does not fit here; every
 * colour of it is transparent and this is not a machine kept for transparent;
 * something it needs is not ready.
 *
 * The rest are sorted by the owner's order — and one tie-break of this file
 * (ASSUMPTION, between «متأخر» and «سهولة التغيير»): a mould that fits ONLY
 * this machine goes before one that could go elsewhere. Remaining quantity
 * sorts smallest first (ASSUMPTION: finish what is nearly done).
 */
export function rankFor(
  machine: PlanMachine,
  orders: readonly PlanOrder[],
  ctx: { today: string; transparentMachines: readonly string[] },
): { ranked: Suggestion[]; blocked: Blocked[] } {
  const mk = machineKey(machine.label);
  const keptForTransparent = ctx.transparentMachines.map(machineKey);
  const ranked: Suggestion[] = [];
  const blocked: Blocked[] = [];
  const fromColour = machine.now.colourNow || darkestColour(machine.now.colours);

  for (const o of orders) {
    const here = !!o.mountedOn && machineKey(o.mountedOn) === mk;
    if (here && machine.state === "running") continue;
    if (o.mountedOn && !here && o.mountedRunning) continue;

    if (o.remaining === 0) {
      blocked.push({ order: o, reason: "finished" });
      continue;
    }
    if (o.fits && o.fits.length > 0 && !o.fits.some((l) => machineKey(l) === mk)) {
      blocked.push({ order: o, reason: "notFit", vars: { machines: o.fits.join(" · ") } });
      continue;
    }
    const keys = o.colours.map(colourKey).filter(Boolean);
    const allTransparent = keys.length > 0 && keys.every((k) => k === "transparent");
    if (allTransparent && keptForTransparent.length > 0 && !keptForTransparent.includes(mk)) {
      blocked.push({ order: o, reason: "transparentElsewhere", vars: { machines: ctx.transparentMachines.join(" · ") } });
      continue;
    }
    if (o.missing && o.missing.length > 0) {
      blocked.push({ order: o, reason: "missing", vars: { items: o.missing.join(",") } });
      continue;
    }

    const standing = machine.now.products.find((p) => fold(p) === fold(o.product)) ?? machine.now.products[0] ?? "";
    const { estimate, startColour } = bestStart(
      { product: standing, colour: fromColour, material: machine.now.material },
      { product: o.product, colours: keys, material: o.material },
      { bigMachine: machine.bigMachine, oilCores: o.oilCores },
    );
    const late = o.dueDate ? daysLate(o.dueDate, ctx.today) : 0;
    const onlyHere = !!o.fits && o.fits.length === 1;
    const chips: Chip[] = [];

    if (o.keyClient) chips.push({ key: "keyClient", tone: "good" });
    if (late > 0) chips.push({ key: "late", tone: "warn", vars: { n: late } });
    if (here) chips.push({ key: "mountedHere", tone: "good" });
    else if (o.mountedOn) chips.push({ key: "mountedElsewhere", tone: "warn", vars: { machine: o.mountedOn } });
    if (onlyHere) chips.push({ key: "onlyHere", tone: "good" });

    // On a running machine only a key client is worth taking the mould off.
    // Said on that order; "the machine is running" is said ONCE, above the
    // list, not on every card.
    if (machine.state === "running" && o.keyClient) chips.push({ key: "worthInterrupt", tone: "good" });

    switch (estimate.colour) {
      case "same": chips.push({ key: "sameColour", tone: "good" }); break;
      case "any": chips.push({ key: "anyColour", tone: "good" }); break;
      case "darker": chips.push({ key: "darker", tone: "good" }); break;
      case "fromTransparent": chips.push({ key: "fromTransparent", tone: "good" }); break;
      case "lighter": chips.push({ key: "lighter", tone: "warn" }); break;
      case "toTransparent": chips.push({ key: "toTransparent", tone: "bad" }); break;
      case "unknown":
        chips.push({ key: keys.length === 0 ? "colourUnknown" : "nowColourUnknown", tone: "warn" });
        break;
    }
    if (keys.length > 1 && startColour) chips.push({ key: "startWith", tone: "info", vars: { colour: startColour } });

    if (estimate.materialChange === false) chips.push({ key: "sameMaterial", tone: "good" });
    else if (estimate.materialChange === true) chips.push({ key: "materialChange", tone: "warn" });

    if (estimate.drying) {
      const d = estimate.drying;
      chips.push({ key: "drying", tone: "warn", vars: { h: d.minH === d.maxH ? `${d.minH}` : `${d.minH}–${d.maxH}` } });
    }
    const someTransparent = keys.includes("transparent");
    if (machine.transparentOnly && !someTransparent) chips.push({ key: "transparentMachine", tone: "warn" });

    const fitAnswered = !!o.fits && o.fits.length > 0;
    const fit: Suggestion["fit"] =
      fitAnswered || o.fitsHint.some((l) => machineKey(l) === mk) ? "here"
      : o.fitsHint.length > 0 || !!o.fitsHintText ? "elsewhere"
      : "unknown";
    if (fit === "elsewhere") chips.push({ key: "fitHintElsewhere", tone: "warn", vars: { t: o.fitsHintText } });
    if (o.workers !== null && o.workers > 1) chips.push({ key: "workers", tone: "warn", vars: { n: o.workers } });
    if (o.runHours !== null && o.runHours > 0 && o.runHours < SHIFT_HOURS) chips.push({ key: "shortRun", tone: "warn" });

    ranked.push({
      order: o, estimate, startColour, late, onlyHere, mountedHere: here, fit: here ? "here" : fit, chips,
      needsAnswers: keys.length === 0 || o.colourSource !== "answer" || !fitAnswered || o.missing === null,
    });
  }

  const easeOf = (s: Suggestion) => {
    // The mould is already on this machine: nothing is cheaper to start.
    if (s.mountedHere) return -1;
    const someTransparent = s.order.colours.some((c) => colourKey(c) === "transparent");
    // A coloured job on a machine kept for transparent sorts with the worst.
    return machine.transparentOnly && !someTransparent ? EASE_ORDER.veryHard : EASE_ORDER[s.estimate.ease];
  };
  const FIT = { here: 0, unknown: 1, elsewhere: 2 } as const;
  ranked.sort((a, b) =>
    FIT[a.fit] - FIT[b.fit]
    || Number(b.order.keyClient) - Number(a.order.keyClient)
    || Number(b.late > 0) - Number(a.late > 0)
    || Number(b.onlyHere) - Number(a.onlyHere)
    || easeOf(a) - easeOf(b)
    || (a.order.remaining ?? Infinity) - (b.order.remaining ?? Infinity)
    || (a.order.dueDate || "9999").localeCompare(b.order.dueDate || "9999")
    || a.order.code.localeCompare(b.order.code, undefined, { numeric: true }),
  );
  return { ranked, blocked };
}

/* ----------------------------------- the map -------------------------------- */

/**
 * The factory floor, as the owner drew it (2026-10-05): the big machine on
 * the left, two columns of presses either side of the aisle, two wide ones
 * along the bottom. Positions are DATA — one cell in «إجابات خطة الاسطمبات»,
 * arranged on the page itself — because the registry has been renumbered four
 * times and a floor plan keyed on «PQ 7» in code would silently put the wrong
 * press in the wrong place the fifth time.
 *
 * A grid of MAP_COLS columns; a tile is `label@c,r,w,h` (1-based top-left
 * cell, width and height in cells); tiles are joined with « ; ».
 */
export const MAP_COLS = 7;
export const MAP_MAX_ROWS = 16;
export const MAP_NAME = "الأرضية";
export type MapTile = { label: string; c: number; r: number; w: number; h: number };

export function parseLayout(text: string | undefined | null): MapTile[] {
  const out: MapTile[] = [];
  for (const part of String(text ?? "").split(";")) {
    const at = part.lastIndexOf("@");
    if (at <= 0) continue;
    const label = part.slice(0, at).replace(/\s+/g, " ").trim();
    const n = latinDigits(part.slice(at + 1)).split(",").map((x) => Number(x.trim()));
    if (!label || n.length !== 4 || n.some((x) => !Number.isInteger(x))) continue;
    const tile = { label, c: n[0], r: n[1], w: n[2], h: n[3] };
    if (!tileInBounds(tile) || out.some((t) => machineKey(t.label) === machineKey(label))) continue;
    out.push(tile);
  }
  return out;
}

export const formatLayout = (tiles: readonly MapTile[]): string =>
  tiles.map((t) => `${t.label}@${t.c},${t.r},${t.w},${t.h}`).join(" ; ");

export const tileInBounds = (t: MapTile): boolean =>
  t.w >= 1 && t.h >= 1 && t.c >= 1 && t.r >= 1 && t.c + t.w - 1 <= MAP_COLS && t.r + t.h - 1 <= MAP_MAX_ROWS;

export const tilesOverlap = (a: MapTile, b: MapTile): boolean =>
  a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;

/** In bounds, one tile per machine, and no two tiles on the same cell. */
export function validLayout(tiles: readonly MapTile[]): boolean {
  for (let i = 0; i < tiles.length; i++) {
    if (!tileInBounds(tiles[i])) return false;
    for (let j = 0; j < i; j++) {
      if (machineKey(tiles[i].label) === machineKey(tiles[j].label) || tilesOverlap(tiles[i], tiles[j])) return false;
    }
  }
  return true;
}

/** Rows the map needs to show every tile. */
export const mapRows = (tiles: readonly MapTile[]): number => tiles.reduce((m, t) => Math.max(m, t.r + t.h - 1), 0);

/**
 * Put a machine on a cell (or resize it in place). The tile is pulled back
 * inside the grid when it would hang over the edge; the move is REFUSED
 * (null) when it would land on another machine — the page says so rather than
 * stacking two presses on one spot.
 */
export function placeTile(
  tiles: readonly MapTile[], label: string, at: { c: number; r: number; w?: number; h?: number },
): MapTile[] | null {
  const key = machineKey(label);
  const cur = tiles.find((t) => machineKey(t.label) === key);
  const w = Math.min(MAP_COLS, Math.max(1, at.w ?? cur?.w ?? 2));
  const h = Math.min(4, Math.max(1, at.h ?? cur?.h ?? 1));
  const next: MapTile = {
    label: cur?.label ?? label, w, h,
    c: Math.min(Math.max(1, at.c), MAP_COLS - w + 1),
    r: Math.min(Math.max(1, at.r), MAP_MAX_ROWS - h + 1),
  };
  const others = tiles.filter((t) => machineKey(t.label) !== key);
  if (others.some((t) => tilesOverlap(t, next))) return null;
  return [...others, next];
}

export const removeTile = (tiles: readonly MapTile[], label: string): MapTile[] =>
  tiles.filter((t) => machineKey(t.label) !== machineKey(label));

/* ---------------------------------- shifts --------------------------------- */

/**
 * «التغيير مش مسموح في الوردية الليلية وما بتطلعش أي عينات بالليل». The day
 * shift is 08:00–20:00 (the factory day starts at 08:00, lib/dates.ts). The
 * page WARNS at night and still records a change that really happened — a
 * plan that refuses to hear about reality is worse than a broken rule.
 */
export const isNightHour = (cairoHour: number): boolean => cairoHour < 8 || cairoHour >= 20;

/* --------------------------------- formatting ------------------------------ */

/** 105 → {h: 1, m: 45}; the page words it. */
export const splitMinutes = (min: number): { h: number; m: number } => ({
  h: Math.floor(Math.max(0, min) / 60),
  m: Math.round(Math.max(0, min) % 60),
});

/** A cell the site writes must never start a formula (setValue and appendRow
 *  both treat a leading = + - @ as one). */
export function safeText(v: unknown, max = 120): string {
  return String(v ?? "").replace(/[\u0000-\u001F]+/g, " ").trim().replace(/^[=+\-@]+/, "").trim().slice(0, max);
}
