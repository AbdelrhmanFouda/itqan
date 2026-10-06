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

export type EstimateOptions = { bigMachine?: boolean; oilCores?: boolean | null; hotRunner?: boolean | null };

export type Estimate = {
  ease: Ease;
  colour: ColourRelation;
  /** true = a different family, false = the same, null = one side unknown. */
  materialChange: boolean | null;
  sameMould: boolean;
  purgeMin: number;
  swapMin: number;
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
  const swapMin = sameMould ? 0 : opts.bigMachine ? N.swapBigMin : opts.oilCores ? N.swapOilCoresMin : N.swapMin;
  // A hot runner is heated and purged through whenever its mould goes up or
  // the colour in it changes — not when the same mould carries on unchanged.
  const hotRunnerMin = opts.hotRunner && !(sameMould && ease === "same") ? N.hotRunnerMin : 0;

  return {
    ease, colour, materialChange, sameMould, purgeMin, swapMin, hotRunnerMin,
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
  /** Pieces still to make; null when Master has no piece weight for it. */
  remaining: number | null;
  /** Hours of running left (Master's cycle, else the order's own logged rate); null when unknown. */
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
  late: number;       // whole days past due, 0 when not late
  onlyHere: boolean;
  /** The order's mould is already standing on THIS machine. */
  mountedHere: boolean;
  /**
   * Does the mould belong on this machine? "here" = the engineer said so, or
   * Master's tonnage names it; "unknown" = nobody said, or Master's tonnage
   * names no machine the factory has; "elsewhere" = nobody answered and
   * Master names OTHER machines. Never a gate — Master's tonnage is half
   * empty and partly stale. Only "elsewhere" is sorted after the rest (and
   * folded away on the page): "here" and "unknown" share a tier, so the
   * owner's own order — important client, then late — decides the top.
   */
  fit: "here" | "unknown" | "elsewhere";
  /** Something the ranking wanted to know is not answered yet (colour, which
   *  machines the mould fits, whether it is ready). A hint on the questions
   *  button — never a row of grey chips, which is what made the first version
   *  of the list unreadable. */
  needsAnswers: boolean;
  chips: Chip[];
};

export type BlockReason = "finished" | "onHold" | "notFit" | "transparentElsewhere" | "missing";
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

  for (const o of orders) {
    const here = !!o.mountedOn && machineKey(o.mountedOn) === mk;
    if (here && machine.state === "running" && !o.queuedBehind) continue;
    if (!here && o.mountedOn && (o.mountedRunning || !!o.queuedBehind)) continue;

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
      { bigMachine: machine.bigMachine, oilCores: o.oilCores, hotRunner: o.hotRunner },
    );
    const late = o.dueDate ? daysLate(o.dueDate, ctx.today) : 0;
    const onlyHere = !!o.fits && o.fits.length === 1;
    const maybeRunningHere = sameCode(machine.now.orderMaybe, o.code);
    const chips: Chip[] = [];

    const fitAnswered = !!o.fits && o.fits.length > 0;
    const fit: Suggestion["fit"] =
      here || fitAnswered || o.fitsHint.some((l) => machineKey(l) === mk) ? "here"
      : o.fitsHint.length > 0 ? "elsewhere"
      : "unknown";

    if (o.keyClient) chips.push({ key: "keyClient", tone: "good" });
    if (late > 0) chips.push({ key: "late", tone: "warn", vars: { n: late } });
    if (maybeRunningHere) chips.push({ key: "maybeRunningHere", tone: "warn" });
    if (here && o.queuedBehind) chips.push({ key: "sameMouldNext", tone: "good", vars: { order: o.queuedBehind } });
    else if (here) chips.push({ key: "mountedHere", tone: "good" });
    else if (o.mountedOn) chips.push({ key: "mountedElsewhere", tone: "warn", vars: { machine: o.mountedOn } });
    if (onlyHere) chips.push({ key: "onlyHere", tone: "good" });

    // On a running machine only an important client is worth taking the mould
    // off — and not when the running job is an important client's too, when
    // the mould does not belong here, or when this order simply follows on the
    // same mould. "The machine is running" is said ONCE above the list.
    if (machine.state === "running" && o.keyClient && !machine.now.keyClient
      && fit !== "elsewhere" && !o.queuedBehind && !maybeRunningHere) {
      chips.push({ key: "worthInterrupt", tone: "good" });
    }

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

    if (estimate.drying) {
      const d = estimate.drying;
      chips.push({ key: "drying", tone: "warn", vars: { h: d.minH === d.maxH ? `${d.minH}` : `${d.minH}–${d.maxH}` } });
    }
    if (o.hotRunner) chips.push({ key: "hotRunner", tone: "info" });
    if (colouredOnTransparentMachine) chips.push({ key: "transparentMachine", tone: "bad" });
    if (offTransparentMachine && fitsKept) chips.push({ key: "transparentElsewhereMaybe", tone: "warn", vars: { machines: ctx.transparentMachines.join(" · ") } });

    if (fit === "elsewhere") chips.push({ key: "fitHintElsewhere", tone: "warn", vars: { t: o.fitsHintText } });
    if (o.workers !== null && o.workers > 1) chips.push({ key: "workers", tone: "warn", vars: { n: o.workers } });
    if (o.runHours !== null && o.runHours > 0 && o.runHours < SHIFT_HOURS) chips.push({ key: "shortRun", tone: "warn" });

    ranked.push({
      order: o, estimate, startColour, late, onlyHere, mountedHere: here, fit, chips,
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
  const FIT = { here: 0, unknown: 0, elsewhere: 1 } as const;
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
export const MAP_TILE = { w: 10, h: 6, minW: 4, minH: 3 } as const;
export const MAP_NAME = "الأرضية";
export type MapTile = { label: string; c: number; r: number; w: number; h: number };

const LEGACY_MAP_COLS = 7;
const GRID_WORD = /^grid (\d+) ?x ?(\d+)$/;

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
  for (const part of String(text ?? "").split(";")) {
    const at = part.lastIndexOf("@");
    if (at <= 0) {
      const m = latinDigits(part).replace(/\s+/g, " ").trim().toLowerCase().match(GRID_WORD);
      if (m && !grid && +m[1] > 0 && +m[2] > 0) grid = { cols: +m[1], rows: +m[2] };
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
  return out;
}

export const formatLayout = (tiles: readonly MapTile[]): string =>
  [`grid ${MAP_COLS}x${MAP_MAX_ROWS}`, ...tiles.map((t) => `${t.label}@${t.c},${t.r},${t.w},${t.h}`)].join(" ; ");

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
