"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { ad } from "@/lib/i18n.auth";
import { REQUESTABLE_ROLES, type Role } from "@/lib/roles";
import { Field, inputCls, Btn, Spinner } from "@/components/dashboard/ui";

type AuthErrStrings = {
  errInvalid: string; errEmailInUse: string; errWeakPassword: string;
  errPopupClosed: string; errGeneric: string;
};

function mapError(code: string | undefined, e: AuthErrStrings): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return e.errInvalid;
    case "auth/email-already-in-use":
      return e.errEmailInUse;
    case "auth/weak-password":
      return e.errWeakPassword;
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return e.errPopupClosed;
    default:
      return e.errGeneric;
  }
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "up" && !role) {
      setError(a.auth.errNeedRole);
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
      setError(mapError((err as { code?: string }).code, a.auth));
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError("");
    if (mode === "up" && !role) {
      setError(a.auth.errNeedRole);
      return;
    }
    setBusy(true);
    try {
      await signInGoogle(mode === "up" ? (role as Role) : null);
      router.replace("/dashboard");
    } catch (err) {
      setError(mapError((err as { code?: string }).code, a.auth));
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
          className={`flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 transition-colors ${isAr ? "mr-auto" : "ml-auto"}`}
        >
          <Globe size={12} />
          {isAr ? "EN" : "عربي"}
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

              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

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
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}
            className="block w-full text-center text-sm text-blue-600 hover:underline mt-5"
          >
            {mode === "in" ? a.auth.needAccount : a.auth.haveAccount}
          </button>
          <Link href="/" className="block text-center text-xs text-gray-400 hover:text-gray-600 mt-3">
            {a.auth.backToSite}
          </Link>
        </div>
      </div>
    </div>
  );
}
