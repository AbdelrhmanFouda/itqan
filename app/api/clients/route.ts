import { NextRequest, NextResponse } from "next/server";
import { getClients, addClient } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";

export async function GET() {
  try {
    const clients = await getClients();
    return NextResponse.json(clients);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const { name, industry, logo } = await req.json();
    const client = await addClient(name, industry ?? "", logo ?? "");
    return NextResponse.json(client);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
