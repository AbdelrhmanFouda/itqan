"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { cp } from "@/lib/i18n.portal";
import { clearPortalSignUp } from "@/lib/portal-signup";
import { authErrorCode, authErrorKind, authErrorDetail, type AuthErrorKind } from "@/lib/auth-errors";
import { loginEmailFor, usernameOf, normalizeUsername, isValidUsername } from "@/lib/customer-login";
import { Field, inputCls, Btn, Spinner } from "@/components/dashboard/ui";

/**
 * «بوابة العملاء» sign-in and sign-up.
 *
 * The same two methods that already work for staff — email/password and
 * Google — but NOT the staff paths: signing up here creates `customers/{uid}`
 * through the portal's own register route and never a `users/{uid}`
 * (context/CustomerAuthContext.tsx).
 *
 * The company name is asked for and stored as `requestedClient`, DISPLAY ONLY.
 * It is what the owner reads on the approvals screen while he picks the real
 * «العملاء» row; nothing the person types here is ever used for access. The
 * hint under the field says so, because a buyer who thinks the box unlocks
 * something will type until it does.
 *
 * ── A username or an address (2026-10-07) ───────────────────────────────────
 * The owner can make a customer's login himself («حسابات العملاء» → «إنشاء
 * حساب عميل»): a USERNAME and a password. So the sign-in box takes either, and
 * what was typed goes through `loginEmailFor` (lib/customer-login.ts). Signing
 * UP here still needs a real address — a person registering themselves should
 * use one they can receive mail at — so that tab stays an e-mail box.
 */
type ErrStrings = (typeof cp)["en"]["login"];

/** One sentence per kind of failure (lib/auth-errors.ts) — never a dead end. */
const ERR_KEY: Record<AuthErrorKind, keyof ErrStrings> = {
  invalid: "errInvalid",
  emailInUse: "errEmailInUse",
  weakPassword: "errWeakPassword",
  unauthorizedDomain: "errUnauthorizedDomain",
  popupClosed: "errPopupClosed",
  network: "errNetwork",
  tooMany: "errTooMany",
  badEmail: "errBadEmail",
  signupClosed: "errSignupClosed",
  disabled: "errDisabled",
  register: "errRegister",
  generic: "errGeneric",
};

type Shown = { text: string; code: string };

/**
 * What to print for a thrown sign-in error. Only a `generic` failure carries
 * its raw code — the word under the sentence that lets the next unknown
 * failure be reported.
 */
function describe(err: unknown, e: ErrStrings): Shown {
  const code = authErrorCode(err);
  const kind = authErrorKind(code);
  return { text: e[ERR_KEY[kind]], code: kind === "generic" ? authErrorDetail(code) : "" };
}

export default function PortalLoginPage() {
  const { lang, setLang } = useLang();
  const c = cp[lang];
  const isAr = lang === "ar";
  const router = useRouter();
  const { user, loading } = useAuth();
  const { signInEmail, signUpEmail, signInGoogle } = useCustomerAuth();

  const [mode, setMode] = useState<"in" | "up">("in");
  // On the sign-in tab: a username or an address. On the sign-up tab: an address.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(mode === "in" ? c.login.signInTitle : c.login.signUpTitle);

  // A marker left by a sign-up that never created an account at all (a weak
  // password, a closed popup) would suppress the staff profile of whoever
  // signs in on this browser next. Clearing it on mount costs nothing — and
  // it clears ONLY that un-pinned marker, never an account whose customer
  // document has still to be written (lib/portal-signup.ts).
  //
  // And again on the way OUT: a Google popup left open behind this page keeps
  // its sign-in pending, and the «من فريق العمل؟» link below is a client-side
  // navigation — no `pagehide`, no throw — so nothing else would end the
  // marker before somebody used the staff door. A sign-in that does complete
  // after the page is gone pins its own uid the instant it does.
  useEffect(() => {
    clearPortalSignUp();
    return () => clearPortalSignUp();
  }, []);

  // Not while a sign-up is in flight: the account exists a moment before its
  // customer document does, and navigating on that would take the person off
  // this screen mid-write and hide whatever it had to say. If registration
  // does fail, /portal finishes it — CustomerAuthProvider retries there.
  useEffect(() => {
    if (busy) return;
    if (!loading && user) router.replace("/portal");
  }, [busy, loading, user, router]);

  // Signing up needs an address somebody can receive mail at: an `@`, and not
  // the reserved domain the owner-made usernames live on.
  const typed = email.trim();
  const realAddress = typed.includes("@") && usernameOf(typed) === "";
  const canSubmit =
    password.length >= 6 &&
    (mode === "in"
      ? loginEmailFor(typed).length > 0
      : realAddress && displayName.trim().length > 0 && company.trim().length > 0);
  // On the sign-in tab, something with no `@` is a USERNAME. One that could
  // never be a username (a space, Arabic letters, too short) would go to
  // Firebase as a broken address and come back as «البريد الإلكتروني غير
  // صحيح» — to a person who typed no e-mail at all.
  const badUsername = mode === "in" && typed.length > 0 && !typed.includes("@") && !isValidUsername(normalizeUsername(typed));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Enter in a field submits the form even while the button is disabled.
    if (!canSubmit) return;
    // Said here, in its own words, and Firebase is not asked at all.
    if (badUsername) { setError({ text: c.login.errBadUsername, code: "" }); return; }
    setBusy(true);
    try {
      // A username becomes its address on the login domain; an address is
      // handed over as typed.
      if (mode === "in") await signInEmail(loginEmailFor(typed), password);
      else await signUpEmail(typed, password, displayName.trim(), company.trim());
      router.replace("/portal");
    } catch (err) {
      const shown = describe(err, c.login);
      // Firebase refusing the ADDRESS of something typed without an `@` is a
      // refusal of the username.
      const asUsername = mode === "in" && !typed.includes("@") && authErrorKind(authErrorCode(err)) === "badEmail";
      setError(asUsername ? { text: c.login.errBadUsername, code: "" } : shown);
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    if (mode === "up" && !company.trim()) { setError({ text: c.login.errNeedCompany, code: "" }); return; }
    setBusy(true);
    try {
      await signInGoogle(mode === "up" ? company.trim() : undefined);
      router.replace("/portal");
    } catch (err) {
      setError(describe(err, c.login));
      setBusy(false);
    }
  }

  if (loading || (user && !busy)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner text={c.common.loading} />
      </div>
    );
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 flex items-center px-6">
        <Link href="/" className="font-bold text-gray-900 text-sm">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <button
          onClick={() => setLang(isAr ? "en" : "ar")}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 min-h-11 sm:min-h-0 transition-colors ms-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
        >
          <Globe size={12} />
          {c.common.langToggle}
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <p className="text-blue-600 text-xs font-semibold uppercase tracking-widest mb-1">{c.common.portal}</p>
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === "in" ? c.login.signInTitle : c.login.signUpTitle}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{c.login.intro}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <form onSubmit={handleSubmit}>
              {mode === "up" && (
                <>
                  <Field label={c.login.name}>
                    <input
                      id="portal-name" autoComplete="name" className={inputCls}
                      value={displayName} onChange={(e) => setDisplayName(e.target.value)} required
                    />
                  </Field>
                  <Field label={c.login.company}>
                    <input
                      id="portal-company" autoComplete="organization" className={inputCls}
                      value={company} onChange={(e) => setCompany(e.target.value)} required
                    />
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{c.login.companyHint}</p>
                  </Field>
                </>
              )}
              {/* type="text", not "email": a username has no `@`, and an e-mail
                  box would refuse it before the form ever submitted. The
                  e-mail KEYBOARD is still asked for, and nothing the phone
                  might "correct" is allowed to touch what was typed. */}
              <Field label={mode === "in" ? c.login.identifier : c.login.email}>
                <input
                  id="portal-email" type="text" inputMode="email" dir="ltr"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  autoComplete={mode === "in" ? "username" : "email"} className={inputCls}
                  value={email} onChange={(e) => setEmail(e.target.value)} required
                />
                {mode === "up" && (
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{c.login.emailHint}</p>
                )}
              </Field>
              <Field label={c.login.password}>
                <input
                  id="portal-password" type="password" className={inputCls}
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                />
              </Field>

              {error && (
                <div className="mb-3" role="alert">
                  <p className="text-sm text-red-600">{error.text}</p>
                  {/* Only an unrecognised failure carries its raw code. */}
                  {error.code && (
                    <p className="text-[11px] text-gray-400 mt-0.5 break-all">
                      <bdi dir="ltr">{error.code}</bdi>
                    </p>
                  )}
                </div>
              )}

              {/* Disabled until the form is valid: a customer must never meet a
                  refusal they could have been kept away from. */}
              <Btn type="submit" disabled={busy || !canSubmit} className="w-full">
                {mode === "in" ? c.login.signInBtn : c.login.signUpBtn}
              </Btn>
            </form>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">{c.login.or}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <Btn type="button" variant="outline" disabled={busy} onClick={handleGoogle} className="w-full">
              {c.login.google}
            </Btn>
          </div>

          <button
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}
            className="block w-full text-center text-sm text-blue-600 hover:underline mt-5 py-2.5 min-h-11 sm:min-h-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {mode === "in" ? c.login.needAccount : c.login.haveAccount}
          </button>
          <Link href="/login" className="flex items-center justify-center text-center text-xs text-gray-400 hover:text-gray-600 mt-3 py-2.5 min-h-11 sm:min-h-0">
            {c.login.staffHint}
          </Link>
          <Link href="/" className="block text-center text-xs text-gray-400 hover:text-gray-600 py-2.5">
            {c.common.backToSite}
          </Link>
        </div>
      </div>
    </div>
  );
}
