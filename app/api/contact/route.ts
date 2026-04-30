import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { name, company, phone, email, inquiry_type, message } = await req.json();
    await prisma.contactInquiry.create({
      data: { name, company, phone, email, inquiryType: inquiry_type, message },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
