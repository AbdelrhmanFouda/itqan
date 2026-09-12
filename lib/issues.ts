/**
 * The issues log («الأعطال») — the rules, pure and import-free.
 *
 * Built 2026-09-09 when the log gained VOICE: a worker at the press records
 * what broke (and, later, what fixed it) instead of typing Arabic on a phone
 * with a gloved hand. The recording lives in the owner's Drive (saved through
 * the sheet bridge, folder «تسجيلات الأعطال»), and the row in «الأعطال» holds
 * the Drive link in one of two columns — «تسجيل العطل» (I) for the problem,
 * «تسجيل الحل» (J) for the solution. The sheet stays the truth: open the row,
 * click the link, hear the worker.
 *
 * Everything that decides a value lives here so tests/issues.test.ts can pin
 * it: which recording format the phone uses, how a Drive link is read back,
 * how a file is named, when a description may be empty, and how a row is
 * recognised again before it is written to.
 */

/* ------------------------------ vocabulary ------------------------------- */

// The Arabic tokens the sheet's dropdowns hold («الأعطال»!D and !G). Stored as
// they are; the UI translates for display only.
export const ISSUE_CATEGORIES = ["خامة", "اسطمبة", "ماكينة", "كهرباء", "أخرى"] as const;
export const ISSUE_STATUSES = ["مفتوح", "قيد التنفيذ", "تم"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Tapping the status pill moves an issue one step along; «تم» wraps back. */
export const NEXT_STATUS: Record<string, IssueStatus> = {
  "مفتوح": "قيد التنفيذ",
  "قيد التنفيذ": "تم",
  "تم": "مفتوح",
};

/* ------------------------------- recording ------------------------------- */

/** A description of a fault or a fix: two minutes is plenty, and it keeps two
 *  clips under the 4.5 MB request limit of a Vercel function. */
export const MAX_AUDIO_SECONDS = 120;
/** Per clip. Opus at 32 kbps is ~30 KB per 10 s; AAC on an iPhone up to ~1.5 MB
 *  for two minutes. Anything bigger is not a voice note. */
export const MAX_AUDIO_BYTES = 3_500_000;
/** Both clips together must stay under Vercel's 4.5 MB body limit. */
export const MAX_REQUEST_BYTES = 4_200_000;
/** The bitrate asked of MediaRecorder where the browser honours it (Chrome). */
export const AUDIO_BITS_PER_SECOND = 32_000;

/**
 * Formats to try, best first.
 *
 * WebM/Opus first: it is Chrome's native recording format (Android, Windows)
 * and the one every player handles. `audio/mp4` is NOT "the iPhone-friendly
 * one" when Chrome records it — measured 2026-09-09: Chrome answered
 * `audio/mp4;codecs=opus`, Opus in an MP4 box, which an iPhone does not play
 * any better and fewer players open at all. Safari cannot record WebM, so on
 * an iPhone the list falls through to `audio/mp4`, where Safari records AAC.
 */
export const RECORDING_MIMES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

/** The first format the recorder supports, or "" when it supports none. */
export function pickRecordingMime(isSupported: (mime: string) => boolean): string {
  for (const m of RECORDING_MIMES) {
    try { if (isSupported(m)) return m; } catch { /* an old browser throws — try the next */ }
  }
  return "";
}

/** The file extension a recording of this type should carry in Drive. */
export function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "bin";
}

/** A MIME type the site will accept from a phone: audio, and only audio. */
export function isAudioMime(mime: string): boolean {
  return /^audio\//i.test((mime || "").trim());
}

export type AudioKind = "issue" | "solution";

/**
 * The name the recording gets in Drive — readable in the folder without
 * opening anything: «عطل PQ 7 — 100 2026-09-09 14-30-05.webm».
 * Slashes and colons are dropped (Drive tolerates them, Windows downloads
 * do not); everything else in the machine label is kept as it is.
 */
export function audioFileName(kind: AudioKind, machine: string, dateIso: string, at: Date, mime: string): string {
  const word = kind === "issue" ? "عطل" : "حل";
  const m = (machine || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  return `${word}${m ? ` ${m}` : ""} ${dateIso || "بدون تاريخ"} ${hh}-${mm}-${ss}.${extFor(mime)}`;
}

/** "0:07", "1:30" — the time on the record button and the player. */
export function formatSeconds(s: number): string {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/* ----------------------------- Drive links ------------------------------- */

export type AudioRef = { id: string; url: string };

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * The Drive file id inside whatever the cell holds: the canonical
 * `/file/d/<id>/view` link the site writes, the `open?id=` and `uc?id=`
 * shapes Drive itself hands out, or a bare id. "" when the cell is not a link.
 */
export function driveIdFromLink(cell: string | undefined): string {
  const s = (cell || "").trim();
  if (!s) return "";
  let m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return DRIVE_ID.test(s) ? s : "";
}

/** The link the sheet cell holds — clickable in the workbook for the owner. */
export function driveViewLink(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

/** What a cell in an audio column means, or null when it holds nothing usable. */
export function audioRef(cell: string | undefined): AudioRef | null {
  const id = driveIdFromLink(cell);
  return id ? { id, url: driveViewLink(id) } : null;
}

/** A Drive id the audio route may ask the bridge for. */
export function isDriveId(id: string): boolean {
  return DRIVE_ID.test(id || "");
}

/* --------------------------- what a row needs ---------------------------- */

/**
 * A new issue needs a description OR a recording of one. The assistant's
 * log_issue keeps requiring text (it has no microphone); the page and the API
 * accept a voice note in its place, so «الوصف» may be blank on a row whose
 * column I holds the recording.
 */
export function hasProblem(description: string | undefined, hasIssueAudio: boolean): boolean {
  return Boolean((description || "").trim()) || hasIssueAudio;
}

/* -------------------------- recognising a row ---------------------------- */

export type IssueIdentity = {
  date?: string; machine?: string; product?: string; description?: string; issueAudio?: string;
};

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Before writing to row N, the row must still be the issue the user was
 * looking at: rows shift when anyone deletes one in the sheet between the
 * read and the tap, and a status written onto a shifted row closes somebody
 * else's fault. Compares the fields the caller sends (date and machine at
 * least); a field the caller omits is not checked.
 */
export function sameIssue(expect: IssueIdentity, fresh: IssueIdentity): boolean {
  if (expect.date === undefined || expect.machine === undefined) return false;
  const keys: (keyof IssueIdentity)[] = ["date", "machine", "product", "description", "issueAudio"];
  for (const k of keys) {
    if (expect[k] === undefined) continue;
    if (norm(expect[k]) !== norm(fresh[k])) return false;
  }
  return true;
}

/** Only the fields that actually changed — the sheet write must never touch
 *  a cell the user did not edit (CLAUDE.md, "diff-only"). */
export function diffIssue<T extends Record<string, string>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if ((after[k] ?? "") !== (before[k] ?? "")) out[k] = after[k];
  }
  return out;
}

/* ------------------------------- the list -------------------------------- */

/** Today in Cairo as YYYY-MM-DD (the sheet's date convention for this tab). */
export function cairoToday(now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** "today" / "yesterday" for the card's date line, else null (show the date). */
export function dayLabel(iso: string, todayIso: string): "today" | "yesterday" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return null;
  if (iso === todayIso) return "today";
  const t = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return t - d === 86_400_000 ? "yesterday" : null;
}

export type IssueLike = {
  machine: string; product: string; category: string; description: string;
  action: string; note: string; status: string; date: string;
  issueAudio: AudioRef | null; solutionAudio: AudioRef | null;
};

export type IssueFilter = { status?: string; machine?: string; category?: string; query?: string };

/** Arabic-tolerant, case-folded text match across the fields a person would search. */
export function matchesIssue(i: IssueLike, f: IssueFilter): boolean {
  if (f.status && i.status !== f.status) return false;
  if (f.machine && i.machine !== f.machine) return false;
  if (f.category && i.category !== f.category) return false;
  const q = foldArabic(norm(f.query));
  if (!q) return true;
  const hay = foldArabic([i.machine, i.product, i.category, i.description, i.action, i.note, i.date].join(" ").toLowerCase());
  return q.split(" ").every((term) => hay.includes(term));
}

/** «إسطمبة» finds «اسطمبه»: alef, ya/hamza and ta-marbuta variants fold together, tatweel and
 *  harakat drop, and both Arabic-Indic and Persian digits fold to Latin. Kept in step with
 *  normalizeText (lib/storage-filter), itemKey (lib/stock) and normalizeArabic (lib/prod-meta)
 *  by the corpus test in tests/latin-digits.test.ts — the four copies are deliberate (no imports). */
export function foldArabic(s: string): string {
  return (s || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىئ]/g, "ي") // ى ئ → ي
    .replace(/ؤ/g, "و") // ؤ → و
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)); // Persian ۳ folds too
}

/** How many issues sit in each status — the three tiles at the top. */
export function countByStatus(list: { status: string }[]): Record<IssueStatus, number> {
  const out: Record<IssueStatus, number> = { "مفتوح": 0, "قيد التنفيذ": 0, "تم": 0 };
  for (const i of list) {
    const s = (ISSUE_STATUSES as readonly string[]).includes(i.status) ? (i.status as IssueStatus) : "مفتوح";
    out[s]++;
  }
  return out;
}
