# Firebase setup

This project uses **Firebase Firestore** for all dynamic data:

| Collection         | Used by                                  |
| ------------------ | ---------------------------------------- |
| `machines`         | Dashboard → Machines                     |
| `machineNotes`     | Dashboard → Machine detail               |
| `monthlyReports`   | Dashboard → Reports                      |
| `contactInquiries` | Public contact form submissions          |
| `clients`          | Public "Companies We Worked With" + dashboard → Clients |

Follow these steps once to get live data.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it (e.g. `itqan`), accept defaults, and create it.

## 2. Create a Firestore database

1. In the project, open **Build → Firestore Database → Create database**.
2. Choose a location (e.g. `eur3` / closest region).
3. Start in **production mode** — we'll apply our own rules next.

## 3. Apply security rules

Open **Firestore → Rules**, paste the contents of [`firestore.rules`](./firestore.rules), and **Publish**.

> These are open dev rules so everything works out of the box. Before launch,
> restrict writes to authenticated admins and keep only `clients` publicly
> readable (notes in the rules file).

## 4. Register a Web app and copy the config

1. **Project settings (gear icon) → General → Your apps → Web (`</>`)**.
2. Register the app (no Hosting needed).
3. Copy the `firebaseConfig` values.

## 5. Add your config locally

```bash
cp .env.example .env.local
```

Fill `.env.local` with the values from step 4:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=itqan-xxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=itqan-xxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=itqan-xxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc123
```

## 6. Install, seed, and run

```bash
npm install
npm run seed     # fills Firestore with 19 machines, notes, 5 reports, inquiries, 6 clients
npm run dev
```

Open <http://localhost:3000>. The homepage shows the generated product photos and
the **Companies We Worked With** section; the dashboard (`/dashboard`) shows the
seeded machines, reports, and clients.

> `npm run seed` **clears** the seeded collections first, then inserts fresh
> sample data — safe to re-run, but don't run it against real production data.

## Notes on images

Product photos live in `public/products/` and client logos in `public/clients/`.
The repo ships with clean placeholder assets so the site looks complete out of the box.

### Generate real AI images (optional)

Replace the placeholders with AI-generated photos/logos using Google Gemini:

```bash
# get a free key at https://aistudio.google.com/apikey, then:
GOOGLE_AI_API_KEY=AIza...yourkey npm run images          # macOS / Linux
# Windows PowerShell:
$env:GOOGLE_AI_API_KEY="AIza...yourkey"; npm run images
```

This overwrites the 6 product images and 6 client logos in place (same filenames),
so they appear automatically — no code changes needed. The key is read from the
environment only and is never written to a file. Free keys are rate-limited, so the
script paces itself. Override the model with `MODEL=gemini-3.1-flash-image-preview`.

You can also drop in your own real photos/logos using the same filenames, or manage
images through Firebase Storage by storing the download URL in the `logo` / `image` field.

## Deploying to Vercel

Add the same `NEXT_PUBLIC_FIREBASE_*` variables under **Vercel → Project →
Settings → Environment Variables**, then deploy. No database server to manage.
