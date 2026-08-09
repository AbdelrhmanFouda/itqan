@AGENTS.md

# ITQAN — bilingual manufacturing site + Google-Sheet-backed factory system

Next.js 16 (App Router) + Tailwind v4 + Framer Motion. Public marketing site plus a
role-gated `/dashboard` for an Egyptian plastic-injection factory. **The database is a
Google Sheet** (the crew edits it; the site reads/writes through an Apps Script bridge).
Firebase holds auth/roles, small caches (users, usage, aiReviews) — and, as of phase 2,
**one collection of genuine factory data: `downtimeEvents`.** Everything is bilingual
AR/EN with RTL support.

> **That `downtimeEvents` exception is deliberate — do not "fix" it.** The old rule here
> read "Firebase is auth and roles only, not factory data", and everywhere else it still
> holds. Downtime is the exception because the owner ruled that the workbook must not gain
> tabs, columns, formulas or validation, and that `apps-script.gs` must not be edited or
> redeployed. «الإنتاج»!J «زمن التوقف» and !K «سبب التوقف» are two of the six columns that
> have never been filled once in 417 rows, so there was no existing place in the sheet to
> write downtime and no permission to make one. Firestore was the only remaining store.
> A CSV export (`/api/downtime/export`) ships with it precisely so this is reversible: if
> the owner later wants downtime in the workbook, he exports and pastes it himself.
> See "Downtime capture" below.

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
- **Downtime capture (phase 2)** — `lib/downtime.ts` (pure maths, zero imports, unit-tested)
  + `lib/downtime-data.ts` (Firestore fetch), the same split as `oee.ts`/`oee-data.ts`.
  `/dashboard/downtime` is a phone-first Arabic page: pick machine → pick reason → start →
  stop, **four taps, no typing**. That constraint is evidence-driven — the six sheet columns
  that need typing are empty across 417 rows, while the tapped hourly log has 20 unbroken
  days. `/api/downtime` (GET/POST/PATCH) and `/api/downtime/export` are ALL guarded,
  including the reads, because the rows carry `createdBy`.
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

## The sheet model — read this before touching data code

| Tab | Role |
|---|---|
| `الرئيسي` (Master) | Source of truth, header row 2, data rows 3+. Cols A–P incl. F weight, H cavities (DESIGN count), I cycle(s), J worst cycle |
| `الاسطمبات` (Molds), `المنتجات` (Products) | Row-aligned formula views of Master — READ ONLY |
| `الماكينات` (machines) | Registry, one row per physical machine. **The code label «PQ n — ton» (hidden col J) is the machine's identity everywhere** — production col C, OEE grouping, issue dropdowns. Tonnages repeat, so the code is the key. The registry has been renumbered four times: never hardcode it, always re-read. |
| `الإنتاج` (production) | One row per machine/day: A date, B shift, C machine LABEL, D mold, E product (must match Master name EXACTLY — joins are by name), H good, I scrap, J downtime, K reason |
| `تسجيل الإنتاج` | **The hourly log — the only hourly surface.** Header row 4; 24 hour columns 08:00→07:00 holding PIECES; AB سستم (=SUM), AC فعلي (hand count), AE متوقع, الكفاءة %, AF الهالك, AG حالة السجل, AH hidden scrap denominator |
| `تقرير الإنتاج` | Per-product rollup (UNIQUE spill in A + ARRAYFORMULAs). Owner-built, maintained by `../production-report-v3.gs` |
| *(no tab)* `downtimeEvents` | **Firestore, not the sheet.** Phase-2 downtime capture — see the exception note at the top. Joins to «الإنتاج» on `date` + the «الماكينات»!J machine label |
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
  returns a preview; only an explicit user confirmation triggers the write. Per-user daily
  message limits are counted in Firestore `usage/{uid}`; the Firebase ID token is verified
  server-side without firebase-admin (Google securetoken certs, `aud`/`iss` = itqan-5f802),
  because org policy blocks service-account keys.

## Conventions

- i18n: `lib/i18n*.ts` — `en` and `ar` objects MUST keep the same shape. UI strings never
  hardcoded. `dir={isAr ? "rtl" : "ltr"}` on containers.
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
  Symptom to recognise: downtime capture appears to work, the page shows no error, and
  Availability quietly stays at 100% — because `loadDowntimeTotals()` catches the failure
  and degrades to the pre-phase-2 state on purpose.
- Vercel build runs the typecheck — a bad type fails the deploy.
- Turbopack can serve a stale compile error after export refactors — request the route URL
  to force recompile; corrupted `.next` → delete `.next` + `tsconfig.tsbuildinfo`.
- Zombie dev servers holding port 3000 corrupt `.next`.
- Apps Script drops onEdit events fired <2s apart.
- When checking whether something is deployed, add a `?cb=` cachebuster — a first fetch has
  returned a stale cached response and made a fresh deploy look stale.
- New column names in a tab can hijack `appendRecord`: it maps each HEADER to the first FIELD
  whose keyword it contains. In «أوامر العمل», avoid الكمية / الحالة / المنتج / qty / status /
  product in new column names, or appends will write into an ARRAYFORMULA spill.
- ARRAYFORMULA ranges must track the data (`FILTER`+`ROW`+`MAX`, not a fixed `$D$2:$D$60`),
  or `getLastRow()` overshoots and appended rows land past the computed block.
  `INDEX/MATCH` does not vectorize under ARRAYFORMULA — use `VLOOKUP`.
