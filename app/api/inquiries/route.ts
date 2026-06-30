import { NextResponse } from "next/server";
import { getInquiries } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(await getInquiries());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
