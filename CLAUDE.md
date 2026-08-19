@AGENTS.md

# ITQAN — bilingual manufacturing site + Google-Sheet-backed factory system

Next.js 16 (App Router) + Tailwind v4 + Framer Motion. Public marketing site plus a
role-gated `/dashboard` for an Egyptian plastic-injection factory. **The database is a
Google Sheet** (the crew edits it; the site reads/writes through an Apps Script bridge).
Firebase holds auth/roles and small caches (users, usage, aiReviews). Everything is
bilingual AR/EN with RTL support.

> **Firebase is auth, roles and caches — not factory data. That rule is whole again as of
> 2026-08-14.** Downtime was its one exception for five days: the workbook was frozen, and
> «الإنتاج»!J «زمن التوقف» and !K «سبب التوقف» are two of the six columns never filled once
> in 417 rows, so there was nowhere in the sheet to put a stoppage. The owner has since had
> the tab **«التوقفات»** created (`../production/scripts/downtime-tab.gs`) and ruled it the
> source of truth; the 37 events captured on the phone were migrated into it on 2026-08-14
> and the monthly totals were verified identical before and after (17,253 min, 30
> day+machine keys, 6 reasons).
>
> Firestore keeps **one** downtime responsibility: the stoppage running *right now*. It has
> no minutes until somebody taps stop, and «التوقفات»!D is validated greater than zero, so
> an open stoppage has no legal row — and "write it as 0 and fix it later" is the exact
> failure this system keeps producing. The row is appended on stop, always measured.
> See "Downtime" below.

> Business context, live data state, open items and the sheet's history live in
> **`../ITQAN-CONTEXT.md`**. Read that for *what is true right now*; read this file for
> *how the code works*. Last synced 2026-08-09.

## Commands

```bash
npm run dev          # localhost:3000 (Turbopack)
npm run build        # production build — ALSO the type gate; Vercel runs this on push
npx tsc --noEmit     # quick typecheck
npm test             # Node's own runner, zero deps. `tests/` is excluded from
                     # tsconfig on purpose — it needs the .ts import extension
npm run seed         # (legacy Firestore seed — rarely needed now)
```

Deploy = push to `main` → Vercel auto-deploys (project `itqan`, domain itqan-taupe.vercel.app).
Secrets live in `.env.local` (gitignored) and are mirrored to Vercel env vars.

## Recently landed (2026-08-14) — downtime moved into the sheet

«التوقفات» is the stoppage log now, read and written like «الإنتاج» and «الأعطال». The 37
captured events were migrated and the totals verified identical. Firestore keeps only the
running stoppage. Full detail in the block quote above and under "Downtime"; the bridge
write semantics this uncovered are in "Write semantics" — they affect every tab, not
just this one.

## Recently landed (2026-08-09)

The API auth hardening (`lib/api-guard.ts`, `lib/authed-fetch.ts`, `app/robots.ts`) and the
jobs kg→pieces fix were pushed in `545b10c` — they had been sitting uncommitted, so the
live site was accepting unauthenticated writes until then. `/robots.txt` is live.

Then `d3d124e` fixed four data-correctness bugs; each is described in place below.
All were verified against the live workbook through the bridge, not inferred.

## Architecture (data flow)

```
Google Sheet «قاعدة بيانات اتقان - مترابطة»  ←→  Apps Script web app (apps-script.gs)
        id: 1Oi5ZedXaMWUwLVbh01-rH6X3xCuCA94yrdMmw3wBBE0        │ token-gated doGet/doPost
                                                                 ▼
                                    lib/sheets.ts  (generic ENTITIES reader/writer)
                                                                 ▼
             app/api/* (sheet/[entity], runs, machines, hourly, jobs, issues,
                        oee, ai-review, agent, storage)
                                                                 ▼
                    /dashboard pages (client components, 20s auto-refresh)
```

- `lib/sheets.ts` — config-driven: `ENTITIES` maps each tab to fields matched by
  **header keywords** (headers are bilingual "ar\nen"). Appends are ordered to match the
  tab's real headers, so column reordering in the sheet doesn't break writes.
  `TAB_ALIASES` maps the Arabic tab names to their old English names as fallbacks — keep
  that map when adding an entity.
- Molds/Products tabs are **formula views of Master** — never write to them; writes route
  to the Master row (`MASTER_VIEWS` logic). Clients is a manual tab (write in place).
  ⚠️ **The view's ID column cannot be trusted.** It is `ROW()-2` of the view's OWN row, and
  both views carry `#REF!` at rows 435, 459, 473, 478, 488; each break shifts everything
  below it, so **45 products show an ID belonging to a different Master row** (view row 440
  is «الجردل» with id 438, which is «قاعدة» in Master). `mapToMaster()` therefore verifies
  the PRODUCT NAME after locating by ID, re-resolves by name on disagreement, and returns
  `identity_mismatch` rather than writing when the name is missing or duplicated (one
  product, «سماعة اريون», is genuinely duplicated in Master at rows 289 and 453).
  Clearing the `#REF!` rows is still the owner's job in the sheet.
- `lib/oee.ts` (pure) + `lib/oee-data.ts` (fetch+shape, shared by `/api/oee` and
  `/api/ai-review`) — OEE = Availability × Performance × Quality with per-run capping.
- `lib/hourly.ts` — `loadHourlyRows()` parses «تسجيل الإنتاج»; `deriveScrap()` computes
  scrap per day+machine as سستم − فعلي and distributes it across that day's production runs
  that have no logged scrap, proportional to good units. Feeds `/api/runs` and
  `lib/oee-data.ts`, so quality is measured rather than assumed.
- `lib/jobs.ts` — joins «أوامر العمل» to Master by product name, converts ordered kg to
  pieces via the piece weight, and sums production for progress.
- Auth: Firebase (email/Google) → role request → owner approves at `/dashboard/approvals`.
  Roles/nav in `lib/roles.ts`; owner email hardcoded there and in `firestore.rules`.

### Roles and what each one sees

`owner` + `manager` have full access to everything and are not listed. Everyone else
sees exactly this — the `NAV` table in `lib/roles.ts` is the single source for both the
sidebar and `canAccess()`.

| Role | Pages |
|---|---|
| `worker` (عامل) | hourly, downtime, issues, assistant |
| `production` | overview, production, jobs, hourly, downtime, performance, assistant, issues |
| `quality` | overview, quality, hourly, issues, performance, assistant |
| `maintenance` | machines, downtime, issues |
| `sales` | sales, products, jobs, clients |
| `finance` | finance, reports |
| `storage` | storage |

- **`production` and `quality` are no longer the same.** They used to share one `OPS`
  constant with a comment saying they must never drift apart; that coupling was
  deliberately removed, every entry now lists its roles explicitly, and there is no shared
  alias left. Production lost quality/machines/molds/products/storage/reports; quality lost
  those plus jobs/production/downtime. Both keep overview.
- `worker` is the least-privileged role and is therefore **first** in `REQUESTABLE_ROLES`,
  which is the default applied when a request is approved without a stated role.
- ⚠ **`landingFor(role)` must always return a page that role can access**, or the user
  signs in and is bounced straight back out. `tests/roles.test.ts` asserts
  `canAccess(role, landingFor(role))` for every role in `ALL_ROLES` — change `NAV` and
  `landingFor` together. `worker` lands on `/dashboard/downtime` (it has no overview).
- ⚠ **This table is UX gating, not a security boundary.** Operational read APIs (molds,
  products, machines, runs, oee, hourly, issues) are deliberately open — removing a page
  from a role hides it, it does not classify the data. Mutating routes are guarded by
  `requireRole`, but with no allow-list, so **any approved role** may call them; only
  `/api/inquiries` and `sheet/clients` restrict further (`["sales"]`, both PII reads).
- `canAccess()` matches by longest PREFIX, and the overview entry's href is `/dashboard`,
  which prefixes every `/dashboard/*` path. So a role holding overview inherits any route
  with no NAV entry of its own. Every real page has one today, but **a new page added
  without a NAV entry is reachable by production and quality**, not owner/manager only.
- **Downtime** — `lib/downtime.ts` (pure maths, zero imports, unit-tested)
  + `lib/downtime-data.ts` (reads and writes «التوقفات»), the same split as
  `oee.ts`/`oee-data.ts`.
  `/dashboard/downtime` is a phone-first Arabic page: pick machine → pick reason → start →
  stop, **four taps, no typing**. That constraint is evidence-driven — the six sheet columns
  that need typing are empty across 417 rows, while the tapped hourly log has 20 unbroken
  days. **Treat it as a hard constraint: no extra tap, question, menu, free-text field or
  word of English may be added to that flow.** Raise it with the owner instead.
  - The reason buttons are the owner's own eight (`DOWNTIME_CAPTURE_REASONS`), in his order,
    «أخرى» last. ONE FLAT LIST — never grouped into planned/unplanned sections or a
    two-step pick; that distinction is none of the worker's business.
  - Each reason carries `planned` (and `organisational`) as **metadata set in code**. The
    worker is never asked it and never sees it. It surfaces only on owner-facing surfaces:
    `explain.plannedDowntimeMin` / `unplannedDowntimeMin` / `organisationalDowntimeMin` and
    the monthly report, so the report can state what share of downtime was avoidable.
    ⚠ Those keys are named `*DowntimeMin` on purpose — `explain.plannedMin` already means
    planned PRODUCTION time and would be silently overwritten by a key called `plannedMin`.
  - Unknown reason keys count as **unplanned**, so a stray value cannot flatter the
    avoidable-downtime number.
  - `ALL_DOWNTIME_REASONS` keeps the retired keys (Breakdown, Material, No order, Quality
    hold, None) resolving for display and grouping — they are still in the sheet's own
    «سبب التوقف» vocabulary, and dropping them would make sheet-side downtime ungroupable.
  - **The page is always Arabic** (`ARABIC_ONLY` in `context/LangContext.tsx`), whatever is
    stored and whoever is signed in — it is used by people who do not read English. The
    language toggle is hidden there rather than left dead. The forcing is render-only, so
    an owner visiting the page does not have the rest of the site switched on him. `/api/downtime` (GET/POST/PATCH) and `/api/downtime/export` are ALL guarded,
  including the reads, because the rows carry «سُجل بواسطة» (a staff email).
  ⚠ **So is `/api/sheet/downtime`.** Adding the entity to `ENTITIES` made the generic sheet
  route able to serve the tab, and that route leaves every entity open except the ones
  named in it — `clients` and now `downtime`. A PII tab added to `ENTITIES` without a line
  there is a silent open read.
  - The server stamps `startedAt` and computes minutes from the STORED start on stop, so a
    phone with a wrong clock cannot invent downtime that would flow into Availability.
  - `date` is the **factory day** (`factoryDay()` in `lib/dates.ts`, 08:00→07:00), not the
    calendar day — a 02:00 stoppage belongs to the shift that began the previous morning,
    matching how «تسجيل الإنتاج» dates its rows.
  - One open event per machine; a double-tapped start returns the running event instead of
    opening a duplicate that would double-count.
  - `distributeDowntime()` spreads a day+machine total across that day's runs in proportion
    to each run's remaining headroom. It must not land on one run: `computeOEE()` clamps a
    run's downtime to its planned minutes, so a whole day dumped on one 720-min run would
    be silently truncated. Anything that genuinely does not fit is returned as
    `readiness.downtimeUnallocatedMin` rather than dropped.
  - This is what finally makes **Availability real** — it was a flat 100% before, because
    every run's `downtimeMin` was 0. `explain.availabilityMeasured` is no longer permanently
    false, and `explain.availabilitySource` says whether the number came from the capture,
    the sheet column, or both.
  - **Unclosed stoppages are the expected failure mode**, not an edge case: the likeliest
    real behaviour is an operator ending a shift without tapping stop. Such an event has no
    duration, so it is excluded from Availability — which under-counts downtime while every
    number still looks healthy. `isStaleOpen()` flags any event still open after its factory
    day ended, and they are surfaced where the OWNER sees them (dashboard home banner,
    `readiness.staleOpen`, and the monthly report), not only on the floor's entry page.
    **Nothing auto-closes.** A person reviews each one and closes it, which marks the row
    `estimated: true` + `closedBy`, so a reconstructed number can never be mistaken for a
    measured one. `explain`/the report disclose the estimated total separately.
  - ⚠ **A SHIFT ENDING DOES NOT END THE STOPPAGE (owner's rule, 2026-08-17).** Closing a
    stale stoppage used to cap its minutes at `factoryDayEnd()` — 08:00 the next morning —
    reasoning that a machine "cannot have been down past the shift it was logged in". That
    reasoning was wrong and the captured data says so loudly: **21 of the 37 stoppages run
    past 08:00, carrying 14,973 of the 17,253 minutes, and 11 are longer than a whole
    720-minute shift.** A press that broke at 22:00 and was still broken at 14:00 was down
    sixteen hours; it did not resume because a shift ended with nobody there. There is now
    no cap — a reconstructed close runs to the moment somebody closes it, the same clock a
    tapped stop uses. `estimatedStopMinutes()` is deleted; see the note in its place in
    `lib/downtime.ts`. What bounds a forgotten tap is `isStaleOpen()` surfacing it the next
    morning and the `estimated` flag, not a cap that silently discarded minutes.
  - ⚠ **Consequence, and it is NOT yet solved: a stoppage's minutes are all attributed to
    its START day.** One row, one date. `distributeDowntime()` can only give a run
    `plannedMin − downtimeMin` of headroom, so a stoppage longer than one day's planned time
    cannot fully land and the remainder returns as `readiness.downtimeUnallocatedMin`.
    Production already shows **10,012 of 17,253 minutes unallocated**, and removing the cap
    makes long stoppages more common. The fix is to split a spanning stoppage across the
    factory days it actually covered, one row per day — which changes what «التوقفات»
    contains (one tap becomes several rows) and is the owner's call. Do not "solve" the
    unallocated number by reinstating the cap.
  - **The two stores, and which does what.** «التوقفات» is the log — every total, chart,
    Pareto, CSV and report reads it, through `loadDowntimeTotals()`. Firestore holds only
    the OPEN stoppage, because it has no minutes yet. Three consequences worth knowing
    before touching this:
    - **Stop writes Firestore FIRST, then the sheet.** Not the other way round. If the
      append were first and the close then failed, the stoppage would still be open, the
      operator would tap stop again, and «التوقفات» would gain a SECOND row — double-counted
      downtime, which is invisible. A closed event with `sheetSynced: false` is a flag the
      next read can act on; a duplicate row is not.
    - **`flushPendingDowntime()` retries those**, from `GET /api/downtime`, which the floor
      page polls. It reads the tab first and skips anything already there, because the
      bridge is **at-least-once**: see the write-semantics section below.
    - **Pre-cutover documents carry no `sheetSynced` field at all.** Firestore equality does
      not match a missing field, so the migrated archive stays out of the retry query
      automatically. Do not "tidy" that by backfilling `sheetSynced: false` — it would
      re-append a month of history.
  - The open-event query is a single-field equality and the pending query is another, so
    still **no composite index** — the rule `lib/db.ts` is built around.
  - **The reason vocabulary crosses the boundary in BOTH directions now.** The sheet speaks
    Arabic, the app speaks stable English keys. `downtimeReasonAr(key)` writes; the new
    `downtimeReasonFromSheet(cell)` reads, and it is total over
    `ALL_DOWNTIME_REASONS` — including the five RETIRED keys, which are live data: «عطل»
    (2,251 min) and «خامة» (896 min) are in the migrated history. An unrecognised word is
    returned **as itself**, never folded into "Other", so it shows up in the Pareto under
    its own name instead of hiding. `normalizeArabic()` folds harakat, tatweel, bidi marks
    and the alef/ya/ta-marbuta spellings before the lookup.
    ⚠ «عطل» and «خامة» are deliberately **not** in the tab's dropdown — they are readable
    history, not offerable choices. That is why the migration had to use `append`.
- **Reading the paper production sheet (IN PROGRESS)** — `lib/sheet-import.ts` (pure maths,
  18 tests) + `lib/sheet-vision.ts` (Gemini vision). **Not yet wired to any route or page.**
  See "Reading the paper sheet" below for the full state, the open questions and the two
  findings that must not be forgotten.
  - **Firebase Storage was abandoned deliberately.** An earlier version stored photos in a
    bucket; creating it failed in the console and the owner chose *"send the image straight
    to Gemini and never store it"* instead. All of that code was removed (`lib/photos.ts`,
    `lib/photo-upload.ts`, `/api/hourly-photos`, `storage.rules`, the `hourlyPhotos`
    collection and its rule). **Do not reintroduce Storage without asking** — it needs a
    bucket, Blaze billing, and rules published by hand.
  - Naming note if images ever come back: "storage" in this repo already means the
    materials warehouse («المخزن», `lib/storage.ts`, the `storage` role).
- **Monthly report draft (phase 3)** — `/dashboard/reports` was a blank manual form, which is
  why it was empty. `GET /api/reports/draft?month=YYYY-MM` (guarded) composes an ARABIC draft
  from `buildOEEData(month)` + the **existing** `generateReview()` in `lib/ai-review.ts`,
  sharing the same `(cairoDay, month)` cache document as the Performance page — so a month
  already reviewed today costs no extra LLM call, and the two surfaces can never disagree.
  **There is no second AI path and no second prompt**; that review is already bilingual, so
  the Arabic is its `.ar` half, and the deterministic `rulesReview()` fallback is Arabic too,
  so the draft works with no API key (better with `GEMINI_API_KEY`).
  `lib/report-draft.ts` is pure/import-free and unit-tested. It **never invents**:
  `jobs_completed` stays blank because «أوامر العمل» has no completion date, and an
  unmeasured Availability/Quality, estimated minutes, unallocated minutes and unclosed
  stoppages are all stated in the text the owner reads.
  The draft **is never auto-saved** — it fills the form's state, and the owner edits and
  presses save, which goes through the unchanged `POST /api/reports`.

## The sheet model — read this before touching data code

| Tab | Role |
|---|---|
| `الرئيسي` (Master) | Source of truth, header row 2, data rows 3+. Cols A–P incl. F weight, H cavities (DESIGN count), I cycle(s), J worst cycle |
| `الاسطمبات` (Molds), `المنتجات` (Products) | Row-aligned formula views of Master — READ ONLY |
| `الماكينات` (machines) | Registry, one row per physical machine. **The code label «PQ n — ton» (hidden col J) is the machine's identity everywhere** — production col C, OEE grouping, issue dropdowns. Tonnages repeat, so the code is the key. The registry has been renumbered four times: never hardcode it, always re-read. |
| `الإنتاج` (production) | One row per machine/day: A date, B shift, C machine LABEL, D mold, E product (must match Master name EXACTLY — joins are by name), H good, I scrap, J downtime, K reason |
| `تسجيل الإنتاج` | **The hourly log — the only hourly surface.** Header row 4; 24 hour columns 08:00→07:00 holding PIECES; AB سستم (=SUM), AC فعلي (hand count), AE متوقع, الكفاءة %, AF الهالك, AG حالة السجل, AH hidden scrap denominator |
| `تقرير الإنتاج` | Per-product rollup (UNIQUE spill in A + ARRAYFORMULAs). Owner-built, maintained by `../production-report-v3.gs` |
| `التوقفات` | **The stoppage log — the source of truth for downtime since 2026-08-14.** Header row 1, data row 2+. A date, B machine (dropdown ← «الماكينات»!J), C reason (Arabic dropdown), **D minutes — the only field anything computes from, validated > 0**, E/F optional clock times, G تقديري؟ نعم/لا, H سُجل بواسطة, I ملاحظات. Joins to «الإنتاج» on `date` + the machine label. Built by `../production/scripts/downtime-tab.gs` |
| `أوامر العمل` (jobs) | Manual cols A:N + computed O:X linking to Master by product name. **K (status) and L (priority) are validated ARABIC lists** — K is exactly `لم يبدأ · جاري التشغيل · متوقف · مكتمل`. The app keeps English tokens internally and maps at the boundary via `jobStatusToSheet`/`FromSheet` in `lib/prod-meta.ts`. `Quoted`/`Delivered` have no Arabic counterpart, so they are no longer written — adding them is a sheet change the owner must approve |
| `الأعطال` | Issues log (date, machine, **product**, category, description, action, status, notes). Dropdowns from machines!J / Master!C — layout applied by `setupIssuesTab()` in apps-script.gs (re-run to repair) |
| `العملاء` (Clients), `لوحة البيانات` (Dashboard) | Manual contacts / counters |

**The hourly board «الإنتاج بالساعة» was DELETED on 2026-07-19** at the owner's request.
`../board-formatting.gs` and `../scrap-autofill.gs` target it and will throw — they are dead.

Domain semantics:

- **Scrap = سستم − فعلي** (counter minus hand count) — the owner's model, now native in the
  sheet. Computed **only on self-consistent rows** (both numeric AND سستم ≥ فعلي); rows where
  فعلي > سستم are flagged and excluded, because the cause is missing hours in the log.
  `deriveScrap()` mirrors this on the site side.
- Master keeps the **design** cavity count. Molds often run with damaged cavities blocked.
  A per-run open-cavities column was built and then dropped from the final workbook — if you
  see `openCavities` in old code paths, it is vestigial.
- **«غير متاح / N/A»** is the deliberate filler for unknown cells — never "clean" it;
  all parsing treats it as blank.
- **Dates** arrive in any shape ("14/07 /2026", Arabic digits, serials) — always go through
  `normalizeDate()` in `lib/dates.ts`; never parse dates ad hoc. **The workbook holds TWO
  conventions in the same column** (verified 2026-08-09): hand-typed text is zero-padded
  day-first (`01/08 /2026` = 1 Aug), while cells Sheets parsed as real dates render unpadded
  month-first (`8/5/2026` = 5 Aug). `normalizeDate()` uses whichever part exceeds 12 first,
  then falls back to that padding tell. Before the fix, ambiguous ties were forced
  month-first: 11 of 35 production dates and 7 of 20 hourly dates were wrong, all of August
  disappeared, August scrap computed as zero and **Quality read a fake 100%**. Covered by
  `tests/dates.test.ts` (`npm test`) using real sheet values. If a third format ever appears,
  add it there first.
- **Fixed:** «تسجيل الإنتاج» labels its first two hour columns `8:00`/`9:00` without a
  leading zero (`00:00`–`07:00` ARE padded), so matching the literal `08:00`/`09:00` dropped
  exactly those two columns — 22 of 24 hours displayed. `normHeader()` in `lib/sheets.ts`
  now zero-pads a bare `H:MM` before keyword matching. Totals were always unaffected (they
  come from the sheet's own AB column).
- Reports from the floor identify machines unreliably by code — resolve by PRODUCT NAME
  through the registry when validating.

## Two numbers per shift instead of 24 cells — groundwork landed 2026-08-19

The crew is to record سستم and فعلي per machine per shift rather than 24 hour cells.
Read-side groundwork is in; **no write path has changed** pending confirmation that the
sheet can take it without restructuring.

- **Row SHAPES are derived from the cells** (`lib/hour-shape.ts`, zero imports, 6 tests):
  `hourly` (readings that differ), `flat` (one constant filled across — 09/08 زراير is
  1062 eleven times, which *looks* hourly and carries no hour-to-hour information),
  `shiftTotal` (one cell), `empty`. **Never add a sheet column for this.** Only `hourly`
  may appear in an hour-of-day view.
- **`hoursLogged` is now `hourCellsFilled`.** It counts CELLS. Being named for hours is
  what invited the inference; under the new shape it returns 1 for a twelve-hour shift.
  Nothing may derive a duration from it.
- **Planned time was already safe** — `resolvePlannedMin` takes it from the machines
  registry «طول الوردية», and live readiness reports `plannedSource {column:0,
  machines:544, default:0}`. `computeOEE()` reads no hour cell at all.

### ⚠ «تسجيل الإنتاج» rows hold ONE shift OR TWO, and one cell cannot say which

The single most useful thing measured here. With all 175 August rows simulated as
shift-totals, the efficiency badge read:

| basis | result |
|---|---|
| «المتوقع» (AD) as-is | **1024%–2628%** — AD is `3600/cycle × cavities × COUNT(D:AA)`, and COUNT is now 1 |
| AD rescaled by the registry shift length | **83%–241%** — still exactly **2×** the 24-cell reading, every row |

The 2× is the finding: the tab has **no shift column**, so both shifts share one row and
are told apart only by which half of the 24 cells carries numbers. A row therefore covers
12 hours or 24, and a single filled cell cannot distinguish them. **The efficiency badge is
withheld on shift-total rows rather than guessed.** `/performance` is unaffected — it keys
off «الإنتاج», which does carry a shift per row.

**This decides the row model**: one row per shift (registry length is then right) or one
per day (it is not). Do not implement the write path until that is settled.

### ⚠ AB ≠ the sum of the displayed hour cells, on 110 of 175 rows

`AB = SUM(D:AA)` computes on UNDERLYING values; the bridge returns DISPLAY values, which
are rounded. The two differ by ±3–6 units on most rows. Anything that re-adds the visible
hour cells and treats the result as سستم will drift. Read AB; never recompute it. (Found by
a test harness that did exactly that and injected +49 units.)

## The sheet read path — fixed 2026-08-12, and easy to undo by accident

**Symptom reported:** "the app loads for too long and it is fetching nothing."
Measured against production while the bridge itself answered every tab in ~2.5s:

| | before | cold now | warm now |
|---|---|---|---|
| `/api/runs` | **71s → `[]`** (the tab has 455 rows) | 3.2s ✓ | 0.83s |
| `/api/hourly` | **22s → empty** (994 rows) | 0.65s ✓ | 0.48s |
| `/api/oee` | 30s | 2.9s ✓ | 0.62s |

Three causes, and the first two produced the *same* symptom — a blank page, not
an error:

1. **No cache existed.** `fetchSheet` used `cache: "no-store"` on every call.
   Opening the dashboard fires several routes, each reading three or four tabs.
2. **The Apps Script deployment runs serially.** Firing four reads at once did
   not make them faster, it made some fail — and under load the bridge answers
   with an **HTML error page**, so `JSON.parse` threw straight into the
   candidate loop's empty `catch`.
3. **Every failure looked like emptiness.** A refused read and a genuinely empty
   tab both arrived as `[]`.

What is there now, and why each piece must stay:

- **Next's data cache** (`next: { revalidate: 45, tags: [SHEET_CACHE_TAG] }`),
  *not* an in-memory Map. A Map lives and dies with a serverless instance — the
  first attempt used one and the second request measured **slower** than the
  first, because it landed on a cold instance.
- ⚠️ **`revalidate` and `cache: "no-store"` conflict — set both and Next ignores
  BOTH**, silently disabling the cache. Fresh reads must set exactly one.
- **A one-at-a-time queue** around every bridge GET. This is what stopped the
  empty responses; the cache alone did not.
- **A retry of the real tab name after 1.5s and 4s.** A bridge that refused
  because it was busy usually answers a moment later.
- **Empty results are never cached** — pinning a transient failure for 45s would
  be a worse version of the original bug.
- **Writes and pre-write validation read `fresh`**, bypassing the cache
  entirely. `commitDraft()` exists to re-derive row numbers from the sheet as it
  is *right now*; a 45-second-old copy would defeat confirm-before-write.
- **`?fresh=1` on `/api/hourly`**, which the paper import passes when reloading
  after a write, so nobody is shown their own rows missing. Tag invalidation is
  the optimisation; this flag is the guarantee — `updateTag` (the
  read-your-own-writes primitive) is Server-Actions-only and unavailable in a
  Route Handler, and `revalidateTag`'s `profile: "max"` means
  stale-while-revalidate, which is exactly wrong straight after a write.

**If sheet pages ever go blank again, look here first**, and check the server log
for `[sheets] every attempt failed for tab "…"` — that line distinguishes "the
tab is empty" from "the bridge refused", which is the distinction that was
missing for the entire life of this bug.

## The bridge (apps-script.gs)

- Bound to the sheet, deployed as web app (Execute as owner / access Anyone), token-gated.
- Actions: `doGet(tab)` → displayValues; `doPost` → `updates[{row,col,value}]` (setValue —
  a "=..." string becomes a live formula), `append`, `deleteRow`, `createTab`. **It cannot
  set data-validation, number formats or conditional formatting** — those need one of the
  standalone `.gs` files run from the sheet's script editor.
- ⚠️ **Editing apps-script.gs is NOT live until Deploy → Manage deployments → New version.**
  Editor "Run" works without redeploy; the web app serves the last deployed snapshot.
  Diagnostic symptom: editing rows works but adding rows silently does nothing.
- ⚠️ **Apps Script writes are buffered** — `try { fn() } catch {}` does not contain them;
  the throw lands at the next flush and pending writes are discarded. Put
  `SpreadsheetApp.flush()` INSIDE the try. Apply `setNumberFormat` one column at a time on
  this workbook; multi-column calls throw "column level actions".
### Write semantics — measured against the live workbook, 2026-08-14

Learned while migrating downtime into «التوقفات». All four apply to **every** tab, not
just that one, and three of them contradict what the code comments used to claim.

1. **`append` and `updates` do NOT obey the same rules.** `append` → `sheet.appendRow()`;
   `updates` → `range.setValue()` per cell. They differ in two ways that matter:

   | | data validation | a date string |
   |---|---|---|
   | `append` (appendRow) | **ignored** | stays TEXT — `"2026-08-11"` reads back as `"2026-08-11"` |
   | `updates` (setValue) | **ENFORCED — throws** | parsed, then rendered in the column's format (`"09/08/2026"`) |

   Both round-trip correctly through `normalizeDate()`, so either is safe to read. Use
   `append` when the value might be outside a dropdown (migrating retired reasons), and
   note that «الأعطال» — the other tab the site writes — already holds ISO text, so text
   is the house convention.

2. **A rejected cell abandons the REST of the same POST — FIXED, both ends.** The bridge's
   `updates` loop had no try/catch, so one validation failure threw out of `doPost`: every
   cell after it was dropped, every cell before it stayed committed, and the caller got an
   HTML error page. Writing «عطل» (not in the tab's dropdown) into C2 left row 2 holding a
   date, a machine and seven empty cells.

   `updateRecordsInTab()`'s old comment — "the rows land together or not at all" — was
   therefore false. **A single POST is one request, not one transaction.** Two layers now
   make it nearly true:

   - **`apps-script.gs` wraps the loop and rolls back** to the UNDERLYING values, which is
     the only place a faithful undo is possible (the web app sees display strings, and
     restoring `09/08/2026` in a workbook holding two date conventions can store
     8 September). It replies `{ok:false, error:"cell_rejected", at:"R2C3", rolledBack, notRolledBack}`
     instead of an error page. ⚠ **Not live until Deploy → Manage deployments → New
     version.**
   - **`postUpdates()` in `lib/sheets.ts` recovers without it.** It snapshots the target
     cells from the fresh read the caller already did, and on failure re-reads, uses
     `planRollback()` (`lib/sheet-write.ts`, pure, 10 tests) to see what actually moved,
     restores what can be restored honestly and reports the rest as `stranded`. Verified
     against the live tab on 2026-08-14: the «عطل» batch half-applied, the plan found both
     landed cells, the undo left the tab byte-identical.

   `UpdateResult` therefore carries `applied` / `rolledBack` / `stranded`. **A caller that
   reports a failure without checking `stranded` is telling the user something untrue** —
   `commitDraft()` in `lib/hourly-import.ts` is the worked example.

   *Exposure, corrected:* an earlier note here claimed a bad product name could half-apply
   a paper import. It cannot. That import writes hour columns and «الفعلي», which carry no
   validation at all, and on a new row its date/machine/product are resolved from the very
   sources the dropdowns point at. The reachable case is `updateRecord()` pushing an
   arbitrary value into a validated column — a job status outside «أوامر العمل»!K's four
   Arabic values is the live one, since `jobStatusToSheet` passes unknown values through.

3. **The bridge is AT-LEAST-ONCE.** An append that answered with an HTML error page had
   already written its row; the retry wrote it again, and one 14-minute stoppage became two
   rows and 28 minutes. **A failed-looking write is not evidence that nothing happened.**
   Any retry must re-read and check first — `flushPendingDowntime()` does, and so does
   `scripts/migrate-downtime-to-sheet.mjs`.

4. **Sheets renders a time cell without a leading zero.** Write `08:00`, read back `8:00`;
   `00:54` comes back `0:54`. Exactly the trap that dropped two hour columns from
   «تسجيل الإنتاج» (see `normHeader`). `parseClockMinutes()` in `lib/dates.ts` handles it —
   never compare a clock string without padding it first.

- Driving the bridge from a browser console: GET is simple; **POST with a plain-string body
  and no JSON content-type header** (avoids CORS preflight). Under load `/exec` returns HTML
  error pages — retry with a text parse.

## Storage module (المخزن — SEPARATE spreadsheet)

- The storage sheet «مخزن اتقان» (`1jmPjBFMCcoZmaVeLUD_wLCRtat3RCQ2c7c_UVtsW4gw`) is NOT the
  DB sheet. Its bound script is `../storage-setup-v3.gs`: builds the whole sheet (form +
  إيداع/سحب logs + الرصيد الحالي + «كتالوج الخامات») AND serves its own web bridge
  (`doGet` = balance/logs/lists in one call; `doPost` = save/update/delete/refresh, reusing
  the sheet form's validate_/compute_/nextNumber_/available_ so website saves behave exactly
  like sheet saves — incl. the insufficient-balance block on withdrawals). Same redeploy
  gotcha as apps-script.gs. `POST {action:'refresh'}` re-syncs the dropdown lists remotely.
- Env: `STORAGE_APPS_SCRIPT_URL` + `STORAGE_APPS_SCRIPT_SECRET` (= `WEB_TOKEN` in the .gs).
- Website: `lib/storage.ts` → `/api/storage` (GET open; POST verifies the Firebase ID token
  via `lib/agent-auth.ts` and requires role storage/owner/manager) → `/dashboard/storage`.
- Conventions: خامة = kg only; منتج = pieces (kg×1000 ÷ piece-grams); blank client/loc stored
  as «غير متاح / N/A». **Location is part of the balance key and is NOT case-folded** —
  `a12` and `A12` are two different stock lines.
- Materials come from the sheet's own «كتالوج الخامات» (Master's material names were ruled
  inaccurate by the owner); products/clients/piece-weights still sync from Master.

## AI features (built — not a roadmap item any more)

- `/api/ai-review` + `lib/ai-review.ts` — daily LLM review of the OEE picture. Provider auto:
  `GEMINI_API_KEY` (default `gemini-2.5-flash-lite`) else `ANTHROPIC_API_KEY`
  (`claude-haiku-4-5`); overridable with `AI_REVIEW_PROVIDER`/`AI_REVIEW_MODEL`. Cached once
  per Cairo day per scope in Firestore `aiReviews`; `?refresh=1` forces; deterministic
  `rulesReview()` fallback when no key is set.
- `/api/agent` + `lib/agent-tools.ts` + `/dashboard/assistant` — chat assistant that reads the
  sheet and **proposes** writes. Non-negotiable rule: **confirm-before-write.** The agent
  returns a preview; only an explicit user confirmation triggers the write.
  `ALLOWED` includes `worker`, so a shop-floor account can drive it, writes included.
  Because of that, a confirmed write is **attributed**: `handleConfirm` stamps
  `[المساعد · <email>]` into the row's «ملاحظات» note for production rows and issues,
  taking the actor from the VERIFIED token — never from the request body. A single-cell
  `update` has nowhere in the sheet to carry provenance (writing it into a neighbouring
  cell would corrupt data nobody asked to change), so it is attributed in the server log
  and the response instead. Per-user daily
  message limits are counted in Firestore `usage/{uid}`; the Firebase ID token is verified
  server-side without firebase-admin (Google securetoken certs, `aud`/`iss` = itqan-5f802),
  because org policy blocks service-account keys.

## Reading the paper sheet — BUILT (2026-08-10), read before touching it

Photograph the paper production sheet → Gemini reads it → the owner gets an **editable
preview** → only on his confirmation does anything reach «تسجيل الإنتاج».

| Piece | File |
|---|---|
| Pure maths + every rule that fails silently | `lib/sheet-import.ts` (44 tests) |
| The Gemini vision call | `lib/sheet-vision.ts` |
| Read the sheet, resolve names, write | `lib/hourly-import.ts` |
| Extract (writes nothing) | `POST /api/hourly/import` |
| Commit (the ONLY write path) | `POST /api/hourly/import/commit` |
| The editable grid | `components/dashboard/paper-import.tsx` |
| Entry point | a button on `/dashboard/hourly` — **everyone who can reach the page** |

**Do not re-gate this by role.** It shipped owner-only and the owner reversed it on
2026-08-10: *"the pages should be the same for all, they should all see it."* One page that
renders two ways is precisely what he did not want. Both routes therefore take a bare
`requireRole(req)` — any approved role — which is also the standing convention for mutating
routes here, and the same one that already lets a shop-floor account drive the assistant
with writes included. The safety is the two-press confirmation and the server-side
re-validation, not the role list, and those apply to whoever is signed in.

⚠️ **Extract spends a vision call per request and the Gemini free tier rate-limits** — a 429
was hit during testing on 2026-08-10. Several people photographing at shift change will get
`vision_failed`; it degrades safely (nothing written, the UI says so). If it becomes common,
add a per-user daily cap the way `/api/agent` does — `AI_AGENT_DAILY_LIMIT` plus the
Firestore `usage/{uid}` counter — rather than narrowing who may use the feature.

**The two phases deliberately do not trust each other.** `buildDraft()` resolves the photo
against the sheet and returns a preview; `commitDraft()` throws all of that away and
re-derives every row number, name and free row from a FRESH read before writing. The
browser's row numbers are a claim, not an instruction — the preview may have sat open for
minutes while the crew edited the tab. A row that fails any check aborts the WHOLE import;
a partial write into a shared log is harder to find than no write. This is the opposite of
the assistant's accept/reject confirm, which is safe there only because the server itself
built the payload seconds earlier.

Writes go through `updateRecordsInTab()` (new, in `lib/sheets.ts`) — every cell of every
row in ONE bridge POST. `/exec` returns HTML error pages under load, so ten sequential
POSTs would be ten chances to half-apply an import.

### The paper

One page per SHIFT covering EVERY machine — not one page per machine.
`الأنتاج اليومي لماكينات الحقن — الوردية المسائية | 09/08/2026`, then per row:
`# | التاريخ | الماكينة/الكود | المنتج/الاسطمبة | 8:00 … 7:00 (twelve) | سستم | الفعلي`.

### Findings — verified against the live tab, not assumed

1. **The paper counts SHOTS; the sheet counts PIECES, and the multiplier IS «الرئيسي» H.**
   Confirmed on 2026-08-10 against the owner's own reading of the paper, on five products:

   | Product | Paper, per hour | Master cav | × | Sheet |
   |---|---|---|---|---|
   | كرسي | 23 | 1 | 23 | **23** |
   | غطاء كبير زي بلاست | 163 | 4 | 652 | **652** |
   | حامل عجله | 118 | 8 | 944 | **945** |
   | زراير | 151 | 7 | 1057 | **1062** |
   | كفر شفاف العداد الكبير | 80 | 2 | 160 | **160** |

   The sheet's per-row constant is `round(mean(paper hours) × cavities)`, which is why two
   rows land a few units off a single hour's reading: `1062 ÷ 7 = 151.71`, and the owner
   confirms that row is **151s with a 152 among them**. The mean is fractional by design.

   ⚠️ **An earlier version of this file claimed the opposite** — that Master's cavity count
   was unreliable because only four of ten rows were exactly divisible by it. That analysis
   was wrong twice over, and both mistakes are easy to repeat:
   - It divided the sheet value by **one observed hour** and demanded a whole number. The
     typist multiplies the **mean**, which is usually fractional (77.5, 118.1, 151.7), so a
     non-integer result is the expected outcome, not evidence against Master.
   - Its زراير row rested on a paper value of **118**, which was a misread of `١٥١`. In this
     handwriting `٥` closes into a loop that reads as `٨`. That single glyph produced a
     phantom "×9 where Master says 7" and, from it, a wrong conclusion about the whole
     column. **When a derived multiplier disagrees with Master, suspect the digit first.**

   The multiplier still defaults from Master, is shown next to the raw paper reading, and is
   **editable per row** — but it is now a well-supported default rather than a guess.
2. **The sheet is NOT a transcription.** On paper the hours vary (`١١٨ ١١٨ ١١٩ ١١٩`); in
   the sheet every row is ONE constant repeated. Re-verified across **all ten** rows of
   09/08: every shift-half of every row holds exactly one distinct value, repeated 8–11
   times. Not a sample of one — it is how this sheet has always been filled. So historic
   hourly columns carry **no real hour-to-hour variation** and per-hour analysis on them
   shows nothing. The import defaults to **faithful** (each hour's own reading) with a
   one-click **flatten** toggle, because faithful loses no information and the toggle makes
   the choice reversible; the owner has still not ruled on which he wants.
3. **There is NO «الوردية» column.** Verified 2026-08-10 — the real header row 4 is
   `A التاريخ | B الماكينة/كود | C المنتج/الاسطمبة | D..AA the 24 hours | AB سستم |
   AC الفعلي | AD المتوقع | AE الكفاءة | AF الهالك | AG حالة السجل | AH أساس احتساب الهالك`.
   Both shifts share ONE row and the shift is implied purely by which half carries numbers.
   `ENTITIES.hourly` still declares a `shift` field; `colIndex` finds no header, drops it,
   and `HourlyRow.shift` has therefore always been `""`. Harmless, but do not "fix" it by
   adding a column — that is a sheet change the owner must approve.
4. **The band is real and roomy.** Live counts on 2026-08-10: last occupied row **228**,
   **770 blank rows** left in 5…998. Blank rows carry no formula output at all (AB does not
   render a `0`), so occupancy is unambiguous — but `findFreeRows` is still computed from
   the identity/data columns only, never from AB, because a formula that started rendering
   `0` would otherwise report the band full at row 5 and silently disable new rows.

### The write path — worked out, not yet built

- **UPDATE is safe.** `updateRecord("hourly", row, changes)` → `mapInTab`, which emits only
  the CHANGED cells; the formula columns are never touched. `row` is the 1-based sheet row,
  exactly what `HourlyRow.row` carries. h08/h09 resolve correctly thanks to `normHeader`.
- **NEVER `appendRecord` here.** It builds one cell per header and writes `""` for every
  omitted field — which would blank `AB سستم`, `AD المتوقع`, `AE الكفاءة` on that row.
- **NEVER the bridge's `append` action either.** It is `sheet.appendRow()` → `getLastRow()+1`
  = **row 999**, because the formulas run to 998. That lands past the formula band, past the
  `AF:AH` spill and past the validation, producing a row with no computed columns.
- **A new row (mould changed mid-day) = find the next blank row inside 5–998 and UPDATE it.**
  `AB`/`AD`/`AE` are per-row formulas already pre-filled to 998, and A/B/C validation too,
  so a row written inside that band inherits everything. Data ended ~row 206; **~776 free
  rows remain**, after which the band must be extended by hand in the sheet.
- **Match on date + machine + PRODUCT.** On 09/08 PQ 12 — 180 has two rows — عجلة مكنسة
  (morning) and جوان عجلة مكنسة (evening) — because the mould changed.
- `AF/AG/AH` are ARRAYFORMULA spills anchored at row 5. Never write into them.

### The shift mapping

`lib/sheet-import.ts` owns it. The sheet has 24 hour columns (indices 3–26, `08:00→07:00`);
a paper sheet has 12. **Morning fills the first twelve, evening the last twelve — so an
evening paper's "8:00" is the sheet's `20:00`.** Getting this backwards files a night's
output as a morning's, silently. `detectShift()` reads «مسائية»/«صباحية» from the heading
and returns `null` when it cannot tell — **ask, never assume.**

### Model choice — settled by measurement, 2026-08-10

`gemini-2.5-flash`, overridable with **`AI_VISION_MODEL`** (env only, no code change). The
bake-off is no longer inconclusive. Same photo, same prompt, same six-row gold set:

| Model | Score |
|---|---|
| **`gemini-2.5-flash`** | **6/6** |
| `claude-sonnet-5` | 3/6 |
| `claude-opus-5` | returned unparseable output |
| `gemini-2.5-pro` | untested — 429s without billing |

Flash is simultaneously the cheapest option and the most accurate one here, so **do not
reach for a bigger model to fix a bad read.** Every failure measured so far has been the
photograph (framing, orientation, WhatsApp compression), and a stronger model does not
correct any of them.

**Quota, not capability, is the operational limit.** The free tier allows 20 requests a
minute *per Google Cloud project* — not per key, so minting a second key changes nothing.
Enabling billing on the existing key is what lifts the cap and is also what makes
`gemini-2.5-pro` reachable at all. `callGemini()` retries a 429 twice regardless.

If Pro is ever worth trying, it needs no deploy: set `AI_VISION_MODEL=gemini-2.5-pro` in
Vercel and redeploy. Score it against the gold set in this section before keeping it —
Flash is the incumbent at 6/6 and Pro is slower and dearer.

### The first real photo — measured 2026-08-10, read this before tuning anything

A real evening sheet (09/08/2026) was run end to end and scored against the rows that same
page produced in «تسجيل الإنتاج». A row counts as clean when `sheetEvening ÷ paperValue`
is a whole number 1–12 — that tests alignment AND digits without hand-transcribing.

| Model | Score | Time |
|---|---|---|
| `gemini-2.5-flash` | **3/9** | 20 s |
| `claude-opus-5` | **2/8** (dropped a row) | 126 s |
| `claude-sonnet-5` | **2/9** | 57 s |
| `gemini-2.5-pro` | — | HTTP 429, not on the free tier |

**Do not respond to this by shopping for a better model.** Three models across two vendors
score the same, disagree with each other, and disagree with *themselves* between runs at
temperature 0. What they get right is telling: the printed columns (date, heading, all nine
machine codes) are read perfectly every time, and both stopped machines correctly returned
twelve nulls plus «توقف صيانة» rather than zeros.

**The bottleneck is the photograph.** It arrived via WhatsApp — 1600×1200 and hard-
compressed — hand-held at an angle with the page filling under half the frame, leaving
**≈54 px per grid row** for handwritten Arabic-Indic digits. A flat, square-on, frame-
filling shot sent as the original file is ≈250 px per row. Fix the photo before touching
the prompt again.

**The dangerous failure is row slip, not a misread digit.** A row keeps its correct machine
and product and takes the numbers from the line below — زراير read 151 (EXT 55L's value)
while still labelled زراير. The name looks right, so nothing in the preview flags it. That
is why the prompt now anchors every row to its printed «#» and returns it, and why the
preview shows «سطر N» — the printed number is the only way to see a slip. It is also why
the multiplier stays visible: 1062 ÷ 118 = 9 exactly is what caught this one.

The prompt was rewritten around these findings — see the comment above `PROMPT` in
`lib/sheet-vision.ts`. The old wording said hours run *"left to right in the printed column
order 8:00 … 7:00"*, which contradicts itself on a right-to-left page: 8:00 is the
**rightmost** hour column. That one line is worth understanding before editing the prompt.

### Second photo, same page — what actually moves the number

A second shot of the SAME page (flat on a table, whole page in frame, but photographed
sideways and again via WhatsApp) was scored against a tighter metric: five rows of 09/08
evening where the sheet value divides cleanly, so the correct paper reading is **known**
(كرسي 23, غطاء كبير 163, زراير 118, كفر شفاف 80, غطاء برميل احمر stopped).

| Input | Gold score |
|---|---|
| Photo 1 (hand-held, angled, WhatsApp) | 2/6 |
| Photo 2 **sent sideways** | catastrophic — hallucinated 20 rows, duplicated PQ 13 across the blanks |
| Photo 2, rotation corrected | 2/6 |
| Photo 2, rotated **+ cropped to the table** | **6/6** |
| Photo 2, rotated + cropped + one request per row | worse — see below |

Three things this settles:

1. **Framing is the biggest lever, and it is free.** Cropping added no pixels — it only
   removed the table, the chair and the other papers — and it took the score from 2/5 to
   4/5. It is also what finally read `163` instead of `63`, an error present in *every*
   previous run across both photos and all three models. A photo that fills the frame is
   that crop, taken for nothing.
2. **Orientation must be right before the model sees it.** A sideways page does not degrade
   gracefully; it collapses.
3. **One-request-per-row makes it WORSE.** Tested twice. The model uses neighbouring rows to
   calibrate digit shapes and row boundaries, and isolating a row throws that away. Do not
   build the per-row crop pipeline the earlier note suggested — this is the measurement
   that retires that idea.

4. **There is no row-slip bug.** An earlier revision of this file described a confident
   mechanism — "rows 3–6 shift up by one, desyncing at a sparse row and resyncing at a
   marked one". **That was an artifact of the wrong gold values above.** Once زراير is 151
   and حامل عجله is 118, every row the model returned on the cropped image is correct, and
   the "shift" disappears. The lesson is about method, not vision: a plausible mechanism was
   fitted to a pattern that only existed in the yardstick. Re-derive before theorising.

**Reading the paper by eye: the handwriting sits BELOW its printed row label.** Each
product name in the right-hand column aligns with the band *under* it, not the one beside
it. That offset is what makes hand-checking a photo error-prone — and it is how the `١٥١`
misread survived into two documents.

**The lever nobody has pulled yet is a non-WhatsApp original.** Both photos came through
WhatsApp, which caps the long edge at 1600 px. A phone original is 3000–4000 px. Combined
with filling the frame, that is roughly 4× the pixels per digit over anything measured here.

### Still open

- The two questions above are unanswered. `docs/QUESTIONS-SHEET-OWNER.md` is written out in
  Egyptian Arabic for whoever types the sheet; the answers change only DEFAULTS, not code.
- «الفعلي» is multiplied by the same per-row multiplier as the hours. Whether the paper's
  «الفعلي» is shots or already pieces is question 3 in that doc — and the totals column is
  the worst-read part of the page (زراير read 1812 where the sheet says 22,609), so treat
  a blank there as the safe default and check it by hand.
- **`GEMINI_API_KEY` was never invalid** — the value in `.env.local` was one 53-character
  token pasted twice. Halved on 2026-08-10; `gemini-2.5-flash` returns HTTP 200. The old
  gotcha entry below is kept only so the symptom stays searchable.

## Conventions

- i18n: `lib/i18n*.ts` — `en` and `ar` objects MUST keep the same shape. UI strings never
  hardcoded. `dir={isAr ? "rtl" : "ltr"}` on containers.
- **Language is remembered in a COOKIE, and that is not a detail** (`itqan.lang`, see
  `lib/lang-cookie.ts`). It was localStorage-only until 2026-08-17, and the entry here used
  to claim that meant "no flash of English". It did not, and the owner reported the site
  losing his choice for weeks:

  > `curl https://itqan-taupe.vercel.app/` → `<html lang="en">`, **14 English words, 0
  > Arabic**, whatever the visitor had chosen.

  localStorage cannot be read while the HTML is generated, so the SERVER always sent
  English and the browser only corrected it after the bundle downloaded and hydrated. The
  inline script fixed `<html lang/dir>` before paint — the LAYOUT was right and the TEXT was
  not, which is worse than either, because it looks deliberate. On a phone on factory wifi
  that window is seconds.
  - The cookie rides along with the request, so `app/layout.tsx` (now `async`, reading
    `cookies()`) renders the right language in the first byte.
  - **localStorage is kept, not replaced.** The inline script migrates a pre-cookie choice
    into the cookie so nobody re-picks, and it is the fallback when cookies are blocked.
  - ⚠ The cookie is written from `stored`, **never from the effective `lang`**.
    `/dashboard/downtime` forces Arabic for everyone; writing that would silently convert an
    English-reading manager's own preference because he opened the capture page once.
  - **Cost: every route is dynamic now**, not a static shell. ~30ms per request against
    sheet reads of 2.5–40s, and the shells were never the slow part — every page fetches its
    data client-side anyway. Do not "restore" static rendering without also solving the
    first-byte language, or this bug comes straight back.
  - The script, `LANG_STORAGE_KEY` and `lib/lang-cookie.ts` must all stay in sync.
- Charts are hand-built SVG in `components/dashboard/charts.tsx` — no chart libraries.
- Mobile: base Tailwind classes are the phone layout; desktop is preserved under `md:`/`sm:`
  overrides. Tables get an `sm:hidden`/`md:hidden` card-list twin instead of shrinking.
- Sheet writes send only CHANGED fields (diff vs original) — never clobber untouched cells.
- Keep the GitHub repo PRIVATE — apps-script.gs carries the sheet write token.
- **API auth:** every MUTATING /api route, plus the PII/cost reads (`sheet/clients`,
  `inquiries`, `ai-review`), verifies the Firebase ID token via `lib/api-guard.ts`
  `requireRole(req[, allowed])` (owner/manager always pass; any approved role by default).
  Client side, those calls go through `lib/authed-fetch.ts`. A NEW mutating route/caller must
  follow the same pair. Operational reads (molds/products/machines/runs/oee/hourly/issues
  list) stay open deliberately.
- Prefer manual-with-preview over silent automation. The owner explicitly rejected
  script-driven auto-entry: complexity and silent mistakes are worse than manual work.

## Gotchas

- ⚠️ **`firestore.rules` is NOT deployed by pushing to git.** Vercel deploys the app;
  Firebase rules are deployed separately (`firebase deploy --only firestore:rules`, or
  pasted in the Firebase console). Every collection needs a `match` block — there is no
  catch-all — and API routes reach Firestore through the **unauthenticated** client SDK,
  so a missing block denies the SERVER too, not just browsers. Verified the hard way on
  2026-08-09: `downtimeEvents` writes returned `PERMISSION_DENIED` until the rule shipped.
  The collection is still needed — it holds the stoppage that is running right now — so the
  rule must stay. Symptom to recognise **now**: start and stop appear to work but no row
  ever reaches «التوقفات», because the event was never stored to stop. What a Firestore
  outage no longer does is zero the minutes: `loadDowntimeTotals()` catches the open-event
  read separately, so a Firebase problem costs the stale-stoppage banner and nothing else.
- ⚠ **The `GEMINI_API_KEY` in the local `.env.local` is INVALID** (2026-08-10): a direct
  call returns `401 … Expected OAuth 2 access token`, on both `?key=` and the
  `x-goog-api-key` header. Production works — the report draft returns `Source: gemini` —
  so **Vercel holds a different, working key**. Copy the Vercel value into `.env.local`
  before testing anything Gemini-related locally, or you will conclude the code is broken
  when it is the key.
- Vercel build runs the typecheck — a bad type fails the deploy.
- Turbopack can serve a stale compile error after export refactors — request the route URL
  to force recompile; corrupted `.next` → delete `.next` + `tsconfig.tsbuildinfo`.
- Zombie dev servers holding port 3000 corrupt `.next` — **and they also silently serve the
  OLD build.** A second `npm start` cannot bind the port, fails quietly, and the first
  process keeps answering, so a fix you just built looks broken. Cost three test cycles on
  2026-08-17. Kill the listener and confirm the port is free before believing any local
  result: `Get-NetTCPConnection -LocalPort 3000 -State Listen | Stop-Process -Id {$_.OwningProcess} -Force`.
- ⚠ **`cookies().get(name)` returns `{name, value}`** — a bare `"ar"`, NOT `"itqan.lang=ar"`.
  Handing that to a `Cookie:`-header parser yields null and renders the whole site in the
  fallback language while every unit test stays green. That is exactly how the language fix
  shipped broken on its first attempt; `langFromValue()` and `parseLangCookie()` are now two
  functions and `tests/lang-cookie.test.ts` pins which shape each takes.
- **A `flex` row with `gap-` and no `flex-wrap` cannot break, however narrow the phone.**
  The storage header held four controls (~460px) in one on a 375px screen; the OUTER div
  wrapped, so the title dropped to its own line and the page looked deliberate while
  scrolling sideways. Hunting these by eye is hopeless — scan for `flex` + `gap-` without
  `flex-col`/`flex-wrap` and three or more controls.
- Apps Script drops onEdit events fired <2s apart.
- When checking whether something is deployed, add a `?cb=` cachebuster — a first fetch has
  returned a stale cached response and made a fresh deploy look stale.
- New column names in a tab can hijack `appendRecord`: it maps each HEADER to the first FIELD
  whose keyword it contains. In «أوامر العمل», avoid الكمية / الحالة / المنتج / qty / status /
  product in new column names, or appends will write into an ARRAYFORMULA spill.
- ARRAYFORMULA ranges must track the data (`FILTER`+`ROW`+`MAX`, not a fixed `$D$2:$D$60`),
  or `getLastRow()` overshoots and appended rows land past the computed block.
  `INDEX/MATCH` does not vectorize under ARRAYFORMULA — use `VLOOKUP`.
