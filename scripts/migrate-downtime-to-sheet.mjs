/**
 * One-off: move the Firestore `downtimeEvents` history into «التوقفات».
 *
 *   node scripts/migrate-downtime-to-sheet.mjs            # preview, writes nothing
 *   node scripts/migrate-downtime-to-sheet.mjs --write    # append the rows
 *   node scripts/migrate-downtime-to-sheet.mjs --verify   # re-read and compare totals
 *
 * WHY A SCRIPT AND NOT A ROUTE
 * It runs once. A route would be a permanently reachable way to duplicate a
 * month of downtime, and the totals have to be compared by a person before and
 * after — which is the whole point of the exercise.
 *
 * WHAT IT WRITES
 * One `append` per row — the same path `appendRecord()` uses — NOT one big
 * `updates:[{row,col,value}]` POST. Measured against the live tab on
 * 2026-08-14, and both halves of this were surprises:
 *
 *   • `setValue` (the `updates` action) ENFORCES this tab's reject-style data
 *     validation. Writing «عطل», which is real history but not one of the eight
 *     dropdown values, threw — and the throw abandoned the rest of the POST,
 *     leaving row 2 with a date and a machine and seven empty cells. A batch
 *     that half-applies is worse than one that fails.
 *   • `appendRow` (the `append` action) does not enforce it, so the retired
 *     reasons go in as themselves, and it writes the date as ISO TEXT rather
 *     than parsing it — which is exactly what «الأعطال» already holds, so the
 *     migrated rows match the tab the site already writes.
 *
 * Sequential appends can be interrupted, so this is RESUMABLE: it fingerprints
 * the rows already in the tab and appends only what is missing. Re-running
 * after a failure finishes the job instead of duplicating it.
 *
 * WHAT IT DOES NOT WRITE
 *  • Events with no minutes. Four taps in the archive rounded to 0 (start and
 *    stop inside the same minute). «التوقفات»!D is validated greater than zero
 *    and every total already ignored them, so copying them in as zeros would
 *    ADD a lie and change nothing else. They stay in Firestore.
 *  • A row that is already in the tab. Rows are matched on
 *    date|machine|reason|minutes|start, so re-running is safe.
 *
 * WHAT IT LEAVES ALONE
 * The Firestore documents. They keep no `sheetSynced` field, which is exactly
 * what keeps them out of the app's pending-retry query (see lib/db.ts), and
 * they remain as the untouched original if the copy ever has to be checked.
 */
import { readFileSync } from "node:fs";

/* ----------------------------- env ---------------------------------- */
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  console.error("No .env.local — cannot reach the bridge or Firestore.");
  process.exit(1);
}

const SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
const SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET;
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const FB_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!SCRIPT_URL || !SCRIPT_SECRET || !PROJECT || !FB_KEY) {
  console.error("Missing GOOGLE_APPS_SCRIPT_* or NEXT_PUBLIC_FIREBASE_* in .env.local.");
  process.exit(1);
}

const TAB = "التوقفات";
const WRITE = process.argv.includes("--write");
const VERIFY = process.argv.includes("--verify");

/* ------------- the bits of the app this script has to mirror ---------------
 * Copied rather than imported: lib/sheets.ts imports next/cache and lib/db.ts
 * imports the Firebase SDK, neither of which loads in a bare node script. The
 * header→column mapping below is CHECKED against the live headers before
 * anything is written, so a drift between this copy and ENTITIES.downtime
 * stops the migration instead of silently writing minutes into the wrong
 * column. Keep the two in step.
 */
const FIELDS = [
  { key: "date", keywords: ["التاريخ", "date"] },
  { key: "machine", keywords: ["الماكينة", "machine"] },
  { key: "reason", keywords: ["سبب", "reason"] },
  { key: "minutes", keywords: ["زمن التوقف", "دقيقة", "downtime (min)"] },
  { key: "start", keywords: ["بداية", "started"] },
  { key: "end", keywords: ["نهاية", "ended"] },
  { key: "estimated", keywords: ["تقديري", "estimated"] },
  { key: "loggedBy", keywords: ["بواسطة", "logged"] },
  { key: "notes", keywords: ["ملاحظ", "note"] },
];
/** The column each field MUST land in (A..I from downtime-tab.gs). */
const EXPECTED = { date: 0, machine: 1, reason: 2, minutes: 3, start: 4, end: 5, estimated: 6, loggedBy: 7, notes: 8 };

const normHeader = (h) => (h || "").toLowerCase().replace(/(^|[^\d])(\d):(\d{2})/g, "$10$2:$3");

/** lib/prod-meta.ts DOWNTIME_CAPTURE_REASONS + RETIRED_DOWNTIME_REASONS. */
const REASON_AR = {
  "Setup": "ضبط منتج",
  "Nozzle burn": "حرق فونيه",
  "Mold change": "تغيير الاسطمبة",
  "Mold maintenance": "صيانة الاسطمبة",
  "Maintenance": "صيانة في الماكينة",
  "Material drying": "تجفيف خامة",
  "No operator": "توقف بسبب عدم وجود عامل",
  "Other": "أخرى",
  "Breakdown": "عطل",
  "Material": "خامة",
  "No order": "لا يوجد أمر شغل",
  "Quality hold": "إيقاف للجودة",
  "None": "لا يوجد",
};

const CAIRO_OFFSET_MIN = 120;
const pad2 = (n) => String(n).padStart(2, "0");
const clock = (ms) => {
  if (!ms) return "";
  const d = new Date(ms + CAIRO_OFFSET_MIN * 60000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};

/* ----------------------------- io helpers ---------------------------- */
/** Read a tab, retrying a throttled bridge — it answers with an HTML error page
 *  when busy and normally a moment later. Mirrors lib/sheets.ts. */
async function readTab(tab) {
  const u = `${SCRIPT_URL}?token=${encodeURIComponent(SCRIPT_SECRET)}&tab=${encodeURIComponent(tab)}`;
  let last = "";
  for (const wait of [0, 1500, 4000, 8000]) {
    if (wait) await new Promise((s) => setTimeout(s, wait));
    try {
      const res = await fetch(u, { redirect: "follow" });
      const body = await res.text();
      try {
        return JSON.parse(body).values ?? [];
      } catch {
        last = body.trim().startsWith("<") ? "an HTML error page (bridge throttled?)" : body.slice(0, 100);
      }
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error(`bridge never returned JSON for "${tab}": ${last}`);
}

async function postAction(payload) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: SCRIPT_SECRET, ...payload }),
    redirect: "follow",
  });
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { ok: false, error: `non-JSON reply: ${body.slice(0, 120)}` };
  }
}

const fval = (f) =>
  f === undefined ? null
  : f.stringValue !== undefined ? f.stringValue
  : f.integerValue !== undefined ? Number(f.integerValue)
  : f.booleanValue !== undefined ? f.booleanValue
  : f.doubleValue !== undefined ? Number(f.doubleValue)
  : null;

async function readFirestore() {
  const out = [];
  let token = "";
  do {
    const u = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/downtimeEvents?pageSize=300&key=${FB_KEY}${token ? `&pageToken=${token}` : ""}`;
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Firestore read failed: HTTP ${res.status}`);
    const j = await res.json();
    for (const d of j.documents ?? []) {
      const f = d.fields ?? {};
      out.push({
        id: d.name.split("/").pop(),
        date: fval(f.date) ?? "",
        machine: fval(f.machine) ?? "",
        reason: fval(f.reason) ?? "",
        minutes: fval(f.minutes) ?? 0,
        startedAt: fval(f.startedAt) ?? 0,
        endedAt: fval(f.endedAt),
        estimated: fval(f.estimated) === true,
        createdBy: fval(f.createdBy) ?? "",
      });
    }
    token = j.nextPageToken ?? "";
  } while (token);
  return out;
}

/* ------------------------------- totals ------------------------------- */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const normKey = (s) =>
  (s ?? "").replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .toLowerCase().replace(/\s+/g, " ").trim();
const dtKey = (date, machine) => `${date}|${normKey(machine)}`;

/** The same three roll-ups summarizeDowntime() produces, so they can be compared. */
function tally(events) {
  const byKey = new Map(), byReason = new Map(), byMonth = new Map();
  let total = 0, estimated = 0;
  for (const e of events) {
    if (!e.date || !e.machine || !(e.minutes > 0)) continue;
    total += e.minutes;
    if (e.estimated) estimated += e.minutes;
    const k = dtKey(e.date, e.machine);
    byKey.set(k, (byKey.get(k) ?? 0) + e.minutes);
    byReason.set(e.reason || "Other", (byReason.get(e.reason || "Other") ?? 0) + e.minutes);
    const m = e.date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + e.minutes);
  }
  return { byKey, byReason, byMonth, total, estimated, count: events.filter((e) => e.date && e.machine && e.minutes > 0).length };
}

function compare(label, a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const diffs = [];
  for (const k of keys) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) diffs.push(`${k}: ${a.get(k) ?? 0} → ${b.get(k) ?? 0}`);
  if (diffs.length === 0) { console.log(`  ✓ ${label}: identical (${keys.size} keys)`); return true; }
  console.log(`  ✗ ${label}: ${diffs.length} differ`);
  for (const d of diffs.slice(0, 12)) console.log(`      ${d}`);
  return false;
}

/* --------------------------------- run -------------------------------- */
const events = (await readFirestore()).sort(
  (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt),
);
const countable = events.filter((e) => e.date && e.machine && e.minutes > 0);
const skipped = events.filter((e) => !(e.date && e.machine && e.minutes > 0));
const before = tally(events);

console.log(`Firestore: ${events.length} documents, ${countable.length} with minutes.`);
console.log(`  total ${before.total} min (${before.estimated} of them estimated)`);
console.log(`  by month: ${[...before.byMonth].map(([m, v]) => `${m}=${v}`).join("  ")}`);
console.log(`  by reason: ${[...before.byReason].sort((a, b) => b[1] - a[1]).map(([r, v]) => `${r}=${v}`).join("  ")}`);
if (skipped.length) {
  console.log(`  NOT migrated (${skipped.length}, zero minutes — never counted anywhere):`);
  for (const e of skipped) console.log(`      ${e.date} ${e.machine} ${e.reason} ${e.minutes}min`);
}

const values = await readTab(TAB);
if (values.length === 0) { console.error(`«${TAB}» not found. Run production/scripts/downtime-tab.gs first.`); process.exit(1); }
const headers = values[0];
console.log(`\n«${TAB}»: ${headers.length} columns, ${values.length - 1} data rows.`);

// Check the ENTITIES.downtime keyword mapping against the REAL headers before
// trusting it with a month of history.
const mapping = headers.map((hd) => {
  const h = normHeader(hd);
  return (FIELDS.find((f) => f.keywords.some((k) => h.includes(k))) ?? { key: null }).key;
});
let mapOk = true;
for (const [key, col] of Object.entries(EXPECTED)) {
  if (mapping[col] !== key) {
    mapOk = false;
    console.error(`  ✗ column ${String.fromCharCode(65 + col)} «${headers[col]}» maps to ${mapping[col]}, expected ${key}`);
  }
}
if (!mapOk) { console.error("Column mapping is wrong — refusing to write."); process.exit(1); }
console.log(`  ✓ all nine columns map as ENTITIES.downtime expects: ${mapping.join(", ")}`);

if (VERIFY) {
  const rows = values.slice(1).map((r) => ({
    date: isoFromSheet(r[0]),
    machine: (r[1] ?? "").trim(),
    reason: keyFromAr(r[2]),
    minutes: Number(String(r[3] ?? "").replace(/[^\d.-]/g, "")) || 0,
    estimated: (r[6] ?? "").trim() === "نعم",
  }));
  const after = tally(rows);
  console.log(`\nRead back ${rows.length} rows → ${after.count} countable, ${after.total} min (${after.estimated} estimated).`);
  const ok =
    compare("minutes by day+machine", before.byKey, after.byKey) &&
    compare("minutes by reason", before.byReason, after.byReason) &&
    compare("minutes by month", before.byMonth, after.byMonth);
  console.log(ok ? "\n✓ TOTALS MATCH — the sheet says exactly what Firestore said." : "\n✗ TOTALS DIFFER — do not cut over.");
  process.exit(ok ? 0 : 1);
}

/**
 * Sheets renders a time cell WITHOUT a leading zero: "08:00" is written and
 * "8:00" comes back, "00:54" comes back "0:54". Same trap as the hour headers
 * in «تسجيل الإنتاج» (see normHeader in lib/sheets.ts). Pad before comparing,
 * or six of the thirty-seven rows look missing and get written twice.
 */
const padClock = (s) => String(s ?? "").trim().replace(/^(\d):/, "0$1:");

/** date|machine|reason|minutes|start — enough to tell two real stoppages apart. */
const sig = (r) => [r.date, r.machine, r.reason, r.minutes, padClock(r.start)].join("|");

function sigOfSheetRow(r) {
  return sig({
    date: isoFromSheet(r[0]),
    machine: (r[1] ?? "").trim(),
    reason: keyFromAr(r[2]),
    minutes: String(Math.round(Number(String(r[3] ?? "").replace(/[^\d.-]/g, "")) || 0)),
    start: (r[4] ?? "").trim(),
  });
}

const already = new Set(values.slice(1).map(sigOfSheetRow));

const rows = countable.map((e) => ({
  date: e.date,
  machine: e.machine,
  reason: REASON_AR[e.reason] ?? e.reason,
  minutes: String(Math.round(e.minutes)),
  start: clock(e.startedAt),
  end: clock(e.endedAt),
  estimated: e.estimated ? "نعم" : "لا",
  loggedBy: e.createdBy,
  notes: "مُرحّل من تسجيل الموبايل",
  _sig: sig({
    date: e.date, machine: e.machine, reason: e.reason,
    minutes: String(Math.round(e.minutes)), start: clock(e.startedAt),
  }),
}));
const todo = rows.filter((r) => !already.has(r._sig));

console.log(`\nPrepared ${rows.length} rows; ${rows.length - todo.length} already in the tab, ${todo.length} to append.`);
console.log("First three:");
for (const r of todo.slice(0, 3)) {
  console.log(`   ${r.date} | ${r.machine} | ${r.reason} | ${r.minutes} | ${r.start}–${r.end} | ${r.estimated} | ${r.loggedBy}`);
}

if (!WRITE) { console.log("\nDry run. Nothing written. Re-run with --write."); process.exit(0); }
if (todo.length === 0) { console.log("\nNothing to do. Run with --verify to compare the totals."); process.exit(0); }

console.log("\nWriting one row at a time…");
let written = 0;
for (const r of todo) {
  // Ordered by COLUMN, not by object-key order — the header check above
  // proved EXPECTED matches the tab, so this is the tab's own order.
  const cells = Object.entries(EXPECTED).sort((a, b) => a[1] - b[1]).map(([k]) => r[k]);
  let res = null;
  // The bridge answers with an HTML error page when it is busy; a moment later
  // it answers normally. Same reasoning as the read retries in lib/sheets.ts.
  //
  // ⚠ BUT A FAILED-LOOKING APPEND MAY HAVE WRITTEN THE ROW. Learned the hard
  // way on the first run of this migration: row 1 came back as an HTML error
  // page, the retry appended it again, and «التوقفات» ended with 38 rows and 14
  // extra minutes on PQ 3 — 280. So every retry re-reads the tab first and
  // treats "it is already there" as success.
  for (const wait of [0, 1500, 4000]) {
    if (wait) {
      await new Promise((s) => setTimeout(s, wait));
      const now = await readTab(TAB).catch(() => null);
      if (now && now.slice(1).some((x) => sigOfSheetRow(x) === r._sig)) { res = { ok: true }; break; }
    }
    res = await postAction({ tab: TAB, append: cells });
    if (res.ok) break;
  }
  if (!res?.ok) {
    console.error(`\nStopped after ${written} rows — ${r.date} ${r.machine} failed: ${res?.error ?? "unknown"}`);
    console.error("Nothing is lost. Re-run the same command: the rows already written are skipped.");
    process.exit(1);
  }
  written++;
  process.stdout.write(`\r  ${written}/${todo.length}`);
}
console.log(`\nWrote ${written} rows. Now run with --verify to compare the totals.`);

/* ---------------------- read-back helpers (--verify) ---------------------- */
function isoFromSheet(raw) {
  const s = String(raw ?? "").trim().replace(/\s*([/.\-])\s*/g, "$1");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return "";
  const a = +m[1], b = +m[2], y = m[3];
  // Same rule as normalizeDate(): whichever part exceeds 12 settles it, else
  // a zero-padded leading part means day-first.
  if (a > 12 && b <= 12) return `${y}-${pad2(b)}-${pad2(a)}`;
  if (b > 12 && a <= 12) return `${y}-${pad2(a)}-${pad2(b)}`;
  return m[1].length === 2 ? `${y}-${pad2(b)}-${pad2(a)}` : `${y}-${pad2(a)}-${pad2(b)}`;
}
function keyFromAr(v) {
  const s = String(v ?? "").trim();
  for (const [k, ar] of Object.entries(REASON_AR)) if (ar === s) return k;
  return s;
}
