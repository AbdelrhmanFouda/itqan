import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsConfigured, ENTITIES } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
// The ONLY entities served without a token; everything else is DENY-BY-DEFAULT
// (any approved role). The set lives in lib/open-reads.ts — pure, zero imports,
// pinned by tests/open-reads.test.ts — with the full story of why deny-by-
// default exists (2026-08-28: `sheet/jobs` served the order book past the
// /api/jobs guard). Changing the set is a publish/unpublish decision.
import { OPEN_READS } from "@/lib/open-reads";

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES[entity]) return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  if (entity === "clients") {
    // The clients tab carries contact details — signed-in sales (+ owner/
    // manager) only, stricter than the default guard.
    const g = await requireRole(req, ["sales"]);
    if ("deny" in g) return g.deny;
  } else if (!OPEN_READS.has(entity)) {
    // Covers jobs + production + master (client names, order quantities,
    // standards) and downtime («سُجل بواسطة» — a staff email on every row,
    // read-guarded for exactly the reason /api/downtime's GET is).
    const g = await requireRole(req);
    if ("deny" in g) return g.deny;
  }
  try {
    const data = await getRecords(entity);
    // Only the OPEN reads may sit in the browser cache briefly (the server's
    // own 45s sheet cache is the real one) — never the guarded/clients
    // branches, whose responses depend on who asked.
    return NextResponse.json(
      { ...data, configured: sheetsConfigured() },
      OPEN_READS.has(entity)
        ? { headers: { "Cache-Control": "private, max-age=30" } }
        : undefined,
    );
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
