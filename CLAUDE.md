@AGENTS.md

# ITQAN — bilingual manufacturing site + Google-Sheet-backed factory system

Next.js 16 (App Router) + Tailwind v4 + Framer Motion. Public marketing site plus a
role-gated `/dashboard` for an Egyptian plastic-injection factory. **The database is a
Google Sheet** (the crew edits it; the site reads/writes through an Apps Script bridge).
Firebase is used ONLY for auth/roles and small caches (aiReviews, users) — not for
production data. Everything is bilingual AR/EN with RTL support.

## Commands

```bash
npm run dev          # localhost:3000 (Turbopack)
npm run build        # production build — ALSO the type gate; Vercel runs this on push
npx tsc --noEmit     # quick typecheck
npm run seed         # (legacy Firestore seed — rarely needed now)
```

Deploy = push to `main` → Vercel auto-deploys (project `itqan`, domain itqan-taupe.vercel.app).
Secrets live in `.env.local` (gitignored) and must be mirrored to Vercel env vars.

## Architecture (data flow)

```
Google Sheet «قاعدة بيانات اتقان - مترابطة»  ←→  Apps Script web app (apps-script.gs)
        id: 1Oi5ZedXaMWUwLVbh01-rH6X3xCuCA94yrdMmw3wBBE0        │ token-gated doGet/doPost
                                                                 ▼
                                    lib/sheets.ts  (generic ENTITIES reader/writer)
                                                                 ▼
                    app/api/* (sheet/[entity], runs, machines, oee, ai-review)
                                                                 ▼
                    /dashboard pages (client components, 20s auto-refresh)
```

- `lib/sheets.ts` — config-driven: `ENTITIES` maps each tab to fields matched by
  **header keywords** (headers are bilingual "ar\nen"). Appends are ordered to match the
  tab's real headers, so column reordering in the sheet doesn't break writes.
- Molds/Products tabs are **formula views of Master** — never write to them; writes route
  to the Master row by ID (`MASTER_VIEWS` logic). Clients is a manual tab (write in place).
- `lib/oee.ts` (pure) + `lib/oee-data.ts` (fetch+shape, shared by `/api/oee` and
  `/api/ai-review`) — OEE = Availability × Performance × Quality with per-run capping.
- Auth: Firebase (email/Google) → role request → owner approves at `/dashboard/approvals`.
  Roles/nav in `lib/roles.ts`; owner email hardcoded there and in `firestore.rules`.

## The sheet model — read this before touching data code

Tabs were renamed to ARABIC on 2026-07-15 (`renameTabsToArabic()` in apps-script.gs).
`lib/sheets.ts` `TAB_ALIASES` keeps the old English names as fallbacks — keep that map
when adding entities.

| Tab (old name) | Role |
|---|---|
| `الرئيسي` (Master) | Source of truth, header row 2, data rows 3+. Cols A–P incl. I cycle(s), J worst-cycle, H cavities (DESIGN count — see below) |
| `الاسطمبات` (Molds), `المنتجات` (Products) | Row-aligned formula views of Master — READ ONLY |
| `الماكينات` (machines) | Registry: one row per physical machine. **Code label «PQ n — ton» (hidden col J) is the machine's identity everywhere** — production col C, board headers, OEE grouping. Codes are frozen; renaming requires relabeling history. |
| `الإنتاج` (production) | One row per machine/shift: A date, B shift, C machine LABEL, D mold, E product (must match Master name EXACTLY — joins are by name), H good, I scrap, J downtime, K reason, N **open cavities** |
| `الإنتاج بالساعة` | Hourly board: 93 day-blocks × 31 rows (products row + 24h + 6 stat rows), 2 lanes/machine. **Hourly cells are machine SHOTS, not pieces.** |
| `الأعطال` | Issues log (date, machine, **product**, category, description, action, status, notes). الماكينة/المنتج have dropdowns linked to machines!J / Master!C — layout applied by `setupIssuesTab()` in apps-script.gs (re-run it to repair) |
| `العملاء` (Clients), `أوامر العمل` (jobs), `لوحة البيانات` (Dashboard) | Manual contacts / deferred jobs / counters |

Domain semantics (owner-confirmed 2026-07-14):
- **Shots vs pieces:** crew records machine shot-counts hourly; final good is counted/weighed
  pieces. `scrap = shots × open_cavities − good`.
- **Open cavities:** molds run with damaged cavities blocked; the count varies per run.
  Master keeps the DESIGN cavity count; each production row records what was open (col N).
  OEE uses `openCavities || Master cavities` for the ideal rate.
- **«غير متاح / N/A»** is the deliberate filler for unknown cells — never "clean" it;
  all parsing treats it as blank.
- **Dates** arrive in any shape ("14/07 /2026", Arabic digits, serials) — always go through
  `normalizeDate()` in `lib/dates.ts`; never parse dates ad hoc.
- Reports from the floor identify machines unreliably by code — resolve by PRODUCT NAME
  through the registry when validating.

## The bridge (apps-script.gs)

- Bound to the sheet, deployed as web app (Execute as owner / access Anyone), token-gated.
- Actions: `doGet(tab)` → displayValues; `doPost` → `updates[{row,col,value}]` (setValue —
  a "=..." string becomes a live formula), `append`, `deleteRow`. **It cannot create tabs,
  set data-validation, or format** — those need a .gs run or manual action in the sheet.
- ⚠️ **Editing apps-script.gs is NOT live until Deploy → Manage deployments → New version.**
  Editor "Run" works without redeploy; the web app serves the last deployed snapshot.

## Conventions

- i18n: `lib/i18n*.ts` — `en` and `ar` objects MUST keep the same shape. UI strings never
  hardcoded. `dir={isAr ? "rtl" : "ltr"}` on containers.
- Charts are hand-built SVG in `components/dashboard/charts.tsx` — no chart libraries.
- Mobile: base Tailwind classes are the phone layout; desktop is preserved under `md:`/`sm:`
  overrides. Tables get an `sm:hidden`/`md:hidden` card-list twin instead of shrinking.
- Sheet writes send only CHANGED fields (diff vs original) — never clobber untouched cells.
- Keep the GitHub repo PRIVATE — apps-script.gs carries the sheet write token.

## Gotchas

- Vercel build runs the typecheck — a bad type fails the deploy.
- Turbopack can serve a stale compile error after export refactors — request the route URL
  to force recompile; corrupted `.next` → delete `.next` + `tsconfig.tsbuildinfo`.
- Apps Script drops onEdit events fired <2s apart; under load `/exec` returns HTML error
  pages — retry with text-parse.
- Zombie dev servers holding port 3000 corrupt `.next`.

---

## NEXT MILESTONE — in-app AI agent (sheet edits + reports, per-user daily limits)

Goal: a chat assistant inside `/dashboard` where staff paste crew reports (WhatsApp text or
free text) or ask questions; the agent reads the sheet, VALIDATES, and proposes writes —
a human confirms before anything is written. It also generates on-demand reports.

Design decisions (agreed with the owner — his priority is simplicity and catching mistakes):

1. **Route** `app/api/agent/route.ts`: Anthropic Messages API tool-use loop
   (`ANTHROPIC_API_KEY` already scaffolded in env; default model `claude-haiku-4-5`,
   escalate to Sonnet via env `AI_AGENT_MODEL`). Reuse the provider pattern from
   `lib/ai-review.ts`.
2. **Tools** (server-side implementations wrap existing code — do NOT reinvent):
   - `read_records(entity, filter?)` → `getRecords()` from lib/sheets.ts
   - `get_oee(month?)` → `buildOEEData()` from lib/oee-data.ts
   - `propose_production_rows(rows[])` → returns a PREVIEW; never writes directly
   - `append_production(rows[])` / `update_cell(...)` → ONLY callable after the client
     sends the user's explicit confirmation of the previewed rows
   - `log_issue(issue)` → append to «الأعطال»
   Validation rules the agent must apply before proposing: product exists in Master,
   machine label exists in registry (resolve by product name if codes conflict),
   `shots × openCavities − good ≥ 0`, duplicate (date+shift+machine) detection.
3. **Confirm-before-write UX**: agent returns `{preview: rows[]}`; UI renders a table with
   Confirm/Cancel; only on Confirm does the client call the write. No silent writes, ever.
4. **Per-user daily message limit** (owner requirement):
   - Client sends the Firebase ID token with each request.
   - Verify the JWT server-side WITHOUT firebase-admin (org policy blocks service-account
     keys): check RS256 signature against Google's public certs
     (`googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`),
     `aud` = itqan-5f802, `iss` = `https://securetoken.google.com/itqan-5f802`, `exp`.
   - Count usage in Firestore: doc `usage/{uid}` `{date: "YYYY-MM-DD", count}` — reset when
     date differs, reject with a friendly bilingual message when count ≥ limit.
   - Limits by role from `lib/roles.ts` (env-overridable): owner/manager unlimited,
     others default `AI_AGENT_DAILY_LIMIT` (start: 20). Add `usage` rules to
     firestore.rules (user can read own; writes via the verified API only — enforce by
     requiring the API's uid to match).
5. **UI** `app/dashboard/assistant/page.tsx`: chat page, role-gated (start: OPS + full
   access), bilingual, mobile-first (crew phones). Show remaining messages for the day.
6. **Reports**: "تقرير اليوم/الأسبوع" tool → compose from `buildOEEData` + production rows;
   render in chat with a copy button; reuse the daily-cached review in `aiReviews` where
   possible to save tokens.

Cost guardrails: Haiku by default, cap tool-loop iterations (~8), truncate tool results
(the sheet has 800-row ranges — always slice), cache read_records per request.
