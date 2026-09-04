/**
 * Stale-while-revalidate, the one decision of it — pure, zero imports, so
 * Node's test runner can pin it (tests/stale-copy.test.ts).
 *
 * Why this exists (measured 2026-09-05, built site AND production): once the
 * 45s sheet cache has expired, the next read of a tab BLOCKED for the whole
 * bridge round trip — 3–12s for the 14-row «الماكينات», 7.6s on Vercel, 34s
 * for the four tabs behind /api/oee. Next's fetch cache does hand the route
 * its stale entry at once (~40ms, seen in the log) but then HOLDS the
 * response until its own background revalidation has finished, so the user
 * waits for the bridge anyway. lib/sheets.ts therefore keeps the last good
 * copy of each tab per instance and decides here what to do with it:
 *
 *   fresh   — younger than `freshMs`: serve it, no network at all;
 *   stale   — younger than `maxAgeMs`: serve it NOW and refresh in the
 *             background (`after()` keeps the function alive on Vercel);
 *   none    — no copy, or too old: read and wait, as before this existed.
 *
 * Bounded on purpose: a bridge that has been down for ten minutes must show
 * as slow or empty, not as ten-minute-old numbers presented as current.
 */

export type StaleCopy<T> = { value: T; at: number };

export type CopyVerdict<T> =
  | { state: "fresh"; value: T }
  | { state: "stale"; value: T }
  | { state: "none" };

export function judgeCopy<T>(
  copy: StaleCopy<T> | undefined, now: number, freshMs: number, maxAgeMs: number,
): CopyVerdict<T> {
  if (!copy) return { state: "none" };
  const age = now - copy.at;
  if (age < 0) return { state: "none" }; // a clock that went backwards — trust nothing
  if (age <= freshMs) return { state: "fresh", value: copy.value };
  if (age <= maxAgeMs) return { state: "stale", value: copy.value };
  return { state: "none" };
}
