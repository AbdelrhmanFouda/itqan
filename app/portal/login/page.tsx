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
 */
type ErrStrings = (typeof cp)["en"]["login"];

function mapError(code: string | undefined, e: ErrStrings): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return e.errInvalid;
    case "auth/email-already-in-use":
      return e.errEmailInUse;
    case "auth/weak-password":
      return e.errWeakPassword;
    case "auth/unauthorized-domain":
      return e.errUnauthorizedDomain;
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return e.errPopupClosed;
    default:
      return code === "register_failed" ? e.errRegister : e.errGeneric;
  }
}

export default function PortalLoginPage() {
  const { lang, setLang } = useLang();
  const c = cp[lang];
  const isAr = lang === "ar";
  const router = useRouter();
  const { user, loading } = useAuth();
  const { signInEmail, signUpEmail, signInGoogle } = useCustomerAuth();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  usePageTitle(mode === "in" ? c.login.signInTitle : c.login.signUpTitle);

  // A marker left by a sign-up that never created an account at all (a weak
  // password, a closed popup) would suppress the staff profile of whoever
  // signs in on this browser next. Clearing it on mount costs nothing — and
  // it clears ONLY that un-pinned marker, never an account whose customer
  // document has still to be written (lib/portal-signup.ts).
  useEffect(() => { clearPortalSignUp(); }, []);

  // Not while a sign-up is in flight: the account exists a moment before its
  // customer document does, and navigating on that would take the person off
  // this screen mid-write and hide whatever it had to say. If registration
  // does fail, /portal finishes it — CustomerAuthProvider retries there.
  useEffect(() => {
    if (busy) return;
    if (!loading && user) router.replace("/portal");
  }, [busy, loading, user, router]);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    (mode === "in" || (displayName.trim().length > 0 && company.trim().length > 0));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "in") await signInEmail(email.trim(), password);
      else await signUpEmail(email.trim(), password, displayName.trim(), company.trim());
      router.replace("/portal");
    } catch (err) {
      setError(mapError((err as { code?: string; message?: string }).code ?? (err as Error)?.message, c.login));
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError("");
    if (mode === "up" && !company.trim()) { setError(c.login.errNeedCompany); return; }
    setBusy(true);
    try {
      await signInGoogle(mode === "up" ? company.trim() : undefined);
      router.replace("/portal");
    } catch (err) {
      setError(mapError((err as { code?: string; message?: string }).code ?? (err as Error)?.message, c.login));
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
              <Field label={c.login.email}>
                <input
                  id="portal-email" type="email" autoComplete="email" className={inputCls}
                  value={email} onChange={(e) => setEmail(e.target.value)} required
                />
              </Field>
              <Field label={c.login.password}>
                <input
                  id="portal-password" type="password" className={inputCls}
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                />
              </Field>

              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

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
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}
            className="block w-full text-center text-sm text-blue-600 hover:underline mt-5 py-2.5 min-h-11 sm:min-h-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {mode === "in" ? c.login.needAccount : c.login.haveAccount}
          </button>
          <Link href="/login" className="block text-center text-xs text-gray-400 hover:text-gray-600 mt-3 py-2.5">
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
