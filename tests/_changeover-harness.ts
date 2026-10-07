/**
 * Loads the REAL lib/changeover-data.ts in Node's test runner, with the four
 * modules that touch the network — lib/sheets, lib/jobs, lib/db and (since
 * 2026-10-07, when the plan began to read the store) lib/storage — replaced by
 * the in-memory stand-ins exported from THIS file. Everything else it imports
 * (lib/changeover, lib/work-orders, lib/master-lookup, lib/dates, …) is the
 * real, import-free module, reached through the app's own `@/` alias, which
 * is mapped here for the test process only.
 *
 * Why it exists: the rules in lib/changeover.ts were unit-tested from day one,
 * while the server glue that decides WHICH order is on WHICH machine had no
 * test at all — and that is where both review passes of 2026-10-05 found the
 * defects, three of them introduced by the fixes for the first pass.
 *
 * Import this file FIRST and load the module under test with a dynamic
 * `await import(...)`: static imports are linked before any module runs.
 * Not a `*.test.ts` file, so `npm test` does not run it on its own.
 */
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SELF = pathToFileURL(path.join(import.meta.dirname, "_changeover-harness.ts")).href;
// lib/storage pulls in next/server and @vercel/functions (its copies), which
// Node's test runner cannot load — and it would call the storage bridge.
const STUBBED = new Set(["@/lib/sheets", "@/lib/jobs", "@/lib/db", "@/lib/storage"]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED.has(specifier)) return nextResolve(SELF, context);
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(path.join(ROOT, `${specifier.slice(2)}.ts`)).href, context);
    }
    return nextResolve(specifier, context);
  },
});

/* --------------------------------- fixtures -------------------------------- */

type Row = Record<string, unknown> & { row?: number };
export type Fixture = {
  /** One list of records per entity, as lib/sheets getRecords would shape them. */
  tabs: Record<string, Row[]>;
  /** What loadJobs() answers (already-shaped jobs). */
  jobs: Row[];
  /** The stoppages running now (Firestore). */
  stops: Row[];
  /** «مخزن اتقان» as lib/storage getStorageData() shapes it: the lines of
   *  «الرصيد الحالي» and the sheet's own list of material names. null = the
   *  storage bridge did not answer (`ok: false`, nothing in it). */
  store: { balance: Row[]; materials?: string[] } | null;
  /** The store read goes wrong: it THROWS, or it never answers at all. */
  storeFault: "" | "throws" | "hangs";
  appends: { entity: string; values: Record<string, string> }[];
  updates: { entity: string; row: number; changes: Record<string, string> }[];
  /** Entities whose read FAILS (an empty tab with no fields). */
  failRead: Set<string>;
  /** Entities that exist with only their header row. */
  headerOnly: Set<string>;
  /** Lazy tabs the reader was told do not exist. */
  lazyMissing: Set<string>;
};

const G = globalThis as unknown as { __changeover?: Fixture };
const F = (): Fixture => G.__changeover!;

export function fresh(): Fixture {
  G.__changeover = {
    tabs: { machines: [], master: [], production: [], jobs: [], downtime: [], changeoverAnswers: [], changeoverLog: [] },
    jobs: [], stops: [], store: null, storeFault: "", appends: [], updates: [],
    failRead: new Set(), headerOnly: new Set(), lazyMissing: new Set(),
  };
  return G.__changeover;
}

const realNow = Date.now;
/** Pin the clock (an ISO instant, UTC). */
export function setNow(iso: string): void { const t = new Date(iso).getTime(); Date.now = () => t; }
export function resetNow(): void { Date.now = realNow; }

/** «الماكينات» rows for labels like «PQ 2 — 180». */
export const reg = (labels: readonly string[]): Row[] => labels.map((l, i) => {
  const [code, ton] = l.split(" — ");
  return { row: i + 2, name: ton, code, label: l, product: "" };
});

/** One «الإنتاج» row. */
export const shift = (date: string, machine: string, product: string, o: Row = {}): Row =>
  ({ date, shift: "الصباحية", machine, product, material: "", client: "", goodUnits: "", ...o });

/** One «التوقفات» row — a finished stoppage; «تغيير الاسطمبة» unless told otherwise. */
export const stoppage = (date: string, machine: string, minutes: number | string, o: Row = {}): Row =>
  ({ date, machine, reason: "تغيير الاسطمبة", minutes: String(minutes), start: "", end: "", estimated: "لا", ...o });

/** One line of the store's «الرصيد الحالي» — a material in kg unless told otherwise. */
export const stockLine = (item: string, client: string, avail: number | string, o: Row = {}): Row =>
  ({ itemType: "خامة", item, client, loc: "A12", unit: "كجم", avail: String(avail), ...o });

/** One already-shaped work order (lib/jobs.ts JobShaped). */
export const job = (o: Row): Row => ({
  id: "0", code: "", client: "", product: "", moldCode: "", qtyOrdered: 1000, qtyOrderedKg: 100,
  startDate: "", dueDate: "", status: "Not Started", priority: "", machine: "", materialIssued: "",
  masterbatch: "", instructions: "", notes: "", produced: 0, scrapped: 0, remaining: 1000,
  linked: true, ambiguous: false, pieceWeightG: 10, cavities: 0, cycleSec: 0, material: "",
  estHours: 0, open: true, masterClient: "", lastMachine: "", ...o,
});

/* ------------------------- stand-in for lib/sheets.ts ----------------------- */

export async function getRecords(entity: string) {
  const f = F();
  const empty = { records: [] as Row[], fields: [] as string[], longFields: [], labels: {}, writable: true, readAt: Date.now() };
  if (f.failRead.has(entity)) return empty;
  if (f.headerOnly.has(entity)) return { ...empty, fields: ["date"] };
  const rows = f.tabs[entity] ?? [];
  if (rows.length === 0) return empty;
  const fields = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((k) => k !== "row");
  return { ...empty, fields, records: rows.map((r, i) => ({ row: i + 2, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "row" ? v : String(v ?? "")])) })) };
}

export async function appendRecord(entity: string, values: Record<string, string>) {
  const f = F();
  f.appends.push({ entity, values: { ...values } });
  (f.tabs[entity] ??= []).push({ ...values });
  return { ok: true };
}
export async function ensureHeaders() { return { ok: true }; }
export async function ensureTab() { return { ok: true }; }
export async function updateRecord(entity: string, row: number, changes: Record<string, string>) {
  F().updates.push({ entity, row, changes });
  return { ok: true };
}
export async function expectSupported() { return true; }
export const sheetsWritable = () => true;
export const lazyTabMissing = (tab: string) => F().lazyMissing.has(tab);

/* -------------------------- stand-in for lib/jobs.ts ------------------------ */

export async function loadJobs() {
  return { jobs: F().jobs, runsFor: () => [], writable: true, configured: true, duplicates: [], registryLabels: [], readAt: Date.now() };
}

/* --------------------------- stand-in for lib/db.ts ------------------------- */

export async function getOpenDowntimeEvents() { return F().stops; }

/* ------------------------- stand-in for lib/storage.ts ---------------------- */

/** What the real one answers when the bridge is silent and no copy is kept. */
const NO_STORE = {
  configured: true, ok: false, balance: [] as Record<string, string>[], inLog: [], outLog: [],
  lists: { products: [] as string[], materials: [] as string[], clients: [] as string[], locations: [] as string[], weights: {} },
  catalog: [], supportsCatalog: false, supportsForClient: false, readAt: 0, stale: false,
};

export async function getStorageData() {
  const f = F();
  if (f.storeFault === "throws") throw new Error("storage_down");
  // Never settles — what a hung bridge looks like to the caller's own bound.
  if (f.storeFault === "hangs") return new Promise<typeof NO_STORE>(() => {});
  if (!f.store) return NO_STORE;
  return {
    ...NO_STORE, ok: true, readAt: Date.now(),
    balance: f.store.balance.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v ?? "")]))),
    lists: { ...NO_STORE.lists, materials: f.store.materials ?? [] },
  };
}
