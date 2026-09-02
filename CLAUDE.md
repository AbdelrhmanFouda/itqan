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

## Recently landed (2026-08-28) — leak closures + front-door fixes

- **`/api/public/showcase` returns counts only.** It kept serving 30 real product names
  and all 57 client names after the landing page stopped showing them (90ab433). The Hero
  only ever used the counts; a revived «أعمالنا» section must bring its own genericized
  content (`components/Products.tsx` no longer fetches).
- **`/api/jobs` (list + detail) and `/api/storage` GETs are guarded** (any approved role) —
  they name clients, order quantities and stocks. Callers switched to `authedFetch`:
  overview, finance, sales, jobs, job detail, storage pages.
- **`/api/sheet/[entity]` GET is DENY-BY-DEFAULT** behind an explicit
  `OPEN_READS = {molds, products, machines, issues}` set (clients keeps its stricter
  sales-only rule). The adversarial review of this very changeset found the jobs guard
  was bypassable by URL: `sheet/jobs` served the same order book open, `sheet/production`
  served the client name on every row (a column `/api/runs` deliberately omits), and
  `sheet/master` was open too. A NEW entity added to `ENTITIES` is now guarded until
  consciously added to that set — the old shape (open unless someone remembered a guard
  line) is the exact "silent open read" the route's own comment warned about.
- **`/api/reports` and `/api/reports/[id]` GETs are guarded** — monthly management
  narrative (notes/issues/recommendations) was an anonymous read while POST/DELETE in the
  same files were guarded (pre-existing since 545b10c, caught by the same review).
  Reports pages switched to `authedFetch`.
- **Five Firestore-era routes deleted:** `/api/clients`, `/api/clients/[id]`, `/api/molds`,
  `/api/molds/[id]`, `/api/molds-register`. Zero callers; two of them were open reads.
- **Nav offers no dead anchors:** the Team/Equipment links render only when their i18n
  content exists, mirroring the `return null` gates in Team.tsx/Tools.tsx.
- **The contact form requires a phone OR an email** (client + server, reason
  `missing_contact`) — a lead with neither cannot be answered. Fields also gained
  `id`/`htmlFor`/`autoComplete`, so labels are announced and phones offer autofill.

## Recently landed (2026-08-20 → 27) — see ../CHANGES-2026-08-27.md for the full story

- **«تسجيل الإنتاج» was deleted from the workbook and the site was rewired off it**
  (2026-08-27, second session) — scrap now comes off the run's own «الإنتاج» row via
  `lib/scrap.ts`; the hourly page, route, lib and entity are deleted; a `no_tab` answer no
  longer costs 5.5s of retries and now shows up in the readiness panel. Full story in
  "«تسجيل الإنتاج» was removed from the workbook" below.
- **A stoppage from a previous day keeps recording** (`b5eb2f8`) — no more "forgotten"
  pile on the floor page; day-aware counter, measured stop. Details in the Downtime
  section below.
- **Jobs are fully editable from the site** (`b5eb2f8`) — edit modal for every
  «أوامر العمل» column + an edit-Master-standard modal; Master rows re-located by product
  NAME on a fresh read, raw cell text round-tripped so «4+4» survives.
- **Site-wide UI polish** (`ffbfea8`, 35 files, presentation only). Rollback tag
  **`before-redesign`** is pushed. The marketing dark ground is a `.marketing-dark`
  wrapper class on `app/page.tsx`, NOT on `body`.
- **No real product names on the landing page** (`90ab433`) — «أعمالنا» section removed.
- **Three new downtime reasons** (`032f18f`) — «عدم وجود خامة» (new key `No material`),
  «لا يوجد أمر شغل» (`No order` revived from the retired list), «كسر المصب»
  (`Sprue broken`). Eleven buttons, «أخرى» last. The sheet dropdown still needs the three
  values (owner).
- **The workbook was re-surveyed 2026-08-27** and several claims in this file dated 9 Aug
  are corrected in place below, each marked *(REVISED 2026-08-27)*. The biggest: «الإنتاج»
  now carries native سستم/هالك/«حالة السجل».
- **Two number-correctness fixes landed the same day:** `deriveScrap()` was given a
  credit-first rule so it stopped double-counting days that mix a native-scrap row with a
  «لم يُعد بعد» row — *superseded hours later, when the tab it read was deleted and
  lib/scrap.ts was rewritten around the run's own row* — and a
  multi-day stoppage's minutes are now split across the factory days it covered at READ
  time (`splitAcrossFactoryDays` in lib/downtime.ts — the sheet stays one tap = one row).
- **Front door + review tools (second wave, ../CHANGES-2026-08-27.md §7):** the contact
  form only claims success on a confirmed 2xx; `/api/contact` gained a per-IP rate limit,
  field caps, a utm/referrer `source` on every inquiry and a Resend notify hook (env-
  gated); WhatsApp/call buttons render only when `NEXT_PUBLIC_CONTACT_PHONE` exists — no
  placeholder ever ships; OG/twitter card + generated `app/opengraph-image.tsx` (no stock
  photos posing as the factory) + `/sitemap.xml`. Dashboard home shows days-since-last-
  stoppage-logged (the 24→27 Aug silence was ADOPTION, not a bug — write path verified
  live). `/api/downtime/reclassify` (owner/manager ONLY — note the `requireRole(req, [])`
  pattern) relabels «أخرى» rows after a fresh-read identity check; the downtime page's
  review section renders only for owner/manager, so the floor flow is untouched. Jobs
  carry `ambiguous: true` when the product name matches >1 Master row.

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
             app/api/* (sheet/[entity], runs, machines, jobs, issues,
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
- `lib/scrap.ts` — `resolveScrap(row)` reads a run's scrap off its OWN «الإنتاج» row:
  «هالك» when filled (`source: "logged"`), else «الأجمالي سستم» − «إنتاج سليم»
  (`"system"`), else `"none"` — which means UNKNOWN, not zero. Pure, zero imports,
  11 tests. Used by all three run paths (`/api/runs`, `lib/oee-data.ts`, `lib/jobs.ts`),
  so they cannot disagree. **`lib/hourly.ts` and `deriveScrap()` are gone** — see
  "«تسجيل الإنتاج» was removed from the workbook" below.
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
| `worker` (عامل) | downtime, issues, assistant |
| `production` | overview, production, jobs, downtime, performance, assistant, issues |
| `quality` | overview, quality, issues, performance, assistant |
| `maintenance` | machines, downtime, issues |
| `sales` | sales, products, jobs, clients |
| `finance` | finance, reports |
| `storage` | storage |

- **`production` and `quality` are no longer the same.** They used to share one `OPS`
  constant with a comment saying they must never drift apart; that coupling was
  deliberately removed, every entry now lists its roles explicitly, and there is no shared
  alias left. Production lost quality/machines/molds/products/storage/reports; quality lost
  those plus jobs/production/downtime. Both keep overview. *(2026-08-27: every role
  also lost `hourly` — the page's only data source was deleted from the workbook.)*
- `worker` is the least-privileged role and is therefore **first** in `REQUESTABLE_ROLES`,
  which is the default applied when a request is approved without a stated role.
- ⚠ **`landingFor(role)` must always return a page that role can access**, or the user
  signs in and is bounced straight back out. `tests/roles.test.ts` asserts
  `canAccess(role, landingFor(role))` for every role in `ALL_ROLES` — change `NAV` and
  `landingFor` together. `worker` lands on `/dashboard/downtime` (it has no overview).
- ⚠ **This table is UX gating, not a security boundary.** Operational read APIs (molds,
  products, machines, runs, oee, issues) are deliberately open — removing a page
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
  - The reason buttons are the owner's own **eleven** (`DOWNTIME_CAPTURE_REASONS`), in his
    order, «أخرى» last. Three added 2026-08-27 at his word: «عدم وجود خامة» (`No material`,
    organisational), «لا يوجد أمر شغل» (`No order` — retired key revived), «كسر المصب»
    (`Sprue broken`). ONE FLAT LIST — never grouped into planned/unplanned sections or a
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
  - **The page is NO LONGER forced to Arabic — owner's word, 2026-08-28.** It was
    (`ARABIC_ONLY`, 2026-08-17, because workers do not read English), but the force also
    switched the OWNER to Arabic with the toggle hidden every time he opened the tab, and
    he asked for that to stop. The worker protection moved to the DEFAULT: the whole site
    now falls back to ARABIC when no choice is stored (layout, LangContext, bootstrap, and
    the three server pages all agree — grep "owner's word, 2026-08-28"), so a worker who
    never touches the toggle still sees Arabic everywhere. `ARABIC_ONLY` is an EMPTY list
    now (mechanism kept, `tests/arabic-only.test.ts` pins the reversal). `/api/downtime` (GET/POST/PATCH) and `/api/downtime/export` are ALL guarded,
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
  - ⚠ **A STOPPAGE FROM A PREVIOUS DAY IS STILL RUNNING (owner's rule, 2026-08-20).** The
    floor page used to move a stale-open stoppage into a "never stopped" pile whose only
    action was close-as-estimated — which read as "it stopped at the end of the shift as
    if someone forgot to log it". It no longer does: the page merges `stale` into the
    running list, the counter is day-aware ("2 يوم 5:20"), the card shows its start date,
    and the SAME measured stop applies — minutes run start → now, `estimated: false`.
    The API is unchanged (`open`/`stale` are still two lists; the owner surfaces read
    `stale`, reworded from "forgotten" to "still down since a previous day"), and the
    `estimate: true` PATCH branch survives server-side for a deliberate owner review —
    but no UI sends it any more.
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
  - **SOLVED 2026-08-27 (owner's word), at READ time: a spanning stoppage's minutes now
    land on every factory day it covered.** `splitAcrossFactoryDays()` (lib/downtime.ts,
    pure, 8 tests) slices a row by its date + «بداية» clock into 08:00-bounded days, and
    `loadDowntimeTotals()` tallies the SLICES — sliced before the month filter, so a
    stoppage crossing a month boundary contributes to the right months. Chosen over
    write-time splitting deliberately: the sheet stays one tap = one row, no multi-append
    over an at-least-once bridge, and the pre-existing long rows are handled too. A row
    with no start clock stays whole on its start day. Only 6 of the 54 current rows
    actually cross a day boundary (a factory day is 24h; most 12h+ stoppages still fit) —
    residual `downtimeUnallocatedMin` now mostly means "more downtime than the day's
    PLANNED minutes" or "no production row that day", which is a modeling question, not an
    attribution bug. Do not "solve" it by reinstating the cap.
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
- **The paper-photo import is GONE (2026-08-19)** — see "The paper-photo import — REMOVED"
  below for what was deleted, what survived it, and where to recover it from.
  - **Firebase Storage was abandoned deliberately** before that, and the reasoning still
    stands if images ever return: an earlier version stored photos in a bucket, creating it
    failed in the console, and the owner chose *"send the image straight to Gemini and never
    store it"*. `lib/photos.ts`, `lib/photo-upload.ts`, `/api/hourly-photos`, `storage.rules`
    and the `hourlyPhotos` collection were all removed. **Do not reintroduce Storage without
    asking** — it needs a bucket, Blaze billing, and rules published by hand.
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
| `الرئيسي` (Master) | Source of truth, header row 2, data rows 3+. *(REVISED 2026-08-27)* A new «الفئة / Category» column at E shifted the letters: F weight → **G نوع الخام, I cavities (DESIGN count), J cycle(s), K worst cycle**. Column matching is by keyword so code was unaffected — but don't trust old letters. 485 rows; **26 product names exist twice** (was just «سماعة اريون») |
| `الاسطمبات` (Molds), `المنتجات` (Products) | Row-aligned formula views of Master — READ ONLY |
| `الماكينات` (machines) | Registry, one row per physical machine. **The code label «PQ n — ton» (hidden col J) is the machine's identity everywhere** — production col C, OEE grouping, issue dropdowns. Tonnages repeat, so the code is the key. The registry has been renumbered four times: never hardcode it, always re-read. |
| `الإنتاج` (production) | One row per machine/**shift**: A date, B shift, C machine LABEL, E product (must match Master name EXACTLY — joins are by name). *(REVISED 2026-08-27)* The tab now carries QUALITY natively: H سليم, **I «الأجمالي سستم» (new), J هالك — FILLED on 374 of 593 rows, exactly سستم − سليم — and K «حالة السجل»** (سليم / لم يُعد بعد / الفعلي أكبر من العداد). Downtime/reason/operator/notes columns are still never filled — downtime still joins from «التوقفات». B also holds «عطلة» / «يوم جمعة» day-off markers |
| `تسجيل الإنتاج` | **DELETED from the workbook — 2026-08-27, deliberately.** The bridge answers `no_tab` under every spelling, and the workbook holds ZERO `#REF!` cells, which is what deleting a referenced tab would have left. Quality moved onto «الإنتاج»'s own row. Nothing in the site reads it any more |
| `تقرير الإنتاج` | Per-product rollup (UNIQUE spill in A + ARRAYFORMULAs). Owner-built, maintained by `../production-report-v3.gs` |
| `التوقفات` | **The stoppage log — the source of truth for downtime since 2026-08-14.** Header row 1, data row 2+. A date, B machine (dropdown ← «الماكينات»!J), C reason (Arabic dropdown), **D minutes — the only field anything computes from, validated > 0**, E/F optional clock times, G تقديري؟ نعم/لا, H سُجل بواسطة, I ملاحظات. Joins to «الإنتاج» on `date` + the machine label. Built by `../production/scripts/downtime-tab.gs` |
| `أوامر العمل` (jobs) | Manual cols A:N + computed O:X linking to Master by product name. **K (status) and L (priority) are validated ARABIC lists** — K is exactly `لم يبدأ · جاري التشغيل · متوقف · مكتمل`. The app keeps English tokens internally and maps at the boundary via `jobStatusToSheet`/`FromSheet` in `lib/prod-meta.ts`. `Quoted`/`Delivered` have no Arabic counterpart, so they are no longer written — adding them is a sheet change the owner must approve |
| `الأعطال` | Issues log (date, machine, **product**, category, description, action, status, notes). Dropdowns from machines!J / Master!C — layout applied by `setupIssuesTab()` in apps-script.gs (re-run to repair) |
| `العملاء` (Clients), `لوحة البيانات` (Dashboard) | *(REVISED 2026-08-27)* «العملاء» was rebuilt as a mini-dashboard: title + note rows, headers at ROW 3 (الرقم / العميل / عدد المنتجات / آخر طلب / الشخص المسؤول / الهاتف), 60 clients. Contact person + phone are EMPTY (yellow, to fill). Keyword header detection still finds row 3 |

**The hourly board «الإنتاج بالساعة» was DELETED on 2026-07-19** at the owner's request.
`../board-formatting.gs` and `../scrap-autofill.gs` target it and will throw — they are dead.

Domain semantics:

- **Scrap = سستم − سليم** — counter minus hand count, the owner's model, and NATIVE in
  «الإنتاج» since the 27-Aug restructure. `resolveScrap()` in **lib/scrap.ts** (pure,
  zero imports, 11 tests) reads it off the run's own row: «هالك» if filled, else
  سستم − سليم, else nothing. A row where سليم exceeds سستم («الفعلي أكبر من العداد»,
  56 rows) is REFUSED, never clamped to a flattering 0.
  ⚠ **`source: "none"` means UNKNOWN, not "no scrap".** 63 of the 400 August rows are
  «لم يُعد بعد» or counter-mismatched; they contribute good units to Quality's
  denominator with zero scrap, which OVERSTATES it. `readiness.scrapUnknown` counts them
  and `rowCheck` rides along on every run so a UI can say which rows are unconfirmed.
  Do not "fix" this by inventing a number — the sheet does not know it yet either.

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

## «تسجيل الإنتاج» was removed from the workbook — 2026-08-27

The hourly log is gone, deliberately, and the site no longer has an hourly surface.

**How that was established**, because "the read returned nothing" is exactly what a
throttled bridge looks like: the bridge answered `no_tab` for the name and for fifteen
plausible renames and alef/hamza/whitespace variants; the workbook contains **zero**
`#REF!` cells, which is not what deleting a tab that formulas point at leaves behind;
«الإنتاج» had already gained the numbers the hourly log used to carry; and the owner
confirmed it.

What went with it: `app/dashboard/hourly/page.tsx`, `app/api/hourly/route.ts`,
`lib/hourly.ts`, `lib/hour-shape.ts`, `tests/hour-shape.test.ts`, `ENTITIES.hourly`, the
`hourly` NAV key and its i18n blocks, and the `hourly` entity from the assistant's
`read_records` tool. **Recover from git if it ever comes back** — the last commit holding
it all is the one before this note.

What it means for the numbers:

- **Scrap is no longer a join.** `deriveScrap()` — the day+machine distribution with the
  credit-first fix landed the same morning — had nothing left to distribute FROM. It is
  replaced by `resolveScrap()`, which reads the run's own row. Measured on the live August
  rows: quality 87.93% → **87.42%**, because 11 rows whose «هالك» is blank but whose
  سستم is filled now contribute 9,258 pieces of scrap that nothing was counting.
- **`lib/jobs.ts` gained scrap it never had.** It read «هالك» raw and was the only one of
  the three run paths that never saw derived scrap, so a job's total could sit below the
  same runs' total on /performance. All three now call the same function.
- **The "two numbers per shift" question is closed by the sheet, not by us.** The write
  path was blocked on "a row holds one shift or two and one filled cell cannot say which".
  There is no row and no cell any more; «الإنتاج» carries a shift per row and always did.

## The sheet read path — fixed 2026-08-12, and easy to undo by accident

**Symptom reported:** "the app loads for too long and it is fetching nothing."
Measured against production while the bridge itself answered every tab in ~2.5s:

| | before | cold now | warm now |
|---|---|---|---|
| `/api/runs` | **71s → `[]`** (the tab has 455 rows) | 3.2s ✓ | 0.83s |
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
  because it was busy usually answers a moment later. ⚠ **Skipped entirely when
  every candidate name came back `no_tab`** (2026-08-27) — that answer is
  definitive, and re-asking cost 5.5s of sleeps plus five wasted bridge calls on
  every uncached read for as long as «تسجيل الإنتاج» stayed in `ENTITIES`.
  A refused tab is also recorded in `missingTabs()` and surfaces in the
  Performance page's readiness panel, so "the tab is gone" can no longer read as
  "the tab is empty".
- **Empty results are never cached** — pinning a transient failure for 45s would
  be a worse version of the original bug.
- **Writes and pre-write validation read `fresh`**, bypassing the cache
  entirely. `commitDraft()` exists to re-derive row numbers from the sheet as it
  is *right now*; a 45-second-old copy would defeat confirm-before-write.
- **`fresh` on the read path** — writes and pre-write validation bypass the
  cache entirely, because `commitDraft()` exists to re-derive row numbers from
  the sheet as it is *right now*. Tag invalidation is the optimisation; this
  flag is the guarantee — `updateTag` (the read-your-own-writes primitive) is
  Server-Actions-only and unavailable in a Route Handler, and `revalidateTag`'s
  `profile: "max"` means stale-while-revalidate, which is exactly wrong straight
  after a write.

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
   the paper import (since removed). It could not have: that import wrote hour columns and
   «الفعلي», which carry no validation at all, and on a new row its date/machine/product
   came from the very sources the dropdowns point at. The reachable case is `updateRecord()` pushing an
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

**Easy to use, and every line opens — 2026-09-02, owner's words.** The two verbs a
storekeeper has — إيداع and سحب — are the two big buttons; the other three actions became
icons. The four stat tiles FILTER (tap «بدون مكان» → the 67 unfiled lines; tap «بالسالب»
→ the negatives). The filter selects fold behind a «فلاتر» button on a phone. The item
dropdown (469 products) has a type-to-narrow box above it — the `<select>` stays strict,
because `validate_` only checks the name is non-empty and a typo would open a new stock
line. The room map remembers open/closed in localStorage. And **every line of the balance
opens** (`components/dashboard/storage-item.tsx`): its movements, each editable; deposit
here / withdraw from here / **move to another place**; the same item standing elsewhere;
and two honesty checks — the movements summed against the sheet's figure, and a negative
line paired with the pile it was almost certainly meant to draw from. A move is two bridge
writes (سحب then إيداع — the sheet has no "move"); withdraw goes first because it is the
one the sheet can refuse, and if the deposit then fails the modal shows exactly what landed
with an undo, rather than retrying blind over an at-least-once bridge.

**Three logic faults found while checking it against the live bridge, all fixed:**

- **Editing a movement from the site re-dated it to TODAY.** The sheet renders dates as
  «9/2/2026 13:56:27» (its locale is `en_US`, set by `setupAll`) or as the ISO text the site
  writes; the edit form handed that raw cell to `<input type=date>`, which blanked it, and
  `webUpdate_` stamps `new Date()` on a blank. `storageDate()` (lib/storage-filter.ts, two
  patterns, no guessing — NOT `normalizeDate()`, whose padding heuristic is for the main
  workbook's two conventions) now feeds the form, the tables and the history; an
  unreadable cell (ITQ0167 holds «A17» where its date should be) is left empty and the save
  asks for a date instead of inventing one.
- **«المتوفر» in the form disagreed with what the bridge checks.** The bridge's
  `available_()` re-sums the LOGS on four exact strings; it never reads «الرصيد الحالي».
  The form summed the balance tab. Those differ whenever a balance row's formula has been
  typed over — and two had been (below). `avail`, the drawer's enable/disable and the
  move's ceiling now all come from `sumNet(historyFor(...))`, the same arithmetic.
- **Blank location on a withdrawal meant the wrong thing for the deployed bridge.** v3's
  exact match means «the line filed without a place»; v4's auto-allocation means «every
  place». The form now says whichever the bridge in front of it does (`blankLocMeansAll`
  = the v4 probe), and the hint under the field changes with it.

**Live shape on 2026-09-02** (the 30-Aug numbers below are superseded): 117 balance
lines, 162 deposits, 58 withdrawals, entries from that same day — the storekeeper is
using it. **67 of 117 lines have no location.** Two lines are negative: «كوبوليمر» (اتقان,
no place, −195 — while A12 holds 720 of the same; a withdrawal filed without the place) and
«غطاء احمر بروبلين 58» (اشرف عوض, −5,100). **That second one is the sheet lying, not the
stock:** its «الكمية المضافة» cell renders as an EMPTY STRING on a line with five deposits
totalling 72,600, and a live SUMIFS never renders blank (zero shows as «0» on every other
row) — the formula in F on that row, and F on the «غطاء أحمر جديد» row above it (shows
1,500 against one 500 deposit), were overwritten by hand. The bridge, which sums the logs,
still holds 67,500 for it. Owner item 8 in `../CLAUDE.md`. On the remaining 115 lines the
movements sum to the sheet's figure exactly, and all 220 movements belong to a line
(checked through the bridge, script in the 2026-09-02 session).

**Finding things — 2026-08-30.** `/dashboard/storage` had one text box matching four
fields, in a room that is 55 slots deep. The two questions a storekeeper actually asks —
«what is standing in A12» and «where is this item» — were both unanswerable on the page.
Now: `lib/storage-filter.ts` (pure, import-free, 15 tests) holds the search + location
rules; the page filters by location / item type / stock level and sorts, on every tab; a
collapsible **map of the room** groups the slots by line (A/B/C, floor zones, named
places) with a count on each and filters on one tap; and the movement form PICKS its
location from «أماكن التخزين» instead of taking free text, listing where the chosen item
is standing right now so a withdrawal starts from the pile that exists.

Three things in there are worth knowing before touching it:

- ⚠ **The filter folds case; the sheet's balance key does not.** `a12` and `A12` are two
  balance lines in «الرصيد الحالي» and always were (open item 4 in
  `../storage/CLAUDE.md`), so picking A12 shows both — one physical slot, one answer.
  Each row still prints its own spelling, and `locKey()` is **never** used to write.
- **Search is Arabic-folded and multi-term.** alef family, ى/ي, ة/ه, tatweel, harakat and
  Arabic-Indic digits all fold, and terms are ANDed, so «A12 نايلون» narrows. Without the
  folding the box silently misses «إسطمبة» when you typed «اسطمبه».
- ⚠ **THE DEPLOYED BRIDGE IS STILL v3 — measured 2026-08-30**, not inferred: it answers
  `lists.locations` empty and log rows **14 columns wide** (v4 pads every row to 15).
  `storage-setup-v4.gs` / `v4-1.gs` were written on 19 Aug and never installed. So both v4
  features are LATENT, and the page PROBES for each rather than assuming:
  - **`supportsForClient`** (`lib/storage.ts`) = the log row's width ≥ 15. The «صرف لصالح»
    column and the form field render only when it is true — offering the field against a
    v3 bridge would take a beneficiary that the sheet then drops in silence.
  - **`strictLocations`** = `lists.locations.length > 0`. Only «أماكن التخزين» knows the
    slots that are currently EMPTY, and those are exactly the ones a deposit goes into:
    the room has ~55 and 21 hold anything. With the list, the form is a strict `<select>`
    like the sheet's own dropdown; without it, a datalist that SUGGESTS the codes in use
    but still accepts a new one — a strict list built from observed data alone would make
    filing stock into a fresh slot impossible. Both self-upgrade on the next read once
    v4.1 is deployed; no code change.
  `collectLocations()` likewise unions the sheet's list with every location the data
  mentions, so the FILTER works on either bridge.
- **`webUpdate_` rewrites the whole row from the request** (v4+), so once the sheet is
  upgraded, an edit that does not send «صرف لصالح» blanks it. The site round-trips the
  value now, which closes that before it can happen rather than after. A سحب with no
  location likewise reports the bridge's own `message`/`nums` when v4 spreads it over
  several places, instead of naming one of the rows it wrote — also inert until upgrade.

**Live shape, read through the bridge on 2026-08-30** — the module is no longer
"commercially empty", so the 9-Aug note claiming zero withdrawals is out of date:
97 balance lines, 123 deposits, **46 withdrawals**, 21 locations in use, 0 negative
balances; lists carry 436 products / 41 materials / 59 clients. `a12` and `A12` are BOTH
live and hold different things — two materials for اتقان at `A12`, a product for
الكترو فود at `a12` — which is exactly why the filter folds them together and the write
path does not.


- The storage sheet «مخزن اتقان» (`1jmPjBFMCcoZmaVeLUD_wLCRtat3RCQ2c7c_UVtsW4gw`) is NOT the
  DB sheet. Its bound script is `../storage/scripts/storage-setup-v4-1.gs` (v3 is history):
  builds the whole sheet (form + إيداع/سحب logs + الرصيد الحالي + «كتالوج الخامات»
  + «أماكن التخزين») AND serves its own web bridge
  (`doGet` = balance/logs/lists in one call; `doPost` = save/update/delete/refresh, reusing
  the sheet form's validate_/compute_/nextNumber_/available_ so website saves behave exactly
  like sheet saves — incl. the insufficient-balance block on withdrawals). Same redeploy
  gotcha as apps-script.gs. `POST {action:'refresh'}` re-syncs the dropdown lists remotely.
- Env: `STORAGE_APPS_SCRIPT_URL` + `STORAGE_APPS_SCRIPT_SECRET` (= `WEB_TOKEN` in the .gs).
- Website: `lib/storage.ts` + `lib/storage-filter.ts` → `/api/storage` (GET guarded since
  2026-08-28 — the balance names clients and their stocks; POST verifies the Firebase ID token
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

## The paper-photo import — REMOVED 2026-08-19

Photograph the paper sheet → Gemini reads it → editable preview → write to
«تسجيل الإنتاج». Built 2026-08-10, never wired to a page the crew used, removed at the
owner's word: *"it wont be used in this maybe somthing else latter."*

Deleted: `lib/sheet-import.ts`, `lib/sheet-vision.ts`, `lib/hourly-import.ts`,
`app/api/hourly/import/**`, `components/dashboard/paper-import.tsx`,
`tests/sheet-import.test.ts`, the button on `/dashboard/hourly` and the `hourly.import`
i18n blocks. **The full implementation is in git at `2a43c4e`** — recover it from there
rather than rewriting, if it ever comes back for something else.

Two things deliberately survived it, because they were never really part of it:

- **`sumCavities` → `lib/cavities.ts`** (zero imports, 4 tests). Master's H column holds
  `8`, `4+4`, `2 وش&2 كفر`, `1 طقم`; a two-part mould fires both parts per shot and reading
  only the first number halves the count. `lib/jobs.ts` uses it for kg→pieces.
  ⚠ **`lib/oee-data.ts` does NOT** — it uses a plain `num(m.cavities)`, which reads `4+4` as
  4. Those two disagree on multi-part moulds today. Not fixed here because it moves OEE
  numbers and this pass was required to move none.
- **`updateRecordsInTab()`** in `lib/sheets.ts` — now called by nothing; see the note on it.

`docs/QUESTIONS-SHEET-OWNER.md` is left in place. It is written in Egyptian Arabic for
whoever types the sheet and its first question — does the paper count SHOTS and the sheet
PIECES, ×cavities? — is still unanswered and still matters to «الرئيسي» H and the sheet's
own «المتوقع». It is a domain question that outlived the feature.

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
  - ⚠ The cookie is written from `stored`, **never from the effective `lang`**. The rule
    predates 2026-08-28 (when /dashboard/downtime forced Arabic and writing the effective
    value would have converted a manager's own preference); ARABIC_ONLY is empty now, but
    keep the rule — it is what makes re-adding a forced route safe.
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
  `inquiries`, `ai-review`) **and the client-data reads (`jobs` list + detail, `storage` —
  guarded 2026-08-28: job rows name the client and ordered quantity, storage names clients
  and their stocks)**, verifies the Firebase ID token via `lib/api-guard.ts`
  `requireRole(req[, allowed])` (owner/manager always pass; any approved role by default).
  Client side, those calls go through `lib/authed-fetch.ts`. A NEW mutating route/caller must
  follow the same pair. Operational reads (sheet molds/products/machines/runs/oee/issues
  list) stay open deliberately — **that list is exhaustive: a read not on it is either
  guarded or it is a leak**, which is exactly how jobs and storage sat open for weeks.
  `/api/public/showcase` returns the three counts ONLY — it served 30 real product names
  and the full client list until 2026-08-28, after the landing page itself had stopped
  showing names (90ab433). The Firestore-era `/api/clients*`, `/api/molds*` and
  `/api/molds-register` routes are deleted (2026-08-28, zero callers; `/api/molds` served
  leftover test data unauthenticated).
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
