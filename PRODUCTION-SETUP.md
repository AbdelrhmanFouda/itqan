# Phase 1 — Production data capture (Sheet-only)

This is the setup needed for the new daily production logging. The code is done;
these are the three things **you** do in your Google account, then a quick test.

Decisions locked in: **Sheet-only** data model · **two 12-hour shifts (720 min each)**
· **supervisor logs once a day**. One row per machine **per shift** is recommended
(so two rows for a machine that ran both shifts) — that keeps per-shift OEE possible.

---

## 1. Add a `Production` tab to the combined sheet

Create a new tab named exactly **`Production`**. Put these headers in row 1, left to
right. Bilingual headers match the house style, but English-only also works — the app
matches columns by keyword, and **column order can change later** without breaking.

| Col | Header (Arabic / English) | Example value | Notes |
|----|----|----|----|
| A | التاريخ / Date | 2026-06-29 | YYYY-MM-DD |
| B | الوردية / Shift | Day | `Day` or `Night` (stored in English) |
| C | الماكينة / Machine | M-03 | must match a name in the `Machines` tab |
| D | كود الاسطمبة / Mold Code | 50 | the mold's ID/code from Master |
| E | الزمن المخطط / Planned Min | 720 | shift length in minutes (OEE denominator) |
| F | إنتاج سليم / Good Units | 1440 | good parts |
| G | هالك / Scrap Units | 60 | defaults to 0 |
| H | زمن التوقف / Downtime Min | 60 | defaults to 0 |
| I | سبب التوقف / Downtime Reason | Mold change | required when downtime > 0 |
| J | العامل / Operator | Ahmed | optional |
| K | ملاحظات / Notes | | optional |

> Keep **Downtime Min (H)** before **Downtime Reason (I)** — that ordering is what lets
> the app tell the two "downtime" columns apart.

## 2. Add a `Machines` reference tab

Create a tab named exactly **`Machines`** with these headers, then one row per machine:

| Header (Arabic / English) | Example | Notes |
|----|----|----|
| الماكينة / Machine | M-03 | machine name — used in the run dropdown |
| طول الوردية / Shift Length | 720 | minutes; auto-fills Planned Min when the machine is picked |
| نشط / Active | Yes | optional |

List every injection machine on the floor. The machine **name** here is what links a run
to a machine, so keep names consistent between this tab and the `Production` tab.

## 3. Redeploy the Apps Script (one time)

The script now supports **appending** and **deleting** rows (logging/removing runs), not
just cell edits. Update it:

1. Open the combined sheet → **Extensions → Apps Script**.
2. Select all, delete, and paste the full contents of **`website/apps-script.gs`** (already updated in the repo).
3. **Deploy → Manage deployments →** edit your existing Web app → **Version: New version → Deploy**.
   (Re-using the same deployment keeps your existing URL, so `.env.local` needs no change.)
4. If prompted, re-authorize.

No `.env.local` change is needed if you reuse the same deployment.

---

## 4. Master cleanup (the one real data task)

OEE's **Performance** factor needs each active mold's **standard cycle time** and
**cavities**. In Master today these are mostly `N/A`. For molds you actually run, fill in:

- **زمن الدورة / Cycle** — ideal cycle time in **seconds**.
- **عدد الكافيتي / Cavities** — parts produced per cycle.

You don't need all 434 rows — just the molds that are currently in production. Anything
left blank simply won't get a Performance/OEE number until it's filled.

---

## 5. Test checklist

1. Open the dashboard → **Production**. Click **Log Production**.
2. The **Machine** and **Mold** dropdowns should now be populated from the sheet.
3. Save a run → it should appear in the table and as a new row in the `Production` tab.
4. Delete it → the row should disappear from both.
5. Repeat on the **Quality** page (it shares the same run data).

Once runs are landing reliably for a couple of weeks, we build **Phase 2**: the OEE
dashboard (Availability × Performance × Quality), downtime Pareto, and scrap trends —
all computed from this `Production` tab plus Master's cycle/cavities.
