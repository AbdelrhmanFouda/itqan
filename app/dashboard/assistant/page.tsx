"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, AlertTriangle, Check, X, User, Bot } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { ag } from "@/lib/i18n.agent";
import { Btn } from "@/components/dashboard/ui";

/* ---- shapes returned by /api/agent ---- */
type ValRow = {
  date: string; shift: string; machine: string; product: string; mold: string;
  goodUnits: string; scrapUnits: string; openCavities: string; downtimeMin: string;
  downtimeReason: string; plannedMin: string; machineCode: string; operator: string; note: string;
  errors?: string[]; warnings?: string[];
};
type ValIssue = { values: Record<string, string>; errors: string[]; warnings: string[] };
type Preview =
  | { kind: "production"; rows: { values: ValRow; errors: string[]; warnings: string[] }[]; blocked: boolean }
  | { kind: "issue"; issue: ValIssue; blocked: boolean }
  | { kind: "update"; update: { entity: string; row: number; field: string; value: string } };

type ChatMsg = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  preview?: Preview;
  state?: "pending" | "confirmed" | "cancelled";
};

let seq = 1;
const nid = () => seq++;

export default function AssistantPage() {
  const { lang } = useLang();
  const { user } = useAuth();
  const isAr = lang === "ar";
  const a = ag[lang];

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null | undefined>(undefined);
  const [limit, setLimit] = useState<number | null>(null);
  const [gate, setGate] = useState<"ok" | "no-access" | "no-key" | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const token = async () => (user ? user.getIdToken() : "");

  // On load: role access + remaining messages for the day.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch("/api/agent", { headers: { Authorization: `Bearer ${await token()}` } });
        const j = await res.json();
        if (!j.allowed) { setGate("no-access"); return; }
        setGate(j.llmConfigured ? "ok" : "no-key");
        setRemaining(j.remaining);
        setLimit(j.limit);
      } catch {
        setGate("ok"); // don't hard-block on a transient error
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    const userMsg: ChatMsg = { id: nid(), role: "user", content: body };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: await token(),
          lang,
          messages: next.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await res.json();
      if (res.status === 429) {
        setRemaining(0);
        setMessages((m) => [...m, { id: nid(), role: "system", content: (j.limitMessage?.[lang]) || a.limitReached }]);
        return;
      }
      if (!res.ok) {
        setMessages((m) => [...m, { id: nid(), role: "system", content: j.error === "no_api_key" ? a.notConfigured : a.errorGeneric }]);
        return;
      }
      if (typeof j.remaining !== "undefined") setRemaining(j.remaining);
      if (typeof j.limit !== "undefined") setLimit(j.limit);
      setMessages((m) => [
        ...m,
        { id: nid(), role: "assistant", content: j.reply || "", preview: j.preview || undefined, state: j.preview ? "pending" : undefined },
      ]);
    } catch {
      setMessages((m) => [...m, { id: nid(), role: "system", content: a.errorGeneric }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPreview(msgId: number, preview: Preview) {
    if (busy) return;
    setBusy(true);
    const payload =
      preview.kind === "production"
        ? { kind: "production", rows: preview.rows.map((r) => r.values) }
        : preview.kind === "issue"
        ? { kind: "issue", issue: preview.issue.values }
        : { kind: "update", update: preview.update };
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await token(), confirm: payload }),
      });
      const j = await res.json();
      const ok = res.ok && j.ok;
      setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, state: ok ? "confirmed" : "pending" } : x)));
      const written = preview.kind === "production" ? (j.written ?? preview.rows.length) : 1;
      const failMsg = j.reason === "issues_tab_missing" || j.reason === "no_tab" ? a.faultsTabMissing : a.writeFailed;
      setMessages((m) => [
        ...m,
        { id: nid(), role: "system", content: ok ? a.writtenOk(written) : failMsg },
      ]);
    } catch {
      setMessages((m) => [...m, { id: nid(), role: "system", content: a.writeFailed }]);
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview(msgId: number) {
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, state: "cancelled" } : x)));
    setMessages((m) => [...m, { id: nid(), role: "system", content: a.cancelled }]);
  }

  const remainingLabel =
    limit === null ? a.unlimited : typeof remaining === "number" ? a.remaining(remaining) : "";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-9rem)]">
      {/* header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
          <Sparkles size={18} className="text-blue-600" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {a.title}
            {remainingLabel && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{remainingLabel}</span>
            )}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.subtitle}</p>
        </div>
      </div>

      {gate === "no-access" ? (
        <Notice tone="warn">{a.noAccess}</Notice>
      ) : (
        <>
          {gate === "no-key" && <Notice tone="warn">{a.notConfigured}</Notice>}

          {/* messages */}
          <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 sm:p-4 space-y-4">
            {messages.length === 0 && <Intro a={a} onPick={(t) => send(t)} />}
            {messages.map((m) =>
              m.role === "system" ? (
                <SystemLine key={m.id} text={m.content} />
              ) : (
                <Bubble key={m.id} role={m.role} text={m.content}>
                  {m.preview && (
                    <PreviewCard
                      a={a}
                      isAr={isAr}
                      preview={m.preview}
                      state={m.state}
                      busy={busy}
                      onConfirm={() => confirmPreview(m.id, m.preview!)}
                      onCancel={() => cancelPreview(m.id)}
                    />
                  )}
                </Bubble>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                {a.thinking}
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* composer */}
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              rows={1}
              placeholder={a.placeholder}
              disabled={busy || remaining === 0}
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 max-h-40 min-h-[2.75rem]"
            />
            <Btn type="submit" disabled={busy || !input.trim() || remaining === 0} className="h-11 shrink-0">
              <Send size={15} />
              <span className="hidden sm:inline">{a.send}</span>
            </Btn>
          </form>
        </>
      )}
    </div>
  );
}

/* -------------------------------- pieces ---------------------------------- */

function Intro({ a, onPick }: { a: (typeof ag)["en"]; onPick: (t: string) => void }) {
  return (
    <div className="text-sm text-gray-600">
      <p className="leading-relaxed mb-4">{a.intro}</p>
      <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">{a.examplesTitle}</p>
      <div className="flex flex-wrap gap-2">
        {a.examples.map((ex, i) => (
          <button
            key={i}
            onClick={() => onPick(ex)}
            className="text-start text-xs border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 rounded-lg px-3 py-2 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ role, text, children }: { role: "user" | "assistant"; text: string; children?: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isUser ? "bg-gray-200 text-gray-600" : "bg-blue-100 text-blue-700"}`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className={`min-w-0 max-w-[85%] ${isUser ? "items-end" : ""}`}>
        {text && (
          <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${isUser ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-800 border border-gray-100"}`}>
            {text}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function SystemLine({ text }: { text: string }) {
  return (
    <div className="text-center">
      <span className="inline-block text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">{text}</span>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 text-sm rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3.5 py-2.5">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------ preview card ------------------------------ */

function PreviewCard({
  a, isAr, preview, state, busy, onConfirm, onCancel,
}: {
  a: (typeof ag)["en"];
  isAr: boolean;
  preview: Preview;
  state?: "pending" | "confirmed" | "cancelled";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const done = state === "confirmed" || state === "cancelled";
  const blocked = (preview.kind === "production" || preview.kind === "issue") && preview.blocked;

  const title =
    preview.kind === "production" ? a.reviewTitle : preview.kind === "issue" ? a.reviewIssueTitle : a.reviewUpdateTitle;

  return (
    <div className={`mt-2 rounded-xl border bg-white overflow-hidden ${done ? "border-gray-200 opacity-70" : "border-blue-200"}`}>
      <div className="px-3.5 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center gap-2">
        <Sparkles size={14} className="text-blue-600" />
        <span className="text-sm font-semibold text-gray-800">{title}</span>
      </div>

      <div className="p-3.5 space-y-3">
        {preview.kind === "production" && <ProductionPreview a={a} rows={preview.rows} />}
        {preview.kind === "issue" && <IssuePreview a={a} issue={preview.issue} />}
        {preview.kind === "update" && <UpdatePreview a={a} update={preview.update} />}

        {!done && <p className="text-xs text-gray-400">{a.reviewHint}</p>}
        {blocked && !done && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={13} /> {a.blocked}
          </p>
        )}

        {done ? (
          <p className={`text-sm font-medium ${state === "confirmed" ? "text-emerald-600" : "text-gray-500"}`}>
            {state === "confirmed" ? `✓ ${a.confirm}` : a.cancelled}
          </p>
        ) : (
          <div className={`flex gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Btn onClick={onConfirm} disabled={busy || blocked}>
              <Check size={15} /> {busy ? a.writing : a.confirm}
            </Btn>
            <Btn variant="outline" onClick={onCancel} disabled={busy}>
              <X size={15} /> {a.cancel}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function Chips({ label, items, tone }: { label: string; items: string[]; tone: "red" | "amber" }) {
  if (!items || items.length === 0) return null;
  const cls = tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <div className="space-y-1">
      {items.map((t, i) => (
        <p key={i} className={`text-xs border rounded-lg px-2 py-1 ${cls}`}>
          <span className="font-semibold">{label}:</span> {t}
        </p>
      ))}
    </div>
  );
}

type PreviewRow = { values: ValRow; errors: string[]; warnings: string[] };

function ProductionPreview({ a, rows }: { a: (typeof ag)["en"]; rows: PreviewRow[] }) {
  return (
    <div className="space-y-3">
      {/* wide table scrolls inside its own container */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[36rem]">
          <thead>
            <tr className="text-gray-400 text-start">
              {[a.colDate, a.colShift, a.colMachine, a.colProduct, a.colGood, a.colScrap, a.colCavities, a.colDowntime].map((h) => (
                <th key={h} className="font-medium px-2 py-1.5 text-start whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 text-gray-700">
                <td className="px-2 py-1.5 whitespace-nowrap">{r.values.date || "—"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.values.shift || "—"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.values.machine || "—"}</td>
                <td className="px-2 py-1.5">{r.values.product || r.values.mold || "—"}</td>
                <td className="px-2 py-1.5 font-medium text-emerald-700">{r.values.goodUnits}</td>
                <td className="px-2 py-1.5 font-medium text-red-600">{r.values.scrapUnits}</td>
                <td className="px-2 py-1.5">{r.values.openCavities || "—"}</td>
                <td className="px-2 py-1.5">{r.values.downtimeMin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="space-y-1">
          <Chips label={a.errorsLabel} items={r.errors} tone="red" />
          <Chips label={a.warningsLabel} items={r.warnings} tone="amber" />
        </div>
      ))}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-400 w-24 shrink-0">{k}</span>
      <span className="text-gray-800 min-w-0">{v}</span>
    </div>
  );
}

function IssuePreview({ a, issue }: { a: (typeof ag)["en"]; issue: ValIssue }) {
  const v = issue.values;
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <KV k={a.colDate} v={v.date} />
        <KV k={a.issueMachine} v={v.machine} />
        <KV k={a.issueProduct} v={v.product} />
        <KV k={a.issueCategory} v={v.category} />
        <KV k={a.issueDescription} v={v.description} />
        <KV k={a.issueAction} v={v.action} />
        <KV k={a.issueStatus} v={v.status} />
        <KV k={a.issueNote} v={v.note} />
      </div>
      <Chips label={a.errorsLabel} items={issue.errors} tone="red" />
      <Chips label={a.warningsLabel} items={issue.warnings} tone="amber" />
    </div>
  );
}

function UpdatePreview({ a, update }: { a: (typeof ag)["en"]; update: { entity: string; row: number; field: string; value: string } }) {
  return (
    <div className="space-y-1">
      <KV k={a.updEntity} v={update.entity} />
      <KV k={a.updRow} v={String(update.row)} />
      <KV k={a.updField} v={update.field} />
      <KV k={a.updValue} v={update.value} />
    </div>
  );
}
