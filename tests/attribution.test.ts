/**
 * Enquiry attribution (lib/attribution.ts). Run with `npm test`.
 * The vocabulary is fixed and reports group on it — these pin both the words
 * and the derivation rules the ads campaign depends on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAttribution, isSource, SOURCES } from "../lib/attribution.ts";

test("the vocabulary is exactly the five words, lowercase", () => {
  assert.deepEqual([...SOURCES], ["facebook", "google", "whatsapp", "referral", "direct"]);
  assert.equal(isSource("google"), true);
  assert.equal(isSource("Google"), false);
  assert.equal(isSource("utm_source=google"), false);
});

test("gclid or utm_source=google → google", () => {
  assert.equal(deriveAttribution("?gclid=test", "/").source, "google");
  assert.equal(deriveAttribution("?utm_source=Google&utm_campaign=pmax", "/").source, "google");
  const a = deriveAttribution("?gclid=abc&utm_campaign=pmax", "/");
  assert.equal(a.gclid, "abc");
  assert.equal(a.utm_campaign, "pmax");
  assert.equal(a.landing_path, "/?gclid=abc&utm_campaign=pmax");
});

test("fbclid or utm_source=facebook → facebook", () => {
  assert.equal(deriveAttribution("?fbclid=x", "/").source, "facebook");
  assert.equal(deriveAttribution("?utm_source=facebook", "/").source, "facebook");
});

test("anything else → direct, raw utm_source still kept", () => {
  assert.equal(deriveAttribution("", "/").source, "direct");
  const a = deriveAttribution("?utm_source=newsletter", "/");
  assert.equal(a.source, "direct");
  assert.equal(a.utm_source, "newsletter");
});
