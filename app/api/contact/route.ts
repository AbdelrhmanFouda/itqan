import { NextRequest, NextResponse } from "next/server";
import { addInquiry } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { name, company, phone, email, inquiry_type, message } = await req.json();
    await addInquiry({ name, company, phone, email, inquiry_type, message });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
