import { NextResponse } from "next/server";
import { getPublicShowcase } from "@/lib/sheets";

export async function GET() {
  try {
    return NextResponse.json(await getPublicShowcase());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ stats: { molds: 0, products: 0, clients: 0 }, clients: [], products: [] });
  }
}
