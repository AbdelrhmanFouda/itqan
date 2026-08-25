/**
 * Canonical (English) values stored in Firestore for production records, plus
 * colour tones and a localiser that pairs a stored value with its translated
 * label (see lib/i18n.prod.ts arrays, which are index-aligned with these).
 */

export const MACHINE_STATUSES = ["Operational", "Under Maintenance", "Idle", "Out of Service"];
export const MOLD_STATUSES = ["Active", "In Repair", "Retired"];
// «أوامر العمل»!K is a validated list of EXACTLY these four Arabic values, and
// !L (priority) is Arabic too — verified live on 2026-08-09. The app previously
// wrote five English tokens that matched none of them, so every job read back
// as an unknown status: `activeJobs` counted 0 and nothing ever counted as done.
// English stays the canonical internal token; Arabic is the sheet's wire format;
// jobStatusToSheet/fromSheet map at the boundary. See lib/jobs.ts.
export const JOB_STATUSES = ["Not Started", "In Production", "On Hold", "Completed"];
export const JOB_PRIORITIES = ["Low", "Normal", "High"];

const JOB_STATUS_AR: Record<string, string> = {
  "Not Started": "لم يبدأ",
  "In Production": "جاري التشغيل",
  "On Hold": "متوقف",
  Completed: "مكتمل",
};

// "عادية"/"عالية" are confirmed from live rows; "منخفضة" is the Arabic label the
// owner already uses for Low in lib/i18n.prod.ts, so the list is consistent —
// but it has not been seen in the sheet itself. Worth an eyeball before relying on it.
const JOB_PRIORITY_AR: Record<string, string> = {
  Low: "منخفضة",
  Normal: "عادية",
  High: "عالية",
};

const invert = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([en, ar]) => [ar, en]));

const JOB_STATUS_EN = invert(JOB_STATUS_AR);
const JOB_PRIORITY_EN = invert(JOB_PRIORITY_AR);

/**
 * Sheet → app. Unknown values pass through unchanged rather than being forced
 * into a bucket: legacy English rows ("Quoted", "Delivered") and anything a
 * colleague types by hand still render as themselves instead of silently
 * becoming "Not Started".
 */
export const jobStatusFromSheet = (v: string): string => JOB_STATUS_EN[v.trim()] ?? v.trim();
export const jobPriorityFromSheet = (v: string): string => JOB_PRIORITY_EN[v.trim()] ?? v.trim();

/**
 * App → sheet. Only the four validated values are translated; anything else is
 * passed through so we never invent an Arabic term the owner has not approved.
 * "Quoted" and "Delivered" have no counterpart in the sheet's list — they are no
 * longer offered in the UI, and adding them is a sheet change for the owner.
 */
export const jobStatusToSheet = (v: string): string => JOB_STATUS_AR[v] ?? v;
export const jobPriorityToSheet = (v: string): string => JOB_PRIORITY_AR[v] ?? v;
export const DOWNTIME_REASONS = ["None", "Mold change", "Breakdown", "Material", "No order", "Quality hold", "Other"];

export type DowntimeReason = {
  /** Stored value. English and STABLE — the Arabic wording can be reworded
   *  later without orphaning captured history. */
  key: string;
  /** What the floor sees. The only half a worker ever reads. */
  ar: string;
  /** Owner-facing surfaces only (never rendered on the capture page). */
  en: string;
  /**
   * Was this stoppage scheduled work, or a failure?
   *
   * ⚠ METADATA ONLY — set once, here, in code. The worker is never asked it,
   * never sees it and never chooses it, and the buttons are NEVER grouped by it:
   * a flat list keeps a distinction that is none of his business off his screen.
   * It exists purely so owner-facing surfaces (OEE explain, the performance page,
   * the monthly report) can say what share of downtime was avoidable.
   */
  planned: boolean;
  /**
   * Organisational rather than mechanical — nobody was there to run the machine.
   * The monthly report gives this its own line instead of letting it disappear
   * into a per-machine breakdown, because the fix is a rota, not a spanner.
   */
  organisational?: boolean;
};

/**
 * The buttons on the phone capture page (/dashboard/downtime).
 *
 * The owner's own list, in the owner's own order — most frequent first, «أخرى»
 * last, so the common case is the nearest tap. ONE FLAT LIST: no groups, no
 * headers, no sub-menus, no categories. The interaction is machine → reason →
 * start, then stop, and it must stay exactly that.
 *
 * The stored `reason` is the canonical English key, so phone-captured downtime
 * lands in the same Pareto bucket as anything typed into the sheet's «سبب
 * التوقف» column. "Mold change", "Maintenance" and "Other" keep the keys they
 * already had.
 */
export const DOWNTIME_CAPTURE_REASONS: DowntimeReason[] = [
  { key: "Setup",            ar: "ضبط منتج",                  en: "Product setup",     planned: true },
  { key: "Nozzle burn",      ar: "حرق فونيه",                 en: "Nozzle burn",       planned: false },
  { key: "Mold change",      ar: "تغيير الاسطمبة",            en: "Mold change",       planned: true },
  { key: "Mold maintenance", ar: "صيانة الاسطمبة",            en: "Mold maintenance",  planned: false },
  { key: "Maintenance",      ar: "صيانة في الماكينة",          en: "Machine maintenance", planned: false },
  { key: "Material drying",  ar: "تجفيف خامة",                en: "Material drying",   planned: true },
  { key: "No operator",      ar: "توقف بسبب عدم وجود عامل",    en: "No operator",       planned: false, organisational: true },
  // Added 2026-08-22 at the owner's word, after «أخرى» reached 25 of 54 rows:
  // the two causes it was hiding. "No order" is the RETIRED key revived — same
  // key, so sheet history groups with it; "No material" is new (deliberately
  // NOT the retired «خامة», which meant a material PROBLEM, not absence).
  { key: "No material",      ar: "عدم وجود خامة",              en: "No material",       planned: false, organisational: true },
  { key: "No order",         ar: "لا يوجد أمر شغل",            en: "No order",          planned: false, organisational: true },
  { key: "Sprue broken",     ar: "كسر المصب",                 en: "Sprue broken",      planned: false },
  { key: "Other",            ar: "أخرى",                      en: "Other",             planned: false },
];

/**
 * Keys that are no longer offered as buttons but MUST still resolve.
 *
 * The sheet's own «سبب التوقف» vocabulary (DOWNTIME_REASONS above) still holds
 * these, so anything typed there — now or in the future — would otherwise be
 * ungroupable and would fall back to showing a bare English key on an Arabic
 * page. Retired for capture, kept for display and grouping.
 */
const RETIRED_DOWNTIME_REASONS: DowntimeReason[] = [
  { key: "Breakdown",    ar: "عطل",              en: "Breakdown",    planned: false },
  { key: "Material",     ar: "خامة",             en: "Material",     planned: false },
  // "No order" left this list on 2026-08-22 — revived as a capture button.
  { key: "Quality hold", ar: "إيقاف للجودة",      en: "Quality hold", planned: false },
  { key: "None",         ar: "لا يوجد",           en: "None",         planned: true },
];

/** Every key that can appear in data — offered or retired. Lookup only. */
export const ALL_DOWNTIME_REASONS: DowntimeReason[] = [
  ...DOWNTIME_CAPTURE_REASONS,
  ...RETIRED_DOWNTIME_REASONS,
];

const reasonFor = (key: string) => ALL_DOWNTIME_REASONS.find((r) => r.key === key);

/** Canonical downtime key → the crew's Arabic wording (falls back to the key). */
export const downtimeReasonAr = (key: string): string => reasonFor(key)?.ar ?? key;

/* ------------------ the sheet's Arabic ⇄ the app's keys -------------------- */
/**
 * «التوقفات» stores the crew's ARABIC wording; everything downstream — the
 * Pareto, `isPlannedDowntime`, the monthly report — is keyed on the English
 * key. `downtimeReasonAr` has always mapped key → Arabic; this is the direction
 * that did not exist, and the one the sheet needs on every read.
 *
 * It must be TOTAL over the vocabulary that can actually appear, which is
 * larger than the eight dropdown values: the five RETIRED keys are in live
 * data (5 rows of «عطل» and 3 of «خامة» were captured before the list was
 * settled), so they are in the map too. A word that maps to nothing would land
 * in «أخرى» and quietly move minutes from one bar of the Pareto to another.
 */

/**
 * Fold an Arabic cell to a comparison key: strip harakat, tatweel and the
 * invisible bidi marks that RTL sheets collect, unify the alef/ya/ta-marbuta
 * spellings a hand-typed row may differ by, drop terminal punctuation, and
 * collapse whitespace (some dropdown values carry a trailing tab — «زراير\t»
 * is the known case in this workbook).
 *
 * Latin text passes through lowercased, so the same map also resolves a cell
 * holding an English key (a pasted export, or a row the assistant wrote).
 */
export function normalizeArabic(s: string | undefined): string {
  return (s ?? "")
    .replace(/[ً-ْٰـ]/g, "")     // harakat, superscript alef, tatweel
    .replace(/[​-‏؜﻿]/g, "")     // zero-width + bidi marks
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ → ا
    .replace(/ى/g, "ي")                  // ى → ي
    .replace(/ة/g, "ه")                  // ة → ه
    .replace(/[؟?!.،,;:]/g, "")          // ؟ ? ! . ، , ; :
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const REASON_BY_TEXT: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const r of ALL_DOWNTIME_REASONS) {
    m.set(normalizeArabic(r.ar), r.key);
    m.set(normalizeArabic(r.key), r.key); // an English key in the cell resolves too
    m.set(normalizeArabic(r.en), r.key);  // …as does the English label
  }
  return m;
})();

/**
 * A «سبب التوقف» cell → the canonical key.
 *
 * An unrecognised word is returned AS ITSELF, never coerced to "Other" — the
 * same rule as `jobStatusFromSheet`. A reason nobody has defined should appear
 * in the Pareto under its own name so it can be seen and either added to the
 * list or corrected in the sheet; folding it into «أخرى» hides it. Unknown keys
 * already count as unplanned (`isPlannedDowntime`), so this cannot flatter the
 * avoidable-downtime figure either.
 *
 * A blank cell returns "" — the caller decides what an unrecorded reason means.
 * It must never become a 0 or an invented value.
 */
export const downtimeReasonFromSheet = (v: string | undefined): string => {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  return REASON_BY_TEXT.get(normalizeArabic(raw)) ?? raw;
};

/** «تقديري؟» — the sheet's two validated values. */
export const DOWNTIME_YES = "نعم";
export const DOWNTIME_NO = "لا";

/**
 * «تقديري؟» → boolean. Anything that is not an explicit yes is FALSE only for
 * the flag's own purposes; note that the caller must not read a blank as
 * "measured" without saying so — a blank here means nobody stated it.
 */
export const downtimeEstimatedFromSheet = (v: string | undefined): boolean => {
  const n = normalizeArabic(v);
  return n === normalizeArabic(DOWNTIME_YES) || n === "yes" || n === "true";
};

/**
 * Was this downtime planned? Unknown keys count as UNPLANNED — an unrecognised
 * stoppage is not evidence that it was scheduled, and calling it planned would
 * quietly flatter the avoidable-downtime number.
 */
export const isPlannedDowntime = (key: string): boolean => reasonFor(key)?.planned ?? false;

/** Organisational (a rota problem, not a machine problem). */
export const isOrganisationalDowntime = (key: string): boolean =>
  reasonFor(key)?.organisational ?? false;
// Shift definitions. Canonical English value stored in the sheet; UI label is
// localised via lib/i18n.prod.ts `runs.shifts` (index-aligned with this array).
export const SHIFTS = ["Day", "Night"];

export type Tone = "green" | "amber" | "red" | "gray" | "blue";

export const toneClasses: Record<Tone, string> = {
  green: "bg-green-50 text-green-700 border-green-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  gray: "bg-gray-100 text-gray-600 border-gray-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
};

export function machineTone(s: string): Tone {
  if (s === "Operational") return "green";
  if (s === "Under Maintenance") return "amber";
  if (s === "Out of Service") return "red";
  return "gray";
}

export function moldTone(s: string): Tone {
  if (s === "Active") return "green";
  if (s === "In Repair") return "amber";
  return "gray";
}

// "Delivered" is retained here (and in the DONE sets) only so legacy rows still
// render correctly — it is not a value the app writes any more.
export function jobTone(s: string): Tone {
  if (s === "Completed" || s === "Delivered") return "green";
  if (s === "In Production") return "blue";
  if (s === "On Hold") return "amber";
  return "gray";
}

export function priorityTone(s: string): Tone {
  if (s === "High") return "red";
  if (s === "Normal") return "blue";
  return "gray";
}

/** Translate a canonical English value using index-aligned arrays. */
export function localize(value: string, canon: string[], localized: string[]): string {
  const i = canon.indexOf(value);
  return i >= 0 && localized[i] ? localized[i] : value;
}

/** Build {value,label} option pairs for a <select>. */
export function options(canon: string[], localized: string[]) {
  return canon.map((value, i) => ({ value, label: localized[i] ?? value }));
}
