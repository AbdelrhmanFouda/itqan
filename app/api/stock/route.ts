import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { loadStock } from "@/lib/stock-data";

export type { StockResponse } from "@/lib/stock-data";

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
export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  return NextResponse.json(await loadStock());
}
