/**
 * The last answer a page saw, kept on the device so the NEXT open renders it
 * at once while the live answer is fetched (2026-09-09, "the website is now
 * very slow"). A phone on factory wifi opening a page after lunch waited for
 * the sheet round trip before showing anything; now it shows what it showed
 * last time, with the refresh icon spinning, and replaces it when the answer
 * lands. Same idea as the downtime page's remembered machine list and the
 * remembered profile in AuthContext.
 *
 * Per device, per browser, nothing leaves it; a blocked or full localStorage
 * simply means no snapshot (every call is wrapped). Callers strip any
 * server-side age from a snapshot before showing it — a snapshot's age is
 * unknown, and the spinner is its honest hint.
 */

const VERSION = 1;

export function readLastSeen<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; data?: T } | null;
    return parsed && typeof parsed === "object" && parsed.v === VERSION && parsed.data !== undefined ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLastSeen(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: VERSION, at: Date.now(), data }));
  } catch {
    /* private mode, quota, or storage blocked — the page still works */
  }
}

/* ---------------------------- bounded fetch (2026-09-10) ---------------------------
 * No dashboard page had a client-side timeout: when the bridge stalled, the
 * spinner stayed until the platform killed the function (300 s). Every page
 * load goes through this now — the last answer on the device paints first
 * (readLastSeen), the live one replaces it, and a stall becomes a visible
 * line with a retry instead of an endless spinner.
 */
export const LOAD_TIMEOUT_MS = 90_000;

export type Timed<T> = { ok: true; data: T } | { ok: false; status: number; timedOut: boolean };

/** fetch → JSON with a hard timeout; never throws. `fetcher` is fetch or authedFetch. */
export async function timedJson<T>(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit = {},
  ms = LOAD_TIMEOUT_MS,
): Promise<Timed<T>> {
  try {
    const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return { ok: false, status: res.status, timedOut: false };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: 0, timedOut };
  }
}
