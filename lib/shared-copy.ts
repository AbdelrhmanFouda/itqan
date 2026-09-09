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
 * Rules the callers keep:
 *  - the copy carries the time it was READ (`at`); the reader judges it with
 *    lib/stale-copy.ts exactly like a local copy — fresh / stale-refresh /
 *    too old — nothing here decides that;
 *  - a write drops the copy by TAG and is AWAITED before the write answers
 *    (propagation is ~300 ms), and the writer's own instance fences copies
 *    older than its write, so a page reloading right after a save cannot be
 *    shown the pre-write sheet;
 *  - every call is best-effort: a cache that is unreachable or slow (the
 *    client times out at 500 ms) degrades to "no copy", never to an error.
 */
import { getCache } from "@vercel/functions";
import type { StaleCopy } from "@/lib/stale-copy";

const NAMESPACE = "itqan";

function cache() {
  return getCache({ namespace: NAMESPACE });
}

/** The shared copy under `key`, or null when there is none, it is malformed,
 *  or it is older than `maxAgeMs`. */
export async function readSharedCopy<T>(key: string, maxAgeMs: number): Promise<StaleCopy<T> | null> {
  try {
    const raw = (await cache().get(key)) as Partial<StaleCopy<T>> | null | undefined;
    if (!raw || typeof raw !== "object" || typeof raw.at !== "number" || raw.value === undefined) return null;
    const age = Date.now() - raw.at;
    if (age < 0 || age > maxAgeMs) return null;
    return { value: raw.value as T, at: raw.at };
  } catch {
    return null;
  }
}

/** Store a copy for the region. `ttlSec` bounds its life independently of
 *  the readers' own judgement; `tags` are what a write expires. */
export async function writeSharedCopy<T>(key: string, copy: StaleCopy<T>, ttlSec: number, tags: string[]): Promise<void> {
  try {
    await cache().set(key, copy, { ttl: ttlSec, tags, name: key });
  } catch {
    /* over the 2 MB item limit, or the cache is unreachable — the local copy still serves */
  }
}

/** Expire every copy carrying any of these tags (region-wide). */
export async function dropSharedCopies(tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  try {
    await cache().expireTag(tags);
  } catch {
    /* the readers' writtenAt fence still protects this instance */
  }
}
