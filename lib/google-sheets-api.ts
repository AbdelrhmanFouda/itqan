/**
 * The Google Sheets API as a transport — the bridge without Apps Script.
 *
 * Every read and write of the workbook went through an Apps Script web app
 * (apps-script.gs). Measured across 9–10 Sep 2026, that bridge costs 2.5–4 s
 * per round trip on a good day and 20–40 s in a "slow spell", with cold
 * starts, HTML error pages under load and at-least-once writes. None of it is
 * the site's to fix. This module talks to the same spreadsheet through the
 * Sheets REST API instead: ~0.2–0.5 s a call, several tabs per call, clean
 * answers, no deploy step.
 *
 * Authorised as the OWNER through an OAuth refresh token he grants once
 * (/api/google/connect → consent → /api/google/callback shows the token → he
 * pastes it into Vercel as GOOGLE_OAUTH_REFRESH_TOKEN). The workspace blocks
 * service-account keys, which is why the bridge existed; a user token is a
 * different mechanism. Scope: spreadsheets only — voice notes stay on the
 * bridge (Drive), so the consent stays narrow.
 *
 * Semantics kept identical to the bridge where the site depends on them:
 *  - reads return DISPLAY values (valueRenderOption=FORMATTED_VALUE), the same
 *    strings getDisplayValues() gave, so lib/dates.ts and every parser are
 *    unchanged — rows arrive ragged (trailing blanks trimmed), which the
 *    header mapping already tolerates;
 *  - append is RAW (a date string stays text, like appendRow);
 *  - updates are USER_ENTERED (a date string is parsed, "=…" is a formula,
 *    like setValue) — but the API does NOT enforce data validation, so the
 *    site's own checks (status vocabulary, registry labels, reasons) are the
 *    only guard, as they already were for appends;
 *  - `expect` (the row must still hold a value) is a read of those cells right
 *    before the write — a ~200 ms window instead of Apps Script's single
 *    execution, accepted.
 *
 * Failure policy: a network/HTTP failure is reported to the caller; an
 * auth failure (revoked token, `invalid_grant`) marks the transport BROKEN
 * for this instance so lib/sheets.ts falls back to the bridge and /api/health
 * says so. Nothing here retries a write.
 */

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALL_TIMEOUT_MS = 20_000;

export function sheetsApiConfigured(): boolean {
  return Boolean(SHEET_ID && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

let broken: { reason: string; at: number } | null = null;
const BROKEN_RETRY_MS = 5 * 60 * 1000;
/** Usable right now: configured and not marked broken in the last 5 minutes. */
export function sheetsApiUsable(): boolean {
  if (!sheetsApiConfigured()) return false;
  if (broken && Date.now() - broken.at < BROKEN_RETRY_MS) return false;
  return true;
}
export function sheetsApiState(): { configured: boolean; broken: string | null } {
  return { configured: sheetsApiConfigured(), broken: broken ? broken.reason : null };
}

export class SheetsApiError extends Error {
  constructor(public status: number, message: string, public auth = false) {
    super(message);
  }
}

/* ------------------------------ access token ------------------------------ */

let access: { token: string; exp: number } | null = null;

async function accessToken(force = false): Promise<string> {
  if (!force && access && Date.now() < access.exp - 60_000) return access.token;
  const body = new URLSearchParams({
    client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: REFRESH_TOKEN!, grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS), cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const reason = json.error || `http_${res.status}`;
    // invalid_grant = the owner revoked the app or changed something that
    // invalidated the token. Nothing here can recover; say so loudly.
    broken = { reason, at: Date.now() };
    console.error(`[sheets-api] token refresh failed: ${reason} ${json.error_description ?? ""} — falling back to the bridge`);
    throw new SheetsApiError(res.status, reason, true);
  }
  access = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  broken = null;
  return access.token;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}/${SHEET_ID}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 401 && retry) {
    await accessToken(true);
    return call<T>(path, init, false);
  }
  const text = await res.text();
  let json: T & { error?: { message?: string; status?: string } };
  try { json = JSON.parse(text); } catch { throw new SheetsApiError(res.status, `unparseable answer (HTTP ${res.status})`); }
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      broken = { reason: json.error?.status || `http_${res.status}`, at: Date.now() };
      console.error(`[sheets-api] ${msg} — falling back to the bridge`);
      throw new SheetsApiError(res.status, msg, true);
    }
    throw new SheetsApiError(res.status, msg);
  }
  return json;
}

/* ---------------------------------- helpers -------------------------------- */

/** A whole-tab range, quoted for A1 notation («'أوامر العمل'»). */
const tabRange = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
export function colLetter(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const cellA1 = (tab: string, row: number, col: number) => `${tabRange(tab)}!${colLetter(col)}${row}`;
const isRangeError = (e: unknown) => e instanceof SheetsApiError && e.status === 400 && /Unable to parse range|not found/i.test(e.message);

/* ----------------------------------- reads --------------------------------- */

export type ApiTabAnswer = { values: string[][] } | { error: "no_tab" };

/** Several whole tabs in one call (display values). A tab the workbook does
 *  not have comes back as {error:"no_tab"} — the batch call fails as a whole
 *  on an unknown range, so those are read one by one. */
export async function apiReadTabs(tabs: string[]): Promise<Record<string, ApiTabAnswer>> {
  const out: Record<string, ApiTabAnswer> = {};
  if (tabs.length === 0) return out;
  const q = tabs.map((t) => `ranges=${encodeURIComponent(tabRange(t))}`).join("&");
  try {
    const json = await call<{ valueRanges?: { range?: string; values?: string[][] }[] }>(
      `/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
    );
    (json.valueRanges ?? []).forEach((vr, i) => { out[tabs[i]] = { values: vr.values ?? [] }; });
    return out;
  } catch (e) {
    if (!isRangeError(e) || tabs.length === 1) {
      if (isRangeError(e)) { out[tabs[0]] = { error: "no_tab" }; return out; }
      throw e;
    }
  }
  for (const t of tabs) {
    try {
      const json = await call<{ values?: string[][] }>(`/values/${encodeURIComponent(tabRange(t))}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
      out[t] = { values: json.values ?? [] };
    } catch (e) {
      if (isRangeError(e)) out[t] = { error: "no_tab" };
      else throw e;
    }
  }
  return out;
}

/* ---------------------------------- writes --------------------------------- */

export type ApiCell = { row: number; col: number; value: string };

/** Append one row after the tab's data (RAW: text stays text). Returns the row number. */
export async function apiAppend(tab: string, row: string[]): Promise<{ row: number }> {
  const json = await call<{ updates?: { updatedRange?: string } }>(
    `/values/${encodeURIComponent(tabRange(tab))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [row] }) },
  );
  const m = (json.updates?.updatedRange ?? "").match(/!([A-Z]+)(\d+)(?::[A-Z]+(\d+))?$/);
  return { row: m ? Number(m[3] ?? m[2]) : 0 };
}

const fold = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Update cells (USER_ENTERED). With `expect`, those cells are read first and
 * must still hold the given display values — else nothing is written and
 * {error:"row_changed"} is returned, the same answer bridge v7 gives.
 */
export async function apiUpdate(
  tab: string, cells: ApiCell[], expect?: ApiCell[],
): Promise<{ ok: true } | { ok: false; error: "row_changed"; at: string; current: string }> {
  if (expect && expect.length) {
    const q = expect.map((c) => `ranges=${encodeURIComponent(cellA1(tab, c.row, c.col))}`).join("&");
    const json = await call<{ valueRanges?: { values?: string[][] }[] }>(`/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`);
    for (let i = 0; i < expect.length; i++) {
      const cur = fold(json.valueRanges?.[i]?.values?.[0]?.[0]);
      if (cur !== fold(expect[i].value)) {
        return { ok: false, error: "row_changed", at: `R${expect[i].row}C${expect[i].col}`, current: cur };
      }
    }
  }
  await call(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: cells.map((c) => ({ range: cellA1(tab, c.row, c.col), majorDimension: "ROWS", values: [[c.value]] })),
    }),
  });
  return { ok: true };
}

/* sheetId lookup for structural changes */
let props: { at: number; sheets: { id: number; title: string }[] } | null = null;
async function sheetProps(force = false): Promise<{ id: number; title: string }[]> {
  if (!force && props && Date.now() - props.at < 10 * 60 * 1000) return props.sheets;
  const json = await call<{ sheets?: { properties?: { sheetId?: number; title?: string } }[] }>(`?fields=sheets.properties(sheetId,title)`);
  const sheets = (json.sheets ?? []).map((s) => ({ id: s.properties?.sheetId ?? -1, title: s.properties?.title ?? "" }));
  props = { at: Date.now(), sheets };
  return sheets;
}

export async function apiDeleteRow(tab: string, row: number): Promise<{ ok: true } | { ok: false; error: "no_tab" }> {
  const sheet = (await sheetProps()).find((s) => s.title === tab) ?? (await sheetProps(true)).find((s) => s.title === tab);
  if (!sheet) return { ok: false, error: "no_tab" };
  await call(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheet.id, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }] }),
  });
  return { ok: true };
}

export async function apiCreateTab(tab: string, headers: string[] | null): Promise<{ existed: boolean }> {
  if ((await sheetProps(true)).some((s) => s.title === tab)) return { existed: true };
  await call(`:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }) });
  props = null;
  if (headers && headers.length) {
    await call(`/values/${encodeURIComponent(tabRange(tab) + "!A1")}?valueInputOption=RAW`, {
      method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [headers] }),
    });
  }
  return { existed: false };
}

/** The spreadsheet's title — what the connect page shows to prove the token
 *  reaches THIS workbook. Takes an explicit access token (the flow's own). */
export async function spreadsheetTitleWith(accessTokenValue: string): Promise<string> {
  const res = await fetch(`${API}/${SHEET_ID}?fields=properties.title`, {
    headers: { Authorization: `Bearer ${accessTokenValue}` }, signal: AbortSignal.timeout(CALL_TIMEOUT_MS), cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { properties?: { title?: string }; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.properties?.title ?? "";
}
