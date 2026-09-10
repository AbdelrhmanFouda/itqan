import { NextRequest, NextResponse } from "next/server";

/**
 * Step 1 of connecting the site to the workbook through the Google Sheets
 * API (2026-09-10, replacing the Apps Script bridge as the transport): send
 * the OWNER to Google's consent screen for THIS site's OAuth client, asking
 * for the spreadsheets scope only, offline (a refresh token). Step 2 is
 * /api/google/callback, which shows the token to the person who consented.
 *
 * Open on purpose: it holds no data and only redirects to Google with the
 * public client id. A random `state` in an httpOnly cookie ties the callback
 * to this browser.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "not_configured", hint: "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the environment first." }, { status: 503 });
  }
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "https://www.googleapis.com/auth/spreadsheets openid email");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // always mint a refresh token, even on a re-consent
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  const res = NextResponse.redirect(u.toString(), 302);
  res.cookies.set("itqan.oauth.state", state, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 600, path: "/api/google" });
  return res;
}
