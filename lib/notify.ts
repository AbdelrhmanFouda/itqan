/**
 * The factory's one notification inbox.
 *
 * There is exactly ONE mail path in this site and it addresses the owner: the
 * enquiry form has used it since 2026-09-15, and the customer portal now uses
 * it for a new order request. Nothing here ever writes an outside address into
 * `to` — mailing a customer needs a verified sending domain for etqaneg.com in
 * Resend first, and until that exists the shared fallback sender lands in
 * spam. See the proposal §3.7.
 *
 * Extracted from app/api/contact on 2026-09-23 rather than copied: a second
 * copy of an eight-line fetch is how the two drift, and the next change (a
 * second recipient, a different provider, a retry) would then have to be made
 * twice and would be made once.
 *
 * Every call is BOUNDED and SWALLOWS its own failure. A notification is never
 * allowed to fail the thing it is reporting: the enquiry is already stored and
 * the request row is already in the sheet by the time this runs.
 */

const TIMEOUT_MS = 8000;

/** Escape the two characters that could break out of the HTML body. */
export const esc = (v: string): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One «<b>label:</b> value» paragraph, or nothing at all when the value is empty. */
export const line = (label: string, value: string): string =>
  value ? `<p><b>${esc(label)}:</b> ${esc(value)}</p>` : "";

/** Is a notification even possible? Both env vars must be set. */
export function notifyConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && recipients().length > 0;
}

function recipients(): string[] {
  return (process.env.INQUIRY_NOTIFY_TO ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Send one notification to the owner's inbox. Returns whether it left; never
 * throws, and logs with `tag` so a failure can be traced to its caller.
 */
export async function notify(subject: string, html: string, tag = "notify"): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = recipients();
  if (!key || !to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.INQUIRY_NOTIFY_FROM || "ITQAN <onboarding@resend.dev>",
        to,
        subject,
        html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[${tag}] notify failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[${tag}] notify failed:`, err);
    return false;
  }
}
