/**
 * Why a sign-in failed — lib/auth-errors.ts.
 *
 * Both doors (`/login` and `/portal/login`) read a thrown sign-in error through
 * these two functions. Until 2026-10-07 everything outside six codes was the
 * generic sentence with nothing beside it — which is what the owner met when he
 * tried to make a customer login from the portal page, and why he had nothing
 * to report.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authErrorCode, authErrorKind, authErrorDetail, type AuthErrorKind,
} from "../lib/auth-errors.ts";

test("the code is Firebase's `code`, else the Error's message, else nothing", () => {
  // A FirebaseError carries both; the code wins.
  assert.equal(
    authErrorCode({ code: "auth/too-many-requests", message: "Firebase: Error (auth/too-many-requests)." }),
    "auth/too-many-requests",
  );
  assert.equal(authErrorCode(new Error("register_failed")), "register_failed");
  assert.equal(authErrorCode(new TypeError("Failed to fetch")), "Failed to fetch");
  assert.equal(authErrorCode("auth/user-disabled"), "auth/user-disabled", "a thrown string is its own code");
  assert.equal(authErrorCode({ code: "  auth/invalid-email  " }), "auth/invalid-email");
  // A blank or non-string code falls through to the message.
  assert.equal(authErrorCode({ code: "", message: "boom" }), "boom");
  assert.equal(authErrorCode({ code: 42, message: "boom" }), "boom");
  for (const nothing of [null, undefined, 0, 7, true, {}, [], { code: 42 }, { message: 9 }]) {
    assert.equal(authErrorCode(nothing), "", JSON.stringify(nothing));
  }
});

test("every kind the contract names is reached by its codes", () => {
  const cases: [string, AuthErrorKind][] = [
    ["auth/invalid-credential", "invalid"],
    ["auth/wrong-password", "invalid"],
    ["auth/user-not-found", "invalid"],
    ["auth/email-already-in-use", "emailInUse"],
    ["auth/weak-password", "weakPassword"],
    ["auth/unauthorized-domain", "unauthorizedDomain"],
    ["auth/popup-closed-by-user", "popupClosed"],
    ["auth/cancelled-popup-request", "popupClosed"],
    ["auth/network-request-failed", "network"],
    ["auth/too-many-requests", "tooMany"],
    ["auth/invalid-email", "badEmail"],
    ["auth/missing-email", "badEmail"],
    ["auth/operation-not-allowed", "signupClosed"],
    ["auth/admin-restricted-operation", "signupClosed"],
    ["auth/user-disabled", "disabled"],
    ["register_failed", "register"],
  ];
  for (const [code, kind] of cases) assert.equal(authErrorKind(code), kind, code);
  // …and every kind except `generic` is reachable, so no sentence is dead.
  const reached = new Set(cases.map(([, k]) => k));
  for (const k of [
    "invalid", "emailInUse", "weakPassword", "unauthorizedDomain", "popupClosed", "network",
    "tooMany", "badEmail", "signupClosed", "disabled", "register",
  ] as AuthErrorKind[]) {
    assert.ok(reached.has(k), `no code reaches ${k}`);
  }
});

test("a fetch that never left is a network failure, in every browser's wording", () => {
  for (const message of [
    "Failed to fetch",                                      // Chrome
    "NetworkError when attempting to fetch resource.",      // Firefox
    "Load failed",                                          // Safari
    "fetch failed",                                         // Node
    "TypeError: Failed to fetch",
  ]) {
    assert.equal(authErrorKind(message), "network", message);
    assert.equal(authErrorKind(authErrorCode(new TypeError(message))), "network", message);
  }
  // Most TypeErrors are a bug in the page, not a dead socket.
  assert.equal(authErrorKind(authErrorCode(new TypeError("Cannot read properties of undefined"))), "generic");
  assert.equal(authErrorKind("the request failed to fetch a thing"), "generic", "the whole message, not a fragment");
});

test("anything unrecognised is generic — never a guess, never a prototype key", () => {
  for (const code of [
    "", "   ", "auth/internal-error", "auth/popup-blocked", "AUTH/WRONG-PASSWORD", "wrong-password",
    "constructor", "toString", "__proto__", "hasOwnProperty",
  ]) {
    assert.equal(authErrorKind(code), "generic", JSON.stringify(code));
  }
  assert.equal(authErrorKind(null), "generic");
  assert.equal(authErrorKind(undefined), "generic");
});

test("the line under the generic sentence is one short line", () => {
  assert.equal(authErrorDetail("auth/internal-error"), "auth/internal-error");
  assert.equal(authErrorDetail("  two\n lines\tof   text "), "two lines of text");
  assert.equal(authErrorDetail("x".repeat(500)).length, 80);
  assert.equal(authErrorDetail(null), "");
  assert.equal(authErrorDetail(""), "");
});
