import { NextRequest, NextResponse } from "next/server";
import {
  getStorageData, saveMovement, updateMovement, deleteMovement,
  refreshStorageLists, storageConfigured, type MovementInput,
} from "@/lib/storage";
import { requireRole } from "@/lib/api-guard";

// The READ is guarded too (any approved role, 2026-08-28) — the balance and
// movement logs name clients and their material stocks, which is client data,
// not an operational read like runs/machines. WRITES (stock in/out) stay
// stricter: requireRole(req, ["storage"]) — storage, owner or manager, the
// same pair every other mutating route uses (lib/api-guard + authed-fetch).

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const data = await getStorageData();
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      configured: storageConfigured(), ok: false,
      balance: [], inLog: [], outLog: [],
      lists: { products: [], materials: [], clients: [], locations: [], weights: {} },
      supportsForClient: false,
      catalog: [], supportsCatalog: false,
      readAt: 0, stale: false,
    });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req, ["storage"]);
  if ("deny" in g) return g.deny;
  try {
    const body = (await req.json()) as { action?: string } & MovementInput;
    const action = body.action || "save";
    const result =
      action === "save" ? await saveMovement(body)
      : action === "update" ? await updateMovement(body)
      : action === "delete" ? await deleteMovement(body.log || "", body.num || "")
      : action === "refresh" ? await refreshStorageLists()
      : { ok: false, error: "unknown_action" };
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
