/**
 * Server side of the issues log («الأعطال»): the rows, the voice notes, and
 * the request that carries them.
 *
 * The rules are in lib/issues.ts (pure). This file is the glue to the sheet
 * bridge (lib/sheets.ts): a recording goes to the owner's Drive through
 * `bridgeSaveFile`, its link goes into the row's «تسجيل العطل» / «تسجيل الحل»
 * cell, and playback comes back through `bridgeReadFile` — never a public
 * Drive link, so a worker's voice is heard by signed-in staff only.
 *
 * Two facts about the bridge shape everything here (CLAUDE.md, "Write
 * semantics"): it is AT-LEAST-ONCE, so a save that looked like it failed may
 * have written the file (a retry makes a second file in Drive — harmless, an
 * orphan nobody links to); and `appendRecord` / `updateRecord` DROP a field
 * whose header the tab lacks, silently — hence `ensureAudioColumns()` runs
 * before the first recording is ever saved.
 */
import { Buffer } from "node:buffer";
import {
  getRecords, ensureHeaders, bridgeFeatures, bridgeSaveFile, bridgeReadFile,
  type SheetRecord,
} from "@/lib/sheets";
import {
  audioRef, audioFileName, driveViewLink, isAudioMime, isDriveId,
  MAX_AUDIO_BYTES, MAX_REQUEST_BYTES,
  type AudioKind, type AudioRef, type IssueIdentity,
} from "@/lib/issues";

/** The two recording columns, in the bilingual "ar\nen" shape of the tab. */
export const ISSUE_AUDIO_HEADERS = ["تسجيل العطل\nIssue audio", "تسجيل الحل\nSolution audio"];

export type Issue = {
  row: number; date: string; machine: string; product: string; category: string;
  description: string; action: string; status: string; note: string;
  issueAudio: AudioRef | null; solutionAudio: AudioRef | null;
};

const s = (v: string | undefined) => (v ?? "").trim();

export function shapeIssue(r: SheetRecord): Issue {
  return {
    row: r.row,
    date: s(r.date), machine: s(r.machine), product: s(r.product), category: s(r.category),
    description: s(r.description), action: s(r.action),
    status: s(r.status) || "مفتوح", note: s(r.note),
    issueAudio: audioRef(r.issueAudio), solutionAudio: audioRef(r.solutionAudio),
  };
}

/** The log, oldest first (rows append chronologically). */
export async function loadIssues(opts: { fresh?: boolean } = {}): Promise<{ issues: Issue[]; writable: boolean }> {
  const { records, writable } = await getRecords("issues", opts);
  return { issues: records.map(shapeIssue), writable };
}

/** The identity a client saw, in the shape sameIssue() compares. */
export function identityOf(i: Issue): IssueIdentity {
  return {
    date: i.date, machine: i.machine, product: i.product, description: i.description,
    issueAudio: i.issueAudio?.id ?? "",
  };
}

/* ------------------------------ the request ------------------------------ */

export type AudioUpload = { bytes: Buffer; mime: string; size: number };
export type IssueInput = {
  /** POST: the new issue's text fields. */
  fields: Record<string, string>;
  /** PATCH: the fields that changed. */
  changes: Record<string, string>;
  /** PATCH: the row as the client saw it — verified before any write. */
  expect: IssueIdentity | null;
  files: Partial<Record<AudioKind, AudioUpload>>;
};
export type InputError = { error: string; status: number };

/** The columns a person may fill or edit. The two audio columns are set by
 *  the server only, from a file it just saved. */
export const ISSUE_TEXT_FIELDS = ["date", "machine", "product", "category", "description", "action", "status", "note"] as const;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
function parseJson<T>(v: unknown): T | null {
  if (typeof v !== "string" || !v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}
/** A MIME type as the browser reported it, minus anything that is not a type. */
const cleanMime = (m: string) => m.replace(/[^\w/;=+.,\- "]/g, "").slice(0, 80).trim();

/**
 * Read a POST/PATCH whichever way the page sent it: multipart (text fields +
 * the recordings) or JSON (text only — the assistant, the smoke test).
 * Sizes are checked here, once, so no route can forget: one clip over
 * MAX_AUDIO_BYTES or two over MAX_REQUEST_BYTES is refused before anything
 * touches the bridge.
 */
export async function readIssueInput(req: Request): Promise<IssueInput | InputError> {
  const ct = req.headers.get("content-type") || "";
  const out: IssueInput = { fields: {}, changes: {}, expect: null, files: {} };

  if (ct.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return { error: "bad_form", status: 400 }; }
    for (const k of ISSUE_TEXT_FIELDS) {
      const v = fd.get(k);
      if (typeof v === "string") out.fields[k] = v;
    }
    out.changes = parseJson<Record<string, string>>(fd.get("changes")) ?? {};
    out.expect = parseJson<IssueIdentity>(fd.get("expect"));
    let total = 0;
    for (const kind of ["issue", "solution"] as const) {
      const f = fd.get(kind === "issue" ? "issueAudio" : "solutionAudio");
      if (!f || typeof f === "string") continue;
      const mime = cleanMime(f.type || str(fd.get(`${kind}Mime`)));
      if (!isAudioMime(mime)) return { error: "bad_audio", status: 400 };
      if (f.size > MAX_AUDIO_BYTES) return { error: "audio_too_large", status: 413 };
      total += f.size;
      if (total > MAX_REQUEST_BYTES) return { error: "audio_too_large", status: 413 };
      out.files[kind] = { bytes: Buffer.from(await f.arrayBuffer()), mime, size: f.size };
    }
    return out;
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return { error: "bad_json", status: 400 }; }
  if (!body || typeof body !== "object") return { error: "bad_json", status: 400 };
  for (const k of ISSUE_TEXT_FIELDS) if (k in body) out.fields[k] = str(body[k]);
  if (body.changes && typeof body.changes === "object") {
    for (const [k, v] of Object.entries(body.changes as Record<string, unknown>)) out.changes[k] = str(v);
  }
  if (body.expect && typeof body.expect === "object") out.expect = body.expect as IssueIdentity;
  return out;
}

/* ------------------------------ voice notes ------------------------------ */

// The tab predates the recording columns (A:H on 2026-09-09). Adding them is
// a one-time header write, checked on a fresh read and then trusted for a
// while on this instance — the alternative is a bridge round trip per save.
let audioColumnsOkAt = 0;
const AUDIO_COLUMNS_TRUST_MS = 10 * 60 * 1000;

async function ensureAudioColumns(): Promise<{ ok: boolean; reason?: string }> {
  if (Date.now() - audioColumnsOkAt < AUDIO_COLUMNS_TRUST_MS) return { ok: true };
  const r = await ensureHeaders("issues", ISSUE_AUDIO_HEADERS);
  if (r.ok) audioColumnsOkAt = Date.now();
  return r;
}

/** The wall clock in Cairo, for the file's name — the function runs in UTC. */
function cairoClock(now = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const d = new Date(now);
    d.setHours(get("hour") % 24, get("minute"), get("second"), 0);
    return d;
  } catch {
    return now;
  }
}

export type SavedAudio =
  | { ok: true; id: string; link: string }
  | { ok: false; reason: string; status: number };

/**
 * Save one recording: capability check → the columns exist → the file is in
 * Drive → the link the row will hold. A deployment without the `saveAudio`
 * action answers `audio_unsupported` (409) and nothing is written anywhere.
 */
export async function saveIssueAudio(
  kind: AudioKind, file: AudioUpload, machine: string, dateIso: string,
): Promise<SavedAudio> {
  const features = await bridgeFeatures();
  if (!features.audio) return { ok: false, reason: "audio_unsupported", status: 409 };
  const cols = await ensureAudioColumns();
  if (!cols.ok) return { ok: false, reason: `audio_columns:${cols.reason ?? "failed"}`, status: 502 };
  const saved = await bridgeSaveFile({
    name: audioFileName(kind, machine, dateIso, cairoClock(), file.mime),
    mime: file.mime,
    base64: file.bytes.toString("base64"),
  });
  if (!saved.ok) {
    return { ok: false, reason: saved.reason, status: saved.reason === "audio_unsupported" ? 409 : 502 };
  }
  return { ok: true, id: saved.id, link: driveViewLink(saved.id) };
}

/* ------------------------------- playback -------------------------------- */

// `Uint8Array<ArrayBuffer>` (not ArrayBufferLike): that is what a Response
// body accepts, and Buffer's own view sits on a shared pool slab.
type Clip = { mime: string; bytes: Uint8Array<ArrayBuffer>; name: string };
// Per instance. A clip is fetched from Drive through the bridge (~3s cold);
// the second listener on the same instance gets it at once, and the browser
// keeps its own copy for a day (Cache-Control on the route).
const clips = new Map<string, Clip>();
let clipBytes = 0;
const CLIP_CACHE_MAX_BYTES = 40 * 1024 * 1024;

function remember(id: string, clip: Clip) {
  clips.set(id, clip);
  clipBytes += clip.bytes.byteLength;
  for (const [k, v] of clips) {
    if (clipBytes <= CLIP_CACHE_MAX_BYTES) break;
    clips.delete(k);
    clipBytes -= v.bytes.byteLength;
  }
}

export type ReadAudio =
  | { ok: true; mime: string; bytes: Uint8Array<ArrayBuffer>; name: string }
  | { ok: false; reason: string; status: number };

/**
 * One recording's bytes. Only an id some row of «الأعطال» actually links to
 * is fetched — the bridge already refuses files outside the recordings
 * folder, and this keeps the route from being a general Drive reader even
 * for a signed-in caller.
 */
export async function readIssueAudio(id: string): Promise<ReadAudio> {
  if (!isDriveId(id)) return { ok: false, reason: "bad_id", status: 400 };
  const hit = clips.get(id);
  if (hit) return { ok: true, ...hit };
  const links = (list: Issue[]) => list.some((i) => i.issueAudio?.id === id || i.solutionAudio?.id === id);
  let { issues } = await loadIssues();
  if (!links(issues)) {
    // The cached copy can predate the row that links this clip — measured
    // 2026-09-09: the bridge wrote row 15 and then its redirect hop answered
    // 404, so the site never invalidated its copy. One fresh read before
    // saying no; a genuinely unknown id costs one bridge trip, no more.
    issues = (await loadIssues({ fresh: true })).issues;
    if (!links(issues)) return { ok: false, reason: "not_found", status: 404 };
  }
  const f = await bridgeReadFile(id);
  if (!f.ok) {
    const gone = f.reason === "audio_not_found" || f.reason === "forbidden";
    return { ok: false, reason: f.reason, status: gone ? 404 : 502 };
  }
  const buf = Buffer.from(f.base64, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(buf.byteLength));
  bytes.set(buf);
  const clip: Clip = { mime: f.mime, bytes, name: f.name };
  remember(id, clip);
  return { ok: true, ...clip };
}
