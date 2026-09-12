import { after } from "next/server";

/**
 * Hold a background promise open past the response.
 *
 * The shared-copy writes (lib/sheets.ts, lib/storage.ts) are fire-and-forget:
 * nothing awaits them, and on a serverless function the instance can be frozen
 * the moment the response is sent, so the write would simply never land.
 * `after()` asks the platform to keep it running — and is a no-op outside a
 * request scope, which is why the call is wrapped: a script or a test importing
 * these modules must not throw here.
 *
 * The two byte-identical copies became this module in cleanup batch 7. Neither
 * importer is loaded by node --test, so a shared module is safe (unlike the
 * digit and Arabic-folding rules, which must stay duplicated).
 */
export function keepAlive(p: Promise<unknown>): void {
  const quiet = p.then(() => undefined, () => undefined);
  try { after(quiet); } catch { /* outside a request scope — nothing to hold open */ }
}
