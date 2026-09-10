import { NextRequest, NextResponse } from "next/server";
import { spreadsheetTitleWith } from "@/lib/google-sheets-api";

/**
 * Step 2 of connecting the site to the workbook through the Sheets API: Google
 * sends the owner back here with a code; it is exchanged for a refresh token,
 * the token is tried against the workbook once (its title is shown as proof),
 * and the token is displayed to the person who consented — ONCE, in this
 * browser, to be pasted into Vercel as GOOGLE_OAUTH_REFRESH_TOKEN. Nothing is
 * stored here: Vercel's environment is the secret store, like the bridge
 * token today.
 *
 * Open on purpose: the only thing it can reveal is the caller's own token,
 * and only with a code Google issued to this site's client for this browser
 * (the `state` cookie set by /api/google/connect must match).
 */
const page = (title: string, bodyHtml: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#111}code,textarea{font-family:ui-monospace,monospace}textarea{width:100%;height:7rem;font-size:13px;direction:ltr}.ok{color:#047857}.bad{color:#b91c1c}ol{padding-inline-start:1.4rem}</style></head><body>${bodyHtml}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return page("غير مهيأ", `<p class="bad">GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET غير موجودين في البيئة.</p>`, 503);
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return page("رُفض", `<p class="bad">Google أجاب: <code>${esc(q.get("error") ?? "")}</code></p><p><a href="/api/google/connect">حاول مرة أخرى</a></p>`, 400);
  const code = q.get("code") ?? "", state = q.get("state") ?? "";
  const expected = req.cookies.get("itqan.oauth.state")?.value ?? "";
  if (!code || !state || state !== expected) {
    return page("جلسة غير صالحة", `<p class="bad">هذه الصفحة تُفتح فقط عبر <a href="/api/google/connect">/api/google/connect</a> من نفس المتصفح.</p>`, 400);
  }
  const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
  const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  const json = (await tok.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!tok.ok || !json.refresh_token || !json.access_token) {
    const why = json.refresh_token ? "" : "لم يصل refresh_token — غالبًا لأن الموافقة سبق منحها بدون prompt=consent؛ افتح /api/google/connect مرة أخرى.";
    return page("فشل التبادل", `<p class="bad">${esc(json.error ?? `HTTP ${tok.status}`)} ${esc(json.error_description ?? "")}</p><p>${why}</p>`, 400);
  }
  // Whose token, and does it reach THIS workbook?
  let email = "";
  try {
    const payload = JSON.parse(Buffer.from((json.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    email = payload.email ?? "";
  } catch { /* no id_token — the email is only a courtesy */ }
  let title = "", reach = "";
  try {
    title = await spreadsheetTitleWith(json.access_token);
    reach = `<p class="ok">✓ الرمز يصل إلى الجدول: <b>${esc(title)}</b></p>`;
  } catch (e) {
    reach = `<p class="bad">✗ الرمز لا يصل إلى الجدول (${esc(e instanceof Error ? e.message : "error")}). هل سجّلت الدخول بالحساب الذي يملك الجدول؟</p>`;
  }
  const res = page(
    "تم الربط",
    `<h1>تم منح الإذن</h1>
<p>الحساب: <b>${esc(email || "غير معروف")}</b></p>${reach}
<p>انسخ الرمز التالي وأضفه في Vercel → Project → Settings → Environment Variables باسم <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> (Production)، ثم Redeploy. يُعرض مرة واحدة فقط ولا يُحفظ في الموقع.</p>
<textarea readonly onclick="this.select()">${esc(json.refresh_token)}</textarea>
<ol><li>Vercel → itqan → Settings → Environment Variables → Add: <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> = الرمز أعلاه.</li><li>Deployments → آخر نشر → ⋯ → Redeploy.</li><li>افتح <code>/api/health</code>: يجب أن يظهر <code>"transport":"api"</code>.</li></ol>
<p style="color:#555;font-size:13px">To revoke later: myaccount.google.com → Security → Third-party access → remove the ITQAN app; the site then falls back to the Apps Script bridge and /api/health says so.</p>`,
  );
  res.cookies.set("itqan.oauth.state", "", { maxAge: 0, path: "/api/google" });
  return res;
}
