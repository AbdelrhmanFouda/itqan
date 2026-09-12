"use client";
/**
 * The 2026-09-10 speed rescue, written once (cleanup batch 7). Fifteen pages
 * had grown the same twenty lines each: read the device snapshot on mount,
 * paint it, fetch bounded, keep what is on screen when the answer fails, and
 * remember the answer that succeeded. The invariant nine of them restated in
 * prose — «a failed or empty answer must never replace what is on screen» —
 * lives here now, and tests/last-seen.test.ts pins it.
 *
 * Pages with two independent sources (finance, sales) or a two-phase load
 * (downtime, issues, storage, jobs/[id]) still drive readLastSeen /
 * writeLastSeen / timedJson themselves — the pieces below are the same ones.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { readLastSeen, writeLastSeen, type Timed } from "./last-seen";

export type LoadFailure = { timedOut: boolean } | null;

export function useRemembered<T>(opts: {
  /** localStorage key, e.g. "itqan.production.last". */
  key: string;
  /** The bounded read. `timedJson(...)` or `bounded(...)`. */
  read: () => Promise<Timed<T>>;
  /** A snapshot that does not pass this is ignored (shape changed between deploys). */
  valid?: (snap: T) => boolean;
  /** Strip any server-side age from a snapshot before it is shown. */
  hydrate?: (snap: T) => T;
  /** Called with every LIVE answer, after it is on screen and remembered. */
  onLoaded?: (data: T) => void;
  /** An answer that must not be remembered (a degraded body, say). */
  worthRemembering?: (data: T) => boolean;
  /** Merge the live answer with what is on screen. Default: replace. */
  merge?: (prev: T | null, next: T) => T;
}) {
  const { key, read, valid, hydrate, onLoaded, worthRemembering, merge } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<LoadFailure>(null);
  /** Everything on screen came off this device, not off a live answer. */
  const [fromSnapshot, setFromSnapshot] = useState(false);

  // The callbacks are read through a ref so a page may pass inline closures
  // without re-running the mount effect on every render.
  const cbs = useRef({ read, valid, hydrate, onLoaded, worthRemembering, merge });
  cbs.current = { read, valid, hydrate, onLoaded, worthRemembering, merge };

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await cbs.current.read();
    setLoading(false);
    if (!r.ok) {
      // A stall or a refusal keeps what is on screen — a page that blanks
      // itself is worse than one that says it could not refresh.
      setFailed({ timedOut: r.timedOut });
      return;
    }
    const next = r.data;
    setData((prev) => (cbs.current.merge ? cbs.current.merge(prev, next) : next));
    setFailed(null);
    setFromSnapshot(false);
    if (!cbs.current.worthRemembering || cbs.current.worthRemembering(next)) writeLastSeen(key, next);
    cbs.current.onLoaded?.(next);
  }, [key]);

  useEffect(() => {
    // What this device saw last time paints AT ONCE; the live answer replaces
    // it. Opening a page cold used to mean a spinner for the whole round trip.
    const snap = readLastSeen<T>(key);
    if (snap !== null && (!cbs.current.valid || cbs.current.valid(snap))) {
      setData(cbs.current.hydrate ? cbs.current.hydrate(snap) : snap);
      setFromSnapshot(true);
    }
    void reload();
  }, [key, reload]);

  return { data, setData, loading, failed, setFailed, fromSnapshot, reload };
}

/**
 * setInterval that does not run while the tab is hidden — a phone in a pocket
 * used to keep the storage page asking the bridge every 20 s and the downtime
 * page every 30 s. `ms = 0` disables the poll.
 */
export function useVisiblePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ms) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
