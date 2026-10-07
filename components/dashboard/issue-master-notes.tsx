"use client";
/**
 * «ملاحظات الاسطمبة في الرئيسي» — the one place the issues page writes to
 * Master (2026-10-07, owner: "write in the master notes about each issue for
 * each product").
 *
 * Shows what «الرئيسي»!Q holds for the opened issue's product, and offers ONE
 * previewed write: a line prefilled from the issue, edited by the person,
 * appended UNDER the existing notes by `PATCH /api/molds {appendNote}` — only
 * on the explicit «احفظ في الرئيسي» tap (confirm-before-write is a hard rule
 * here). Nothing is erased: the server's `appendToNotes` keeps a customer's
 * mould number kept in that cell and refuses a line that would read as one.
 *
 * What is previewed is what is written: the draft is capped at NOTE_LINE_MAX
 * on open, a counter shows the cap, Save is disabled past it, and the server
 * refuses (`too_long`) rather than slicing.
 *
 * A name Master holds twice (24 of them) is shown as twins to choose from, and
 * nothing is written until one is chosen. The write carries the chosen twin's
 * client and code (`expect`) so a row that moved under the page is refused,
 * not written into the other twin; on that refusal Master is re-read and the
 * twins are offered again.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Btn, LoadError, inputCls } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { nameKey } from "@/lib/master-lookup";
import { NOTE_LINE_MAX, moldKey } from "@/lib/mold-number";
import { masterNoteLine } from "@/lib/issues";
import { fill } from "@/lib/format";
import type { pd } from "@/lib/i18n.prod";
import type { MasterPick } from "@/components/dashboard/master-product-picker";

type Strings = (typeof pd)["en"]["issues"];
type Common = (typeof pd)["en"]["common"];

/** A Master row as /api/molds answers it, plus what this section reads off it. */
export type MasterRow = MasterPick & { code: string; notes: string; ambiguous: boolean };

type Msg = { kind: "ok" | "err"; text: string };

/** The length the server measures: whitespace collapsed, as noteLine() writes it. */
const lineLength = (s: string) => s.replace(/\s+/g, " ").trim().length;

export function IssueMasterNotes({ product, issue, master, masterFailed, onRetry, onReload, onSaved, changeLabel, t, c }: {
  product: string;
  issue: { date: string; description: string; action: string };
  /** null = Master has not answered yet. */
  master: MasterRow[] | null;
  masterFailed: boolean;
  onRetry: () => void;
  /** Re-read Master even though a copy is held — after the server said the row moved. */
  onReload: () => void;
  /** The row's notes as the server now holds them — the page keeps its Master copy current. */
  onSaved: (row: number, notes: string) => void;
  /** «تغيير» — the label the product picker uses for the same action. */
  changeLabel: string;
  t: Strings;
  c: Common;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const key = nameKey(product);
  const twins = master && key ? master.filter((r) => nameKey(r.name) === key) : [];
  const row = twins.length === 1 ? twins[0] : twins.find((r) => r.row === chosen) ?? null;
  const tooLong = lineLength(text) > NOTE_LINE_MAX;

  const open = () => { setText(masterNoteLine(issue).slice(0, NOTE_LINE_MAX)); setMsg(null); setWriting(true); };
  const close = () => { setWriting(false); setMsg(null); };
  const rechoose = () => { setChosen(null); setWriting(false); setMsg(null); };

  /** What tells one twin from another: client, number — and the Master row when those collide. */
  const twinLabel = (r: MasterRow) => {
    const base = [r.client, r.number ? `${t.moldNumber} ${r.number}` : ""].filter(Boolean).join(" · ");
    const collides = twins.some((o) => o.row !== r.row && [o.client, o.number].join("|") === [r.client, r.number].join("|"));
    return { base: base || r.name, rowTag: collides || !base ? `#${r.row}` : "" };
  };

  async function save() {
    if (!row || saving || tooLong) return;
    setSaving(true); setMsg(null);
    try {
      const res = await authedFetch("/api/molds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: row.name, row: row.row, expect: { client: row.client, code: row.code }, appendNote: text }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; unchanged?: boolean; notes?: string; reason?: string };
      if (res.ok && j.ok) {
        if (typeof j.notes === "string") onSaved(row.row, j.notes);
        if (j.unchanged) { setMsg({ kind: "err", text: t.masterNoteExists }); }
        else { setWriting(false); setMsg({ kind: "ok", text: t.masterNoteSaved }); }
        return;
      }
      const r = j.reason || "";
      if (r === "identity_mismatch" || r === "not_found") {
        // The row moved under the page (a colleague edits Master daily): the
        // copy held here is stale, so it is re-read and the twins offered again.
        setChosen(null); setWriting(false);
        setMsg({ kind: "err", text: t.rowChanged });
        onReload();
        return;
      }
      setMsg({
        kind: "err",
        text: r === "empty_line" ? t.masterNoteEmpty
          : r === "mold_number_changed" ? t.masterNoteNumber
          : r === "too_long" ? fill(t.masterNoteTooLong, { n: NOTE_LINE_MAX })
          : r === "no_name" ? t.notInMaster
          : t.saveFailed,
      });
    } catch {
      setMsg({ kind: "err", text: t.saveFailed });
    } finally {
      setSaving(false);
    }
  }

  let body: React.ReactNode;
  if (master === null) {
    body = masterFailed
      ? <LoadError text={c.loadError} retry={c.retry} onRetry={onRetry} />
      : <p className="text-sm text-gray-500">{t.masterLoading}</p>;
  } else if (twins.length === 0) {
    body = <p className="text-sm text-gray-500">{t.notInMaster}</p>;
  } else if (!row) {
    body = (
      <div>
        <p className="text-sm text-gray-700 mb-2">{t.whichTwin}</p>
        {msg && (
          <p role="status" className={`mb-2 text-sm ${msg.kind === "ok" ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {twins.map((r) => {
            const l = twinLabel(r);
            return (
              <button
                key={r.row}
                type="button"
                onClick={() => { setChosen(r.row); setMsg(null); }}
                className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-full border border-gray-300 bg-white px-3.5 text-sm text-gray-700 hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span>{l.base}</span>
                {l.rowTag && <bdi dir="ltr" className="text-xs text-gray-400">{l.rowTag}</bdi>}
              </button>
            );
          })}
        </div>
      </div>
    );
  } else {
    const blank = moldKey(row.notes) === "";
    const l = twins.length > 1 ? twinLabel(row) : null;
    body = (
      <div>
        {l && (
          <p className="text-xs text-gray-500 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{l.base}{l.rowTag ? " " : ""}{l.rowTag && <bdi dir="ltr">{l.rowTag}</bdi>}</span>
            <button
              type="button"
              onClick={rechoose}
              disabled={saving}
              className="inline-flex items-center min-h-11 sm:min-h-0 px-1 text-blue-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded"
            >
              {changeLabel}
            </button>
          </p>
        )}
        {blank
          ? <p className="text-sm text-gray-500">{t.masterNotesEmpty}</p>
          : <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{row.notes}</p>}
        {msg && (
          <p role="status" className={`mt-2 text-sm ${msg.kind === "ok" ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>
        )}
        {!writing ? (
          <button
            type="button"
            onClick={open}
            className="mt-3 inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg border border-blue-300 bg-white text-sm font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <Pencil size={14} /> {t.writeToMaster}
          </button>
        ) : (
          <div className="mt-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">{t.masterNoteLabel}</span>
              <textarea
                className={`${inputCls} resize-y`}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={saving}
                aria-invalid={tooLong || undefined}
              />
            </label>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mt-1">
              <p className="text-xs text-gray-500">{t.masterNoteHint}</p>
              <bdi dir="ltr" className={`text-xs tabular-nums ${tooLong ? "text-red-600" : "text-gray-400"}`}>
                {lineLength(text)} / {NOTE_LINE_MAX}
              </bdi>
            </div>
            {tooLong && <p className="text-xs text-red-600 mt-1">{fill(t.masterNoteTooLong, { n: NOTE_LINE_MAX })}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <Btn onClick={() => void save()} disabled={saving || !text.trim() || tooLong}>{saving ? t.saving : t.masterNoteSave}</Btn>
              <Btn variant="outline" onClick={close} disabled={saving}>{c.cancel}</Btn>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 mb-3">
      <span className="block text-xs font-semibold text-gray-700 mb-2">{t.masterNotes}</span>
      {body}
    </div>
  );
}
