# Firebase setup

Firebase is **auth and roles** for this project, plus a handful of small collections.
The factory data lives in the Google Sheet workbook, not here.

| Collection         | Used by                                                     |
| ------------------ | ----------------------------------------------------------- |
| `users`            | who may sign in, their requested vs granted role, approval   |
| `usage`            | per-user daily AI-assistant message counter                  |
| `aiReviews`        | daily AI-review cache (`/api/ai-review`)                     |
| `contactInquiries` | public contact form submissions                              |
| `monthlyReports`   | dashboard → reports                                          |
| `downtimeEvents`   | the stoppage running right now (the log itself is «التوقفات») |
| `machines`, `machineNotes` | dashboard → machine detail — pending a removal decision |

Follow these steps once.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it (e.g. `itqan`), accept defaults, and create it.

## 2. Enable sign-in

**Build → Authentication → Get started**, then enable **Email/Password** and **Google**.

## 3. Create a Firestore database

1. **Build → Firestore Database → Create database**.
2. Choose a location (the live project uses `eur3`).
3. Start in **production mode** — the rules below replace the defaults.

## 4. Apply security rules

Open **Firestore → Rules**, paste the contents of [`firestore.rules`](./firestore.rules),
and **Publish** (or `firebase deploy --only firestore:rules`).

> `users` and `usage` are genuinely protected. The operational collections are still
> `read, write: if true` because `/api` reaches Firestore through the unauthenticated
> client SDK (org policy blocks service-account keys); every route that writes them
> verifies the caller's ID token itself via `requireRole()`. Hardening = move `/api`
> to the Admin SDK, then require auth + role here. See the notes in the rules file.

## 5. Register a Web app and copy the config

1. **Project settings (gear) → General → Your apps → Web (`</>`)**.
2. Register the app (no Hosting needed).
3. Copy the `firebaseConfig` values into `.env.local` (`cp .env.example .env.local`):

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=itqan-xxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=itqan-xxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=itqan-xxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc123
```

## 6. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The sheet transport secrets in `.env.example` are what the
dashboard needs on top of these six.

## Deploying to Vercel

Add the same `NEXT_PUBLIC_FIREBASE_*` variables under **Vercel → Project → Settings →
Environment Variables**, then deploy. No database server to manage.
