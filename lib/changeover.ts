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
  if (!toKey) return "unknown";
  // Anything → transparent is the worst change there is, and "anything"
  // includes a colour nobody has recorded: until the machine is KNOWN to be
  // on transparent, a transparent job is priced as the hard one. (Colours are
  // not in the sheet, so "not recorded" is the usual case, not the exception.)
  if (toKey === "transparent" && fromKey !== "transparent") return "toTransparent";
  if (!fromKey || fromKey === ANY_COLOUR) return "unknown";
  if (fromKey === toKey) return "same";
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
  /** ASSUMPTION: a mould with a hot runner — heating the manifold and purging
   *  through it before the first good shot (owner, 2026-10-05: "some moulds
   *  may have it"; he gave no time). */
  hotRunnerMin: 20,
} as const;

export type Ease = "same" | "easy" | "unknown" | "hard" | "veryHard";
const EASE_ORDER: Record<Ease, number> = { same: 0, easy: 1, unknown: 2, hard: 3, veryHard: 4 };

export type Side = { product: string; colour: string; material: string };

export type EstimateOptions = {
  bigMachine?: boolean; oilCores?: boolean | null; hotRunner?: boolean | null;
  /**
   * What a mould change on THIS machine has actually taken (PlanMachine.swapMin
   * — the median of its own «تغيير الاسطمبة» stoppages). A number replaces the
   * fixed swap minutes above, ordinary and big machine alike, for a change of
   * mould; null / absent = not measured, the fixed numbers stand.
   * Approved by the owner, 2026-10-07: change times come from the factory's
   * own history.
   */
  swapMin?: number | null;
};

export type Estimate = {
  ease: Ease;
  colour: ColourRelation;
  /** true = a different family, false = the same, null = one side unknown. */
  materialChange: boolean | null;
  sameMould: boolean;
  purgeMin: number;
  swapMin: number;
  /** `swapMin` is the machine's own measured time, not one of the fixed numbers. */
  swapMeasured: boolean;
  /** Extra minutes for a hot-runner mould; 0 when it has none or nothing changes. */
  hotRunnerMin: number;
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
export function estimateChange(from: Side, to: Side, opts: EstimateOptions = {}): Estimate {
  const N = CHANGEOVER_NUMBERS;
  const colour = colourRelation(colourKey(from.colour), colourKey(to.colour));
  const ff = materialFamily(from.material), tf = materialFamily(to.material);
  // Two texts this file does not recognise («TPR», «سان», «مخرز شفاف») both
  // fall in "other" — that is not the same material unless it is the same
  // text. Different texts are "not known", which is priced slow, never green.
  const materialChange = !ff || !tf ? null
    : ff === "other" && tf === "other" ? (fold(from.material) === fold(to.material) ? false : null)
    : ff !== tf;

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
  // The same family is priced on that family; a different one — or one that
  // is NOT KNOWN on either side — on the slower of the two (unknown is slow).
  const b = materialChange === false ? base(tf) : Math.max(base(ff), base(tf));
  const purgeMin =
    ease === "same" ? 0
    : ease === "easy" ? Math.round(b * N.easyFactor)
    : ease === "veryHard" ? b * N.toTransparentFactor
    : b;

  const sameMould = !!fold(from.product) && fold(from.product) === fold(to.product);
  // What a change of mould has really taken on this machine, when the server
  // could measure it — instead of the fixed minutes, the big machine's
  // «حوالي 6 ساعات» included (approved by the owner, 2026-10-07). Only a real
  // number of minutes is a measurement; null, 0 and NaN are "not measured".
  const measured = typeof opts.swapMin === "number" && Number.isFinite(opts.swapMin) && opts.swapMin > 0 ? opts.swapMin : null;
  const fixed = opts.bigMachine ? N.swapBigMin : N.swapMin;
  // Oil cores are the MOULD's own cost, whichever machine it goes on: the
  // machine's history is mostly ordinary moulds, so it never brings such a
  // mould under the owner's «ساعتين ثلاثة» (ASSUMPTION — he was not asked how
  // the two combine; the slower of them does not flatter).
  const swapMin = sameMould ? 0
    : opts.oilCores ? Math.max(N.swapOilCoresMin, measured ?? fixed)
    : measured ?? fixed;
  const swapMeasured = !sameMould && measured !== null && swapMin === measured;
  // A hot runner is heated and purged through whenever its mould goes up or
  // the colour in it changes — not when the same mould carries on unchanged.
  const hotRunnerMin = opts.hotRunner && !(sameMould && ease === "same") ? N.hotRunnerMin : 0;

  return {
    ease, colour, materialChange, sameMould, purgeMin, swapMin, swapMeasured, hotRunnerMin,
    totalMin: purgeMin + swapMin + hotRunnerMin,
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
  hotRunner: "mold",
  // The store's own name for the material this product is made of — asked
  // once per product and remembered, because Master's «نوع الخام» does not
  // match the store's catalogue (approved by the owner, 2026-10-07).
  storeMaterial: "mold",
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
/**
 * null = never asked; [] = asked, nothing missing. A cell that holds words
 * this list does not know (somebody typed in the tab) is NOT "nothing
 * missing" — it is read as never asked, so the order is not waved through.
 */
export function missingFromSheet(v: string | undefined | null): MissingKey[] | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (fold(raw) === fold(NOTHING_MISSING)) return [];
  const out: MissingKey[] = [];
  for (const part of listFromSheet(raw)) {
    const hit = MISSING_ITEMS.find((m) => fold(m.ar) === fold(part) || m.key === fold(part));
    if (hit && !out.includes(hit.key)) out.push(hit.key);
  }
  return out.length > 0 ? out : null;
}

/** «تركب على أنهي ماكينات؟» taken back: every machine un-tapped. Written so
 *  the LATEST answer says "not known" again (a blank cell cannot — the latest
 *  NON-blank cell wins). It names no machine, so it reads as no answer. */
export const FITS_UNKNOWN = "غير محدد";

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
  // ensureHeaders adds a missing header at the right-hand end. Keep new
  // columns in the order they were added.
  "ترتيب الخريطة\nMap layout",
  "هوت رانر\nHot runner",
  // Added 2026-10-07, last again: which material of «مخزن اتقان» a product is
  // made of. Worded so that neither half holds another field's keyword.
  "خامة المخزن\nStore material",
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
  // Added 2026-10-05, last for the same reason as «ترتيب الخريطة» above: the
  // ONE colour in the barrel, apart from the colours the job is made in.
  "اللون الشغال الآن\nColour now",
];

export type LogRow = {
  machine: string; order: string; toProduct: string; toColour: string; material: string;
  /** The row's own stamp, as the sheet holds it — the caller normalises it. */
  date?: string;
  fromProduct?: string;
  /** «اللون الشغال الآن» ("" on rows written before the column existed). */
  nowColour?: string;
  reasons?: string;
};

/** The «الأسباب» text of a «الراكب الآن» row — what tells it from a confirmed change. */
export const BASELINE_REASON = "تسجيل الراكب الحالي";
export const isBaselineRow = (r: Pick<LogRow, "reasons">): boolean => fold(r.reasons).startsWith(fold(BASELINE_REASON));

/**
 * «أمر الشغل» on a «الراكب الآن» row when somebody answered «لا» to "is this
 * work order …?" — the machine's job has NO order, and the page stops asking.
 * A blank cell says nothing either way, so it cannot carry that answer.
 */
export const NO_ORDER = "بدون أمر شغل";

/** Rows in SHEET ORDER → what is standing on each machine (by machineKey). */
export function standingFromLog<T extends LogRow>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = machineKey(r.machine);
    if (k && (r.toProduct || "").trim()) out.set(k, r);
  }
  return out;
}

/**
 * The same, plus the newest CONFIRMED change still behind each machine's last
 * row. Only the last row is "what stands" — but a note written after a confirm
 * («تعديل», a tap on which colour is running) must not erase the fact that the
 * machine was STARTED: it used to send a press that had just been mounted back
 * to «واقفة» and offer its running order to every other machine. The confirm
 * stays behind the notes for as long as they name the same mould.
 */
export type Standing<T extends LogRow> = {
  row: T;
  started: T | null;
  /**
   * What the page was told came OFF this machine while the same mould has
   * stood on it — each with the stamp of the row that said so, because it is
   * only true of shifts up to that day: the same mould going back up LATER is
   * news. Carried across notes (a later «لا» or colour tap must not bring back
   * what «اتغيّرت» took off), minus anything a later row names as standing.
   */
  cameOff: { product: string; date: string }[];
};
export function standingWithStart<T extends LogRow>(rows: readonly T[]): Map<string, Standing<T>> {
  const out = new Map<string, Standing<T>>();
  const shares = (a: string | undefined, b: string | undefined) =>
    listFromSheet(a).some((x) => listFromSheet(b).some((y) => fold(x) === fold(y)));
  for (const r of rows) {
    const k = machineKey(r.machine);
    if (!k || !(r.toProduct || "").trim()) continue;
    const own = listFromSheet(r.fromProduct).map((product) => ({ product, date: r.date ?? "" }));
    const names = (product: string) => listFromSheet(r.toProduct).some((x) => fold(x) === fold(product));
    if (!isBaselineRow(r)) { out.set(k, { row: r, started: r, cameOff: own.filter((c) => !names(c.product)) }); continue; }
    const prev = out.get(k);
    const sameMould = !!prev && shares(prev.row.toProduct, r.toProduct);
    const started = prev?.started && shares(prev.started.toProduct, r.toProduct) ? prev.started : null;
    const cameOff = [...(sameMould ? prev!.cameOff : []), ...own].filter((c) => !names(c.product));
    out.set(k, { row: r, started, cameOff });
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
 * it is a list — but it is just as often a mould change inside the shift
 * (13 times in the live log: a change 5 times, a pair starting about as
 * often), and the shift alone cannot tell. So when the latest shift mixes a
 * product carried over from the shift before with a NEW one, the new one is
 * listed first (the from-side and the material are read off it) and the run
 * is marked `mixed`, which the page turns into one question.
 */
export type ShiftRow = { date: string; shift: string; machine: string; product: string; material?: string };
export type LastRun = {
  date: string;
  shift: string;
  products: string[];
  /** «نوع الخام» as each shift row typed it, parallel to `products` ("" = blank). */
  materials: string[];
  /** A carried-over product and a new one in the same shift — see above. */
  mixed: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** «المسائية» comes after «الصباحية» on the same date. Matched on the FOLDED
 *  word — `fold` turns «ئ» into «ي», so the pattern is «مساي», not «مسائ». */
export const shiftRank = (shift: string): number => (/مساي|ليل|night|evening/.test(fold(shift)) ? 2 : 1);

type Slot = { date: string; rank: number; shift: string; items: { product: string; material: string }[] };

/**
 * The last shift of every machine, and the newest date in the whole log.
 * Rows dated after `today` are ignored — a mistyped year must not become
 * "the latest shift" and make every real machine look idle.
 */
export function latestRuns(rows: readonly ShiftRow[], today: string): { byMachine: Map<string, LastRun>; latestDate: string } {
  const seen = new Map<string, { cur: Slot | null; prev: Slot | null }>();
  let latestDate = "";
  const newer = (d: string, r: number, s: Slot) => d > s.date || (d === s.date && r > s.rank);
  const same = (d: string, r: number, s: Slot) => d === s.date && r === s.rank;
  const add = (s: Slot, product: string, material: string) => {
    const hit = s.items.find((i) => fold(i.product) === fold(product));
    if (!hit) s.items.push({ product, material });
    else if (!hit.material && material) hit.material = material;
  };
  for (const r of rows) {
    const mk = machineKey(r.machine);
    const product = String(r.product ?? "").replace(/\s+/g, " ").trim();
    if (!mk || !product || !ISO.test(r.date) || (ISO.test(today) && r.date > today)) continue;
    if (r.date > latestDate) latestDate = r.date;
    const rank = shiftRank(r.shift);
    const material = String(r.material ?? "").replace(/\s+/g, " ").trim();
    const st = seen.get(mk) ?? { cur: null, prev: null };
    seen.set(mk, st);
    const fresh = (): Slot => ({ date: r.date, rank, shift: r.shift, items: [{ product, material }] });
    if (!st.cur || newer(r.date, rank, st.cur)) { st.prev = st.cur; st.cur = fresh(); }
    else if (same(r.date, rank, st.cur)) add(st.cur, product, material);
    else if (!st.prev || newer(r.date, rank, st.prev)) st.prev = fresh();
    else if (same(r.date, rank, st.prev)) add(st.prev, product, material);
  }
  const byMachine = new Map<string, LastRun>();
  for (const [k, st] of seen) {
    const cur = st.cur!;
    let items = cur.items;
    let mixed = false;
    if (items.length > 1 && st.prev) {
      const was = (p: string) => st.prev!.items.some((i) => fold(i.product) === fold(p));
      const carried = items.filter((i) => was(i.product));
      const fresh = items.filter((i) => !was(i.product));
      if (carried.length > 0 && fresh.length > 0) { mixed = true; items = [...fresh, ...carried]; }
    }
    byMachine.set(k, {
      date: cur.date, shift: cur.shift, mixed,
      products: items.map((i) => i.product), materials: items.map((i) => i.material),
    });
  }
  return { byMachine, latestDate };
}

/**
 * For every product, the machine whose shift naming it is the NEWEST in the
 * log. A mould is in one place: when the same product is the last thing two
 * machines logged, the newer shift has it — seen live on 2026-10-05, when
 * «روزته سودة العداد الثلاثي» ran one shift on PQ 10 and then moved to PQ 13,
 * and both stood green with the same order. (The log's own history is 6 moved
 * to 5 came back, so the older machine is ASKED, never declared empty.)
 * Keys are `fold(product)`; the value's machine is a `machineKey`.
 */
export function newestHolders(rows: readonly ShiftRow[], today: string): Map<string, { machine: string; date: string; rank: number }> {
  const out = new Map<string, { machine: string; date: string; rank: number }>();
  for (const r of rows) {
    const mk = machineKey(r.machine);
    const pk = fold(r.product);
    if (!mk || !pk || !ISO.test(r.date) || (ISO.test(today) && r.date > today)) continue;
    const rank = shiftRank(r.shift);
    const cur = out.get(pk);
    if (!cur || r.date > cur.date || (r.date === cur.date && rank > cur.rank)) out.set(pk, { machine: mk, date: r.date, rank });
  }
  return out;
}

export const daysBefore = (iso: string, days: number): string => {
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

/**
 * A product name with «جديد»/«قديم» taken out and a trailing mould number
 * taken off. Two names that agree on this are probably one product — the order
 * says «كفر شفاف فوكس» and the crew logs «كفر شفاف فوكس 2»; the order says
 * «وش سمارت جديد مباشر» and Master (so the log's dropdown) only has
 * «وش سمارت مباشر». Only ever used to ASK the engineer and to borrow a
 * default; a number in the MIDDLE («ضهر عداد 1 فوكس» / «ضهر عداد 2 فوكس») is
 * a different part and is left alone. (Measured on every Master and log name,
 * 2026-10-05: letting «جديد» go wherever it stands adds no new collision.)
 */
const AGE_WORDS = ["جديد", "قديم", "new", "old"];
export function looseNameKey(name: string | undefined | null): string {
  const all = fold(name).split(" ").filter(Boolean);
  let words = all.filter((w) => !AGE_WORDS.includes(w));
  if (words.length === 0) words = all;
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/* ----------------------------- machines and orders ------------------------- */

export type MachineNow = {
  /** What stands on the machine — usually one product, sometimes a pair. */
  products: string[];
  /** Colour keys; a product may run in several («رمادي» then «أسود»). */
  colours: string[];
  /** The ONE colour in the barrel right now, when somebody said so (or it is
   *  the only colour there is). "" when the job runs in several and nobody
   *  said which; the estimate then assumes the WORST of them. */
  colourNow: string;
  /** The colours are a guess or a memory, not anybody's tap on this job. */
  coloursGuessed: boolean;
  material: string;
  /** The work order standing on the machine, "" when it runs without one. */
  order: string;
  /** That order is an important client's — its mould is not taken off for another. */
  keyClient: boolean;
  /** An open order that is PROBABLY this job under another spelling of the
   *  name ("" = none). The page asks; nothing is tied until somebody says yes. */
  orderMaybe: string;
  /** Somebody answered «لا» to that question: this job has NO work order.
   *  Carried so a later note about the same mould does not lose the answer. */
  noOrder: boolean;
  /** The same product has a NEWER shift on this other machine — the mould has
   *  probably moved there ("" = no). The page asks. */
  alsoOn: string;
  /** The latest shift logged a carried-over product and a new one — a change
   *  inside the shift, or a pair starting. The page asks. */
  mixedShift: boolean;
  /** "production" = the shift log says so; "plan" = told on this page and the
   *  log has not said otherwise; "registry" = only «الماكينات» says so;
   *  "none" = nothing is known. */
  source: "plan" | "production" | "registry" | "none";
  /** ISO day of the newest evidence behind `products`; "" when unknown. */
  since: string;
  shift: string;
  /**
   * The ISO day the product now on the machine STARTED there: the change
   * confirmed on this page when there is one, else the oldest of the unbroken
   * run of shift rows (newest first) that name one of `products`; "" when
   * unknown. A mould that went on today is not taken off again (approved by
   * the owner, 2026-10-07) — rankFor does not interrupt a job whose
   * `startedOn` is today or later.
   */
  startedOn: string;
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
  /**
   * What a mould change on THIS machine has actually taken, in minutes: the
   * median of its own «تغيير الاسطمبة» rows in «التوقفات», rounded to 5 (the
   * server works it out — ASSUMPTION there: rows of 15–720 minutes from the
   * last 90 days, and at least 3 of them). null = not enough history, or the
   * tab could not be read: the fixed numbers of CHANGEOVER_NUMBERS stand.
   */
  swapMin: number | null;
  /** How many such rows are behind `swapMin` (0 when it is null for want of any). */
  swapSamples: number;
};

/** The downtime page's reason key for «لا يوجد أمر شغل» (lib/prod-meta.ts). */
export const NO_ORDER_STOPPAGE = "No order";
/**
 * Owner, 2026-10-07: "when a machine is recorded as (no job order) this means
 * it finished what is on it." The stoppage is the floor's own, real-time word;
 * the shift log that counts the quantity is typed a day or two behind. So the
 * order standing on such a machine is DONE (PlanOrder.doneByFloor), and the
 * machine is the first one that needs a mould.
 */
export const machineFinished = (m: { stoppage: Stoppage | null }): boolean => m.stoppage?.reason === NO_ORDER_STOPPAGE;

/**
 * What a running stoppage's REASON says about putting a mould on the machine
 * (approved by the owner, 2026-10-07 — before it, the plan gave a late order
 * to a machine that was down for repair):
 *
 * finished = «لا يوجد أمر شغل»: it has nothing to run — the first to need a mould;
 * open     = the MACHINE is fine and can take another mould: its mould is out
 *            for maintenance, or there is no material for the job on it;
 * blocked  = the machine itself cannot run anything now — a repair, a change
 *            already in progress («تغيير الاسطمبة»), drying, no operator, a
 *            set-up, a burnt nozzle, a broken sprue, «أخرى». A reason key this
 *            file does not know is blocked too: never offer a mould on a guess.
 *
 * Keys are lib/prod-meta.ts DOWNTIME_CAPTURE_REASONS (copied — zero imports).
 */
export type StoppageKind = "finished" | "open" | "blocked";
const OPEN_STOPPAGES: readonly string[] = ["Mold maintenance", "No material"];
export function stoppageKind(reason: string): StoppageKind {
  if (reason === NO_ORDER_STOPPAGE) return "finished";
  return OPEN_STOPPAGES.includes(reason) ? "open" : "blocked";
}
/**
 * «صيانة في الماكينة» — the one blocked reason that is a repair of the MACHINE
 * itself, with no word on how long. Under every other one the mould on the
 * machine is about to run there again (a change in progress, a set-up, drying,
 * nobody to run it, a nozzle, a sprue), so the day's plan keeps its order with
 * it; under this one the plan is left as the owner approved it on 2026-10-07 —
 * "the late order goes to a machine that can run it".
 * ASSUMPTION (his to correct): that this holds when the late order's mould is
 * the one standing on the machine under repair.
 */
const MACHINE_REPAIR = "Maintenance";
const MOULD_REPAIR = "Mold maintenance";
const MOULD_CHANGE = "Mold change";
const NO_MATERIAL = "No material";

/** Owner, 2026-10-10: "the team can do 2 changes at the same time." */
export const CHANGE_TEAMS = 2;

/**
 * WHO is at fault when a machine stands — owner, 2026-10-10: "sometimes the
 * mould is good but on a bad machine, and sometimes the mould is bad but is
 * put on the machine." The floor's own stoppage reason says which:
 *   machine  «صيانة في الماكينة» — the mould on it is GOOD: it can go to
 *            another machine, and this one takes nothing until it is repaired;
 *   mould    «صيانة الاسطمبة» — the MACHINE is good: it takes another mould,
 *            and the order of the bad mould waits for it wherever it stands;
 *   material «عدم وجود خامة» — both are good; the order waits for material
 *            and the machine takes another mould;
 *   none     any other reason says nothing about either.
 */
export type StoppageFault = "machine" | "mould" | "material" | "none";
export function stoppageFault(reason: string | undefined | null): StoppageFault {
  return reason === MACHINE_REPAIR ? "machine" : reason === MOULD_REPAIR ? "mould" : reason === NO_MATERIAL ? "material" : "none";
}

/**
 * The one place a machine's state is decided.
 *
 * `since` is the day of the newest evidence that the machine RAN — a logged
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

/**
 * "The log when the page was told" for resolveNow — or null when the log has
 * MOVED ON since, which makes the log win.
 *
 * `at` is the machine's last shift as of the plan's day (a confirmed change)
 * or the day before it (a note); `later` is every shift logged after that,
 * oldest first; `latest` is the newest shift there is. Comparing only `at`
 * with `latest` read A → B → A as "nothing changed": the mould that had come
 * off went back up and the page kept showing the confirmed one as running,
 * with the really-running order offered as waiting (11 such returns in 141
 * mould changes in the live log). So EVERY shift since is looked at:
 *
 *  - after a CONFIRMED change the machine runs that mould: a later shift that
 *    does not name it (in the log's own spelling of it) means it came off, or
 *    never went up;
 *  - after a NOTE the machine runs what it ran when the note was written: a
 *    later shift naming nothing of `at` (and not the note's mould) is a change.
 *
 * A log that names the plan's mould its own way («كفر شفاف فوكس 2» for the
 * order's «كفر شفاف فوكس») is that mould — it stands, whatever `at` was.
 * `known` = the log has named this mould on this machine at some time (the
 * caller looks); see `fits` below for what that changes.
 */
export function logSinceTold(
  plan: PlanStanding, at: LastRun | null, later: readonly (readonly string[])[], latest: LastRun,
  known = false,
): LastRun | null {
  const loose = plan.products.map(looseNameKey);
  const exactly = (products: readonly string[]) => products.some((x) => plan.products.some((p) => fold(p) === fold(x)));
  // A loosely-equal name is the page's mould only as the spelling the log was
  // USING when the page was told — or, when the log has not named the mould
  // either way since, as the only way it names it. «رشاش 010» moving on to
  // «رشاش 030» is another product, not another spelling.
  const spelling = (at?.products ?? []).filter((a) => loose.includes(looseNameKey(a))).map(fold);
  const seen = spelling.length > 0 || later.some(exactly);
  const respells = (products: readonly string[]) => exactly(products) || products.some((x) => spelling.includes(fold(x)))
    || (!seen && products.some((x) => loose.includes(looseNameKey(x))));
  const carries = (products: readonly string[]) => !!at && products.some((x) => at.products.some((a) => fold(a) === fold(x)));
  // "Runs what it ran when the note was written" is for a tie to a name the
  // log NEVER uses on this machine. A mould the log itself knows here
  // (`known`), or one started by «ركّب دي» (the note sits on a confirm), has
  // come off once a shift since stops naming it — the confirm's own rule.
  const fits = plan.baseline && !plan.startedOn && !known ? (ps: readonly string[]) => carries(ps) || respells(ps) : respells;
  if (later.some((ps) => !fits(ps))) return null;
  return respells(latest.products) ? latest : at;
}

/** What was told on this page about a machine, from its last «تغييرات الاسطمبات» row. */
export type PlanStanding = {
  date: string;
  products: string[];
  /** The colours recorded with it (the job's, or just the one it started on). */
  colours: string[];
  /** The colour in the barrel as last told ("" = not told). */
  colourNow: string;
  order: string;
  material: string;
  /** true = «الراكب الآن»: somebody recorded what is STANDING. false = a
   *  confirmed change. Only a confirmed change says the machine was started —
   *  recording what stands on an idle machine must not turn it green. */
  baseline: boolean;
  /** The day of the newest CONFIRMED change still behind this row ("" = none):
   *  the row's own day for a confirmed change; for a note about what stands,
   *  the confirm it was written after, while both name the same mould. */
  startedOn: string;
  /** What the page was told came OFF — never shown as still standing. */
  from: string[];
};

const sameProduct = (a: readonly string[], b: readonly string[]): boolean =>
  a.some((x) => b.some((y) => fold(x) === fold(y)));

/**
 * Who is right about a machine: what was told on this page, or the shift log?
 *
 *  - They name the same product: both. The log dates it; the page supplies
 *    what the log does not hold (the colours, the work order).
 *  - They differ, and the log has NOT changed mould since the page was told
 *    (`runAtPlan` — the machine's last shift as of that day — is the same
 *    product as its last shift now): the page stands. Two cases, one rule: a
 *    mould that went up after the last logged shift, and an order the engineer
 *    tied to a machine whose log spells the product another way
 *    («كفر شفاف فوكس 2» for the order's «كفر شفاف فوكس»). Without this the
 *    tie was dropped by the very next shift row.
 *  - They differ and the log HAS moved on: the log. The machine was changed
 *    without telling this page.
 *
 * `since` is the newer of the log's last shift and a CONFIRMED change — never
 * a «الراكب الآن» note, which says what stands, not that it ran.
 *
 * `runAtPlan` is the caller's, from `logSinceTold`: the machine's last shift
 * as of the plan's day for a confirmed change, and as of the day BEFORE for a
 * note — a change later on the note's own day must not be read as "unchanged
 * since" — and null once any shift since has moved on.
 */
export function resolveNow(
  plan: PlanStanding | null, run: LastRun | null, registryProduct: string, runAtPlan: LastRun | null = null,
): Pick<MachineNow, "products" | "colours" | "colourNow" | "order" | "source" | "since" | "shift"> & { material: string } {
  if (plan && plan.products.length > 0) {
    const told = { colours: plan.colours, colourNow: plan.colourNow, order: plan.order, material: plan.material };
    // The day the machine was STARTED from this page — never a note's own day.
    const startDay = plan.baseline ? plan.startedOn : plan.date;
    if (!run) return { ...told, products: plan.products, source: "plan", since: startDay, shift: "" };
    const started = !!startDay && startDay > run.date;
    const dated = { since: started ? startDay : run.date, shift: started ? "" : run.shift };
    if (sameProduct(plan.products, run.products)) {
      // A change inside a shift leaves the mould that came off in the same
      // shift's rows; what the page was told came off is not standing. Only
      // for shifts up to the day it was told: the same mould going back up
      // LATER is news, and filtering it out would show the wrong mould.
      const kept = run.date <= plan.date
        ? run.products.filter((p) => !plan.from.some((f) => fold(f) === fold(p)))
        : run.products;
      return { ...told, products: kept.length > 0 ? kept : run.products, source: "production", ...dated };
    }
    // With no shift to compare against: a confirmed change stands while nothing
    // is logged after its day; a note about what stands gives way to any shift
    // logged on its own day or later (it described what was already there).
    // …and when the log ALREADY named the page's mould by then and the latest
    // shift no longer does, it has come off: that is a change, not a tie.
    const unchanged = runAtPlan ? sameProduct(runAtPlan.products, run.products) && !sameProduct(runAtPlan.products, plan.products)
      : plan.baseline ? run.date < plan.date : run.date <= plan.date;
    if (unchanged) return { ...told, products: plan.products, source: "plan", ...dated };
  }
  if (run) return { products: run.products, colours: [], colourNow: "", order: "", material: "", source: "production", since: run.date, shift: run.shift };
  const reg = registryProduct.replace(/\s+/g, " ").trim();
  if (reg) return { products: [reg], colours: [], colourNow: "", order: "", material: "", source: "registry", since: "", shift: "" };
  return { products: [], colours: [], colourNow: "", order: "", material: "", source: "none", since: "", shift: "" };
}

export type PlanOrder = {
  id: string;
  code: string;
  product: string;
  client: string;
  material: string;
  dueDate: string;
  /** The app's status token (lib/prod-meta.ts): "In Production", "Not Started", "On Hold"… */
  status: string;
  qtyKg: number;
  /** Pieces still to make, as the shift log COUNTS them; null when Master has
   *  no piece weight for it. Never the estimate below — see `asOf`. */
  remaining: number | null;
  /**
   * WORKING hours of running left; null when unknown. From the rate named by
   * `runBasis`, and — for the order running on a running machine — after
   * taking off what was probably made since the last day the log holds for
   * that machine (`asOf`): the log is typed a day or two behind. (The server
   * works that out. ASSUMPTION there: at most 72 working hours are taken off,
   * however long the log has been silent.)
   */
  runHours: number | null;
  /**
   * Where the rate behind `runHours` comes from (approved by the owner,
   * 2026-10-07: the forecast uses the real rate). "logged" = the good pieces
   * per shift row over this order's 5 most recent COUNTED shift rows (a row
   * is SHIFT_HOURS); "master" = «الرئيسي»'s cycle and cavities, when nothing
   * is counted yet; "" = neither is known and `runHours` is null.
   */
  runBasis: "logged" | "master" | "";
  /** The last day the shift log holds for the machine this order is running
   *  on — what `runHours` was estimated forward from. "" when no such
   *  allowance was made (not running, or its machine is not). */
  asOf: string;
  /**
   * Registry labels of the machines the shift log shows this PRODUCT ran on,
   * most shift rows first; [] when it never ran (or the log was not read).
   * Where a mould goes is learned from where it has run (approved by the
   * owner, 2026-10-07) — it stands in for `fits` until the supervisor answers.
   */
  ranOn: string[];
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
  /** The mould has a hot runner (owner, 2026-10-05: "some moulds may have it"). null = not asked. */
  hotRunner: boolean | null;
  missing: MissingKey[] | null;
  keyClient: boolean;
  /** The machine this order is tied to, or where its mould stands; "" if nowhere. */
  mountedOn: string;
  /** THIS order is the one running there now (not merely a mould standing). */
  mountedRunning: boolean;
  /**
   * Another order is running on this order's mould — the same product ordered
   * in another colour (the owner's own case). The code of that order. Such an
   * order is not "running": it is the NEXT job on that machine, with no mould
   * change at all, and it is not offered anywhere else while the mould runs.
   */
  queuedBehind: string;
  /** The machine it stands on was recorded «لا يوجد أمر شغل»: the floor says
   *  this order is finished, whatever the (late-typed) count still shows. */
  doneByFloor?: boolean;
  /**
   * The floor said «لا يوجد أمر شغل» on its machine, but the count says more
   * than a shift of running was still left — the two disagree (approved by the
   * owner, 2026-10-07: the floor's word is checked against the count). Such an
   * order is NOT `doneByFloor` and NOT blocked: it stays an ordinary candidate,
   * and the page tells the engineer to close the order if it is finished or to
   * correct the stoppage reason if it is not. Nothing is stored for this.
   *
   * What the server compares with SHIFT_HOURS is not `runHours` as it is shown
   * (the count, as typed): it is what was left when the machine STOPPED — the
   * count less what was probably made between the last day that is counted
   * and the stoppage, at the order's own rate. And only for a machine that was
   * running until then (machineState, the stoppage aside): one that has logged
   * nothing for weeks did not run those weeks, and its count is taken as it is.
   * ASSUMPTION (the owner approved `runHours` > 12; the allowance is this
   * page's reading of it, his to correct): without it every machine whose log
   * is a day behind — which is every machine — would have its finished order
   * doubted and offered back to it.
   */
  doneUnsure?: boolean;
  /**
   * The supervisor's standing answer to «بتتعمل من أنهي خامة في المخزن؟» for
   * this order's product, as it was saved; "" = nobody has answered. Carried
   * apart from `stock`, which is null whenever the store cannot put a number
   * on it (not read, the name gone from the store, its books below zero) —
   * the question form must still show what was answered.
   */
  storeMaterial: string;
  /**
   * The order's material in «مخزن اتقان»; null = which store material it uses
   * is not known, or the store could not be read (ASSUMPTION on the server:
   * it is given 6 seconds to answer). Never a zero for "unknown".
   */
  stock: OrderStock | null;
};

export type OrderStock = {
  /** The store's own name for the material. */
  material: string;
  /** Kilograms the store holds of it, for this order's client or for the factory itself. */
  haveKg: number;
  /** Kilograms the pieces still to make need; null when the remaining count
   *  or the piece weight is not known. */
  needKg: number | null;
  /** Nobody answered which store material this product uses: `material` is a
   *  guess (Master's «نوع الخام» matched exactly one store name). */
  guessed: boolean;
};

/** Where an order's material stands in the store — see `stockState`. */
export type StockState = "unknown" | "ok" | "low" | "none";
/**
 * unknown = `stock` is null; none = the store holds nothing of it; low = it
 * holds less than what is left to make needs; ok otherwise (also when the
 * need cannot be worked out — some is there, and nothing says it is short).
 * Approved by the owner, 2026-10-07. A warning in the ranking, never a block
 * there; only the day's plan refuses to PICK an order with none.
 */
export function stockState(o: Pick<PlanOrder, "stock">): StockState {
  const st = o.stock;
  if (!st) return "unknown";
  if (st.haveKg <= 0) return "none";
  return st.needKg !== null && st.haveKg < st.needKg ? "low" : "ok";
}

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
 * A colour read off a MATERIAL cell («ABS اسود مخرز» → black). «مخرز شفاف» is
 * natural regrind, not a transparent part — seven products with that material
 * have had orders and none was transparent — so transparent is believed only
 * from a virgin grade («PC شفاف»).
 */
export function colourFromMaterial(material: string | undefined | null): string {
  const found = coloursIn(material);
  if (found.length !== 1) return "";
  if (found[0] === "transparent" && /مخرز/.test(fold(material))) return "";
  return found[0];
}

/**
 * What may be in the barrel: the one colour when it is known, else EVERY
 * colour the standing job runs in. «أي لون» says nothing about the barrel.
 */
export function barrelColours(now: Pick<MachineNow, "colourNow" | "colours">): string[] {
  const one = colourKey(now.colourNow);
  if (one && one !== ANY_COLOUR) return [one];
  return now.colours.map(colourKey).filter((k) => k && k !== ANY_COLOUR);
}

/**
 * …and for a machine KEPT for transparent whose colour nobody recorded:
 * transparent. Pricing a transparent job there as "anything → transparent"
 * (the worst change) put coloured orders ahead of it — the reverse of the
 * owner's rule. The page still says the colour is not recorded.
 */
export function barrelOf(m: { now: Pick<MachineNow, "colourNow" | "colours">; transparentOnly: boolean }): string[] {
  const told = barrelColours(m.now);
  return told.length === 0 && m.transparentOnly ? ["transparent"] : told;
}

const worse = (a: Estimate, b: Estimate): boolean =>
  EASE_ORDER[a.ease] > EASE_ORDER[b.ease] || (a.ease === b.ease && a.totalMin > b.totalMin);

/**
 * The change to ONE colour from a machine whose barrel may hold any of
 * `from.colours` — the WORST of them. A machine running white and black is not
 * "the same colour" as a white order just because white is on its list.
 */
export function estimateFrom(
  from: { product: string; colours: readonly string[]; material: string }, to: Side, opts: EstimateOptions = {},
): Estimate {
  const candidates = from.colours.length > 0 ? from.colours : [""];
  let worst: Estimate | null = null;
  for (const colour of candidates) {
    const e = estimateChange({ product: from.product, colour, material: from.material }, to, opts);
    if (!worst || worse(e, worst)) worst = e;
  }
  return worst!;
}

/**
 * An order made in several colours can START with any of them — pick the one
 * that is easiest after what is on the machine (white first after white, not
 * black). No colours at all is one estimate with the colour unknown. «أي لون»
 * is never a start colour: something real goes into the barrel.
 */
export function bestStart(
  from: { product: string; colours: readonly string[]; material: string },
  to: { product: string; colours: readonly string[]; material: string },
  opts: EstimateOptions = {},
): { estimate: Estimate; startColour: string } {
  if (to.colours.length === 0) {
    return { estimate: estimateFrom(from, { product: to.product, colour: "", material: to.material }, opts), startColour: "" };
  }
  let best: { estimate: Estimate; startColour: string } | null = null;
  for (const colour of to.colours) {
    const estimate = estimateFrom(from, { product: to.product, colour, material: to.material }, opts);
    if (!best || worse(best.estimate, estimate)) best = { estimate, startColour: colourKey(colour) === ANY_COLOUR ? "" : colourKey(colour) };
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
  late: number;       // whole CALENDAR days past due, 0 when not late
  onlyHere: boolean;
  /** The order's mould is already standing on THIS machine. */
  mountedHere: boolean;
  /**
   * Does the mould belong on this machine? "here" = the SUPERVISOR said so
   * (or it is standing here); "unknown" = nobody has said yet. Owner,
   * 2026-10-07: "what machine fits what mould is decided by the supervisor" —
   * Master's tonnage is only a hint on the question form now; it used to sort
   * a mould after the rest and fold it away.
   * "ran" (approved the same day) = the supervisor has NOT answered, and the
   * shift log shows this product ran on this machine (PlanOrder.ranOn): sorted
   * between the two, with a «ranHere» chip — `needsAnswers` stays true until
   * he answers.
   */
  fit: "here" | "ran" | "unknown";
  /** WORKING days until the due date — Fridays are not counted (negative =
   *  that many calendar days late); null when it has none. See orderUrgency. */
  dueIn: number | null;
  /** Not late yet, but the running it still needs does not fit in the working
   *  time before its due date (see orderUrgency) — treated like a late order. */
  atRisk: boolean;
  /** A key client's order that is late, at risk, or due within
   *  KEY_URGENT_DAYS working days — the only time a key client jumps the
   *  queue (owner's choice, 2026-10-07). */
  urgentKey: boolean;
  /** Where its material stands in the store (stockState). Never blocks here. */
  stock: StockState;
  /** Worth taking the RUNNING mould off for (see rankFor). */
  interrupt: boolean;
  /** Something the ranking wanted to know is not answered yet (colour, which
   *  machines the mould fits, whether it is ready). A hint on the questions
   *  button — never a row of grey chips, which is what made the first version
   *  of the list unreadable. */
  needsAnswers: boolean;
  chips: Chip[];
};

export type BlockReason = "finished" | "doneByFloor" | "onHold" | "notFit" | "transparentElsewhere" | "missing";
export type Blocked = { order: PlanOrder; reason: BlockReason; vars?: Record<string, string | number> };

/** Whole CALENDAR days from `todayIso` to `dueIso` (negative = late); null
 *  without both. Only for wording a date («التسليم بكرة») — every decision
 *  counts working days (workingDaysUntil). */
function daysUntil(dueIso: string, todayIso: string): number | null {
  if (!ISO.test(dueIso) || !ISO.test(todayIso)) return null;
  const d = Date.UTC(+dueIso.slice(0, 4), +dueIso.slice(5, 7) - 1, +dueIso.slice(8, 10));
  const t = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  return Math.round((d - t) / 86_400_000);
}

/** One shift, in hours — also "ends within a shift" and "a short run". */
export const SHIFT_HOURS = 12;
/** A key client goes first only when its order is late, will be late, or is
 *  due within this many WORKING days (Fridays are not counted). */
export const KEY_URGENT_DAYS = 3;
/** A running job that ends within this many hours ON THE CLOCK is on the day's plan. */
export const SOON_HOURS = 24;

/* ------------------------------- working time ------------------------------- */

/**
 * Days are counted in WORKING time (approved by the owner, 2026-10-07): Friday
 * is the day off, every other day is two 12-hour shifts.
 * ASSUMPTION: every day but Friday runs both shifts, all 24 hours — no other
 * holiday, no short day. The «عطلة» rows of «الإنتاج» are not looked at here.
 */
const dayNumber = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * Working days from `todayIso` to `dueIso`: the days d with today < d ≤ due
 * that are not Fridays (0 = due today). An order already past its date gives
 * the negative number of CALENDAR days (5 days late = −5) — lateness is
 * counted the way the customer counts it. null without two ISO dates.
 */
export function workingDaysUntil(dueIso: string, todayIso: string): number | null {
  if (!ISO.test(dueIso) || !ISO.test(todayIso)) return null;
  const d = dayNumber(dueIso), t = dayNumber(todayIso);
  if (d < t) return d - t;
  // Day 1 (1970-01-02) was a Friday, so day n is one when n mod 7 is 1 — the
  // Fridays in (t, d] are counted, not walked: a due date mistyped a century
  // out must not spin in a sort.
  const fridays = Math.floor((d - 1) / 7) - Math.floor((t - 1) / 7);
  return d - t - fridays;
}

/**
 * `workHours` of running, as hours on the CLOCK from now: today still has
 * (24 − hourNow) running hours unless it is a Friday (then none), every later
 * day has 24 unless it is a Friday — so five hours left at Thursday noon is
 * five hours, and twenty is forty-four. `hourNow` is the Cairo hour (0–24);
 * noon when the caller has no clock (or hands over something that is not an
 * hour). Nothing to run → 0; without an ISO day there is no calendar to walk
 * and the hours come back as they are.
 */
export function calendarHours(workHours: number, todayIso: string, hourNow = 12): number {
  if (!(workHours > 0)) return 0;
  if (!ISO.test(todayIso) || !Number.isFinite(workHours)) return workHours;
  let left = workHours, idle = 0, day = todayIso;
  // (A NaN hour would make every comparison below false and the walk endless.)
  let room = 24 - (Number.isFinite(hourNow) ? Math.min(24, Math.max(0, hourNow)) : 12);
  for (;;) {
    const off = isFriday(day);
    // The idle hours are whole Fridays (or what is left of today's), so the
    // answer is the working hours plus them — no rounding creeps in.
    if (!off && left <= room) return workHours + idle;
    if (off) idle += room; else left -= room;
    day = daysBefore(day, -1);
    room = 24;
    // Whole weeks in one step — six running days and one Friday, whichever
    // weekday this is — so a mistyped quantity cannot spin here either.
    const weeks = Math.ceil(left / 144) - 1;
    if (weeks > 0) { left -= weeks * 144; idle += weeks * 24; }
  }
}

/**
 * Where an order stands by its date alone — no machine needed (the «الأوامر» tab).
 *
 * All of it approved by the owner on 2026-10-07:
 *
 * `dueIn`  WORKING days to the due date (workingDaysUntil) — a Friday in
 *          between is not time to make anything in. Negative = late.
 * `late`   whole CALENDAR days past the date, 0 when not late: lateness is
 *          counted the way the customer counts it.
 * `atRisk` at risk = WILL be late: not late yet, but the running it still
 *          needs is more than the working time before its due date —
 *          `runHours` > working days × 24. Unknown hours or no date is never
 *          "at risk".
 * `urgentKey` a key client's order that is due within KEY_URGENT_DAYS working
 *          days, late, or at risk — the only time a key client jumps the queue.
 */
const REST_OF_TODAY_HOURS = 12;
export function orderUrgency(
  o: Pick<PlanOrder, "dueDate" | "keyClient" | "runHours">, today: string,
): { dueIn: number | null; late: number; atRisk: boolean; urgentKey: boolean } {
  const dueIn = o.dueDate ? workingDaysUntil(o.dueDate, today) : null;
  const late = dueIn !== null && dueIn < 0 ? -dueIn : 0;
  // "Due on day D" means by the END of D, and the days counted do not include
  // today: what is left of today runs too. Half a day on average (ASSUMPTION)
  // — without it every order due today with anything left read «هيتأخر».
  const atRisk = late === 0 && dueIn !== null && o.runHours != null && o.runHours > dueIn * 24 + REST_OF_TODAY_HOURS;
  return { dueIn, late, atRisk, urgentKey: o.keyClient && dueIn !== null && (dueIn <= KEY_URGENT_DAYS || atRisk) };
}

/** Late, or going to be: the two are one tier in every sort, and one reason
 *  to take a running mould off (approved by the owner, 2026-10-07). */
const lateOrAtRisk = (u: { late: number; atRisk: boolean }): boolean => u.late > 0 || u.atRisk;
/** An order the day's plan places before it looks at any machine. */
const isUrgent = (u: { urgentKey: boolean; late: number; atRisk: boolean }): boolean => u.urgentKey || lateOrAtRisk(u);

/**
 * The chips that say WHY an order is where it is: key client, late, will be
 * late, due soon, no date.
 *
 * An order that is `atRisk` says so INSTEAD of "due in…": how many days of
 * running it needs (a part of a day is a day) against the working days there
 * are. The "due in…" chip appears within KEY_URGENT_DAYS working days, but it
 * WORDS the date as the calendar reads — seen on a Thursday, an order due on
 * the Friday is due tomorrow (not today), and one due on the Saturday in two
 * days (not tomorrow).
 */
export function urgencyChips(o: Pick<PlanOrder, "dueDate" | "keyClient" | "runHours">, today: string): Chip[] {
  const { dueIn, late, atRisk } = orderUrgency(o, today);
  const chips: Chip[] = [];
  if (o.keyClient) chips.push({ key: "keyClient", tone: "good" });
  if (late > 0) chips.push({ key: "late", tone: "warn", vars: { n: late } });
  else if (dueIn === null) chips.push({ key: "noDueDate", tone: "warn" });
  else if (atRisk) chips.push({ key: "atRisk", tone: "warn", vars: { need: Math.ceil((o.runHours ?? 0) / 24), have: dueIn } });
  else if (dueIn <= KEY_URGENT_DAYS) {
    const n = daysUntil(o.dueDate, today) ?? dueIn;
    chips.push({ key: n <= 0 ? "dueToday" : n === 1 ? "dueTomorrow" : n === 2 ? "dueTwoDays" : "dueSoon", tone: "warn", vars: { n } });
  }
  return chips;
}

/**
 * Open orders in the owner's order, without a machine: an urgent key client →
 * late or going to be → dated before undated → the nearer date. Two dates the
 * same number of WORKING days away (a Thursday and the Friday after it) are
 * still told apart by the date itself.
 */
export function sortByUrgency<T extends PlanOrder>(orders: readonly T[], today: string): T[] {
  return [...orders].sort((a, b) => {
    const x = orderUrgency(a, today), y = orderUrgency(b, today);
    return Number(y.urgentKey) - Number(x.urgentKey)
      || Number(lateOrAtRisk(y)) - Number(lateOrAtRisk(x))
      || Number(y.dueIn !== null) - Number(x.dueIn !== null)
      || (x.dueIn ?? 0) - (y.dueIn ?? 0)
      || (x.dueIn !== null && y.dueIn !== null ? a.dueDate.localeCompare(b.dueDate) : 0)
      || a.code.localeCompare(b.code, undefined, { numeric: true });
  });
}

/** Where a mould belongs, as a sort key: said (or standing) here → has run here → nobody knows. */
const FIT_ORDER: Record<Suggestion["fit"], number> = { here: 0, ran: 1, unknown: 2 };

/**
 * The ease tier one suggestion sorts on, on its machine — rankFor's own, and
 * the day's plan compares machines for one order with the same number.
 */
function easeOf(machine: Pick<PlanMachine, "transparentOnly">, s: Suggestion): number {
  // The mould is already on this machine: nothing is cheaper to start.
  if (s.mountedHere) return -1;
  const someTransparent = s.order.colours.some((c) => colourKey(c) === "transparent");
  // A coloured job on a machine kept for transparent sorts with the worst.
  return machine.transparentOnly && !someTransparent ? EASE_ORDER.veryHard : EASE_ORDER[s.estimate.ease];
}

/**
 * THE OWNER'S ORDER, as he chose it on 2026-10-07 (it was «عميل مهم» always
 * first): a key client's order that is late, will be late, or is due within
 * KEY_URGENT_DAYS working days → any order that is late or WILL be (`atRisk`)
 * → orders that HAVE a due date before those that have none → where the mould
 * belongs: the supervisor said it goes here, then it has run here, then
 * nobody knows → fits only this machine → ease of the change → least
 * remaining → due date.
 *
 * Taking a RUNNING mould off (`interrupt`) is worth it only for such an urgent
 * key-client order, a late one or one that will be late — and never when the
 * running job ends within a shift, is itself late, at risk or a key client's,
 * or went on TODAY (approved by the owner, 2026-10-07: a mould that went on
 * today is not taken off).
 *
 * The store never takes an order out of this list: a material the store is
 * short of is a chip («stockNone» / «stockLow») — only the day's plan refuses
 * to PICK an order with none.
 *
 * Rank the WAITING orders for one machine.
 *
 * Not a candidate at all: the job this machine is running now, and any order
 * that is running on another machine or queued behind a mould running there —
 * none of them is waiting for a machine.
 * An order whose mould is merely STANDING on an idle machine still is one:
 * here it is the cheapest thing to start («الاسطمبة راكبة هنا»), elsewhere it
 * says where the mould is. So is the same product's NEXT order on the machine
 * running its mould («نفس الاسطمبة الشغالة»): no mould change at all.
 *
 * Five things take an order out of the ranking and into `blocked`, each with
 * its reason: its quantity is already made (still «جاري التشغيل» only because
 * nobody closed it); the order is on hold; the engineer said the mould does
 * not fit here; the engineer said it is transparent and this is not a machine
 * kept for transparent; something it needs is not ready.
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
  const barrel = barrelOf(machine);
  // Assumed, not told: priced as transparent, but never called "the same colour".
  const barrelAssumed = barrel.length > 0 && barrelColours(machine.now).length === 0;
  const sameCode = (a: string, b: string) => !!fold(a) && fold(a) === fold(b);
  // The job running here, and whether it may be interrupted at all.
  const runningHere = machine.state === "running"
    ? orders.find((x) => x.mountedRunning && !x.queuedBehind && machineKey(x.mountedOn) === mk) ?? null : null;
  // Late, or going to be: either way its mould stays where it is.
  const runningLate = !!runningHere && lateOrAtRisk(orderUrgency(runningHere, ctx.today));
  const runningEndsSoon = runningHere?.runHours != null && runningHere.runHours < SHIFT_HOURS;
  // A mould that went on today is not taken off again (approved by the owner,
  // 2026-10-07). An unknown start («») cannot be held against anybody.
  const mountedToday = !!machine.now.startedOn && machine.now.startedOn >= ctx.today;
  const mayInterrupt = machine.state === "running" && !machine.now.keyClient && !runningLate && !runningEndsSoon && !mountedToday;

  for (const o of orders) {
    const here = !!o.mountedOn && machineKey(o.mountedOn) === mk;
    if (here && machine.state === "running" && !o.queuedBehind) continue;
    if (!here && o.mountedOn && (o.mountedRunning || !!o.queuedBehind)) continue;
    // The floor said its machine has no job order: it is finished. Said once,
    // on that machine; offered nowhere.
    if (o.doneByFloor) {
      if (here) blocked.push({ order: o, reason: "doneByFloor" });
      continue;
    }

    if (o.remaining === 0) {
      blocked.push({ order: o, reason: "finished" });
      continue;
    }
    if (o.status === "On Hold") {
      blocked.push({ order: o, reason: "onHold" });
      continue;
    }
    if (o.fits && o.fits.length > 0 && !o.fits.some((l) => machineKey(l) === mk)) {
      blocked.push({ order: o, reason: "notFit", vars: { machines: o.fits.join(" · ") } });
      continue;
    }
    const keys = o.colours.map(colourKey).filter(Boolean);
    const allTransparent = keys.length > 0 && keys.every((k) => k === "transparent");
    const offTransparentMachine = allTransparent && keptForTransparent.length > 0 && !keptForTransparent.includes(mk);
    // …and only a mould that CAN go on a kept machine is sent there: one the
    // engineer said fits only ordinary machines was blocked here for being
    // transparent and there for not fitting — no machine offered it at all.
    const fitsKept = !o.fits || o.fits.length === 0 || o.fits.some((l) => keptForTransparent.includes(machineKey(l)));
    // A GUESSED transparent (read off a name or a material cell) never blocks:
    // «مخرز شفاف» made seven ordinary products look transparent.
    if (offTransparentMachine && fitsKept && o.colourSource === "answer") {
      blocked.push({ order: o, reason: "transparentElsewhere", vars: { machines: ctx.transparentMachines.join(" · ") } });
      continue;
    }
    if (o.missing && o.missing.length > 0) {
      blocked.push({ order: o, reason: "missing", vars: { items: o.missing.join(",") } });
      continue;
    }

    const standing = machine.now.products.find((p) => fold(p) === fold(o.product)) ?? machine.now.products[0] ?? "";
    const { estimate, startColour } = bestStart(
      { product: standing, colours: barrel, material: machine.now.material },
      { product: o.product, colours: keys, material: o.material },
      // The machine's own measured change time, when it has one (null = the
      // fixed minutes stand).
      { bigMachine: machine.bigMachine, oilCores: o.oilCores, hotRunner: o.hotRunner, swapMin: machine.swapMin },
    );
    const onlyHere = !!o.fits && o.fits.length === 1;
    const maybeRunningHere = sameCode(machine.now.orderMaybe, o.code);
    const chips: Chip[] = [];

    const fitAnswered = !!o.fits && o.fits.length > 0;
    // Nobody has answered, and the shift log shows the product on this machine:
    // where a mould goes is learned from where it has run (approved by the
    // owner, 2026-10-07). His answer, once given, is the only word — a mould he
    // said goes elsewhere was blocked above, whatever the log shows.
    const ranHere = (o.ranOn ?? []).some((l) => machineKey(l) === mk);
    const fit: Suggestion["fit"] = here || fitAnswered ? "here" : ranHere ? "ran" : "unknown";
    const urgency = orderUrgency(o, ctx.today);
    const { dueIn, late, urgentKey, atRisk } = urgency;

    chips.push(...urgencyChips(o, ctx.today));
    if (maybeRunningHere) chips.push({ key: "maybeRunningHere", tone: "warn" });
    if (here && o.queuedBehind) chips.push({ key: "sameMouldNext", tone: "good", vars: { order: o.queuedBehind } });
    else if (here) chips.push({ key: "mountedHere", tone: "good" });
    else if (o.mountedOn) chips.push({ key: "mountedElsewhere", tone: "warn", vars: { machine: o.mountedOn } });
    if (fit === "ran") chips.push({ key: "ranHere", tone: "good" });
    if (onlyHere) chips.push({ key: "onlyHere", tone: "good" });

    // Worth taking the running mould off: an urgent key-client order, a late
    // one or one that WILL be late — and not when this order simply follows
    // on the same mould. "The machine is running" is said ONCE above the list.
    const interrupt = mayInterrupt && isUrgent(urgency) && !o.queuedBehind && !maybeRunningHere;
    if (interrupt) chips.push({ key: "worthInterrupt", tone: "good" });

    const someTransparent = keys.includes("transparent");
    const colouredOnTransparentMachine = machine.transparentOnly && !someTransparent;
    switch (estimate.colour) {
      case "same": if (!barrelAssumed) chips.push({ key: "sameColour", tone: "good" }); break;
      case "any": chips.push({ key: "anyColour", tone: "good" }); break;
      case "darker": chips.push({ key: "darker", tone: "good" }); break;
      // Not a good sign on a machine KEPT for transparent: it has to be
      // cleaned back to transparent afterwards.
      case "fromTransparent": if (!colouredOnTransparentMachine) chips.push({ key: "fromTransparent", tone: "good" }); break;
      case "lighter": chips.push({ key: "lighter", tone: "warn" }); break;
      case "toTransparent":
        chips.push({ key: "toTransparent", tone: "bad" });
        if (barrel.length === 0) chips.push({ key: "nowColourUnknown", tone: "warn" });
        break;
      case "unknown":
        chips.push({ key: keys.length === 0 ? "colourUnknown" : barrel.length === 0 ? "nowColourUnknown" : "colourUnranked", tone: "warn" });
        break;
    }
    if (barrelAssumed) chips.push({ key: "nowColourUnknown", tone: "warn" });
    if (keys.length > 1 && startColour) chips.push({ key: "startWith", tone: "info", vars: { colour: startColour } });

    if (estimate.materialChange === false) chips.push({ key: "sameMaterial", tone: "good" });
    else if (estimate.materialChange === true) chips.push({ key: "materialChange", tone: "warn" });
    // No material on record is NOT "no drying needed": four polycarbonate
    // orders read as ready with nothing on the card saying so.
    else if (!materialFamily(o.material)) chips.push({ key: "materialUnknown", tone: "warn" });

    // What the store holds of it. "Not known" says nothing at all — it is not
    // "none" — and neither state takes the order out of this list.
    const stock = stockState(o);
    if (stock === "none" && o.stock) chips.push({ key: "stockNone", tone: "bad", vars: { material: o.stock.material } });
    else if (stock === "low" && o.stock && o.stock.needKg !== null) {
      chips.push({ key: "stockLow", tone: "warn", vars: { have: Math.round(o.stock.haveKg), need: Math.round(o.stock.needKg) } });
    }

    if (estimate.drying) {
      const d = estimate.drying;
      chips.push({ key: "drying", tone: "warn", vars: { h: d.minH === d.maxH ? `${d.minH}` : `${d.minH}–${d.maxH}` } });
    }
    if (o.hotRunner) chips.push({ key: "hotRunner", tone: "info" });
    if (colouredOnTransparentMachine) chips.push({ key: "transparentMachine", tone: "bad" });
    if (offTransparentMachine && fitsKept) chips.push({ key: "transparentElsewhereMaybe", tone: "warn", vars: { machines: ctx.transparentMachines.join(" · ") } });

    if (o.workers !== null && o.workers > 1) chips.push({ key: "workers", tone: "warn", vars: { n: o.workers } });
    if (o.runHours !== null && o.runHours > 0 && o.runHours < SHIFT_HOURS) chips.push({ key: "shortRun", tone: "warn" });

    ranked.push({
      order: o, estimate, startColour, late, onlyHere, mountedHere: here, fit, dueIn, atRisk, urgentKey, interrupt, chips, stock,
      // Where it has run is a stand-in, not his answer: the hint stays.
      needsAnswers: keys.length === 0 || o.colourSource !== "answer" || !fitAnswered || o.missing === null,
    });
  }

  ranked.sort((a, b) =>
    Number(b.urgentKey) - Number(a.urgentKey)
    // Late, and going to be late, are one tier (at risk = WILL be late).
    || Number(lateOrAtRisk(b)) - Number(lateOrAtRisk(a))
    || Number(b.dueIn !== null) - Number(a.dueIn !== null)
    // A mould the supervisor SAID goes here before one nobody has spoken for:
    // with no answers at all the plan offered a small mould to the 280. One
    // the log has seen running here sits between the two.
    || FIT_ORDER[a.fit] - FIT_ORDER[b.fit]
    || Number(b.onlyHere) - Number(a.onlyHere)
    || easeOf(machine, a) - easeOf(machine, b)
    || (a.order.remaining ?? Infinity) - (b.order.remaining ?? Infinity)
    || (a.order.dueDate || "9999").localeCompare(b.order.dueDate || "9999")
    || a.order.code.localeCompare(b.order.code, undefined, { numeric: true }),
  );
  return { ranked, blocked };
}

/* -------------------------------- the day's plan ----------------------------- */

/**
 * Why a machine is on the day's plan, most pressing first:
 * finished  = recorded «لا يوجد أمر شغل» — it has nothing to run;
 * free      = a mould is standing (or nothing is known) and no shift is logged;
 * stopped   = a stoppage is running whose reason leaves the MACHINE able to
 *             take a mould (stoppageKind "open") — still suggested for
 *             (owner: "it should still suggest");
 * overrun   = running, and its order has nothing left to make (remaining 0):
 *             the opposite of «لا يوجد أمر شغل» — the count says done and the
 *             floor has not said so;
 * interrupt = running, and an urgent order is worth taking its mould off for;
 * soon      = running, and its job ends within SOON_HOURS on the clock;
 * down      = a stoppage is running whose reason means the machine itself
 *             cannot run (stoppageKind "blocked") — never given a mould;
 * running   = running with time to go, or nothing to say about when it ends.
 */
export type DayNeed = "finished" | "free" | "stopped" | "overrun" | "interrupt" | "soon" | "down" | "running";
const DAY_ORDER: readonly DayNeed[] = ["finished", "free", "stopped", "overrun", "interrupt", "soon", "down", "running"];
/** The machines that can take a mould NOW — the first an urgent order looks at. */
const NEEDS_MOULD: readonly DayNeed[] = ["finished", "free", "stopped", "overrun"];
/** «PQ 9» before «PQ 10»: by number, not by letter. */
const byLabel = (a: { label: string }, b: { label: string }): number => a.label.localeCompare(b.label, undefined, { numeric: true });

export type DayEntry = {
  machine: PlanMachine;
  need: DayNeed;
  /** The order standing on it now, when the page knows one. */
  current: PlanOrder | null;
  /** WORKING hours of running left on that order; null when not running or not known. */
  hoursLeft: number | null;
  /** The same on the CLOCK — calendarHours(hoursLeft): a Friday in between
   *  is hours in which nothing runs. null when `hoursLeft` is. */
  finishIn: number | null;
  /** The mould to put on next; null on a machine that just keeps running, or
   *  when nothing waits for it. One order is offered to ONE machine. */
  pick: Suggestion | null;
  /** Hours from now at which the pick's material has to start drying
   *  (0 = now); null when it needs none, or there is no pick. */
  dryIn: number | null;
  /** Its place in the queue of mould changes (1, 2, 3 …) and the minutes from
   *  now until one of the CHANGE_TEAMS teams can start it (0 = now). null when
   *  the pick needs no change of mould, or there is no pick. */
  turn: number | null;
  startIn: number | null;
  /** The pick's mould is GOOD and stands on this machine, which is under
   *  repair itself: it is moved from there ("" otherwise). */
  movedFrom: string;
  /** On a machine under repair: where its good mould was planned ("" = nowhere yet). */
  movesTo: string;
};

/**
 * An URGENT order (a key client's close date, late, or at risk) the plan
 * could not put anywhere: "noMaterial" = the store holds none of its material,
 * so no machine is offered it; "noMachine" = no machine that could take it is
 * free, ending soon or worth interrupting — or its mould is held on a machine
 * that is stopped (see planDay; `order.mountedOn` says which, and the page
 * says so). Said on the page, never hidden.
 */
export type Unplaced = { order: PlanOrder; why: "noMaterial" | "noMachine" };
export type DayPlan = { entries: DayEntry[]; unplaced: Unplaced[] };

/**
 * The whole floor in the order things have to be done (owner, 2026-10-07:
 * "I am unable to understand the plan" — the ranked list per machine answered
 * a question nobody had asked yet).
 *
 * URGENT ORDERS CHOOSE THEIR MACHINE FIRST (approved by the owner, 2026-10-07).
 * The first plan went machine by machine — each took the top of its own list —
 * and so gave a late order to whichever machine came first, a press down for
 * repair included. Now:
 *
 *  NEED, before any pick: a stoppage's reason decides (stoppageKind) —
 *    finished → "finished", open → "stopped", blocked → "down"; else not
 *    running → "free"; running with its order at remaining 0 → "overrun";
 *    running with finishIn ≤ SOON_HOURS → "soon"; else "running".
 *  PASS 1, order first: the urgent orders (urgentKey, late or atRisk) that are
 *    in at least one machine's ranking, in sortByUrgency order. Stock "none" →
 *    unplaced "noMaterial": no machine is held for a job that cannot be fed.
 *    Else the machines without a pick whose ranking holds it and which are
 *    (a) finished / free / stopped / overrun, (b) soon, or (c) running with
 *    that suggestion's `interrupt` — the smallest by class (a, b, c), fit
 *    (here, ran, unknown), ease (as rankFor sorts it), the estimate's
 *    totalMin, then the label, numerically. A class (c) machine becomes
 *    "interrupt". No candidate → unplaced "noMachine".
 *  PASS 2, machine first: every finished / free / stopped / overrun / soon
 *    machine still without a pick, in entry order, takes the first suggestion
 *    of its own ranking not yet given whose stock is not "none". "down" and
 *    "running" machines never get one — so a long job is "worth interrupting"
 *    only when an urgent order really has nowhere better to go (five running
 *    machines all said "an urgent order is waiting" with nothing under it,
 *    first live look).
 *  ORDER of entries: finished, free, stopped, overrun, interrupt, soon
 *    (finishIn ascending), down, running (hoursLeft ascending, unknown last);
 *    ties by label, numerically.
 *  dryIn: when the pick needs drying, max(0, (soon ? finishIn : 0) − maxH),
 *    to one decimal; else null.
 *
 * WHERE A MOULD STANDS comes before both passes (the review of 2026-10-07 —
 * the passes above were written, and tested, with no order ON a stopped
 * machine, which is where a stoppage is normally tapped):
 *  - HELD. An order whose mould stands on a machine that is "stopped" (its
 *    mould is out for maintenance, or there is no material for it), or "down"
 *    for anything but a repair of the machine itself (MACHINE_REPAIR), is given
 *    to NO machine: not back to its own — rule 1 says that machine can take
 *    ANOTHER mould, and a "down" one takes none — and not to another, which
 *    was asked to take its running mould off for an order being mounted next
 *    door. An urgent one is unplaced "noMachine".
 *  - ONE MOULD, ONE MACHINE. Two open orders of one product whose mould stands
 *    on the same machine are one mould: once one of them is given, the other
 *    is next on that mould — not a job for another machine, and not unplaced.
 *
 * `hourNow` is the Cairo hour the plan is made at (for `finishIn`); noon when
 * the caller has no clock.
 */
export function planDay(
  machines: readonly PlanMachine[],
  orders: readonly PlanOrder[],
  ctx: { today: string; transparentMachines: readonly string[]; hourNow?: number; nowMs?: number; daysOff?: readonly string[] },
): DayPlan {
  type Row = Pick<DayEntry, "machine" | "need" | "current" | "hoursLeft" | "finishIn" | "pick"> & { ranked: Suggestion[] };
  // A «عطلة» day (one row in «الإنتاج» = every machine off) is a day nothing
  // runs, like a Friday: what is left of today does not count.
  const offToday = !!ctx.daysOff?.includes(ctx.today);
  const hour = ctx.hourNow ?? 12;
  const rows: Row[] = machines.map((machine) => {
    const mk = machineKey(machine.label);
    const current = orders.find((o) => !!fold(o.code) && fold(o.code) === fold(machine.now.order) && machineKey(o.mountedOn) === mk) ?? null;
    const running = machine.state === "running";
    const hoursLeft = running && current && current.runHours != null ? current.runHours : null;
    const finishIn = hoursLeft === null ? null
      : offToday && hoursLeft > 0 ? (24 - hour) + calendarHours(hoursLeft, ctx.today, 24)
      : calendarHours(hoursLeft, ctx.today, ctx.hourNow);
    // The stoppage's reason decides. A machine called stopped with no reason
    // on record is read like a reason nobody knows: not offered a mould.
    const kind: StoppageKind | null = machine.stoppage ? stoppageKind(machine.stoppage.reason)
      : machine.state === "stopped" ? "blocked" : null;
    const need: DayNeed = kind === "finished" ? "finished"
      : kind === "open" ? "stopped"
      : kind === "blocked" ? "down"
      : !running ? "free"
      : current?.remaining === 0 ? "overrun"
      : finishIn !== null && finishIn <= SOON_HOURS ? "soon"
      : "running";
    return { machine, need, current, hoursLeft, finishIn, pick: null, ranked: rankFor(machine, orders, ctx).ranked };
  });

  // PASS 1 — the ORDER picks. Every machine that lists an order, and what it
  // would cost there.
  const offers = new Map<string, { row: Row; s: Suggestion }[]>();
  for (const row of rows) {
    for (const s of row.ranked) {
      const list = offers.get(s.order.id) ?? [];
      list.push({ row, s });
      offers.set(s.order.id, list);
    }
  }
  // `cls`: 0 = the machine can take a mould now, 1 = it can within the day,
  // 2 = it is running a job worth taking off for this order.
  type Candidate = { row: Row; s: Suggestion; cls: number };
  const better = (a: Candidate, b: Candidate): boolean => (
    a.cls - b.cls
    || FIT_ORDER[a.s.fit] - FIT_ORDER[b.s.fit]
    || easeOf(a.row.machine, a.s) - easeOf(b.row.machine, b.s)
    || a.s.estimate.totalMin - b.s.estimate.totalMin
    || byLabel(a.row.machine, b.row.machine)
  ) < 0;
  const given = new Set<string>();
  const unplaced: Unplaced[] = [];
  // Where a mould stands (see above). `need` is settled for these rows: pass 1
  // only ever turns a RUNNING machine into one worth interrupting.
  const rowOf = new Map(rows.map((row) => [machineKey(row.machine.label), row] as const));
  const held = (o: PlanOrder): boolean => {
    const row = o.mountedOn ? rowOf.get(machineKey(o.mountedOn)) : undefined;
    // …unless the MACHINE is what is being repaired: then its mould is good
    // and free to go to another machine (stoppageFault).
    return !!row && (row.need === "stopped" || (row.need === "down" && stoppageFault(row.machine.stoppage?.reason) !== "machine"));
  };
  // A mould is its product ON the machine it stands on; an order whose mould
  // is up nowhere has none to share.
  const mouldOf = (o: PlanOrder): string => (o.mountedOn ? `${fold(o.product)}|${machineKey(o.mountedOn)}` : "");
  const mouldsGiven = new Set<string>();
  const mouldGiven = (o: PlanOrder): boolean => mouldsGiven.has(mouldOf(o));
  const give = (row: Row, s: Suggestion): void => {
    row.pick = s;
    given.add(s.order.id);
    if (mouldOf(s.order)) mouldsGiven.add(mouldOf(s.order));
  };
  const urgent = sortByUrgency(orders.filter((o) => offers.has(o.id) && isUrgent(orderUrgency(o, ctx.today))), ctx.today);
  for (const o of urgent) {
    // (…or it is next on a mould that already has its machine.)
    if (given.has(o.id) || mouldGiven(o)) continue;
    // None of its material in the store: no machine is held for it, and the
    // page says so rather than leaving it out.
    if (stockState(o) === "none") { unplaced.push({ order: o, why: "noMaterial" }); continue; }
    // Its mould is held where it stands: said, never moved.
    if (held(o)) { unplaced.push({ order: o, why: "noMachine" }); continue; }
    let best: Candidate | null = null;
    for (const { row, s } of offers.get(o.id) ?? []) {
      if (row.pick) continue;
      // A machine that is "down" is no candidate at all, and a running one
      // only for an order worth its mould.
      const cls = NEEDS_MOULD.includes(row.need) ? 0 : row.need === "soon" ? 1 : row.need === "running" && s.interrupt ? 2 : -1;
      if (cls < 0) continue;
      const cand: Candidate = { row, s, cls };
      if (!best || better(cand, best)) best = cand;
    }
    if (!best) { unplaced.push({ order: o, why: "noMachine" }); continue; }
    give(best.row, best.s);
    if (best.cls === 2) best.row.need = "interrupt";
  }

  // The order things are done in. Sorted only now: pass 1 may have turned a
  // running machine into one worth interrupting.
  const unknownLast = (a: number | null, b: number | null): number => (a === b ? 0 : (a ?? Infinity) - (b ?? Infinity));
  rows.sort((a, b) =>
    DAY_ORDER.indexOf(a.need) - DAY_ORDER.indexOf(b.need)
    || (a.need === "soon" ? unknownLast(a.finishIn, b.finishIn) : a.need === "running" ? unknownLast(a.hoursLeft, b.hoursLeft) : 0)
    || byLabel(a.machine, b.machine));

  // PASS 2 — the MACHINE picks: the top of its own list that nobody has, that
  // the store can feed, and whose mould is free to go on it (not held on a
  // stopped machine — this one included — and not already given with another
  // order). A machine that is down, or simply running, is given nothing.
  for (const row of rows) {
    if (row.pick || !(NEEDS_MOULD.includes(row.need) || row.need === "soon")) continue;
    const got = row.ranked.find((s) => !given.has(s.order.id) && s.stock !== "none" && !held(s.order) && !mouldGiven(s.order)) ?? null;
    if (got) give(row, got);
  }

  // WHO STARTS WHEN — CHANGE_TEAMS changes at a time, in the order above. A
  // change already in progress («تغيير الاسطمبة» running on a machine) holds
  // a team for what is left of the time a change usually takes there.
  const teams: number[] = new Array<number>(CHANGE_TEAMS).fill(0);
  const freest = (): number => teams.indexOf(Math.min(...teams));
  for (const row of rows) {
    if (row.machine.stoppage?.reason !== MOULD_CHANGE) continue;
    const usual = row.machine.swapMin ?? (row.machine.bigMachine ? CHANGEOVER_NUMBERS.swapBigMin : CHANGEOVER_NUMBERS.swapMin);
    const spent = ctx.nowMs ? Math.max(0, (ctx.nowMs - row.machine.stoppage.since) / 60_000) : 0;
    teams[freest()] += Math.max(0, Math.round(usual - spent));
  }
  let turns = 0;
  const entries = rows.map((row): DayEntry => {
    const dry = row.pick?.estimate.drying ?? null;
    // The dryer has to be done when the machine is: now for one that waits,
    // at the end of the running job for one that ends soon.
    const before = row.need === "soon" ? row.finishIn ?? 0 : 0;
    // A change of mould needs a team; a pick whose mould is already on the
    // machine does not.
    let turn: number | null = null, startIn: number | null = null;
    if (row.pick && !row.pick.mountedHere) {
      const team = freest();
      startIn = Math.max(teams[team], Math.round(before * 60));
      teams[team] = startIn + row.pick.estimate.totalMin;
      turn = ++turns;
    }
    const from = row.pick?.order.mountedOn ? rowOf.get(machineKey(row.pick.order.mountedOn)) : undefined;
    const movedFrom = from && from !== row && from.need === "down" && stoppageFault(from.machine.stoppage?.reason) === "machine"
      ? from.machine.label : "";
    return {
      machine: row.machine, need: row.need, current: row.current, hoursLeft: row.hoursLeft, finishIn: row.finishIn, pick: row.pick,
      dryIn: dry ? Math.max(0, Math.round((before - dry.maxH) * 10) / 10) : null,
      turn, startIn, movedFrom, movesTo: "",
    };
  });
  // Where the good mould of a machine under repair is going.
  for (const e of entries) {
    const src = e.movedFrom ? entries.find((x) => machineKey(x.machine.label) === machineKey(e.movedFrom)) : undefined;
    if (src) src.movesTo = e.machine.label;
  }
  return { entries, unplaced };
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
 * The floor is a LANDSCAPE sheet of MAP_COLS × MAP_MAX_ROWS square units
 * (owner, 2026-10-06: "more landscape, and more pixels to move the machines").
 * The first map was 7 columns of tall cells: a machine could stand in seven
 * places across, and the map was taller than a screen. A tile is
 * `label@c,r,w,h` (1-based top-left unit, width and height in units); tiles
 * are joined with « ; » behind one `grid 56x32` word that says which sheet the
 * numbers are on. A cell WITHOUT that word is the 7-column map and is scaled
 * onto the sheet when read — nobody arranges the floor twice.
 */
export const MAP_COLS = 56;
export const MAP_MAX_ROWS = 32;
/** A machine dropped onto the map, and the smallest it can be made. */
export const MAP_TILE = { w: 7, h: 10, minW: 4, minH: 3 } as const;
export const MAP_NAME = "الأرضية";
export type MapTile = { label: string; c: number; r: number; w: number; h: number };

const LEGACY_MAP_COLS = 7;
const GRID_WORD = /^grid (\d+) ?x ?(\d+)$/;
/** Its own part of the cell: the arrangement was saved as a LANDSCAPE plan. */
const WIDE_WORD = "wide";

/** Tiles from one sheet onto another. EDGES are scaled and rounded, not sizes,
 *  so two tiles that touched still touch and never overlap. */
function scaleTiles(tiles: readonly MapTile[], sx: number, sy: number): MapTile[] {
  return tiles.map((t) => {
    const left = Math.round((t.c - 1) * sx), top = Math.round((t.r - 1) * sy);
    return {
      label: t.label, c: left + 1, r: top + 1,
      w: Math.max(1, Math.round((t.c - 1 + t.w) * sx) - left),
      h: Math.max(1, Math.round((t.r - 1 + t.h) * sy) - top),
    };
  });
}

export function parseLayout(text: string | undefined | null): MapTile[] {
  const raw: MapTile[] = [];
  let grid: { cols: number; rows: number } | null = null;
  let wide = false;
  for (const part of String(text ?? "").split(";")) {
    const at = part.lastIndexOf("@");
    if (at <= 0) {
      const word = latinDigits(part).replace(/\s+/g, " ").trim().toLowerCase();
      const m = word.match(GRID_WORD);
      if (m && !grid && +m[1] > 0 && +m[2] > 0) grid = { cols: +m[1], rows: +m[2] };
      else if (word === WIDE_WORD) wide = true;
      continue;
    }
    const label = part.slice(0, at).replace(/\s+/g, " ").trim();
    const n = latinDigits(part.slice(at + 1)).split(",").map((x) => Number(x.trim()));
    if (!label || n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 1)) continue;
    raw.push({ label, c: n[0], r: n[1], w: n[2], h: n[3] });
  }

  let tiles = raw;
  if (!grid) {
    // The 7-column map: each column is 8 units; its rows were about half as
    // tall as a column was wide, and are packed to fit the sheet's height.
    const old = raw.filter((t) => t.c + t.w - 1 <= LEGACY_MAP_COLS);
    const used = old.reduce((m, t) => Math.max(m, t.r + t.h - 1), 0);
    const sy = Math.min(5, Math.max(1, Math.floor(MAP_MAX_ROWS / Math.max(1, used))));
    tiles = scaleTiles(old, MAP_COLS / LEGACY_MAP_COLS, sy);
  } else if (grid.cols !== MAP_COLS || grid.rows !== MAP_MAX_ROWS) {
    tiles = scaleTiles(raw, MAP_COLS / grid.cols, MAP_MAX_ROWS / grid.rows);
  }

  const out: MapTile[] = [];
  for (const t of tiles) {
    if (!tileInBounds(t) || out.some((x) => machineKey(x.label) === machineKey(t.label))) continue;
    out.push(t);
  }
  // Saved on the 56-unit sheet before the map was a landscape plan (the `grid`
  // word without the `wide` one — the first, 7-column map is left as it was), and arranged
  // TALLER than wide — the owner's own, placed on a phone held upright in the
  // third of the sheet he could see: turned a quarter as it is read, its top
  // to the left, the way a phone is turned sideways. The cell is not touched;
  // the next save writes it wide.
  return grid && !wide && standsTall(out) ? turnLayout(out, 3) : out;
}

export const formatLayout = (tiles: readonly MapTile[]): string =>
  [`grid ${MAP_COLS}x${MAP_MAX_ROWS}`, WIDE_WORD, ...tiles.map((t) => `${t.label}@${t.c},${t.r},${t.w},${t.h}`)].join(" ; ");

const middleOf = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 1;

/** Is the floor arranged with more machines DOWN it than across it? */
export function standsTall(tiles: readonly MapTile[]): boolean {
  if (tiles.length < 2) return false;
  const across = (Math.max(...tiles.map((t) => t.c + t.w)) - Math.min(...tiles.map((t) => t.c))) / middleOf(tiles.map((t) => t.w));
  const down = (Math.max(...tiles.map((t) => t.r + t.h)) - Math.min(...tiles.map((t) => t.r))) / middleOf(tiles.map((t) => t.h));
  return down > across;
}

/**
 * The whole arrangement turned by quarter turns — 1 = clockwise (its top goes
 * to the right), 3 = the other way (its top goes to the left), 2 = upside
 * down. A turn, never a mirror: what stood on a machine's left still does.
 * Only the PLACES turn; a machine's tile stays upright, so a quarter turn
 * gives the ordinary machine the ordinary tile again (MAP_TILE) and lays the
 * floor from the sheet's first unit. Edges are scaled and rounded, so tiles
 * that touched still touch — which also makes a quarter turn lossy: turn
 * from the SAME starting arrangement (the editor does), never turn a turn.
 */
export function turnLayout(tiles: readonly MapTile[], quarters = 1): MapTile[] {
  const q = ((Math.round(quarters) % 4) + 4) % 4;
  const same = tiles.map((t) => ({ ...t }));
  if (q === 0 || tiles.length === 0) return same;
  const left = Math.min(...tiles.map((t) => t.c - 1)), right = Math.max(...tiles.map((t) => t.c - 1 + t.w));
  const top = Math.min(...tiles.map((t) => t.r - 1)), bottom = Math.max(...tiles.map((t) => t.r - 1 + t.h));
  if (q === 2) {
    return tiles.map((t) => ({ ...t, c: left + right - (t.c - 1 + t.w) + 1, r: top + bottom - (t.r - 1 + t.h) + 1 }));
  }
  const spanW = right - left, spanH = bottom - top;
  const sx = Math.min(MAP_COLS / spanH, MAP_TILE.w / middleOf(tiles.map((t) => t.h)));
  const sy = Math.min(MAP_MAX_ROWS / spanW, MAP_TILE.h / middleOf(tiles.map((t) => t.w)));
  const out = tiles.map((t) => {
    const x0 = t.c - 1 - left, x1 = x0 + t.w, y0 = t.r - 1 - top, y1 = y0 + t.h;
    const [a0, a1] = q === 1 ? [spanH - y1, spanH - y0] : [y0, y1];
    const [b0, b1] = q === 1 ? [x0, x1] : [spanW - x1, spanW - x0];
    const l = Math.round(a0 * sx), u = Math.round(b0 * sy);
    return { label: t.label, c: l + 1, r: u + 1, w: Math.max(1, Math.round(a1 * sx) - l), h: Math.max(1, Math.round(b1 * sy) - u) };
  });
  return validLayout(out) ? out : same;
}

export const tileInBounds = (t: MapTile): boolean =>
  t.w >= 1 && t.h >= 1 && t.c >= 1 && t.r >= 1 && t.c + t.w - 1 <= MAP_COLS && t.r + t.h - 1 <= MAP_MAX_ROWS;

export const tilesOverlap = (a: MapTile, b: MapTile): boolean =>
  a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;

/** In bounds, one tile per machine, and no two tiles on the same unit. */
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
 * Put a machine at a unit (or resize it in place). The tile is pulled back
 * inside the sheet when it would hang over the edge and is never smaller than
 * MAP_TILE's minimum; the move is REFUSED (null) when it would land on another
 * machine — the page keeps the last good spot rather than stacking two
 * presses on one.
 */
export function placeTile(
  tiles: readonly MapTile[], label: string, at: { c: number; r: number; w?: number; h?: number },
): MapTile[] | null {
  const key = machineKey(label);
  const cur = tiles.find((t) => machineKey(t.label) === key);
  const w = Math.min(MAP_COLS, Math.max(MAP_TILE.minW, Math.round(at.w ?? cur?.w ?? MAP_TILE.w)));
  const h = Math.min(MAP_MAX_ROWS, Math.max(MAP_TILE.minH, Math.round(at.h ?? cur?.h ?? MAP_TILE.h)));
  const next: MapTile = {
    label: cur?.label ?? label, w, h,
    c: Math.min(Math.max(1, Math.round(at.c)), MAP_COLS - w + 1),
    r: Math.min(Math.max(1, Math.round(at.r)), MAP_MAX_ROWS - h + 1),
  };
  const others = tiles.filter((t) => machineKey(t.label) !== key);
  if (others.some((t) => tilesOverlap(t, next))) return null;
  return [...others, next];
}

/**
 * The first free spot for a machine coming onto the map, reading the sheet
 * like a page (left to right, top to bottom); null when the sheet is full.
 */
export function freeSpot(tiles: readonly MapTile[], w: number = MAP_TILE.w, h: number = MAP_TILE.h): { c: number; r: number } | null {
  for (let r = 1; r + h - 1 <= MAP_MAX_ROWS; r++) {
    for (let c = 1; c + w - 1 <= MAP_COLS; c++) {
      const probe = { label: "", c, r, w, h };
      if (!tiles.some((t) => tilesOverlap(t, probe))) return { c, r };
    }
  }
  return null;
}

export const removeTile = (tiles: readonly MapTile[], label: string): MapTile[] =>
  tiles.filter((t) => machineKey(t.label) !== machineKey(label));

/* ------------------------- the map, in the width there is ------------------------- */

/**
 * The floor is arranged once, on a 56-unit sheet — and read on a phone far
 * more often than on a desk (owner, 2026-10-06: "see it on the phone clearly,
 * while reading the product, seeing the colour and the machine drawing").
 * The first landscape map kept the sheet 42rem wide and let a phone pan it:
 * he arranged every machine into the third of the sheet he could see, and
 * they came out tiny. Scaling a sheet down gives tiles nobody can read. So
 * the sheet is where machines are PLACED, and the drawing follows the width:
 *
 *  - only the part of the sheet the machines stand on is drawn, so the floor
 *    fills the width wherever on the sheet it was arranged;
 *  - on a narrow screen an AISLE (a column no ordinary machine stands on, a
 *    row nothing stands on) is drawn as a sliver — an empty column costs a
 *    phone half a line of text;
 *  - a unit is as wide as that allows, and never so narrow that the narrowest
 *    machine cannot hold its drawing and its name (then, and only then, the
 *    sheet is wider than the screen and pans);
 *  - a unit is as TALL as a tile needs to be read: a drawing over three lines
 *    of name on a phone, a drawing beside two lines on a desk.
 *
 * The ARRANGEMENT is never changed — only how big each unit is drawn.
 *
 * 2026-10-07, owner: "not like this — I want the map itself to be landscape."
 * The drawing above stood a phone's floor up as a tall column of tiles, and a
 * phone held SIDEWAYS (where the dashboard keeps its sidebar) showed a slice
 * of it. The map is a landscape plan now: the arrangement is saved wide
 * (parseLayout turns an older tall one), a frame too narrow for it PANS
 * rather than stands it up, and `fill` fits the whole floor into a frame of a
 * given height — the full-screen view a phone turned sideways gets.
 */
export const MAP_NARROW_PX = 640;
/** The px a tile needs: with the drawing OVER the words, or BESIDE them. */
export const MAP_READABLE = { stackedW: 92, stackedH: 116, sideW: 190, sideH: 72 } as const;
const AISLE = 0.15;
/** Filling a screen, a unit is never drawn taller than this many times its width. */
const FILL_TALLEST = 1.4;

export type FloorFit = {
  tiles: MapTile[];
  /** How wide each unit column and how tall each unit row is drawn, in units
   *  (1 = a full unit, AISLE = a sliver, 0 = not drawn). */
  colFr: number[]; rowFr: number[];
  /** One full unit, in px. */
  unitW: number; unitH: number;
  /** The sheet's width in px, and whether that is wider than the frame. */
  width: number; pans: boolean;
};

const spanOf = (fr: readonly number[], from: number, size: number): number => {
  let sum = 0;
  for (let i = from - 1; i < from - 1 + size && i < fr.length; i++) sum += fr[i] ?? 0;
  return sum;
};
/** A tile's drawn size in px. */
export const tileWidthPx = (fit: FloorFit, t: MapTile): number => spanOf(fit.colFr, t.c, t.w) * fit.unitW;
export const tileHeightPx = (fit: FloorFit, t: MapTile): number => spanOf(fit.rowFr, t.r, t.h) * fit.unitH;

/**
 * How to draw `tiles` in a frame `framePx` wide. `whole` = the editor: the
 * full sheet, every unit the same and rather flat, always fitted to the frame
 * — it is for placing machines, and shows only their codes.
 */
export function fitFloor(tiles: readonly MapTile[], framePx: number, o: { whole?: boolean; fill?: number } = {}): FloorFit {
  const frame = Math.max(0, framePx);
  if (o.whole || tiles.length === 0) {
    const unitW = frame / MAP_COLS;
    const rows = o.whole ? MAP_MAX_ROWS : 1;
    // The editor's sheet is drawn as wide as a sideways phone is: what is
    // arranged there is what the full-screen map shows. Never under 7px a
    // row — a finger has to land on a machine.
    return {
      tiles: [...tiles], colFr: new Array<number>(MAP_COLS).fill(1), rowFr: new Array<number>(rows).fill(1),
      unitW, unitH: Math.max(7, Math.round(unitW * 0.72)), width: frame, pans: false,
    };
  }
  const narrow = frame < MAP_NARROW_PX || o.fill != null;
  const left = Math.min(...tiles.map((t) => t.c)), right = Math.max(...tiles.map((t) => t.c + t.w - 1));
  const top = Math.min(...tiles.map((t) => t.r)), rows = mapRows(tiles);
  // The machines' own span, at full size; on a narrow screen everything in it
  // starts as a sliver and only what a machine stands on is drawn in full.
  const colFr: number[] = new Array<number>(MAP_COLS).fill(0).map((_, i) => (i + 1 < left || i + 1 > right ? 0 : narrow ? AISLE : 1));
  const rowFr: number[] = new Array<number>(rows).fill(0).map((_, i) => (i + 1 < top ? 0 : narrow ? AISLE : 1));
  if (narrow) {
    // A column is the floor's own when an ORDINARY machine stands on it; one
    // that only a long press along the wall crosses is an aisle.
    const widths = tiles.map((t) => t.w).sort((x, y) => x - y);
    const ordinary = widths[Math.floor(widths.length / 2)] * 1.25;
    // The same down the sheet: a tall press standing across the aisle between
    // two lines does not make that aisle a full row.
    const usual = middleOf(tiles.map((t) => t.h)) * 1.25;
    for (const t of tiles) {
      if (t.w <= ordinary) for (let c = t.c; c < t.c + t.w && c <= MAP_COLS; c++) colFr[c - 1] = 1;
      if (t.h <= usual) for (let r = t.r; r < t.r + t.h && r <= rows; r++) rowFr[r - 1] = 1;
    }
  }
  const total = colFr.reduce((x, y) => x + y, 0) || 1;
  if (o.fill != null) {
    // The whole floor in the frame, both ways: nothing pans, nothing scrolls.
    const unitW = frame / total;
    const unitH = Math.max(0, Math.min(o.fill / (rowFr.reduce((x, y) => x + y, 0) || 1), unitW * FILL_TALLEST));
    return { tiles: [...tiles], colFr, rowFr, unitW, unitH, width: frame, pans: false };
  }
  const probe = { tiles: [...tiles], colFr, rowFr, unitW: 1, unitH: 1, width: 0, pans: false };
  const mw = Math.max(1, tiles.reduce((m, t) => Math.min(m, tileWidthPx(probe, t)), Infinity));
  const mh = Math.max(1, tiles.reduce((m, t) => Math.min(m, tileHeightPx(probe, t)), Infinity));
  const R = MAP_READABLE;
  const unitW = Math.max(frame / total, R.stackedW / mw);
  // Is even the narrowest machine wide enough for the drawing to sit BESIDE
  // the words? Then the tiles may be flat; else they are drawn tall.
  const need = mw * unitW >= R.sideW ? R.sideH : R.stackedH;
  const unitH = Math.max(need / mh, unitW * 0.45);
  const width = total * unitW;
  return { tiles: [...tiles], colFr, rowFr, unitW, unitH, width, pans: width > frame + 0.5 };
}

/* ---------------------------------- shifts --------------------------------- */

/**
 * «التغيير مش مسموح في الوردية الليلية وما بتطلعش أي عينات بالليل». The day
 * shift is 08:00–20:00 (the factory day starts at 08:00, lib/dates.ts). The
 * page WARNS at night and still records a change that really happened — a
 * plan that refuses to hear about reality is worse than a broken rule.
 */
export const isNightHour = (cairoHour: number): boolean => cairoHour < 8 || cairoHour >= 20;

/**
 * Friday — the factory's day off. Owner, 2026-10-07, lifting the rule above:
 * "yes they can at night, not Friday." A warning on the page and on the
 * confirm, never a block (ASSUMPTION: the calendar Friday in Cairo, midnight
 * to midnight).
 */
export function isFriday(iso: string): boolean {
  if (!ISO.test(iso)) return false;
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay() === 5;
}

/* --------------------------------- formatting ------------------------------ */

/** 105 → {h: 1, m: 45}; the page words it. */
export const splitMinutes = (min: number): { h: number; m: number } => ({
  h: Math.floor(Math.max(0, min) / 60),
  m: Math.round(Math.max(0, min) % 60),
});

/**
 * The day of a stamp in one of this page's own tabs. The site writes
 * «yyyy-mm-dd HH:MM»; Sheets may hand it back that way, or re-typed in the
 * workbook's locale («10/5/2026 15:10:00» — MONTH first). These columns are
 * written by the site alone, so there is no hand-typed day-first form to guess
 * at, and the padding trick lib/dates.ts uses would read 10/5 as the 10th of
 * May. A day after `today` is a misread or a wrong clock and is clamped: a
 * confirm dated in the future would stand for ever.
 */
export function stampDay(stamp: string | undefined | null, today = ""): string {
  const s = latinDigits(String(stamp ?? "")).replace(/^'/, "").trim();
  let y = 0, mo = 0, d = 0;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/))) {
    const a = +m[1], b = +m[2];
    y = +m[3];
    if (a > 12 && b <= 12) { d = a; mo = b; } else { mo = a; d = b; }
  }
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return ISO.test(today) && day > today ? today : day;
}

/**
 * Minutes on one clock for one of the page's own stamps: the SAME reading of
 * the day as stampDay (month first when Sheets re-typed it) plus the clock.
 * Only ever used to ask "were these two written minutes apart?" — a reader
 * that took «10/5/2026 15:10» for the 10th of May switched the replay check
 * off on the first twelve days of every month from October on.
 */
export function stampClockMinutes(stamp: string | undefined | null): number | null {
  const day = stampDay(stamp);
  if (!day) return null;
  const tail = latinDigits(String(stamp ?? "")).replace(/^'/, "").trim().replace(/^\S+/, "");
  const t = tail.match(/(\d{1,2}):(\d{2})/);
  if (!t) return null;
  let h = +t[1];
  const mi = +t[2];
  if (/pm|م/i.test(tail) && h < 12) h += 12;
  if (/am|ص/i.test(tail) && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, mi) / 60_000;
}

/**
 * A cell the site writes must never start a formula (setValue, appendRow and a
 * USER_ENTERED append all treat a leading = + - @ as one). Stripped until
 * nothing is left to strip — «= =1+1» used to come out as «=1+1» — and with
 * the invisible characters gone first, because a zero-width space in front of
 * the «=» hides it from this check and is then removed by `fold` on the way
 * to the sheet.
 */
export function safeText(v: unknown, max = 120): string {
  let t = String(v ?? "").replace(/[\u0000-\u001F\u200B-\u200F\u061C\uFEFF]+/g, " ").trim();
  while (/^[=+\-@\s]/.test(t)) t = t.replace(/^[=+\-@\s]+/, "");
  return t.slice(0, max).trim();
}
