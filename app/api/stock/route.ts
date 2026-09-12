import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { getStorageData } from "@/lib/storage";
import { loadJobs } from "@/lib/jobs";
import { compareByNet, computeStock, dominantGrams, type StockOrder, type StockRow } from "@/lib/stock";
import { isOpenOrder } from "@/lib/work-orders";

/**
 * «المتاح في المخزن» — the warehouse as the PRODUCTION side reads it (2026-09-09
 * brief): per item, what is on hand («الرصيد الحالي»), what is reserved on OPEN
 * work orders («أوامر العمل», converted to the item's unit through Master's
 * piece weight — lib/jobs.ts), and what is left to promise. Rules and the
 * unit honesty in lib/stock.ts.
 *
 * READ-ONLY by construction: this file has no POST. The production side never
 * writes to «مخزن اتقان»; movements stay the storekeeper's (/api/storage).
 *
 * GUARDED (any approved role): the rows name clients, stocks and order
 * quantities — the same reason /api/storage and /api/jobs are guarded.
 */
export type StockResponse = {
  ok: boolean;
  configured: boolean;
  /** «أوامر العمل» could be read; false ⇒ nothing is shown as reserved. */
  jobsOk: boolean;
  rows: StockRow[];
  meta: {
    /** The storage bridge serves «كتالوج الخامات» (else no minimums). */
    catalog: boolean;
    catalogRows: number;
    asOf: string;
    /** Age of the oldest sheet copy behind the orders (ms). */
    dataAgeMs: number;
    /** Age of the storage balance shown (ms; 0 when none). */
    storageAgeMs: number;
    /** The storage bridge did not answer and its last good copy is shown. */
    storageStale: boolean;
  };
};

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const [storage, jobsRes] = await Promise.all([
      getStorageData(),
      // Only the ordered quantities matter here: «أوامر العمل» + «الرئيسي»
      // (kg → pieces). No production join, no downtime, no registry — two
      // bridge tabs instead of five (2026-09-09, speed).
      loadJobs({ production: false, downtime: false, machines: false }).catch((err) => { console.error(err); return null; }),
    ]);
    const orders: StockOrder[] = (jobsRes?.jobs ?? []).map((j) => ({
      id: j.id, code: j.code, client: j.client, product: j.product, status: j.status, dueDate: j.dueDate,
      // A blank quantity is "nothing typed", not 0 kg — the row says the
      // reservation is unknown rather than pretending the order weighs nothing.
      qtyKg: j.qtyUnreadable || !j.qtyRaw ? null : j.qtyOrderedKg,
      qtyUnreadable: j.qtyUnreadable,
      qtyPieces: j.qtyOrdered,
      pieceWeightG: j.pieceWeightG,
    }));
    const rows = computeStock({
      balance: storage.balance,
      orders,
      catalog: storage.catalog.map((c) => ({ item: c.item, unit: c.unit, min: c.min })),
      storeGrams: dominantGrams(storage.inLog),
      isOpen: isOpenOrder,
    }).sort(compareByNet);
    const body: StockResponse = {
      ok: storage.ok,
      configured: storage.configured,
      jobsOk: jobsRes !== null,
      rows,
      meta: {
        catalog: storage.supportsCatalog,
        catalogRows: storage.catalog.length,
        asOf: new Date().toISOString(),
        dataAgeMs: jobsRes ? Math.max(0, Date.now() - jobsRes.readAt) : 0,
        storageAgeMs: storage.readAt ? Math.max(0, Date.now() - storage.readAt) : 0,
        storageStale: storage.stale,
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      ok: false, configured: false, jobsOk: false, rows: [],
      meta: { catalog: false, catalogRows: 0, asOf: new Date().toISOString(), dataAgeMs: 0, storageAgeMs: 0, storageStale: false },
    });
  }
}
