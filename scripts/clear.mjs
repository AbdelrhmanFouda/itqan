/**
 * Delete ALL sample/seed data from Firestore so you can start fresh with real data.
 *
 * Wipes the operational + marketing collections. Does NOT touch `users`
 * (your sign-in accounts and roles are kept).
 *
 * Usage:
 *   npm run clear
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc } from "firebase/firestore";

// Load .env.local without any extra dependency (same approach as seed.mjs).
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env.local — fall back to process.env
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  console.error("\n  Missing Firebase config. Make sure .env.local exists.\n");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Collections to wipe. `users` is intentionally NOT included.
const COLLECTIONS = [
  "productionRuns",
  "jobs",
  "molds",
  "machineNotes",
  "machines",
  "monthlyReports",
  "contactInquiries",
  "clients",
];

async function clear(name) {
  const snap = await getDocs(collection(db, name));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  console.log(`  cleared ${snap.size} doc(s) from ${name}`);
}

async function run() {
  console.log("Deleting sample data (your user accounts are kept)...");
  for (const c of COLLECTIONS) {
    await clear(c);
  }
  console.log("\n✅ All sample data removed. The dashboard is now empty.\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
