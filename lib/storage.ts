/**
 * Storage («مخزن اتقان») integration — a SEPARATE spreadsheet from the main DB
 * sheet, reached through its own Apps Script web bridge (the bridge lives inside
 * storage-setup.gs and reuses the sheet form's validate/compute/numbering
 * functions, so website saves behave exactly like sheet saves — including the
 * insufficient-balance block on withdrawals).
 *
 * Env (server-side only):
 *   STORAGE_APPS_SCRIPT_URL, STORAGE_APPS_SCRIPT_SECRET
 */

import { keepAlive } from "@/lib/keep-alive";
import { judgeCopy, type StaleCopy } from "@/lib/stale-copy";
import { dropSharedCopies, readSharedCopy, writeSharedCopy } from "@/lib/shared-copy";

const URL = process.env.STORAGE_APPS_SCRIPT_URL;
const SECRET = process.env.STORAGE_APPS_SCRIPT_SECRET;

export function storageConfigured(): boolean {
  return Boolean(URL && SECRET);
}

/* -------------------------------- types -------------------------------- */

// One row of the الرصيد الحالي tab (A..K).
export type StorageBalance = {
  itemType: string; item: string; client: string; loc: string; unit: string;
  inQty: string; inLast: string; outQty: string; outLast: string; loss: string; avail: string;
};

// One row of an إيداع/سحب log (A..O) + which log it came from.
// `forClient` («صرف لصالح (العميل المستفيد)») is column O, appended by the sheet's
// v4 upgrade. `client` stays WHO OWNS the material — it is part of the balance
// key — while `forClient` records who the movement was actually for. An older
// bridge sends 14 columns and it simply arrives empty.
export type StorageMovement = {
  log: "إيداع" | "سحب";
  num: string; itemType: string; item: string; client: string; loc: string; date: string;
  qtyCount: string; qtyKg: string; grams: string; loss: string; qtyFromWt: string;
  net: string; unit: string; notes: string; forClient: string;
};

// `locations` comes from «أماكن التخزين» through the bridge (v4.1+). It can be
// empty — the page then falls back to the locations it can see in the data — but
// it is the only source that knows about a slot which is currently EMPTY, and
// those are exactly the ones you deposit into.
export type StorageLists = {
  products: string[]; materials: string[]; clients: string[]; locations: string[];
  weights: Record<string, number>;
};

// One row of «كتالوج الخامات» (A..F: الخامة · اللون · النوع (بكر / كسر) ·
// الوحدة · الحد الأدنى (كجم) · ملاحظات). Served only by a bridge whose
// webData_() includes `catalog` — the v4.1 deployment measured on 2026-09-09
// does NOT, so this arrives empty until the owner adds it (see CLAUDE.md →
// Storage module). «الحد الأدنى» was filled on 0 of 64 rows that day; the
// owner is filling it from the safety-stock sheet he was sent.
export type StorageCatalogRow = {
  item: string; colour: string; kind: string; unit: string;
  /** «الحد الأدنى (كجم)» as a number, null when blank. */
  min: number | null;
  notes: string;
};

export type StorageData = {
  configured: boolean;
  ok: boolean;
  balance: StorageBalance[];
  inLog: StorageMovement[];
  outLog: StorageMovement[];
  lists: StorageLists;
  /** «كتالوج الخامات», [] on a bridge that does not serve it. */
  catalog: StorageCatalogRow[];
  /** The deployed bridge answered a `catalog` key at all (a probe, like
   *  supportsForClient — the site never assumes the deployment's version). */
  supportsCatalog: boolean;
  /** When the bridge answered with this balance (0 = never). */
  readAt: number;
  /** The bridge did NOT answer this time and this is the last good copy —
   *  the page must say so rather than present it as current. A copy served
   *  inside its normal fresh/stale window is NOT stale in this sense. */
  stale: boolean;
  /**
   * Whether the DEPLOYED bridge knows «صرف لصالح» — measured from the width of
   * a log row (15 columns since sheet v4), not assumed. Verified 2026-08-30: the
   * live deployment is still v3 and answers 14, so the site must not offer a
   * beneficiary field that the sheet would silently drop.
   */
  supportsForClient: boolean;
};

// `nums`/`split`/`message` come back when a سحب with no location was spread over
// several places (sheet v4): one row per place, consecutive numbers. Reporting
// only `num` would name one row and hide the rest.
export type StorageWriteResult = {
  ok: boolean; num?: string; nums?: string[]; split?: boolean; message?: string; error?: string;
};

// Fields the bridge's save/update actions accept.
export type MovementInput = {
  moveType?: string; log?: string; num?: string;
  itemType: string; item: string; client: string; loc: string; date: string;
  qtyCount: string | number; qtyKg: string | number; grams: string | number;
  loss: string | number; notes: string; forClient?: string;
};

/* ------------------------------- helpers ------------------------------- */

// «غير متاح / N/A» placeholders (the sheet's convention) → "" for display.
const NA = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);
function clean(v: string | undefined): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return NA.has(s.toLowerCase()) ? "" : s;
}

const EMPTY: StorageData = {
  configured: storageConfigured(), ok: false,
  balance: [], inLog: [], outLog: [],
  lists: { products: [], materials: [], clients: [], locations: [], weights: {} },
  supportsForClient: false,
  catalog: [], supportsCatalog: false,
  readAt: 0, stale: false,
};

function mapCatalog(rows: string[][]): StorageCatalogRow[] {
  return rows.map((r) => {
    const minText = clean(r[4]).replace(/,/g, "");
    const min = /^\d+(\.\d+)?$/.test(minText) ? Number(minText) : null;
    return {
      item: clean(r[0]), colour: clean(r[1]), kind: clean(r[2]), unit: clean(r[3]) || "كجم",
      min, notes: clean(r[5]),
    };
  }).filter((c) => c.item);
}

function mapBalance(rows: string[][]): StorageBalance[] {
  return rows.map((r) => ({
    itemType: clean(r[0]), item: clean(r[1]), client: clean(r[2]), loc: clean(r[3]),
    unit: clean(r[4]), inQty: clean(r[5]), inLast: clean(r[6]), outQty: clean(r[7]),
    outLast: clean(r[8]), loss: clean(r[9]), avail: clean(r[10]),
  })).filter((b) => b.item);
}

function mapLog(rows: string[][], log: "إيداع" | "سحب"): StorageMovement[] {
  return rows.map((r) => ({
    log,
    num: clean(r[0]), itemType: clean(r[1]), item: clean(r[2]), client: clean(r[3]),
    loc: clean(r[4]), date: clean(r[5]), qtyCount: clean(r[6]), qtyKg: clean(r[7]),
    grams: clean(r[8]), loss: clean(r[9]), qtyFromWt: clean(r[10]), net: clean(r[11]),
    unit: clean(r[12]), notes: clean(r[13]), forClient: clean(r[14]),
  })).filter((m) => m.num);
}

/* -------------------------------- reads -------------------------------- */

/* ------------------------- the copies (2026-09-09) --------------------------
 * The storage bridge had NO cache at all: every /api/storage and /api/stock
 * call went to Apps Script — measured on production, 2.8–6.1 s per call while
 * every sheet-backed route answered in 100–300 ms, and 17 s once when the
 * bridge was throttled. Same two layers as lib/sheets.ts now: this instance's
 * last good answer, judged fresh (≤30 s: served, no network) / stale (≤30
 * min: served at once, refreshed in the background) / none; and the same copy
 * in the region-shared runtime cache (lib/shared-copy.ts) for instances that
 * have none. A write through this module drops both BEFORE it answers, and
 * fences older copies on this instance, so the storekeeper's reload after a
 * save reads the sheet as it is. When the bridge does not answer and a copy
 * exists, the copy is served with `stale: true` — the page says so.
 */
const STORAGE_FRESH_MS = 30_000;
const STORAGE_STALE_MAX_MS = 30 * 60 * 1000;
const STORAGE_READ_TIMEOUT_MS = 30_000;
const STORAGE_KEY = "storage:data";
const STORAGE_TAG = "storage";
let lastGoodStorage: StaleCopy<StorageData> | undefined;
let storageWrittenAt = 0;
let storageInflight: Promise<StorageData | null> | null = null;


function rememberStorage(d: StorageData): void {
  const copy = { value: d, at: d.readAt };
  lastGoodStorage = copy;
  keepAlive(writeSharedCopy(STORAGE_KEY, copy, STORAGE_STALE_MAX_MS / 1000, [STORAGE_TAG]));
}

/** Forget every copy — this instance's and the region's — and fence what
 *  was read before now. Awaited by the writers before they answer. */
async function forgetStorageCopies(): Promise<void> {
  storageWrittenAt = Date.now();
  lastGoodStorage = undefined;
  await dropSharedCopies([STORAGE_TAG]);
}

/** One bridge round trip → the shaped data, or null when it did not answer. */
async function readStorageBridge(): Promise<StorageData | null> {
  try {
    const res = await fetch(`${URL}?token=${encodeURIComponent(SECRET!)}`, {
      cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok?: boolean; balance?: string[][]; inLog?: string[][]; outLog?: string[][];
      lists?: {
        products?: string[]; materials?: string[]; clients?: string[];
        locations?: string[]; weights?: Record<string, number>;
      };
      catalog?: string[][];
    };
    if (!json.ok) return null;
    const width = Math.max(json.inLog?.[0]?.length ?? 0, json.outLog?.[0]?.length ?? 0);
    return {
      configured: true, ok: true,
      supportsForClient: width >= 15,
      supportsCatalog: Array.isArray(json.catalog),
      catalog: mapCatalog(json.catalog ?? []),
      balance: mapBalance(json.balance ?? []),
      inLog: mapLog(json.inLog ?? [], "إيداع"),
      outLog: mapLog(json.outLog ?? [], "سحب"),
      lists: {
        products: json.lists?.products ?? [],
        materials: json.lists?.materials ?? [],
        clients: json.lists?.clients ?? [],
        locations: json.lists?.locations ?? [],
        weights: json.lists?.weights ?? {},
      },
      readAt: Date.now(),
      stale: false,
    };
  } catch {
    return null;
  }
}

/** One bridge read at a time per instance — a refresh in flight is reused. */
function readStorageOnce(): Promise<StorageData | null> {
  if (storageInflight) return storageInflight;
  const p = readStorageBridge()
    .then((d) => { if (d) rememberStorage(d); return d; })
    .finally(() => { if (storageInflight === p) storageInflight = null; });
  storageInflight = p;
  return p;
}

export async function getStorageData(opts: { fresh?: boolean } = {}): Promise<StorageData> {
  if (!URL || !SECRET) return { ...EMPTY, configured: false };
  const now = Date.now();
  const usable = (c: StaleCopy<StorageData> | undefined) => (c && c.at > storageWrittenAt ? c : undefined);
  if (!opts.fresh) {
    let verdict = judgeCopy(usable(lastGoodStorage), now, STORAGE_FRESH_MS, STORAGE_STALE_MAX_MS);
    if (verdict.state === "none") {
      const shared = await readSharedCopy<StorageData>(STORAGE_KEY, STORAGE_STALE_MAX_MS);
      if (shared && shared.at > storageWrittenAt && Array.isArray(shared.value.balance)) {
        lastGoodStorage = shared;
        verdict = judgeCopy(shared, now, STORAGE_FRESH_MS, STORAGE_STALE_MAX_MS);
      }
    }
    if (verdict.state === "fresh") return { ...verdict.value, stale: false };
    if (verdict.state === "stale") {
      keepAlive(readStorageOnce());
      return { ...verdict.value, stale: false };
    }
  }
  const fresh = await readStorageOnce();
  if (fresh) return fresh;
  // The bridge did not answer: the last good copy, if there is one, said so.
  const fallback = usable(lastGoodStorage);
  if (fallback && now - fallback.at <= STORAGE_STALE_MAX_MS) return { ...fallback.value, stale: true };
  return EMPTY;
}

/* -------------------------------- writes ------------------------------- */

async function post(payload: Record<string, unknown>): Promise<StorageWriteResult> {
  if (!URL || !SECRET) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: SECRET, ...payload }),
      redirect: "follow",
      // Bounded (2026-09-10): a save that hung held the phone until the
      // platform killed the request, and the bridge may have written anyway.
      signal: AbortSignal.timeout(60_000),
    });
    // The sheet changed — or may have, the bridge is at-least-once — so every
    // copy is dropped BEFORE answering: the page reloads the moment we do.
    await forgetStorageCopies();
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const json = (await res.json().catch(() => ({}))) as StorageWriteResult;
    return json.ok ? json : { ok: false, error: json.error || "script_error" };
  } catch {
    await forgetStorageCopies();
    return { ok: false, error: "request_failed" };
  }
}

export function saveMovement(m: MovementInput): Promise<StorageWriteResult> {
  return post({ action: "save", ...m });
}
export function updateMovement(m: MovementInput): Promise<StorageWriteResult> {
  return post({ action: "update", ...m });
}
export function deleteMovement(log: string, num: string): Promise<StorageWriteResult> {
  return post({ action: "delete", log, num });
}
export function refreshStorageLists(): Promise<StorageWriteResult> {
  return post({ action: "refresh" });
}
