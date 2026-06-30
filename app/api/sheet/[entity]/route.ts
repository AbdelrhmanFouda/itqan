import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, sheetsConfigured, ENTITIES } from "@/lib/sheets";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES[entity]) return NextResponse.json({ error: "unknown entity" }, { status: 404 });
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
  try {
    const body = await req.json();
    const result = await updateRecord(entity, Number(body.row), (body.changes ?? {}) as Record<string, string>);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
