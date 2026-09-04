#!/usr/bin/env node
/**
 * HTTP smoke test — the running system from the outside, every view.
 *
 *   node scripts/smoke.mjs                              # http://localhost:3000
 *   node scripts/smoke.mjs --base=https://itqan-taupe.vercel.app
 *   node scripts/smoke.mjs --token=<Firebase ID token>  # adds the signed-in checks
 *   node scripts/smoke.mjs --only=pages|open|guarded|mutating|signed
 *
 * What it proves, with no login at all:
 *   PAGES     every page answers, in the right language for the cookie
 *             (no cookie → Arabic, the owner's rule of 2026-08-28), robots,
 *             sitemap, the OG image.
 *   OPEN      the documented open operational reads answer 200 with the shape
 *             the pages expect; the public showcase carries counts and NO names.
 *   GUARDED   every guarded read answers 401 without a token, and 401 with a
 *             bogus one — nothing leaks past a missing header.
 *   MUTATING  every write answers 401 without a token, so nothing here can
 *             touch the sheet (an empty body is sent; a guard that ran AFTER
 *             parsing would show up as a 400, which is also a failure).
 * And with --token (any approved role's ID token):
 *   SIGNED    the guarded reads answer 200 for a signed-in user; /api/molds
 *             carries a mould number per row, including the ones that live in
 *             the notes; the job detail carries Master's number.
 *
 * Getting a token: open the site signed in, DevTools → Network → any request
 * to /api/jobs → Request Headers → copy the value after "Bearer ". It is valid
 * for one hour. Never paste it anywhere else.
 *
 * Exit code 1 on any failure. Calls run one at a time on purpose — the Apps
 * Script bridge serialises reads, and a cold read can take ~10s.
 */

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const BASE = (args.base || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = args.token || "";
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const TIMEOUT_MS = Number(args.timeout || 60000);

const results = [];
let current = "";

async function req(path, { method = "GET", headers = {}, body, cookie, token } = {}) {
  const h = { ...headers };
  if (cookie) h["Cookie"] = cookie;
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "follow", signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, type: res.headers.get("content-type") || "", text, json, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  if (ONLY && !ONLY.has(current)) return;
  try {
    const detail = await fn();
    results.push({ group: current, name, ok: true, detail: detail || "" });
    console.log(`  ✓ ${name}${detail ? `  · ${detail}` : ""}`);
  } catch (e) {
    results.push({ group: current, name, ok: false, detail: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const group = (g) => { current = g; if (!ONLY || ONLY.has(g)) console.log(`\n[${g}]`); };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

/* --------------------------------- PAGES ---------------------------------- */

const LANG = (r, lang) => {
  const dir = lang === "ar" ? "rtl" : "ltr";
  expect(r.status === 200, `HTTP ${r.status}`);
  expect(new RegExp(`<html[^>]*lang="${lang}"[^>]*dir="${dir}"`).test(r.text), `expected <html lang="${lang}" dir="${dir}">`);
  return `${r.ms}ms`;
};

group("pages");
await check("/ with no cookie renders ARABIC (the no-choice default)", async () => LANG(await req("/"), "ar"));
await check("/ with itqan.lang=en renders English", async () => LANG(await req("/", { cookie: "itqan.lang=en" }), "en"));
await check("/ with itqan.lang=ar renders Arabic", async () => LANG(await req("/", { cookie: "itqan.lang=ar" }), "ar"));
await check("/ carries no real PRODUCT names (owner's word, 2026-08-27; the client strip in Clients.tsx is deliberate)", async () => {
  const r = await req("/");
  expect(r.status === 200, `HTTP ${r.status}`);
  // Product names only ever come from the sheet — none may reach the public page.
  expect(!/سماعة اريون|ضهر عداد ثلاثي|زراير|غطاء تك 46|كليب شد/.test(r.text), "a real product name is in the landing page HTML");
  return `${Math.round(r.text.length / 1024)} KB`;
});
await check("/login answers (Arabic by default)", async () => LANG(await req("/login"), "ar"));
await check("/dashboard shell answers (the client bounces a signed-out visitor to /login)", async () => LANG(await req("/dashboard"), "ar"));
for (const [p, ar, en] of [
  ["/dashboard/molds", "حصر الاسطمبات", "Molds Register"],
  ["/dashboard/products", "المنتجات", "Products"],
  ["/dashboard/clients", "العملاء", "Clients"],
]) {
  await check(`${p} — server title in Arabic, then English`, async () => {
    const a = await req(p);
    expect(a.status === 200, `HTTP ${a.status}`);
    expect(a.text.includes(`<title>${ar}`), `Arabic title «${ar}» missing`);
    const e = await req(p, { cookie: "itqan.lang=en" });
    expect(e.text.includes(`<title>${en}`), `English title "${en}" missing`);
    return `${a.ms}ms / ${e.ms}ms`;
  });
}
for (const p of ["/dashboard/downtime", "/dashboard/jobs", "/dashboard/storage", "/dashboard/performance", "/dashboard/issues", "/dashboard/assistant", "/dashboard/machines", "/dashboard/reports", "/dashboard/approvals", "/dashboard/production", "/dashboard/quality", "/dashboard/finance", "/dashboard/sales"]) {
  await check(`${p} answers 200`, async () => { const r = await req(p); expect(r.status === 200, `HTTP ${r.status}`); return `${r.ms}ms`; });
}
await check("/robots.txt keeps the dashboard, the API and login out of search", async () => {
  const r = await req("/robots.txt");
  expect(r.status === 200, `HTTP ${r.status}`);
  for (const d of ["/dashboard", "/api/", "/login"]) expect(r.text.includes(`Disallow: ${d}`), `missing Disallow: ${d}`);
});
await check("/sitemap.xml is an XML sitemap", async () => {
  const r = await req("/sitemap.xml");
  expect(r.status === 200 && r.text.includes("<urlset"), `HTTP ${r.status}`);
});
await check("/opengraph-image is an image", async () => {
  const r = await req("/opengraph-image");
  expect(r.status === 200 && r.type.startsWith("image/"), `HTTP ${r.status} ${r.type}`);
});

/* ---------------------------------- OPEN ---------------------------------- */

group("open");
await check("GET /api/runs → an array of runs with product + downtime fields", async () => {
  const r = await req("/api/runs");
  expect(r.status === 200 && Array.isArray(r.json), `HTTP ${r.status}`);
  if (r.json.length) for (const k of ["id", "date", "machine", "product", "goodUnits", "scrapUnits", "downtimeMin"]) expect(k in r.json[0], `run lacks ${k}`);
  expect(!r.json.some((x) => "client" in x || "note" in x), "runs leak client/note fields");
  return `${r.json.length} runs · ${r.ms}ms`;
});
await check("GET /api/oee → the OEE picture with readiness", async () => {
  const r = await req("/api/oee");
  expect(r.status === 200 && r.json && "overall" in r.json && "readiness" in r.json, `HTTP ${r.status}`);
  return `${r.json.runCount ?? "?"} runs · ${r.ms}ms`;
});
await check("GET /api/machines → the registry with labels", async () => {
  const r = await req("/api/machines");
  expect(r.status === 200 && Array.isArray(r.json?.machines), `HTTP ${r.status}`);
  expect(r.json.machines.every((m) => typeof m.label === "string" && m.label), "a machine has no label");
  return `${r.json.machines.length} machines · ${r.ms}ms`;
});
await check("GET /api/issues → the faults log", async () => {
  const r = await req("/api/issues");
  expect(r.status === 200 && Array.isArray(r.json?.issues), `HTTP ${r.status}`);
  return `${r.json.issues.length} issues · ${r.ms}ms`;
});
for (const e of ["molds", "products", "machines", "issues"]) {
  await check(`GET /api/sheet/${e} → records + fields (documented open read)`, async () => {
    const r = await req(`/api/sheet/${e}`);
    expect(r.status === 200 && Array.isArray(r.json?.records) && Array.isArray(r.json?.fields), `HTTP ${r.status}`);
    return `${r.json.records.length} rows · ${r.ms}ms`;
  });
}
await check("GET /api/public/showcase → three counts and nothing else", async () => {
  const r = await req("/api/public/showcase");
  expect(r.status === 200 && r.json?.stats, `HTTP ${r.status}`);
  expect(Object.keys(r.json).join() === "stats", `extra top-level keys: ${Object.keys(r.json)}`);
  expect(Object.keys(r.json.stats).sort().join() === "clients,machines,molds", `stats keys: ${Object.keys(r.json.stats)}`);
  expect(!/records|names/.test(r.text), "the showcase body carries names");
  return JSON.stringify(r.json.stats);
});
await check("GET /api/sheet/nope → 404 (unknown entity)", async () => { const r = await req("/api/sheet/nope"); expect(r.status === 404, `HTTP ${r.status}`); });
await check("GET /api/contact → 405 (no read; the form only POSTs)", async () => { const r = await req("/api/contact"); expect(r.status === 405, `HTTP ${r.status}`); });

/* -------------------------------- GUARDED --------------------------------- */

group("guarded");
const GUARDED = [
  "/api/jobs", "/api/jobs/2", "/api/storage", "/api/downtime", "/api/downtime?quick=1",
  "/api/downtime/export", "/api/downtime/reclassify", "/api/reports", "/api/reports/some-id",
  "/api/reports/draft?month=2026-08", "/api/ai-review", "/api/inquiries", "/api/agent", "/api/molds",
  "/api/sheet/clients", "/api/sheet/master", "/api/sheet/jobs", "/api/sheet/production", "/api/sheet/downtime",
];
for (const p of GUARDED) {
  await check(`GET ${p} without a token → 401`, async () => {
    const r = await req(p);
    expect(r.status === 401, `HTTP ${r.status}${r.json ? ` ${JSON.stringify(r.json).slice(0, 80)}` : ""}`);
    return `${r.ms}ms`;
  });
}
for (const p of ["/api/jobs", "/api/molds", "/api/sheet/master", "/api/storage"]) {
  await check(`GET ${p} with a bogus token → 401`, async () => {
    const r = await req(p, { token: "not-a-real-token" });
    expect(r.status === 401, `HTTP ${r.status}`);
  });
}

/* -------------------------------- MUTATING -------------------------------- */

group("mutating");
const MUTATING = [
  ["POST", "/api/runs"], ["DELETE", "/api/runs/999999"],
  ["POST", "/api/jobs"], ["PATCH", "/api/jobs/2"], ["DELETE", "/api/jobs/999999"],
  ["POST", "/api/issues"], ["PATCH", "/api/sheet/issues"], ["PATCH", "/api/sheet/molds"], ["PATCH", "/api/sheet/master"],
  ["POST", "/api/machines"], ["PATCH", "/api/machines/x"], ["DELETE", "/api/machines/x"], ["POST", "/api/machines/x/notes"],
  ["POST", "/api/downtime"], ["PATCH", "/api/downtime"], ["POST", "/api/downtime/reclassify"],
  ["POST", "/api/reports"], ["DELETE", "/api/reports/x"],
  ["POST", "/api/storage"], ["POST", "/api/agent"], ["PATCH", "/api/molds"],
];
for (const [m, p] of MUTATING) {
  await check(`${m} ${p} without a token → 401 (nothing written)`, async () => {
    const r = await req(p, { method: m, body: {} });
    expect(r.status === 401, `HTTP ${r.status}${r.json ? ` ${JSON.stringify(r.json).slice(0, 80)}` : ""}`);
  });
}
await check("GET /api/runs/1 → 405 (that route only deletes)", async () => { const r = await req("/api/runs/1"); expect(r.status === 405, `HTTP ${r.status}`); });

/* --------------------------------- SIGNED --------------------------------- */

group("signed");
if (!TOKEN) {
  if (!ONLY || ONLY.has("signed")) console.log("  (skipped — pass --token=<Firebase ID token> to run the signed-in checks)");
} else {
  let role = "?";
  await check("GET /api/agent → the token is accepted and names the role", async () => {
    const r = await req("/api/agent", { token: TOKEN });
    expect(r.status === 200 && r.json, `HTTP ${r.status}`);
    role = r.json.role || "?";
    return `role=${role} allowed=${r.json.allowed}`;
  });
  await check("GET /api/molds → every row carries a mould number decision", async () => {
    const r = await req("/api/molds", { token: TOKEN });
    expect(r.status === 200 && Array.isArray(r.json?.molds), `HTTP ${r.status}`);
    const rows = r.json.molds;
    expect(rows.length > 100, `only ${rows.length} rows`);
    for (const m of rows) {
      expect(typeof m.number === "string" && ["code", "notes", "none"].includes(m.numberSource), `bad row ${JSON.stringify(m).slice(0, 80)}`);
      expect(m.numberSource !== "none" || m.number === "", "a 'none' row carries a number");
      expect(m.numberSource !== "notes" || (m.number && m.code === ""), "a 'notes' row must have no code");
    }
    const fromNotes = rows.filter((m) => m.numberSource === "notes").length;
    const both = rows.filter((m) => m.code && m.notesNumber).length;
    expect(fromNotes >= 1, "no row takes its number from the notes — the three دايموند rows should");
    return `${rows.length} rows · ${rows.filter((m) => m.number).length} numbered · ${fromNotes} from notes · ${both} with both · canEdit=${r.json.canEdit}`;
  });
  await check("GET /api/jobs → the order book, with Master's mould number per job", async () => {
    const r = await req("/api/jobs", { token: TOKEN });
    expect(r.status === 200 && Array.isArray(r.json?.jobs), `HTTP ${r.status}`);
    for (const j of r.json.jobs) expect("masterMoldNumber" in j, `job ${j.code} lacks masterMoldNumber`);
    const first = r.json.jobs[0];
    if (first) {
      const d = await req(`/api/jobs/${first.id}`, { token: TOKEN });
      expect(d.status === 200 && d.json?.job, `detail HTTP ${d.status}`);
      if (d.json.standard) expect("moldNumber" in d.json.standard, "standard lacks moldNumber");
      return `${r.json.jobs.length} jobs · first: «${first.product}» master #${first.masterMoldNumber || "—"} (job code ${first.moldCode || "—"})`;
    }
    return `${r.json.jobs.length} jobs`;
  });
  await check("GET /api/sheet/master → the notes column is read", async () => {
    const r = await req("/api/sheet/master", { token: TOKEN });
    expect(r.status === 200 && Array.isArray(r.json?.fields), `HTTP ${r.status}`);
    for (const f of ["client", "category", "notes", "code", "name"]) expect(r.json.fields.includes(f), `field ${f} missing`);
    return `${r.json.records.length} rows`;
  });
  for (const p of ["/api/storage", "/api/downtime?quick=1", "/api/reports"]) {
    await check(`GET ${p} with the token → 200`, async () => { const r = await req(p, { token: TOKEN }); expect(r.status === 200, `HTTP ${r.status}`); return `${r.ms}ms`; });
  }
  await check("PATCH /api/molds with no changes → a no-op 200 for any approved role (nothing written)", async () => {
    const r = await req("/api/molds", { method: "PATCH", token: TOKEN, body: { row: 3, name: "x", changes: {} } });
    expect(r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`);
    return `HTTP ${r.status} (role ${role})`;
  });
}

/* --------------------------------- summary -------------------------------- */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed · ${BASE}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  [${f.group}] ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
