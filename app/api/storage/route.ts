import { NextRequest, NextResponse } from "next/server";
import {
  getStorageData, saveMovement, updateMovement, deleteMovement,
  refreshStorageLists, storageConfigured, type MovementInput,
} from "@/lib/storage";
import { verifyIdToken, roleFor } from "@/lib/agent-auth";
import { hasFullAccess, type Role } from "@/lib/roles";

// Reads are open like the other /api data routes (UI-gated); WRITES are the
// sensitive part (stock in/out), so they require a Firebase ID token from a
// user whose granted role may edit the storage.
function mayWrite(role: Role | null): boolean {
  return role !== null && (role === "storage" || hasFullAccess(role));
}

export async function GET() {
  try {
    const data = await getStorageData();
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      configured: storageConfigured(), ok: false,
      balance: [], inLog: [], outLog: [],
      lists: { products: [], materials: [], clients: [], weights: {} },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let role: Role | null = null;
    try {
      role = await roleFor(await verifyIdToken(token));
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
