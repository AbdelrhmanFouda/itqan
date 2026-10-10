/**
 * «اسأل Claude» — where the threads, photos and heartbeat live: Firestore.
 *
 * Three collections, all OPEN in firestore.rules like the other collections
 * the server writes (it has no admin identity): `askThreads`, `askPhotos`,
 * `askMeta`. What is in them is ciphertext — lib/ask-crypto.ts says why that
 * is the privacy, and what an outsider can still do.
 *
 * Both queries are single-field (`uid ==`, `status in`), so no composite
 * index — the rule lib/db.ts is built around. Every call is bounded: a
 * Firestore that does not answer costs this feature a 503, never a hung
 * request (the rule the 2026-09-09 outage left).
 */
import {
  collection, doc, getDoc, getDocs, query, runTransaction, setDoc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AskStatus } from "@/lib/ask";
import { memoryStore, type AskStore, type PhotoRec, type ThreadRec } from "@/lib/ask-core";

const COL = { threads: "askThreads", photos: "askPhotos", meta: "askMeta" } as const;
const TIMEOUT_MS = 8000;

function bounded<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ask_store_timeout:${what}`)), TIMEOUT_MS);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const asRec = (id: string, d: Record<string, unknown>): ThreadRec => ({
  id,
  uid: String(d.uid ?? ""),
  status: String(d.status ?? "") as AskStatus,
  updatedAt: Number(d.updatedAt) || 0,
  blob: String(d.blob ?? ""),
});
const plain = (r: ThreadRec) => ({ uid: r.uid, status: r.status, updatedAt: r.updatedAt, blob: r.blob });

const firestoreStore: AskStore = {
  async getThread(id) {
    const snap = await bounded(getDoc(doc(db, COL.threads, id)), "getThread");
    return snap.exists() ? asRec(snap.id, snap.data()) : null;
  },
  async putThread(rec) {
    await bounded(setDoc(doc(db, COL.threads, rec.id), plain(rec)), "putThread");
  },
  async mutateThread(id, fn) {
    const ref = doc(db, COL.threads, id);
    return bounded(
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const next = fn(snap.exists() ? asRec(snap.id, snap.data()) : null);
        if (next) tx.set(ref, plain(next));
        return next;
      }),
      "mutateThread",
    );
  },
  async listByUid(uid) {
    const snap = await bounded(getDocs(query(collection(db, COL.threads), where("uid", "==", uid))), "listByUid");
    return snap.docs.map((d) => asRec(d.id, d.data()));
  },
  async listByStatus(statuses) {
    const snap = await bounded(getDocs(query(collection(db, COL.threads), where("status", "in", statuses))), "listByStatus");
    return snap.docs.map((d) => asRec(d.id, d.data()));
  },
  async putPhoto(id, rec) {
    await bounded(setDoc(doc(db, COL.photos, id), rec), "putPhoto");
  },
  async getPhoto(id) {
    const snap = await bounded(getDoc(doc(db, COL.photos, id)), "getPhoto");
    if (!snap.exists()) return null;
    const d = snap.data();
    return { threadId: String(d.threadId ?? ""), blob: String(d.blob ?? ""), createdAt: Number(d.createdAt) || 0 } satisfies PhotoRec;
  },
  async getBeat() {
    const snap = await bounded(getDoc(doc(db, COL.meta, "heartbeat")), "getBeat");
    return snap.exists() ? String(snap.data().blob ?? "") : null;
  },
  async setBeat(blob) {
    await bounded(setDoc(doc(db, COL.meta, "heartbeat"), { blob }), "setBeat");
  },
};

/**
 * The store in use. `ASK_STORE=memory` keeps everything in this process — for
 * running the flow on localhost before the Firestore rules are published.
 * Never in production: a serverless instance forgets, and two instances
 * would not share a claim.
 */
export function askStore(): AskStore {
  if (process.env.ASK_STORE === "memory" && process.env.NODE_ENV !== "production") {
    const g = globalThis as unknown as { __askMemoryStore?: AskStore };
    return (g.__askMemoryStore ??= memoryStore());
  }
  return firestoreStore;
}
