import { NextRequest, NextResponse } from "next/server";
import { getMolds, addMold } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(await getMolds());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const mold = await addMold({
      code: b.code ?? "",
      partName: b.partName ?? "",
      client: b.client ?? "",
      cavities: Number(b.cavities) || 0,
      material: b.material ?? "",
      cycleTimeSec: Number(b.cycleTimeSec) || 0,
      status: b.status ?? "Active",
      location: b.location ?? "",
    });
    return NextResponse.json(mold);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
