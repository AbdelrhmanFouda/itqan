@AGENTS.md

# ITQAN — bilingual manufacturing site + Google-Sheet-backed factory system

Next.js 16 (App Router) + Tailwind v4 + Framer Motion. Public marketing site plus a
role-gated `/dashboard` for an Egyptian plastic-injection factory. **The database is a
Google Sheet** (the crew edits it; the site reads/writes through an Apps Script bridge).
Firebase is used ONLY for auth/roles and small caches (users, usage, aiReviews) — not for
production data. Everything is bilingual AR/EN with RTL support.

> Business context, live data state, open items and the sheet's history live in
> **`../ITQAN-CONTEXT.md`**. Read that for *what is true right now*; read this file for
> *how the code works*. Last synced 2026-08-09.

## Commands

```bash
npm run dev          # localhost:3000 (Turbopack)
npm run build        # production build — ALSO the type gate; Vercel runs this on push
npx tsc --noEmit     # quick typecheck
npm run seed         # (legacy Firestore seed — rarely needed now)
```

Deploy = push to `main` → Vercel auto-deploys (project `itqan`, domain itqan-taupe.vercel.app).
Secrets live in `.env.local` (gitignored) and are mirrored to Vercel env vars.

## ⚠️ Uncommitted work in the tree (as of 2026-08-09)

`HEAD == origin/main == b42c388`, but **36 files are modified/new and not pushed**:

- the **API auth hardening** (`lib/api-guard.ts`, `lib/authed-fetch.ts`, `app/robots.ts`
  and ~31 route/page files) — so the LIVE site still accepts unauthenticated writes;
- the **jobs kg→pieces fix** (`lib/jobs.ts`, both jobs pages, `lib/i18n.prod.ts`) — so the
  live jobs page compares pieces produced against kilograms ordered.

Before starting new work, check `git status`. Pushing this is the highest-value action
available. The owner runs git himself in PowerShell.

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
  to the Master row by ID (`MASTER_VIEWS` logic). Clients is a manual tab (write in place).
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

## The sheet model — read this before touching data code

| Tab | Role |
|---|---|
| `الرئيسي` (Master) | Source of truth, header row 2, data rows 3+. Cols A–P incl. F weight, H cavities (DESIGN count), I cycle(s), J worst cycle |
| `الاسطمبات` (Molds), `المنتجات` (Products) | Row-aligned formula views of Master — READ ONLY |
| `الماكينات` (machines) | Registry, one row per physical machine. **The code label «PQ n — ton» (hidden col J) is the machine's identity everywhere** — production col C, OEE grouping, issue dropdowns. Tonnages repeat, so the code is the key. The registry has been renumbered four times: never hardcode it, always re-read. |
| `الإنتاج` (production) | One row per machine/day: A date, B shift, C machine LABEL, D mold, E product (must match Master name EXACTLY — joins are by name), H good, I scrap, J downtime, K reason |
| `تسجيل الإنتاج` | **The hourly log — the only hourly surface.** Header row 4; 24 hour columns 08:00→07:00 holding PIECES; AB سستم (=SUM), AC فعلي (hand count), AE متوقع, الكفاءة %, AF الهالك, AG حالة السجل, AH hidden scrap denominator |
| `تقرير الإنتاج` | Per-product rollup (UNIQUE spill in A + ARRAYFORMULAs). Owner-built, maintained by `../production-report-v3.gs` |
| `أوامر العمل` (jobs) | Manual cols A:N + computed O:X linking to Master by product name |
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
  `normalizeDate()` in `lib/dates.ts`; never parse dates ad hoc. Known suspicion: ambiguous
  `d/m` vs `m/d` ties resolve month-first, which can flip days 1–12 into the wrong month —
  `/api/runs` reports a latest date of 2026-12-07 with no December data. Worth verifying.
- **Known bug, not yet fixed:** «تسجيل الإنتاج» labels its first two hour columns `8:00` and
  `9:00` without a leading zero; `ENTITIES.hourly` matches the literal `08:00`/`09:00`, so
  both columns are dropped. Fix = zero-pad bare `H:MM` headers before matching in
  `lib/sheets.ts`. Totals are unaffected (read from the sheet's own column).
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
