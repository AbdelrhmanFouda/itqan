/**
 * A copy of a read that EVERY function instance in the region can see.
 *
 * Measured on production, 2026-09-09 ("the website is now very slow"): once
 * an instance holds a copy of a tab, any route answers in 100–300 ms; an
 * instance WITHOUT one pays the Apps Script bridge — 2.2 s to 11.5 s per tab,
 * serialised, and the routes the crew uses read three to five tabs. Vercel
 * hands requests to whichever instance is free, and every deploy starts new
 * ones, so "cold" was the common case on a phone, not the exception. The
 * per-instance last-good copy in lib/sheets.ts (2026-09-05) could not help
 * with that by construction.
 *
 * This is the same copy kept in the Vercel Runtime Cache — a per-region
 * key-value store shared by all instances of the project, surviving deploys
 * (@vercel/functions `getCache()`; the region is pinned to fra1 in
 * vercel.json). Outside Vercel the package falls back to an in-memory cache
 * in the same process, so local dev exercises the same code path.
 *
 * ⚠ EVERY CALL IS BOUNDED, AND A CACHE THAT DOES NOT ANSWER IS SWITCHED OFF
 * FOR FIVE MINUTES. The first deploy of this layer (7ae0856, the evening of
 * 2026-09-09) took every sheet-backed route on production down for a night:
 * the cache's `get` never resolved in the Vercel function, the read path
 * awaited it before falling back to the bridge, and every route that reads a
 * tab hung until the platform killed it (504 after 300 s) while the token-
 * only routes answered in 200 ms. Measured the next morning, not inferred.
 * So: a read waits at most GET_TIMEOUT_MS, a write or an expiry at most
 * SET_TIMEOUT_MS, a timeout opens the breaker (every call answers "no copy"
 * at once until it closes), and SHEET_SHARED_COPY=off in the environment
 * turns the layer off entirely without a deploy. The bridge path underneath
 * is exactly what it was before this file existed.
 *
 * Rules the callers keep:
 *  - the copy carries the time it was READ (`at`); the reader judges it with
 *    lib/stale-copy.ts exactly like a local copy — fresh / stale-refresh /
 *    too old — nothing here decides that;
 *  - a write drops the copy by TAG and is AWAITED before the write answers
 *    (propagation is ~300 ms), and the writer's own instance fences copies
 *    older than its write, so a page reloading right after a save cannot be
 *    shown the pre-write sheet;
 *  - every call is best-effort: unreachable, slow, broken or switched off all
 *    degrade to "no copy", never to an error and never to a wait.
 */
import { getCache } from "@vercel/functions";
import type { StaleCopy } from "@/lib/stale-copy";

const NAMESPACE = "itqan";
const ENABLED = process.env.SHEET_SHARED_COPY !== "off";
const GET_TIMEOUT_MS = 700;
const SET_TIMEOUT_MS = 1500;
const BREAK_MS = 5 * 60 * 1000;

/** While set, every call answers "no copy" immediately. */
let brokenUntil = 0;
let warned = false;

function cache() {
  return getCache({ namespace: NAMESPACE });
}

const TIMED_OUT = Symbol("timed out");

/** Resolve with the call's result, or TIMED_OUT after `ms` — never reject,
 *  never wait longer. The underlying promise is left to settle on its own. */
function bounded<T>(work: () => Promise<T>, ms: number): Promise<T | typeof TIMED_OUT | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    let p: Promise<T>;
    try {
      p = work();
    } catch {
      clearTimeout(timer);
      resolve(undefined);
      return;
    }
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
}

function available(): boolean {
  return ENABLED && Date.now() >= brokenUntil;
}

function trip(what: string): void {
  brokenUntil = Date.now() + BREAK_MS;
  if (!warned) {
    warned = true;
    console.error(`[shared-copy] the runtime cache did not answer a ${what} in time — skipping it for ${BREAK_MS / 60000} min on this instance`);
  }
}

/** The shared copy under `key`, or null when there is none, it is malformed,
 *  it is older than `maxAgeMs`, or the cache did not answer in time. */
export async function readSharedCopy<T>(key: string, maxAgeMs: number): Promise<StaleCopy<T> | null> {
  if (!available()) return null;
  const raw = await bounded(() => cache().get(key), GET_TIMEOUT_MS);
  if (raw === TIMED_OUT) { trip("read"); return null; }
  const copy = raw as Partial<StaleCopy<T>> | null | undefined;
  if (!copy || typeof copy !== "object" || typeof copy.at !== "number" || copy.value === undefined) return null;
  const age = Date.now() - copy.at;
  if (age < 0 || age > maxAgeMs) return null;
  return { value: copy.value as T, at: copy.at };
}

/** Store a copy for the region. `ttlSec` bounds its life independently of
 *  the readers' own judgement; `tags` are what a write expires. */
export async function writeSharedCopy<T>(key: string, copy: StaleCopy<T>, ttlSec: number, tags: string[]): Promise<void> {
  if (!available()) return;
  const r = await bounded(() => cache().set(key, copy, { ttl: ttlSec, tags, name: key }), SET_TIMEOUT_MS);
  if (r === TIMED_OUT) trip("write");
}

/** Expire every copy carrying any of these tags (region-wide). */
export async function dropSharedCopies(tags: string[]): Promise<void> {
  if (tags.length === 0 || !available()) return;
  const r = await bounded(() => cache().expireTag(tags), SET_TIMEOUT_MS);
  if (r === TIMED_OUT) trip("expiry");
}
