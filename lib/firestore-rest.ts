/**
 * Firestore REST `Value` ⇄ plain JS — the decoder the customer guard reads
 * `customers/{uid}` with.
 *
 * Moved out of lib/agent-auth.ts on 2026-10-07, unchanged. That module imports
 * the Firebase SDK, so Node's test runner cannot load it — and the new
 * owner-made customer login (app/api/customers) WRITES the `clients` link over
 * REST, which the guard then READS over REST. The link is the access boundary,
 * so the two halves have to be provably the same shape:
 * tests/customer-login.test.ts encodes a link with `clientsToFirestore()`
 * (lib/customer-login.ts) and decodes it with the functions below.
 *
 * Pure and import-free.
 */

/** One Firestore REST `Value` as a plain JS value. */
export function restValue(v: unknown): unknown {
  if (!v || typeof v !== "object") return undefined;
  const f = v as Record<string, unknown>;
  if ("stringValue" in f) return String(f.stringValue ?? "");
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return Number(f.doubleValue);
  if ("booleanValue" in f) return Boolean(f.booleanValue);
  if ("nullValue" in f) return null;
  if ("timestampValue" in f) return String(f.timestampValue ?? "");
  if ("arrayValue" in f) {
    const values = (f.arrayValue as { values?: unknown[] })?.values ?? [];
    return values.map(restValue);
  }
  if ("mapValue" in f) return restFields((f.mapValue as { fields?: Record<string, unknown> })?.fields);
  return undefined;
}

/** A REST document's `fields` map as a plain object. */
export function restFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = restValue(v);
  return out;
}
