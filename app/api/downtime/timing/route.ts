import { NextResponse } from "next/server";
import { getOpenDowntimeEvents } from "@/lib/db";
import { getRecords } from "@/lib/sheets";

/**
 * TEMPORARY diagnostic — 2026-09-02, "the downtime page is still slow on my
 * phone". Times the server-side steps behind GET /api/downtime from inside the
 * function, so the cold/warm cost of each can be read from outside without a
 * token. Returns milliseconds and counts only — no rows, no names. Remove once
 * the numbers are in the brief.
 */
export const dynamic = "force-dynamic";

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; ok: boolean; n?: number }> {
  const t0 = Date.now();
  try {
    const v = await fn();
    const n = Array.isArray(v) ? v.length : Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: unknown[] }).records.length : undefined;
    return { ms: Date.now() - t0, ok: true, n };
  } catch {
    return { ms: Date.now() - t0, ok: false };
  }
}

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

export async function GET() {
  const region = process.env.VERCEL_REGION ?? "local";
  const instanceStart = Date.now();
  // 1) the Firestore client SDK query the quick path runs (cold = connection setup)
  const sdkQuery = await timed(getOpenDowntimeEvents);
  // 2) the same query again on a now-warm SDK
  const sdkQueryWarm = await timed(getOpenDowntimeEvents);
  // 3) pure network round trip to Firestore over REST (a document that does not exist)
  const rest = await timed(async () => {
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/__timing__`,
      { cache: "no-store" },
    );
    await r.text();
    return [];
  });
  // 4) Google's token certs (the guard fetches these, cached 1h)
  const certs = await timed(async () => {
    const r = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", { next: { revalidate: 3600 } });
    await r.text();
    return [];
  });
  // 5) a sheet-backed read through the 45s data cache (machines registry)
  const sheet = await timed(() => getRecords("machines"));
  return NextResponse.json({
    region,
    totalMs: Date.now() - instanceStart,
    sdkQuery, sdkQueryWarm, rest, certs, sheet,
  });
}
