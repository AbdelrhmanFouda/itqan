/**
 * «اسأل Claude» — what makes an OPEN Firestore collection private.
 *
 * The server reaches Firestore through the unauthenticated client SDK (org
 * policy blocks service-account keys), so the collections it writes are
 * `allow read, write: if true` and anyone holding the public web config can
 * read and write them. A question, a photo of a mould and an answer a
 * technician will act on cannot sit there in the clear.
 *
 * So nothing is stored in the clear: every thread, photo and heartbeat is
 * AES-256-GCM under a key only the server holds (ASK_DATA_KEY). An outsider
 * reads ciphertext, and a document he writes himself fails authentication and
 * is ignored — he cannot forge an answer. The document id is bound in as
 * additional data, so one document's blob cannot be pasted into another.
 * What he CAN still do is delete or overwrite documents (they then read as
 * missing); that is the same exposure `downtimeEvents` has today.
 *
 * Links handed to the listener (a photo, a recording) are HMAC-signed with a
 * second key derived from the same secret and expire after ten minutes.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { LINK_TTL_S, MIN_SECRET_CHARS } from "@/lib/ask";

type Env = Record<string, string | undefined>;

function derive(env: Env, label: string): Buffer | null {
  const base = (env.ASK_DATA_KEY ?? "").trim();
  if (base.length < MIN_SECRET_CHARS) return null;
  return createHmac("sha256", base).update(label).digest();
}

/** Both secrets present and long enough — otherwise the feature is off. */
export function askConfigured(env: Env = process.env): boolean {
  return derive(env, "x") !== null && (env.ASK_LISTENER_TOKEN ?? "").trim().length >= MIN_SECRET_CHARS;
}

const dataKey = (env: Env) => derive(env, "itqan-ask-data-v1");
const linkKey = (env: Env) => derive(env, "itqan-ask-link-v1");

/** Encrypt bytes for the document `aad` names. Output: iv(12) | tag(16) | ciphertext. */
export function sealBytes(plain: Uint8Array, aad: string, env: Env = process.env): Buffer {
  const key = dataKey(env);
  if (!key) throw new Error("ask_not_configured");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

/** The bytes back, or null for anything this server did not write for `aad`. */
export function openBytes(sealed: Uint8Array, aad: string, env: Env = process.env): Buffer | null {
  const key = dataKey(env);
  if (!key || sealed.byteLength < 29) return null;
  try {
    const buf = Buffer.from(sealed);
    const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}

export function sealJson(value: unknown, aad: string, env: Env = process.env): string {
  return sealBytes(Buffer.from(JSON.stringify(value), "utf8"), aad, env).toString("base64");
}

export function openJson<T>(blob: unknown, aad: string, env: Env = process.env): T | null {
  if (typeof blob !== "string" || !blob) return null;
  const plain = openBytes(Buffer.from(blob, "base64"), aad, env);
  if (!plain) return null;
  try {
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/* ---------------------------------- links -------------------------------- */

export type LinkClaims = { k: "photo" | "audio"; id: string; th: string; exp: number };

/** A signed, expiring reference to one photo or one recording. */
export function signLink(c: Omit<LinkClaims, "exp">, now: number = Date.now(), env: Env = process.env): string {
  const key = linkKey(env);
  if (!key) throw new Error("ask_not_configured");
  const body = Buffer.from(JSON.stringify({ ...c, exp: Math.floor(now / 1000) + LINK_TTL_S }), "utf8").toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/** The claims inside a link when it is ours and unexpired. */
export function openLink(token: string | null | undefined, now: number = Date.now(), env: Env = process.env): LinkClaims | null {
  const key = linkKey(env);
  const parts = String(token ?? "").split(".");
  if (!key || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = createHmac("sha256", key).update(parts[0]).digest();
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LinkClaims;
    if ((c.k !== "photo" && c.k !== "audio") || typeof c.id !== "string" || typeof c.exp !== "number") return null;
    if (c.exp < Math.floor(now / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}

/** A fresh document or message id: 20 hex characters. */
export const newId = (): string => randomBytes(10).toString("hex");
