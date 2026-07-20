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

// One row of an إيداع/سحب log (A..N) + which log it came from.
export type StorageMovement = {
  log: "إيداع" | "سحب";
  num: string; itemType: string; item: string; client: string; loc: string; date: string;
  qtyCount: string; qtyKg: string; grams: string; loss: string; qtyFromWt: string;
  net: string; unit: string; notes: string;
};

export type StorageLists = {
  products: string[]; materials: string[]; clients: string[];
  weights: Record<string, number>;
};

export type StorageData = {
  configured: boolean;
  ok: boolean;
  balance: StorageBalance[];
  inLog: StorageMovement[];
  outLog: StorageMovement[];
  lists: StorageLists;
};

export type StorageWriteResult = { ok: boolean; num?: string; error?: string };

// Fields the bridge's save/update actions accept.
export type MovementInput = {
  moveType?: string; log?: string; num?: string;
  itemType: string; item: string; client: string; loc: string; date: string;
  qtyCount: string | number; qtyKg: string | number; grams: string | number;
  loss: string | number; notes: string;
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
  lists: { products: [], materials: [], clients: [], weights: {} },
};

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
    unit: clean(r[12]), notes: clean(r[13]),
  })).filter((m) => m.num);
}

/* -------------------------------- reads -------------------------------- */

export async function getStorageData(): Promise<StorageData> {
  if (!URL || !SECRET) return { ...EMPTY, configured: false };
  try {
    const res = await fetch(`${URL}?token=${encodeURIComponent(SECRET)}`, {
      cache: "no-store", redirect: "follow",
    });
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as {
      ok?: boolean; balance?: string[][]; inLog?: string[][]; outLog?: string[][];
      lists?: { products?: string[]; materials?: string[]; clients?: string[]; weights?: Record<string, number> };
    };
    if (!json.ok) return EMPTY;
    return {
      configured: true, ok: true,
      balance: mapBalance(json.balance ?? []),
      inLog: mapLog(json.inLog ?? [], "إيداع"),
      outLog: mapLog(json.outLog ?? [], "سحب"),
      lists: {
        products: json.lists?.products ?? [],
        materials: json.lists?.materials ?? [],
        clients: json.lists?.clients ?? [],
        weights: json.lists?.weights ?? {},
      },
    };
  } catch {
    return EMPTY;
  }
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
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const json = (await res.json().catch(() => ({}))) as StorageWriteResult;
    return json.ok ? json : { ok: false, error: json.error || "script_error" };
  } catch {
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
