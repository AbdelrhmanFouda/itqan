import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsConfigured, ENTITIES } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
// The ONLY entities served without a token; everything else is DENY-BY-DEFAULT
// (any approved role). The set lives in lib/open-reads.ts — pure, zero imports,
// pinned by tests/open-reads.test.ts — with the full story of why deny-by-
// default exists (2026-08-28: `sheet/jobs` served the order book past the
// /api/jobs guard). Changing the set is a publish/unpublish decision.
import { OPEN_READS, PRODUCTION_ONLY, SALES_ONLY, WRITABLE_ENTITIES, readonlyFields } from "@/lib/open-reads";

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES[entity]) return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  if (SALES_ONLY.has(entity)) {
    // «العملاء» carries contact details; «طلبات العملاء» carries a customer's
    // name, their free-text note, the reject reason and who decided — and the
    // dedicated route over that tab (/api/requests) is sales-only for exactly
    // that reason. Without this branch the generic door would serve the whole
    // review queue to any approved role, including the roles the views matrix
    // keeps off /dashboard/requests (2026-09-23 review).
    const g = await requireRole(req, ["sales"]);
    if ("deny" in g) return g.deny;
  } else if (PRODUCTION_ONLY.has(entity)) {
    // The mould plan's own tabs — no wider here than on /api/changeover.
    const g = await requireRole(req, ["production"]);
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
    // Projected explicitly so this branch and the catch below answer the same
    // shape — `{...data}` was leaking readAt on the happy path only.
    return NextResponse.json(
      {
        records: data.records, fields: data.fields, longFields: data.longFields,
        labels: data.labels, writable: data.writable, configured: sheetsConfigured(),
        // Fields the PATCH below will strip — the editor shows them as text
        // rather than as an input that silently does not save (2026-09-23,
        // «العملاء»!A «الرقم», now a portal access key).
        readonlyFields: [...readonlyFields(entity)],
      },
      OPEN_READS.has(entity)
        ? { headers: { "Cache-Control": "private, max-age=30" } }
        : undefined,
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ records: [], fields: [], longFields: [], labels: {}, writable: false, configured: false, readonlyFields: [] });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  // The guard runs FIRST so an anonymous PATCH answers 401 for any entity
  // (scripts/smoke.mjs PATCHes sheet/issues|molds|master without a token and
  // expects exactly that); only then is the entity checked against the
  // writable set.
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  if (!ENTITIES[entity]) return NextResponse.json({ ok: false, reason: "unknown entity" }, { status: 404 });
  if (!WRITABLE_ENTITIES.has(entity)) {
    return NextResponse.json({ ok: false, reason: "not_writable_here" }, { status: 403 });
  }
  try {
    const body = await req.json();
    // An access key is never written here. «العملاء»!A «الرقم» is the stable
    // half of a portal account's link (lib/open-reads.ts READONLY_FIELDS), so
    // the generic editor may not renumber a row and point an approved buyer
    // at a different company. Stripped, not refused: the rest of the save is
    // ordinary contact data.
    const changes = { ...((body.changes ?? {}) as Record<string, string>) };
    for (const f of readonlyFields(entity)) delete changes[f];
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ ok: false, reason: "no_writable_changes" }, { status: 400 });
    }
    const result = await updateRecord(entity, Number(body.row), changes);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
