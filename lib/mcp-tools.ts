/**
 * What the Claude connector can read (2026-09-28) — READ-ONLY by construction.
 *
 * Every tool wraps a loader the site already uses, so Claude sees the numbers
 * the dashboard shows: `getRecords` (the sheet tabs), the OEE digest the daily
 * review reasons over, `loadJobs` (the order book with progress), `loadStock`
 * (/dashboard/stock) and `getStorageData` («مخزن اتقان»). Nothing here writes;
 * a write tool would need the confirm-before-write preview first — raise it
 * with the owner before adding one.
 */
import { getRecords, ENTITIES, type SheetRecord } from "@/lib/sheets";
import { getOee } from "@/lib/agent-tools";
import { loadJobs } from "@/lib/jobs";
import { loadStock } from "@/lib/stock-data";
import { getStorageData } from "@/lib/storage";
import { normalizeDate } from "@/lib/dates";
import { searchTerms, matchesTerms } from "@/lib/storage-filter";
import type { ToolDef } from "@/lib/mcp-protocol";

export const MCP_INSTRUCTIONS = [
  "ITQAN (اتقان) is an Egyptian plastic injection-moulding contract manufacturer. These tools read its live",
  "factory data (a Google Sheet, through the company website) — read-only; nothing can be changed from here.",
  "Start with get_oee for performance/downtime/scrap questions, get_jobs for work orders and progress,",
  "get_stock for what is free to promise, get_storage for warehouse lines and movements, read_sheet for raw rows.",
  "Rules of the data: everything joins on the product NAME exactly as in Master («الرئيسي»); a machine is its",
  "registry label like «PQ 7 — 100» (tonnage alone is ambiguous). «غير متاح / N/A» means 'not recorded' —",
  "never read it as zero. Scrap = «الأجمالي سستم» − «إنتاج سليم» when «هالك» is blank. A «عطلة» row in",
  "production is a factory day off. Reads are cached for up to a few minutes; `asOf` says when.",
  "Answer in the language the user writes in; keep Arabic names exactly as the sheet spells them.",
].join(" ");

/** The tabs read_sheet serves. molds/products are formula views of master. */
const SHEETS: Record<string, string> = {
  production: "«الإنتاج» — one row per machine per shift: date, shift, machine, product, good pieces, system count, scrap, record status",
  downtime: "«التوقفات» — one row per stoppage: date, machine, reason, minutes, start/end",
  jobs: "«أوامر العمل» — work orders as typed (get_jobs adds progress)",
  issues: "«الأعطال» — faults: date, machine, product, category, description, action, status",
  master: "«الرئيسي» — product master: name, client, mould number, weight, material, cavities, cycle time",
  machines: "«الماكينات» — the machine registry",
  clients: "«العملاء» — the client list",
};

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const MCP_TOOLS: ToolDef[] = [
  {
    name: "read_sheet",
    title: "Read a factory sheet tab",
    description:
      "Rows from one tab of the factory workbook. Tabs: " +
      Object.entries(SHEETS).map(([k, v]) => `${k} = ${v}`).join("; ") + ". " +
      "`search` keeps rows containing every word (Arabic spelling-insensitive). `from`/`to` (YYYY-MM-DD, inclusive) " +
      "filter by the row's date on production, downtime and issues. Rows come in sheet order (oldest first); " +
      "`newest_first` reverses. `limit` default 100, max 300; page with `offset`. Each row carries its sheet `row` number.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: Object.keys(SHEETS) },
        search: { type: "string" },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        newest_first: { type: "boolean" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: ["entity"],
    },
    annotations: readOnly,
  },
  {
    name: "get_oee",
    title: "OEE and downtime digest",
    description:
      "The factory's OEE digest — availability × performance × quality, per-machine ranking, downtime Pareto by reason, " +
      "scrap, suspect Master standards, a 14-day trend and data-readiness notes. The same numbers /dashboard/performance " +
      "shows. `month` as YYYY-MM; omit for all history.",
    inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } } },
    annotations: readOnly,
  },
  {
    name: "get_jobs",
    title: "Work orders with progress",
    description:
      "Work orders («أوامر العمل») joined to Master and to production: ordered kg and pieces, produced, scrapped, " +
      "remaining, estimated hours, start and due dates, status, machine. Open orders only unless `include_done` is true. " +
      "`search` matches code, client, product or machine.",
    inputSchema: {
      type: "object",
      properties: { include_done: { type: "boolean" }, search: { type: "string" } },
    },
    annotations: readOnly,
  },
  {
    name: "get_stock",
    title: "Stock free to promise",
    description:
      "Per warehouse item: on hand (المتوفر), reserved by open work orders (المحجوز) and free to promise (المتاح = net), " +
      "with the lines, locations and the orders behind each reservation. A null figure means the units disagree or a " +
      "quantity is unreadable — say so, never treat it as zero. `search` narrows by item/client/location.",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string" }, limit: { type: "number", description: "default 100, max 300" } },
    },
    annotations: readOnly,
  },
  {
    name: "get_storage",
    title: "Warehouse lines and movements",
    description:
      "«مخزن اتقان»: the current balance lines (item type, item, owner client, location, unit, in, out, available). " +
      "With `movements: true`, also the matching deposits (إيداع) and withdrawals (سحب). `search` narrows by any field " +
      "(e.g. a location like A12, an item, a client).",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        movements: { type: "boolean" },
        limit: { type: "number", description: "default 150, max 400 per list" },
      },
    },
    annotations: readOnly,
  },
];

/* --------------------------------- helpers -------------------------------- */

const clampInt = (v: unknown, dflt: number, max: number, min = 1) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Drop blank cells — they cost tokens and say nothing. «غير متاح» stays. */
function compact(r: SheetRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== "" && v !== null && v !== undefined) out[k] = v;
  return out;
}

/* ---------------------------------- tools --------------------------------- */

async function readSheet(a: Record<string, unknown>) {
  const entity = str(a.entity);
  if (!SHEETS[entity] || !ENTITIES[entity]) return { error: `unknown entity "${entity}" — use one of ${Object.keys(SHEETS).join(", ")}` };
  const from = str(a.from), to = str(a.to);
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) return { error: "from/to must be YYYY-MM-DD" };
  const dated = ENTITIES[entity].fields.some((f) => f.key === "date");
  if ((from || to) && !dated) return { error: `${entity} has no date column — use search instead` };

  const res = await getRecords(entity);
  // A refused bridge read and an empty tab both arrive as [] (CLAUDE.md, "The
  // sheet read path") — none of these tabs is empty, so say which it likely is.
  if (res.records.length === 0) {
    return { error: `«${ENTITIES[entity].tab}» came back empty — the sheet bridge probably did not answer. Try again in a few seconds.` };
  }
  let rows = res.records;
  const terms = searchTerms(str(a.search));
  if (terms.length) rows = rows.filter((r) => matchesTerms(Object.entries(r).filter(([k]) => k !== "row").map(([, v]) => String(v)), terms));
  if (from || to) {
    rows = rows.filter((r) => {
      const d = normalizeDate(r.date as string);
      return !!d && (!from || d >= from) && (!to || d <= to);
    });
  }
  if (a.newest_first === true) rows = [...rows].reverse();
  const offset = clampInt(a.offset, 0, 1_000_000, 0);
  const limit = clampInt(a.limit, 100, 300);
  const page = rows.slice(offset, offset + limit);
  return {
    entity,
    tab: ENTITIES[entity].tab,
    asOf: new Date(res.readAt).toISOString(),
    total: rows.length,
    offset,
    returned: page.length,
    more: offset + page.length < rows.length,
    records: page.map(compact),
  };
}

async function oee(a: Record<string, unknown>) {
  const month = str(a.month);
  if (month && !/^\d{4}-\d{2}$/.test(month)) return { error: "month must be YYYY-MM" };
  return getOee(month || undefined);
}

async function jobs(a: Record<string, unknown>) {
  // The same four tabs /api/jobs reads — downtime adds nothing to an order.
  const res = await loadJobs({ downtime: false });
  const terms = searchTerms(str(a.search));
  const list = res.jobs
    .filter((j) => a.include_done === true || j.open)
    .filter((j) => matchesTerms([j.code, j.client, j.product, j.machine, j.status], terms))
    .map((j) => ({
      row: j.id, code: j.code, client: j.client, product: j.product, status: j.status, priority: j.priority,
      startDate: j.startDate, dueDate: j.dueDate, machine: j.machine,
      qtyOrderedKg: j.qtyUnreadable ? null : j.qtyOrderedKg, qtyRaw: j.qtyUnreadable ? j.qtyRaw : undefined,
      qtyOrderedPieces: j.qtyOrdered, produced: j.produced, scrapped: j.scrapped, remaining: j.remaining,
      estHours: j.estHours, pieceWeightG: j.pieceWeightG, cavities: j.cavities, cycleSec: j.cycleSec,
      inMaster: j.linked, masterNameAmbiguous: j.ambiguous || undefined,
      notes: j.notes || undefined, instructions: j.instructions || undefined,
    }));
  return {
    asOf: new Date(res.readAt).toISOString(),
    count: list.length,
    progressRule: "produced = «إنتاج سليم» summed from production rows of this product since the start date",
    jobs: list,
  };
}

async function stock(a: Record<string, unknown>) {
  const res = await loadStock();
  const terms = searchTerms(str(a.search));
  const rows = res.rows.filter((r) => matchesTerms([r.item, r.itemType, ...r.clients, ...r.locs], terms));
  const limit = clampInt(a.limit, 100, 300);
  return {
    ok: res.ok, configured: res.configured, ordersRead: res.jobsOk, asOf: res.meta.asOf,
    storageStale: res.meta.storageStale,
    total: rows.length, returned: Math.min(rows.length, limit),
    rows: rows.slice(0, limit),
  };
}

async function storage(a: Record<string, unknown>) {
  const data = await getStorageData();
  if (!data.configured) return { error: "the storage bridge is not configured on this deployment" };
  const terms = searchTerms(str(a.search));
  const limit = clampInt(a.limit, 150, 400);
  const bal = data.balance.filter((b) => matchesTerms([b.itemType, b.item, b.client, b.loc], terms));
  const out: Record<string, unknown> = {
    ok: data.ok, stale: data.stale, asOf: data.readAt ? new Date(data.readAt).toISOString() : null,
    balanceTotal: bal.length, balance: bal.slice(0, limit),
  };
  if (a.movements === true) {
    const hit = (m: (typeof data.inLog)[number]) =>
      matchesTerms([m.num, m.itemType, m.item, m.client, m.loc, m.notes, m.forClient], terms);
    const dep = data.inLog.filter(hit), wd = data.outLog.filter(hit);
    out.depositsTotal = dep.length;
    out.deposits = dep.slice(-limit);
    out.withdrawalsTotal = wd.length;
    out.withdrawals = wd.slice(-limit);
  }
  return out;
}

export async function runMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "read_sheet": return readSheet(args);
    case "get_oee": return oee(args);
    case "get_jobs": return jobs(args);
    case "get_stock": return stock(args);
    case "get_storage": return storage(args);
    default: return { error: `unknown tool ${name}` };
  }
}
