import { NextRequest, NextResponse } from "next/server";
import { addInquiry } from "@/lib/db";
import { isSource } from "@/lib/attribution";

/**
 * The public enquiry endpoint — unauthenticated by nature, so it carries its
 * own guards (added 2026-08-27; until then it was unthrottled and accepted
 * anything):
 *
 *  - RATE LIMIT, per IP, fixed hourly window. In-memory, so it is per
 *    serverless instance — imperfect by design, but most abuse hammers one warm
 *    instance, and a durable limiter would need a new Firestore collection,
 *    which means a firestore.rules change the owner has to deploy by hand.
 *  - HONEYPOT (2026-09-15, ads attract spam): a hidden `website` field. A POST
 *    that fills it is answered ok and stores nothing.
 *  - SIZE CAPS on every field, so nobody stores a novel.
 *  - `source` — the fixed vocabulary from lib/attribution.ts, validated here;
 *    anything else is stored as "direct" (a lead is never refused over its
 *    attribution). Raw utm_source / utm_campaign / gclid / fbclid / landing
 *    path ride along.
 *  - NOTIFICATION via Resend's plain HTTP API (no SDK), when RESEND_API_KEY +
 *    INQUIRY_NOTIFY_TO (comma-separated) are set. The enquiry is stored FIRST;
 *    a notify failure never fails the request. If the STORE fails, the email is
 *    still attempted so the lead exists somewhere, and the visitor is told it
 *    failed (the form then offers WhatsApp).
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

// Trim BEFORE slicing — sliced-then-trimmed, leading whitespace ate the length
// cap and could reduce a real value to empty before the emptiness checks ran.
const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function notify(fields: Record<string, string>, stored: boolean) {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.INQUIRY_NOTIFY_TO ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!key || !to.length) return;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const line = (k: string, v: string) => (v ? `<p><b>${k}:</b> ${esc(v)}</p>` : "");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.INQUIRY_NOTIFY_FROM || "ITQAN <onboarding@resend.dev>",
        to,
        subject: `${stored ? "" : "⚠ لم يُحفظ — "}استفسار جديد من الموقع — ${fields.name || "بدون اسم"}`,
        html:
          (stored ? "" : "<p><b>⚠ فشل الحفظ في قاعدة البيانات — هذه الرسالة هي النسخة الوحيدة.</b></p>") +
          line("الاسم", fields.name) + line("الشركة", fields.company) +
          line("الهاتف", fields.phone) + line("البريد", fields.email) +
          line("النوع", fields.inquiry_type) + line("الرسالة", fields.message) +
          line("المصدر", fields.source) + line("utm_source", fields.utm_source) +
          line("utm_campaign", fields.utm_campaign) + line("gclid", fields.gclid) +
          line("fbclid", fields.fbclid) + line("صفحة الوصول", fields.landing_path),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[contact] notify failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
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
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (s(b.website, 200)) return NextResponse.json({ ok: true });

  const rawSource = s(b.source, 50);
  if (rawSource && !isSource(rawSource)) console.warn(`[contact] unknown source "${rawSource}" stored as direct`);
  const fields = {
    name: s(b.name, 200),
    company: s(b.company, 200),
    phone: s(b.phone, 50),
    email: s(b.email, 200),
    inquiry_type: s(b.inquiry_type, 100),
    message: s(b.message, 5000),
    source: isSource(rawSource) ? rawSource : "direct",
    utm_source: s(b.utm_source, 200),
    utm_campaign: s(b.utm_campaign, 200),
    gclid: s(b.gclid, 200),
    fbclid: s(b.fbclid, 200),
    landing_path: s(b.landing_path, 300),
  };
  // The form requires name + message; enforce server-side too so a scripted
  // POST cannot store an empty husk.
  if (!fields.name || !fields.message) {
    return NextResponse.json({ ok: false, reason: "missing_fields" }, { status: 400 });
  }
  // A lead with no phone AND no email cannot be answered.
  if (!fields.phone && !fields.email) {
    return NextResponse.json({ ok: false, reason: "missing_contact" }, { status: 400 });
  }
  try {
    await addInquiry(fields);
  } catch (err) {
    console.error("[contact] store failed:", err);
    await notify(fields, false);
    return NextResponse.json({ ok: false, reason: "store_failed" }, { status: 500 });
  }
  await notify(fields, true);
  return NextResponse.json({ ok: true });
}
