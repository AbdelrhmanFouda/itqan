/**
 * The device snapshot and the bounded read (components/dashboard/last-seen.ts).
 * The invariant every dashboard page restated in prose and none enforced —
 * «a failed or empty answer must never replace what is on screen» — starts
 * here: a snapshot from an older shape is refused, a blocked localStorage is
 * swallowed, and a non-2xx answer is distinguishable from a timeout so the
 * page can say WHICH happened. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readLastSeen, writeLastSeen, timedJson, bounded } from "../components/dashboard/last-seen.ts";

/** A throwaway localStorage — node has none, and the module must survive both. */
function fakeStorage(opts: { throws?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => { if (opts.throws) throw new Error("blocked"); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.throws) throw new Error("quota"); map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    raw: map,
  };
}
function withStorage<T>(s: unknown, fn: () => T): T {
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = "localStorage" in g;
  const prev = g.localStorage;
  g.localStorage = s;
  try { return fn(); } finally { if (had) g.localStorage = prev; else delete g.localStorage; }
}

test("a value written is read back", () => {
  const s = fakeStorage();
  withStorage(s, () => {
    writeLastSeen("k", { rows: [1, 2] });
    assert.deepEqual(readLastSeen<{ rows: number[] }>("k"), { rows: [1, 2] });
  });
});

test("no snapshot at all reads null, not undefined", () => {
  withStorage(fakeStorage(), () => assert.equal(readLastSeen("nothing"), null));
});

test("a snapshot from another version of the shape is refused", () => {
  const s = fakeStorage();
  withStorage(s, () => {
    s.raw.set("k", JSON.stringify({ v: 99, data: { rows: [1] } }));
    assert.equal(readLastSeen("k"), null);
    s.raw.set("k", JSON.stringify({ v: 1 })); // no data key
    assert.equal(readLastSeen("k"), null);
    s.raw.set("k", "not json at all");
    assert.equal(readLastSeen("k"), null);
  });
});

test("a blocked or full localStorage is swallowed — the page still works", () => {
  withStorage(fakeStorage({ throws: true }), () => {
    assert.equal(readLastSeen("k"), null);
    assert.doesNotThrow(() => writeLastSeen("k", { rows: [] }));
  });
});

test("an empty answer IS an answer — it overwrites, a failure does not", () => {
  const s = fakeStorage();
  withStorage(s, () => {
    writeLastSeen("k", [1, 2, 3]);
    // The pages only ever call writeLastSeen on r.ok, so an empty LIST is
    // remembered (the sheet really is empty) while a FAILURE never gets here.
    writeLastSeen("k", []);
    assert.deepEqual(readLastSeen<number[]>("k"), []);
  });
});

test("timedJson: a 2xx answer is ok:true with the parsed body", async () => {
  const res = await timedJson<{ a: number }>(
    async () => new Response(JSON.stringify({ a: 1 }), { status: 200 }),
    "/api/x",
  );
  assert.deepEqual(res, { ok: true, data: { a: 1 } });
});

test("timedJson: a non-2xx answer reports its status and is NOT a timeout", async () => {
  const res = await timedJson(async () => new Response("no", { status: 401 }), "/api/x");
  assert.deepEqual(res, { ok: false, status: 401, timedOut: false });
});

test("timedJson: a stall reports timedOut — the page says «slow», not «broken»", async () => {
  // What the browser does when AbortSignal.timeout fires: fetch rejects with
  // a TimeoutError. `timedJson` must report that as timedOut, not as a plain
  // failure — the two print different sentences on the page.
  const res = await timedJson(
    async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; },
    "/api/x",
    {},
    20,
  );
  assert.deepEqual(res, { ok: false, status: 0, timedOut: true });
});

test("timedJson: a thrown network error is a failure but not a timeout", async () => {
  const res = await timedJson(async () => { throw new Error("offline"); }, "/api/x");
  assert.deepEqual(res, { ok: false, status: 0, timedOut: false });
});

test("bounded: a promise that resolves in time carries its value", async () => {
  assert.deepEqual(await bounded(Promise.resolve([{ uid: "u1" }]), 1000), { ok: true, data: [{ uid: "u1" }] });
});

test("bounded: a rejection is a failure, a stall is a timeout", async () => {
  assert.deepEqual(await bounded(Promise.reject(new Error("denied")), 1000), { ok: false, status: 0, timedOut: false });
  assert.deepEqual(await bounded(new Promise(() => {}), 20), { ok: false, status: 0, timedOut: true });
});
