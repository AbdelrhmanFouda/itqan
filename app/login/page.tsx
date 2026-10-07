"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { REQUESTABLE_ROLES, type Role } from "@/lib/roles";
import { authErrorCode, authErrorKind, authErrorDetail, type AuthErrorKind } from "@/lib/auth-errors";
import { clearPortalSignUp } from "@/lib/portal-signup";
import { Field, inputCls, Btn, Spinner } from "@/components/dashboard/ui";

type AuthErrStrings = (typeof ad)["en"]["auth"];

/**
 * One sentence per kind of failure — the same reading the customer portal's
 * door uses (lib/auth-errors.ts, 2026-10-07). `register` is the portal's own
 * kind and cannot happen here; it reads as the generic sentence.
 */
const ERR_KEY: Record<AuthErrorKind, keyof AuthErrStrings> = {
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
  register: "errGeneric",
  generic: "errGeneric",
};

type Shown = { text: string; code: string };

/** Only an unrecognised failure carries its raw code under the sentence. */
function describe(err: unknown, e: AuthErrStrings): Shown {
  const code = authErrorCode(err);
  const kind = authErrorKind(code);
  const generic = ERR_KEY[kind] === "errGeneric";
  return { text: e[ERR_KEY[kind]], code: generic ? authErrorDetail(code) : "" };
}

export default function LoginPage() {
  const { lang, setLang } = useLang();
  const a = ad[lang];
  const isAr = lang === "ar";
  const router = useRouter();
  const { user, loading, signInEmail, signUpEmail, signInGoogle } = useAuth();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [error, setError] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(mode === "in" ? a.auth.signInTitle : a.auth.signUpTitle);

  // The mirror of the portal's own login page: a customer sign-in left in
  // flight on this browser (a Google popup still open behind the portal's
  // page) must not speak for whoever uses THIS door. With no uid it removes
  // only that in-flight marker, so nothing else here changes.
  useEffect(() => { clearPortalSignUp(); }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "up" && !role) {
      setError({ text: a.auth.errNeedRole, code: "" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "in") {
        await signInEmail(email.trim(), password);
      } else {
        await signUpEmail(email.trim(), password, displayName.trim(), role as Role);
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(describe(err, a.auth));
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    if (mode === "up" && !role) {
      setError({ text: a.auth.errNeedRole, code: "" });
      return;
    }
    setBusy(true);
    try {
      await signInGoogle(mode === "up" ? (role as Role) : null);
      router.replace("/dashboard");
    } catch (err) {
      setError(describe(err, a.auth));
      setBusy(false);
    }
  }

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner text={a.auth.system} />
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
          {pd[lang].common.langToggle}
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <p className="text-blue-600 text-xs font-semibold uppercase tracking-widest mb-1">{a.auth.system}</p>
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === "in" ? a.auth.signInTitle : a.auth.signUpTitle}
            </h1>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <form onSubmit={handleSubmit}>
              {mode === "up" && (
                <Field label={a.auth.displayName}>
                  <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                </Field>
              )}
              <Field label={a.auth.email}>
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label={a.auth.password}>
                <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </Field>
              {mode === "up" && (
                <Field label={a.auth.requestedRole}>
                  <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)} required>
                    <option value="">{a.auth.selectRole}</option>
                    {REQUESTABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{a.roles[r]}</option>
                    ))}
                  </select>
                </Field>
              )}

              {error && (
                <div className="mb-3" role="alert">
                  <p className="text-sm text-red-600">{error.text}</p>
                  {error.code && (
                    <p className="text-[11px] text-gray-400 mt-0.5 break-all">
                      <bdi dir="ltr">{error.code}</bdi>
                    </p>
                  )}
                </div>
              )}

              <Btn type="submit" disabled={busy} className="w-full">
                {mode === "in" ? a.auth.signInBtn : a.auth.signUpBtn}
              </Btn>
            </form>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">{a.auth.or}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <Btn type="button" variant="outline" disabled={busy} onClick={handleGoogle} className="w-full">
              {a.auth.googleSignIn}
            </Btn>
          </div>

          <button
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}
            className="block w-full text-center text-sm text-blue-600 hover:underline mt-5 py-2.5 min-h-11 sm:min-h-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {mode === "in" ? a.auth.needAccount : a.auth.haveAccount}
          </button>
          {/* The other door, quietly — the mirror of the portal's staff line. */}
          <Link href="/portal/login" className="flex items-center justify-center text-center text-xs text-gray-400 hover:text-gray-600 mt-3 py-2.5 min-h-11 sm:min-h-0">
            {a.auth.customerHint}
          </Link>
          <Link href="/" className="block text-center text-xs text-gray-400 hover:text-gray-600 py-2.5">
            {a.auth.backToSite}
          </Link>
        </div>
      </div>
    </div>
  );
}
