import { NextRequest, NextResponse } from "next/server";
import {
  getStorageData, saveMovement, updateMovement, deleteMovement,
  refreshStorageLists, storageConfigured, type MovementInput,
} from "@/lib/storage";
import { verifyIdToken, roleFor } from "@/lib/agent-auth";
import { requireRole } from "@/lib/api-guard";
import { hasFullAccess, type Role } from "@/lib/roles";

// The READ is guarded too (any approved role, 2026-08-28) — the balance and
// movement logs name clients and their material stocks, which is client data,
// not an operational read like runs/machines. WRITES (stock in/out) stay
// stricter: they require a role that may edit the storage.
function mayWrite(role: Role | null): boolean {
  return role !== null && (role === "storage" || hasFullAccess(role));
}

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
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let role: Role | null = null;
    try {
      role = await roleFor(await verifyIdToken(token), token);
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (!mayWrite(role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

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
