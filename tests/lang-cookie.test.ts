/**
 * The language cookie. Run with `npm test`.
 *
 * This exists because localStorage was not enough: the server cannot read it,
 * so it rendered English text on every request and the browser corrected it
 * after hydrating. Verified against production on 2026-08-17 — the served HTML
 * had 14 English words and 0 Arabic no matter what the visitor had chosen.
 * The cookie is what lets the first byte be right.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANG_COOKIE, LANG_COOKIE_MAX_AGE, langCookieString, isLangValue,
  langFromValue,
} from "../lib/lang-cookie.ts";

test("THE SERVER'S SHAPE: cookies().get() hands back a bare value, not a pair", () => {
  // The bug this test exists for: the root layout passed a whole `Cookie:`
  // header — "itqan.lang=ar" — where a bare value belongs. langFromValue
  // returns null for it, and the entire site rendered in English while every
  // other test stayed green. This pins the shape the server must hand over.
  assert.equal(langFromValue("ar"), "ar");
  assert.equal(langFromValue("en"), "en");
  assert.equal(langFromValue("itqan.lang=ar"), null, "a header is NOT a bare value");
  // A hand-edited or corrupted cookie must fall back, not put the page into a
  // language that does not exist.
  for (const v of ["", "fr", "AR", "ar,en", " ar", null, undefined]) {
    assert.equal(langFromValue(v), null, `${v} should not resolve`);
  }
});

test("the cookie it writes is the cookie it reads", () => {
  // The round trip is the whole contract — a mismatch here means the server
  // silently ignores every choice, which is the bug this replaced.
  for (const l of ["ar", "en"] as const) {
    const s = langCookieString(l);
    assert.equal(langFromValue(s.split(";")[0].split("=")[1]), l);
  }
});

test("the cookie outlives the session and survives a normal navigation", () => {
  const s = langCookieString("ar");
  assert.ok(s.includes(`${LANG_COOKIE}=ar`));
  assert.ok(s.includes("path=/"), "must apply to the dashboard as well as the home page");
  assert.ok(s.includes(`max-age=${LANG_COOKIE_MAX_AGE}`), "a preference, not a session");
  assert.ok(/SameSite=Lax/i.test(s), "must survive a top-level navigation into the site");
  assert.ok(!/Secure/i.test(s), "no Secure flag — the dev server is plain http");
  assert.ok(LANG_COOKIE_MAX_AGE >= 60 * 60 * 24 * 365);
});

test("isLangValue guards the two known languages and nothing else", () => {
  assert.equal(isLangValue("ar"), true);
  assert.equal(isLangValue("en"), true);
  for (const v of ["", "fr", "AR", null, undefined, 0, {}]) assert.equal(isLangValue(v), false);
});
