import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsConfigured, ENTITIES } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES[entity]) return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  // The clients tab carries contact/payment details — signed-in sales (+ owner/
  // manager) only. Operational tabs (molds/products/…) stay open reads.
  if (entity === "clients") {
    const g = await requireRole(req, ["sales"]);
    if ("deny" in g) return g.deny;
  }
  // «التوقفات» carries «سُجل بواسطة» — a staff email on every row — so it is
  // read-guarded for exactly the reason /api/downtime's GET is, and must not
  // become an open read just because it was added to ENTITIES.
  if (entity === "downtime") {
    const g = await requireRole(req);
    if ("deny" in g) return g.deny;
  }
  try {
    const data = await getRecords(entity);
    return NextResponse.json({ ...data, configured: sheetsConfigured() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ records: [], fields: [], longFields: [], labels: {}, writable: false, configured: false });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const body = await req.json();
    const result = await updateRecord(entity, Number(body.row), (body.changes ?? {}) as Record<string, string>);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
