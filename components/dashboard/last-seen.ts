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
