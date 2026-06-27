# Itqan

Bilingual (English / Arabic) marketing site and internal dashboard for **Itqan**,
an Egyptian contract manufacturer (plastic injection molding, fan counterweights,
and in-house CNC mold manufacturing).

Built with **Next.js 16 (App Router)**, **Tailwind CSS v4**, **Framer Motion**,
and **Firebase Firestore** for dynamic data.

## Features

- **Marketing site** — hero, services, about, team, **previous work with photos**,
  **"Companies We Worked With"**, equipment, and a contact form. Full RTL/Arabic support.
- **Dashboard** (`/dashboard`) — manage machines (status + notes), monthly reports,
  and clients, with add/delete actions. Contact form submissions are saved to Firestore.

## Quick start

```bash
npm install
cp .env.example .env.local   # then add your Firebase keys
npm run seed                 # populate Firestore with sample data
npm run dev
```

Open <http://localhost:3000>.

👉 **First time?** Follow [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md) to create the
Firebase project and get the config keys (takes a few minutes).

## Data

All dynamic data lives in Firestore. The data-access layer is in
[`lib/db.ts`](./lib/db.ts) and the client config in [`lib/firebase.ts`](./lib/firebase.ts).
Sample data (machines, notes, reports, inquiries, clients) is seeded by
[`scripts/seed.mjs`](./scripts/seed.mjs).

Images: product photos in `public/products/`, client logos in `public/clients/` —
swap in real assets using the same filenames anytime.

## Deploy

Deploy on Vercel and set the `NEXT_PUBLIC_FIREBASE_*` environment variables in the
project settings. See the end of [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md).
