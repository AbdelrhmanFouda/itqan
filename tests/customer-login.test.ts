/**
 * The owner-made customer login — lib/customer-login.ts.
 *
 * The owner types a USERNAME and a password on «حسابات العملاء»; the server
 * turns the username into an address on a reserved domain, creates the
 * account, and writes the link to «العملاء» over the Firestore REST API. Every
 * rule that decides what is accepted, what is sent and what is shown is pure
 * and lives in one module, so it is all pinned here — including the one that
 * matters most: the link the server WRITES is read back by the guard as the
 * very same link.
 *
 * Nothing here signs anybody up. No test in this repo sends a sign-up.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_LOGIN_DOMAIN, MIN_PASSWORD, ADVISED_PASSWORD, MAX_ALIASES, MAX_ALIAS_LENGTH,
  PASSWORD_ALPHABET, LINK_MASK,
  normalizeUsername, isValidUsername, usernameIssue, loginEmailFor, usernameOf,
  passwordAdvice, generatePassword, sanitizeAliases,
  clientsToFirestore, approvalFields, firebaseErrorToken, signUpRefusal,
} from "../lib/customer-login.ts";
import { restValue, restFields } from "../lib/firestore-rest.ts";
import {
  normalizeClients, clientKeysOf, belongsToCustomer, customerStatusOf, isLinkedCustomer, clientNoOf,
  type ClientLink,
} from "../lib/customer-link.ts";

/* -------------------------------- username -------------------------------- */

test("the login domain is the reserved one — nobody can receive mail at it", () => {
  assert.equal(CUSTOMER_LOGIN_DOMAIN, "example.com");
});

test("a username is trimmed, lower-cased, and its Arabic digits become Latin", () => {
  assert.equal(normalizeUsername("  SampleCo  "), "sampleco");
  assert.equal(normalizeUsername("client٢٠٢٦"), "client2026");
  assert.equal(normalizeUsername("client۲۰۲۶"), "client2026", "Persian digits too");
  assert.equal(normalizeUsername(""), "");
  assert.equal(normalizeUsername(null), "");
  assert.equal(normalizeUsername(undefined), "");
});

test("a valid username: 3–30 of a–z 0–9 . _ -, starting with a letter or a digit", () => {
  for (const ok of ["abc", "sampleco", "sample.co", "sample_co", "sample-co", "7up", "a1b", "x".repeat(30)]) {
    assert.equal(isValidUsername(ok), true, ok);
  }
  for (const bad of [
    "", "ab", "x".repeat(31),
    ".abc", "_abc", "-abc",          // must start with a letter or a digit
    "sample..co", "sampleco.",     // not a legal local part of an address
    "Al", "SAMPLECO",               // not normalised — the caller lower-cases first
    "sample co", "sample@co", "sample/co", "تجريبي", "abc٢",
  ]) {
    assert.equal(isValidUsername(bad), false, JSON.stringify(bad));
  }
  assert.equal(isValidUsername(null), false);
  assert.equal(isValidUsername(undefined), false);
  // What the owner types becomes valid once normalised.
  assert.equal(isValidUsername(normalizeUsername(" SampleCo٢ ")), true);
});

test("the live line says what is wrong — and is silent exactly when the name is valid", () => {
  assert.equal(usernameIssue(""), "empty");
  assert.equal(usernameIssue("sample co"), "chars");
  assert.equal(usernameIssue("تجريبي"), "chars");
  assert.equal(usernameIssue("Al"), "chars", "an upper-case letter is not in the set");
  assert.equal(usernameIssue(".abc"), "start");
  assert.equal(usernameIssue("ab"), "short");
  assert.equal(usernameIssue("x".repeat(31)), "long");
  assert.equal(usernameIssue("a..b"), "dots");
  assert.equal(usernameIssue("abc."), "dots");
  assert.equal(usernameIssue("sampleco"), "ok");
  // The two readings of "valid" can never part company.
  for (const u of [
    "", "a", "ab", "abc", "a.b", "a..b", "abc.", ".abc", "-ab", "_ab", "ab_", "ab-", "a b", "A",
    "x".repeat(30), "x".repeat(31), "sample-co_2026", "٢٢٢", "a@b", "0", "000",
  ]) {
    assert.equal(usernameIssue(u) === "ok", isValidUsername(u), JSON.stringify(u));
  }
});

test("the sign-in box: a username becomes its address, an address is left as typed", () => {
  assert.equal(loginEmailFor("sampleco"), "sampleco@example.com");
  assert.equal(loginEmailFor("  SampleCo "), "sampleco@example.com");
  assert.equal(loginEmailFor("client٢٠٢٦"), "client2026@example.com", "Arabic digits typed on a phone");
  // With an `@` it is an address: trimmed, and otherwise exactly what was typed.
  assert.equal(loginEmailFor(" Buyer@Company.COM "), "Buyer@Company.COM");
  assert.equal(loginEmailFor("sampleco@example.com"), "sampleco@example.com");
  for (const blank of ["", "   ", null, undefined]) assert.equal(loginEmailFor(blank), "");
});

test("the username behind an address — only on the login domain", () => {
  assert.equal(usernameOf("sampleco@example.com"), "sampleco");
  assert.equal(usernameOf("SampleCo@EXAMPLE.com"), "sampleco", "the domain is compared without case");
  assert.equal(usernameOf(" sampleco@example.com "), "sampleco");
  // A foreign domain is a real address, never a username.
  for (const foreign of [
    "buyer@gmail.com", "buyer@example.org", "buyer@sub.example.com", "buyer@notexample.com",
    "example.com", "@example.com", "", null, undefined,
  ]) {
    assert.equal(usernameOf(foreign), "", JSON.stringify(foreign));
  }
  // The two are inverses for every valid username.
  for (const u of ["abc", "sample.co", "sample_co-2026", "7up"]) assert.equal(usernameOf(loginEmailFor(u)), u);
});

/* -------------------------------- password -------------------------------- */

test("password advice is advice: three kinds, and it never depends on the minimum", () => {
  assert.equal(MIN_PASSWORD, 6);
  assert.equal(ADVISED_PASSWORD, 10);
  assert.equal(passwordAdvice("abcdefghij"), "ok");
  assert.equal(passwordAdvice("abcdefghi"), "short", "nine characters");
  assert.equal(passwordAdvice("abc123"), "short");
  assert.equal(passwordAdvice(""), "short");
  assert.equal(passwordAdvice(null), "short");
  // All digits is said at ANY length — a phone number is long and still guessable.
  assert.equal(passwordAdvice("123456"), "digitsOnly");
  assert.equal(passwordAdvice("01234567890"), "digitsOnly");
  assert.equal(passwordAdvice("٠١٢٣٤٥٦٧٨٩٠"), "digitsOnly", "Arabic digits are digits");
  assert.equal(passwordAdvice("0123456789a"), "ok");
});

test("a generated password is three groups of four from an alphabet with no look-alikes", () => {
  // No 0/O/o and no 1/l/I/i — it is read off one phone and typed on another.
  for (const ch of "0Oo1lIi") assert.equal(PASSWORD_ALPHABET.includes(ch), false, `«${ch}» is a look-alike`);
  assert.equal(new Set(PASSWORD_ALPHABET).size, PASSWORD_ALPHABET.length, "no character twice");
  assert.ok(/^[a-zA-Z0-9]+$/.test(PASSWORD_ALPHABET), "nothing a phone keyboard hides");

  // An injected source makes it deterministic: a counter walks the alphabet.
  let i = 0;
  const counter = (n: number) => i++ % n;
  const pw = generatePassword(counter);
  assert.equal(pw, `${PASSWORD_ALPHABET.slice(0, 4)}-${PASSWORD_ALPHABET.slice(4, 8)}-${PASSWORD_ALPHABET.slice(8, 12)}`);
  assert.equal(i, 12, "exactly twelve draws");
  assert.ok(/^[^-]{4}-[^-]{4}-[^-]{4}$/.test(pw));
  assert.equal(pw.replace(/-/g, "").length, 12);
  assert.equal(passwordAdvice(pw), "ok");
  assert.ok(pw.length >= MIN_PASSWORD);

  // The source is asked for an index INTO THE ALPHABET, every time.
  const asked: number[] = [];
  generatePassword((n) => { asked.push(n); return n - 1; });
  assert.deepEqual([...new Set(asked)], [PASSWORD_ALPHABET.length]);
  assert.equal(generatePassword((n) => n - 1).replace(/-/g, ""), PASSWORD_ALPHABET.at(-1)!.repeat(12));

  // A broken source is a bug, not a shorter password.
  for (const bad of [() => -1, (n: number) => n, () => 0.5, () => NaN]) {
    assert.throws(() => generatePassword(bad), /bad_random_source/);
  }
});

/* --------------------------------- aliases -------------------------------- */

test("aliases are cleaned, never repaired: over the limits is a refusal", () => {
  assert.deepEqual(sanitizeAliases(undefined), []);
  assert.deepEqual(sanitizeAliases(null), []);
  assert.deepEqual(sanitizeAliases([]), []);
  assert.deepEqual(sanitizeAliases([" شركة تجريبية ", "شركة تجريبية", "", "   ", "تجريبية"]), ["شركة تجريبية", "تجريبية"]);
  assert.equal(MAX_ALIASES, 10);
  assert.equal(MAX_ALIAS_LENGTH, 120);
  const ten = Array.from({ length: 10 }, (_, k) => `كتابة ${k}`);
  assert.deepEqual(sanitizeAliases(ten), ten);
  assert.equal(sanitizeAliases([...ten, "الحادية عشرة"]), null, "an eleventh is refused, not dropped");
  assert.deepEqual(sanitizeAliases([...ten, ten[0]]), ten, "a repeat is not an eleventh");
  assert.deepEqual(sanitizeAliases(["x".repeat(120)]), ["x".repeat(120)]);
  // An alias is an access KEY: cutting one short would make a different key.
  assert.equal(sanitizeAliases(["x".repeat(121)]), null);
  for (const junk of ["تجريبية", 7, {}, [7], [null], [{ name: "x" }], [["x"]]]) {
    assert.equal(sanitizeAliases(junk), null, JSON.stringify(junk));
  }
});

/* ------------------- the link the server writes is the link read ---------- */

/** Read a REST value back exactly the way `lookupCustomer` does. */
const readBack = (value: unknown) => normalizeClients(restValue(value));

test("clientsToFirestore round-trips through the guard's own decoder", () => {
  const links: ClientLink[] = [
    { no: 7, name: "شركة تجريبية للتجارة", aliases: ["تجريبية", "Sample Trading Co"] },
    { no: 0, name: "عميل بدون رقم", aliases: [] },
    { no: 65, name: "Sample Client 12", aliases: ["عميل تجريبي ١٢"] },
  ];
  assert.deepEqual(readBack(clientsToFirestore(links)), links);
  assert.deepEqual(readBack(clientsToFirestore([])), []);
  for (const one of links) assert.deepEqual(readBack(clientsToFirestore([one])), [one]);
  // …and the keys an account answers to are the same on both sides.
  assert.deepEqual(
    [...clientKeysOf(readBack(clientsToFirestore(links)))].sort(),
    [...clientKeysOf(links)].sort(),
  );
  assert.ok(belongsToCustomer("تجريبية", clientKeysOf(readBack(clientsToFirestore([links[0]])))));
});

test("the encoded link is REST-shaped: an integer number, string names, an array of strings", () => {
  const v = clientsToFirestore([{ no: 7, name: "شركة تجريبية", aliases: ["تجريبية"] }]);
  assert.deepEqual(v, {
    arrayValue: {
      values: [{
        mapValue: {
          fields: {
            no: { integerValue: "7" },
            name: { stringValue: "شركة تجريبية" },
            aliases: { arrayValue: { values: [{ stringValue: "تجريبية" }] } },
          },
        },
      }],
    },
  });
  // A number that is not one is 0 — the same thing `normalizeClients` reads.
  const odd = clientsToFirestore([{ no: Number.NaN, name: "x", aliases: [] }]);
  assert.deepEqual(readBack(odd), [{ no: 0, name: "x", aliases: [] }]);
});

test("an approval writes exactly the four fields of the mask, and reads back approved and linked", () => {
  assert.deepEqual([...LINK_MASK], ["status", "clients", "approvedBy", "approvedAt"]);
  const link: ClientLink = { no: 7, name: "شركة تجريبية", aliases: ["تجريبية"] };
  const fields = approvalFields(link, "manager@factory.test", 1_760_000_000_000);
  assert.deepEqual(Object.keys(fields).sort(), [...LINK_MASK].sort(), "the body and the mask name the same fields");
  // Decoded the way the guard decodes a whole document.
  const doc = restFields(fields);
  assert.equal(customerStatusOf(doc.status), "approved");
  assert.deepEqual(normalizeClients(doc.clients), [link], "ONE link");
  assert.equal(doc.approvedBy, "manager@factory.test");
  assert.equal(doc.approvedAt, 1_760_000_000_000);
  assert.ok(isLinkedCustomer({ status: customerStatusOf(doc.status), clients: normalizeClients(doc.clients) }));
  // Nothing in it could carry a secret: four keys, none of them a credential.
  assert.equal(/password|token/i.test(JSON.stringify(fields)), false);
});

test("the «الرقم» cell reads as the same number on the screen and on the server", () => {
  assert.equal(clientNoOf("7"), 7);
  assert.equal(clientNoOf(" 12 "), 12);
  assert.equal(clientNoOf(12), 12);
  assert.equal(clientNoOf("No. 12"), 12);
  for (const none of ["", "   ", "غير متاح / N/A", null, undefined]) assert.equal(clientNoOf(none), 0);
});

/* --------------------------- what Firebase answers ------------------------ */

test("only an UPPER_SNAKE token is taken from a Firebase error — never its prose", () => {
  const body = (message: string, status?: string) => ({ error: { code: 400, message, status } });
  assert.equal(firebaseErrorToken(body("EMAIL_EXISTS"), 400), "EMAIL_EXISTS");
  assert.equal(
    firebaseErrorToken(body("WEAK_PASSWORD : Password should be at least 6 characters"), 400),
    "WEAK_PASSWORD",
  );
  assert.equal(
    firebaseErrorToken(body("TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled."), 400),
    "TOO_MANY_ATTEMPTS_TRY_LATER",
  );
  assert.equal(firebaseErrorToken(body("OPERATION_NOT_ALLOWED"), 400), "OPERATION_NOT_ALLOWED");
  // Prose in `message`: the token is `status`, and the prose is never returned.
  assert.equal(
    firebaseErrorToken(body("API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"), 400),
    "INVALID_ARGUMENT",
  );
  assert.equal(
    firebaseErrorToken(body("Missing or insufficient permissions.", "PERMISSION_DENIED"), 403),
    "PERMISSION_DENIED",
  );
  // Nothing usable: the HTTP status, and nothing else.
  assert.equal(firebaseErrorToken(body("something went wrong"), 500), "HTTP_500");
  for (const junk of [null, undefined, "", 7, {}, { error: null }, { error: "EMAIL_EXISTS" }, { error: { message: 7 } }]) {
    assert.equal(firebaseErrorToken(junk, 502), "HTTP_502", JSON.stringify(junk));
  }
  // Whatever comes back, the result is a short token — it is what gets logged.
  for (const m of ["EMAIL_EXISTS", "weird prose with test-pass-1 in it", "X".repeat(200), "A_B : c"]) {
    assert.ok(/^[A-Z][A-Z0-9_]{2,59}$/.test(firebaseErrorToken(body(m), 400)), m);
  }
});

test("Firebase's sign-up answers map to the route's own refusals", () => {
  assert.deepEqual(signUpRefusal("EMAIL_EXISTS"), { reason: "username_taken", status: 409 });
  assert.deepEqual(signUpRefusal("WEAK_PASSWORD"), { reason: "weak_password", status: 400 });
  assert.deepEqual(signUpRefusal("INVALID_EMAIL"), { reason: "bad_username", status: 400 });
  assert.deepEqual(signUpRefusal("TOO_MANY_ATTEMPTS_TRY_LATER"), { reason: "too_many", status: 429 });
  for (const other of ["OPERATION_NOT_ALLOWED", "ADMIN_ONLY_OPERATION", "PERMISSION_DENIED", "HTTP_500", ""]) {
    assert.deepEqual(signUpRefusal(other), { reason: "auth_failed", status: 502 }, other);
  }
});
