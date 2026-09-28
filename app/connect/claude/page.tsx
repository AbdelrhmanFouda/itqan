"use client";
/**
 * «ربط Claude» — the authorization page of the Claude connector (2026-09-28).
 *
 * Claude opens this with an OAuth request in the query string. The owner
 * signs in with the site's own login, sees who is asking, and taps allow;
 * /api/mcp/oauth/approve vets the request and hands back the one URL this
 * page may navigate to. Nothing here decides anything on its own.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { authedFetch } from "@/lib/authed-fetch";
import { cn } from "@/lib/i18n.connector";
import { Btn, Spinner } from "@/components/dashboard/ui";

type Stage =
  | { k: "checking" }
  | { k: "ready"; name: string; host: string }
  | { k: "busy" }
  | { k: "error"; msg: "ownerOnly" | "badRequest" | "notConfigured" | "failed" };

const OAUTH_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function ConnectClaude() {
  const { lang } = useLang();
  const t = cn[lang];
  const isAr = lang === "ar";
  const sp = useSearchParams();
  const { user, loading, signInGoogle, signOut } = useAuth();
  const [stage, setStage] = useState<Stage>({ k: "checking" });
  const [signingIn, setSigningIn] = useState(false);

  const request = Object.fromEntries(OAUTH_KEYS.map((k) => [k, sp.get(k) ?? ""]));

  async function post(action: "check" | "approve" | "deny") {
    const res = await authedFetch("/api/mcp/oauth/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, action }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; redirect?: string; clientName?: string; redirectHost?: string };
    return { status: res.status, body };
  }

  function fail(status: number, error?: string) {
    const msg = status === 403 || status === 401 ? "ownerOnly"
      : status === 503 ? "notConfigured"
      : status === 400 ? "badRequest" : "failed";
    setStage({ k: "error", msg: error === "owner_only" ? "ownerOnly" : msg });
  }

  useEffect(() => {
    if (loading || !user) return;
    let live = true;
    setStage({ k: "checking" });
    post("check")
      .then(({ status, body }) => {
        if (!live) return;
        if (body.ok) setStage({ k: "ready", name: body.clientName || "Claude", host: body.redirectHost || "" });
        else fail(status, body.error);
      })
      .catch(() => live && setStage({ k: "error", msg: "failed" }));
    return () => { live = false; };
    // The request is fixed for the life of the page; re-check only on sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  async function decide(action: "approve" | "deny") {
    setStage({ k: "busy" });
    try {
      const { status, body } = await post(action);
      if (body.ok && body.redirect) window.location.assign(body.redirect);
      else fail(status, body.error);
    } catch {
      setStage({ k: "error", msg: "failed" });
    }
  }

  async function google() {
    setSigningIn(true);
    try { await signInGoogle(null); } catch { /* popup closed — the button comes back */ }
    setSigningIn(false);
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-blue-600 shrink-0" aria-hidden />
          <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
        </div>
        <p className="text-gray-700 leading-relaxed">{t.intro}</p>
        <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">{t.readOnly}</p>

        {loading || signingIn ? (
          <Spinner text={t.checking} />
        ) : !user ? (
          <Btn onClick={google} className="w-full min-h-11">{t.signIn}</Btn>
        ) : (
          <>
            <p className="text-sm text-gray-500">{t.signedInAs.replace("{email}", user.email ?? "")}</p>
            {stage.k === "checking" && <Spinner text={t.checking} />}
            {stage.k === "busy" && <Spinner text={t.redirecting} />}
            {stage.k === "ready" && (
              <>
                <p className="text-sm text-gray-700">
                  {t.who.replace("{name}", stage.name).split("{host}")[0]}
                  <bdi dir="ltr" className="font-mono">{stage.host}</bdi>
                  {t.who.split("{host}")[1]}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Btn onClick={() => decide("approve")} className="flex-1 min-h-11">{t.allow}</Btn>
                  <Btn variant="outline" onClick={() => decide("deny")} className="flex-1 min-h-11">{t.deny}</Btn>
                </div>
              </>
            )}
            {stage.k === "error" && (
              <>
                <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{t[stage.msg]}</p>
                {stage.msg === "ownerOnly" && (
                  <Btn variant="outline" onClick={() => signOut()} className="w-full min-h-11">{t.switchAccount}</Btn>
                )}
              </>
            )}
          </>
        )}
        <p className="text-xs text-gray-400">{t.revoke}</p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ConnectClaude />
    </Suspense>
  );
}
