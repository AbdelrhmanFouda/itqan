import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, company, phone, email, inquiry_type, message } = body;

    await sql`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id SERIAL PRIMARY KEY,
        name TEXT,
        company TEXT,
        phone TEXT,
        email TEXT,
        inquiry_type TEXT,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      INSERT INTO contact_inquiries (name, company, phone, email, inquiry_type, message)
      VALUES (${name}, ${company}, ${phone}, ${email}, ${inquiry_type}, ${message})
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
