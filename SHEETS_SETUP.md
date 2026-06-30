# Connecting the Molds Register to Google Sheets

The dashboard **Molds Register** page reads your molds straight from a Google
Sheet (read-only). Your team keeps editing the sheet; the website displays it
with category filters and an expandable details panel. The website never writes
back — it only reads.

Until this is configured the page shows a "not connected yet" notice, so it's
safe to ship without it.

## 1. The sheet

Put the per-mold rows on a tab (the default name the app looks for is
**`All Molds`** — set `GOOGLE_SHEETS_MOLDS_TAB` if yours is named differently).

Each row is one mold. A header row names the columns. The reader matches columns
by keyword, so bilingual headers like `كود الاسطمبة / Mold Code` work, and column
order doesn't matter. It looks for these (English keyword shown):

| Field | Header keyword | Shown in |
| --- | --- | --- |
| Mold Code | `Code` | list |
| Mold Name | `Mold Name` / `Name` | list |
| Category | `Category` | list + filter |
| Client | `Client` | list |
| Cavities | `Cav` | details |
| Cycle time (s) | `Cycle` | details |
| Material | `Material` | details |
| Machine | `Machine` | details |
| Product weight | `Prod` | details |
| Runner weight | `Runner` | details |
| Scrap rate | `Scrap` | details |
| Output / shift | `Out/Shift` | details |
| Operator | `Operator` | details |
| Op. graph | `Graph` | details |
| Likely defects | `Defect` | details |

Cells that read `N/A` / `غير متاح` / `-` are treated as empty and hidden.

## 2. Make it readable

In the sheet: **Share → General access → "Anyone with the link" → Viewer.**
(Read-only is all the website needs.)

## 3. Create an API key

In the **same Google account** (e.g. Google Cloud Console):

1. Create or pick a project.
2. **APIs & Services → Library →** enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Recommended: **Restrict key** → API restrictions → allow only **Google Sheets API**.

## 4. Fill `.env.local`

From the sheet's URL — `.../spreadsheets/d/<THIS_IS_THE_ID>/edit` — copy the id:

```
GOOGLE_SHEETS_ID=<the id from the URL>
GOOGLE_SHEETS_API_KEY=<the API key>
GOOGLE_SHEETS_MOLDS_TAB=All Molds
```

Then restart `npm run dev` (env changes need a restart) and open
**/dashboard → Molds**. Your molds appear, filterable by category, each row
expanding to show cavities, cycle time, material, machine, defects, and the rest.

> Reads are cached for ~1 minute, so edits in the sheet show up within a minute
> rather than instantly.

## Editing molds from the website (write-back) — optional

The API key above is **read-only**. To let people edit molds in the dashboard
and have changes saved back to the sheet, add a **service account** with edit
access. Until you do, the edit form opens read-only with a note.

1. **Create the service account** — Google Cloud Console → *IAM & Admin →
   Service Accounts → Create service account*. Give it a name, click Done.
2. **Make a key** — open the service account → *Keys → Add key → Create new key
   → JSON*. A `.json` file downloads. Open it; you'll use two values:
   `client_email` and `private_key`.
3. **Share the sheet with it** — in the molds sheet, **Share** → paste the
   service account's `client_email` → set it to **Editor** → send.
4. **Add to `.env.local`:**

   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

   Paste the `private_key` exactly as it appears in the JSON (one line, with the
   `\n` sequences kept). Keep the surrounding quotes.
5. Restart `npm run dev`. Now the Edit form saves changes straight to the sheet
   (it writes only the cells you changed, on the matching row).

> The service-account key is a real secret — `.env.local` is git-ignored, so it
> won't be committed. Never paste it anywhere public.
