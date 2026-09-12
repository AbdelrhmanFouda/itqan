# Itqan

Bilingual (English / Arabic) marketing site and internal dashboard for **Itqan**, an
Egyptian contract manufacturer (plastic injection moulding, fan counterweights, in-house
CNC moulds). Next.js 16 (App Router), Tailwind CSS v4, Framer Motion.

**The Google Sheet workbook is the database.** The site reads and writes it through
[`lib/google-sheets-api.ts`](./lib/google-sheets-api.ts), with the Apps Script bridge
([`apps-script.gs`](./apps-script.gs)) as the fallback transport. **Firebase is auth and
roles only** — plus [`lib/db.ts`](./lib/db.ts) for users/usage, monthly reports, contact
inquiries and the one stoppage running right now.

```bash
npm install
cp .env.example .env.local   # Firebase keys + sheet transport secrets
npm run dev                  # localhost:3000
npm run build                # production build — also the type gate
npm test                     # unit tests
npm run smoke                # tests a running site from outside
```

Deploy = push to `main` (Vercel auto-deploys). First-time Firebase setup:
[`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md). **The working brief is
[`CLAUDE.md`](./CLAUDE.md).**
