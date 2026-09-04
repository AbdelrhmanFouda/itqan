#!/usr/bin/env node
/**
 * Speed report — how fast every page and API answers, from the outside.
 *
 *   node scripts/speed.mjs                              # http://localhost:3000
 *   node scripts/speed.mjs --base=https://itqan-taupe.vercel.app
 *   node scripts/speed.mjs --token=<Firebase ID token>  # times the guarded APIs too
 *   node scripts/speed.mjs --rounds=3                   # more warm samples
 *
 * For every page: the HTML round trip (server time-to-first-byte is what the
 * site controls; the browser's own render is measured separately, in the
 * browser). For every API: the FIRST call (usually cold — the 45s sheet cache
 * has expired, the bridge is 2.5–10s) and the following calls (warm).
 * Also: the JavaScript a dashboard page ships (decoded, from the HTML's own
 * <script> tags), because a phone on factory wifi pays that on first visit.
 *
 * Thresholds (flagged with ⚠, never a failure — this is a report):
 *   page HTML          warm > 1.0s
 *   open / guarded API warm > 1.5s     cold > 12s  (the bridge's known floor is ~10s)
 * Exit code is 0 unless a request errored.
 */

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const BASE = (args.base || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = args.token || "";
const ROUNDS = Math.max(1, Number(args.rounds || 2));
const TIMEOUT_MS = 60000;

const PAGES = [
  "/", "/login", "/dashboard", "/dashboard/finance", "/dashboard/quality", "/dashboard/sales",
  "/dashboard/machines", "/dashboard/molds", "/dashboard/products", "/dashboard/jobs",
  "/dashboard/production", "/dashboard/downtime", "/dashboard/storage", "/dashboard/issues",
  "/dashboard/performance", "/dashboard/assistant", "/dashboard/reports", "/dashboard/clients",
  "/dashboard/approvals",
];
const OPEN_APIS = [
  "/api/machines", "/api/runs", "/api/oee", "/api/issues", "/api/sheet/molds", "/api/sheet/products",
  "/api/public/showcase",
];
const GUARDED_APIS = [
  "/api/molds", "/api/jobs", "/api/storage", "/api/downtime?quick=1", "/api/downtime", "/api/reports",
  "/api/sheet/master",
];

let errored = false;

async function time(path, token) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: "follow", signal: ctl.signal,
    });
    const ttfb = performance.now() - t0;
    const body = await res.text();
    return { status: res.status, ttfb: Math.round(ttfb), total: Math.round(performance.now() - t0), bytes: body.length, body, edge: res.headers.get("x-vercel-cache") || "", id: res.headers.get("x-vercel-id") || "" };
  } catch (e) {
    errored = true;
    return { status: 0, ttfb: -1, total: -1, bytes: 0, body: "", edge: "", id: "", error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));
const ms = (n) => (n < 0 ? "ERR" : `${n}ms`);
const flag = (cond) => (cond ? " ⚠" : "");

console.log(`Speed report · ${BASE} · ${new Date().toISOString()}\n`);

/* --------------------------------- pages ---------------------------------- */

console.log("PAGES (server HTML — TTFB / full body; warm = best of the later rounds)");
console.log(pad("path", 26) + pad("first", 12, true) + pad("warm", 12, true) + pad("bytes", 10, true) + "  status");
const pageStats = [];
for (const p of PAGES) {
  const first = await time(p);
  const later = [];
  for (let i = 1; i < ROUNDS; i++) later.push(await time(p));
  const warm = later.length ? later.reduce((a, b) => (b.ttfb >= 0 && b.ttfb < a.ttfb ? b : a)) : first;
  pageStats.push({ p, first, warm });
  console.log(
    pad(p, 26) + pad(ms(first.ttfb), 12, true) + pad(ms(warm.ttfb), 12, true) + pad(Math.round(first.bytes / 1024) + "K", 10, true) +
    `  ${first.status}${flag(warm.ttfb > 1000)}${first.status !== 200 ? " ⚠ status" : ""}`,
  );
}

/* ----------------------------- the JS a page ships ------------------------ */

console.log("\nJAVASCRIPT a dashboard page ships (decoded; brotli on the wire is ~4× smaller)");
for (const p of ["/dashboard/molds", "/dashboard/downtime", "/"]) {
  const html = pageStats.find((s) => s.p === p)?.first.body || "";
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.startsWith("/_next/"));
  let total = 0;
  for (const s of srcs) { const r = await time(s); total += r.bytes; }
  console.log(`  ${pad(p, 22)} ${srcs.length} scripts · ${Math.round(total / 1024)} KB`);
}

/* ---------------------------------- APIs ---------------------------------- */

async function apiTable(title, paths, token) {
  console.log(`\n${title}`);
  console.log(pad("path", 26) + pad("first (cold?)", 15, true) + pad("warm", 12, true) + pad("bytes", 10, true) + "  status  cache");
  for (const p of paths) {
    const first = await time(p, token);
    const later = [];
    for (let i = 1; i < ROUNDS; i++) later.push(await time(p, token));
    const warm = later.length ? later.reduce((a, b) => (b.total >= 0 && b.total < a.total ? b : a)) : first;
    console.log(
      pad(p, 26) + pad(ms(first.total), 15, true) + pad(ms(warm.total), 12, true) + pad(Math.round(first.bytes / 1024) + "K", 10, true) +
      `  ${first.status}    ${first.edge}${flag(warm.total > 1500 || first.total > 12000)}`,
    );
  }
}

await apiTable("OPEN APIs (no token)", OPEN_APIS);
if (TOKEN) await apiTable("GUARDED APIs (with the token)", GUARDED_APIS, TOKEN);
else {
  console.log("\nGUARDED APIs — the 401 round trip only (pass --token to time the real answers)");
  for (const p of GUARDED_APIS) {
    const r = await time(p);
    console.log(pad(p, 26) + pad(ms(r.total), 15, true) + `  ${r.status}`);
  }
}

console.log(`\n${errored ? "some requests ERRORED" : "done"} · thresholds: page warm > 1.0s, API warm > 1.5s or cold > 12s are flagged ⚠`);
process.exit(errored ? 1 : 0);
