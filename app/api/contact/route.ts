import { NextRequest, NextResponse } from "next/server";
import { addInquiry } from "@/lib/db";

/**
 * The public enquiry endpoint — unauthenticated by nature, so it carries its
 * own guards (added 2026-08-27; until then it was unthrottled and accepted
 * anything):
 *
 *  - RATE LIMIT, per IP, fixed hourly window. In-memory, so it is per
 *    serverless instance — imperfect by design, but most abuse hammers one warm
 *    instance, and a durable limiter would need a new Firestore collection,
 *    which means a firestore.rules change the owner has to deploy by hand.
 *  - SIZE CAPS on every field, so nobody stores a novel.
 *  - `source` — utm_* + referrer captured by the form. Stored from day one
 *    because ad attribution cannot be reconstructed retrospectively.
 *  - NOTIFICATION, best-effort: a real lead once sat unseen for 18 days. If
 *    RESEND_API_KEY + INQUIRY_NOTIFY_TO are set, each enquiry is emailed via
 *    Resend's plain HTTP API (no SDK). A notify failure never fails the
 *    request — the enquiry is already stored.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  // Bound the map so a wide scan cannot grow memory without limit.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}

const s = (v: unknown, max: number) => String(v ?? "").slice(0, max).trim();

async function notify(fields: Record<string, string>) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_NOTIFY_TO;
  if (!key || !to) return;
  const line = (k: string, v: string) => (v ? `<p><b>${k}:</b> ${v.replace(/</g, "&lt;")}</p>` : "");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.INQUIRY_NOTIFY_FROM || "ITQAN <onboarding@resend.dev>",
        to: [to],
        subject: `استفسار جديد من الموقع — ${fields.name || "بدون اسم"}`,
        html:
          line("الاسم", fields.name) + line("الشركة", fields.company) +
          line("الهاتف", fields.phone) + line("البريد", fields.email) +
          line("النوع", fields.inquiry_type) + line("الرسالة", fields.message) +
          line("المصدر", fields.source),
      }),
    });
    if (!res.ok) console.error(`[contact] notify failed: ${res.status}`);
  } catch (err) {
    console.error("[contact] notify failed:", err);
  }
}

export async function POST(req: NextRequest) {
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const fields = {
      name: s(b.name, 200),
      company: s(b.company, 200),
      phone: s(b.phone, 50),
      email: s(b.email, 200),
      inquiry_type: s(b.inquiry_type, 100),
      message: s(b.message, 5000),
      source: s(b.source, 500),
    };
    // The form requires name + message; enforce server-side too so a scripted
    // POST cannot store an empty husk.
    if (!fields.name || !fields.message) {
      return NextResponse.json({ ok: false, reason: "missing_fields" }, { status: 400 });
    }
    await addInquiry(fields);
    await notify(fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
