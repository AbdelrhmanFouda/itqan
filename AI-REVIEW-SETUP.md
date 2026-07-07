# AI Review — setup (5 minutes)

The Performance page (`/dashboard/performance`) now has an **AI Review** card: a
bilingual daily analysis of your production data — what the OEE really means,
which Master standards are wrong, which machine to fix first, what to log next.

It is generated **once per day** (Cairo time) per period and cached in
Firestore (`aiReviews` collection), so the cost is one tiny API call a day.
The "Regenerate" button forces a fresh one (e.g. after you fix data).

Without any key it still works — you get the built-in rules analysis. With a
key you get an AI-written review.

## Option A (recommended, free): Google Gemini

1. Go to https://aistudio.google.com/apikey (any Google account).
2. Create an API key (free tier is enough — we use `gemini-2.5-flash-lite`,
   the cheapest model; one call a day is far inside the free quota).
3. Put it in `website/.env.local`:
   ```
   GEMINI_API_KEY=AIza...your-key...
   ```
4. Restart `npm run dev`.

## Option B (paid): Anthropic Claude

1. Get a key from https://console.anthropic.com (needs billing).
2. In `website/.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Model used: `claude-haiku-4-5` (cheapest Claude).

If both keys are set, Gemini wins; force one with
`AI_REVIEW_PROVIDER=anthropic` (or `gemini`). Override the model with
`AI_REVIEW_MODEL=`.

## Required once: publish the updated Firestore rules

`firestore.rules` gained an `aiReviews` entry (the daily cache). Publish it:

1. Firebase console → project **itqan-5f802** → Firestore Database → Rules.
2. Paste the contents of `website/firestore.rules` → **Publish**.

(Skipping this doesn't break the review — it just regenerates on every page
load instead of once a day, which costs more API calls.)

## Vercel (the live site)

Add the same key in Vercel → Project **itqan** → Settings → Environment
Variables (`GEMINI_API_KEY` = your key), then redeploy.

## How "daily" works

The first person to open the Performance page each day triggers generation;
everyone else that day gets the cached review instantly. The card shows the
generation timestamp. No cron needed.
