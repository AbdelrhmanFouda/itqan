"use client";
/**
 * One stock line, opened — "edit inside any product" (owner, 2026-09-02).
 *
 * «الرصيد الحالي» is a formula view: a line cannot be edited, only the
 * movements that add up to it. So opening a line shows exactly those movements
 * (matched the way the sheet sums them — four exact strings, see sameLine()),
 * lets each be edited or deleted, and offers the three things a storekeeper
 * does to a pile: put more on it, take from it, or carry it somewhere else.
 *
 * Two checks ride along because the live data needed them on the day this was
 * written: the movements are summed and compared with the sheet's own figure
 * (a row holding a location code in its date cell shows up here), and a line
 * below zero is paired with the same owner's stock elsewhere — the negative is
 * almost always a movement filed with the wrong place.
 */
import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, MapPin, MoveRight, Pencil, Trash2 } from "lucide-react";
import { Btn, Field, inputCls, Modal } from "@/components/dashboard/ui";
import type { sd } from "@/lib/i18n.storage";
import type { StorageBalance, StorageMovement } from "@/lib/storage";
import {
  caseTwin, historyFor, locKey, siblingLines, storageDate, sumNet, toNumber,
} from "@/lib/storage-filter";

type Strings = (typeof sd)["en"] | (typeof sd)["ar"];
const fill = (t: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), t);
const fmt = (n: number, isAr: boolean) => n.toLocaleString(isAr ? "ar-EG" : "en-US", { maximumFractionDigits: 2 });

/* ------------------------------- the drawer ------------------------------- */

export function ItemDrawer({
  line, balance, movements, canWrite, isAr, s, onClose, onDeposit, onWithdraw, onMove, onEdit, onDelete, onSwitch,
}: {
  line: StorageBalance | null;
  balance: StorageBalance[];
  movements: StorageMovement[];
  canWrite: boolean;
  isAr: boolean;
  s: Strings;
  onClose: () => void;
  onDeposit: (line: StorageBalance) => void;
  onWithdraw: (line: StorageBalance) => void;
  onMove: (line: StorageBalance) => void;
  onEdit: (m: StorageMovement) => void;
  onDelete: (m: StorageMovement) => void;
  onSwitch: (line: StorageBalance) => void;
}) {
  const history = useMemo(() => (line ? historyFor(movements, line) : []), [movements, line]);
  const siblings = useMemo(() => (line ? siblingLines(balance, line) : []), [balance, line]);
  const twin = useMemo(() => (line ? caseTwin(balance, line) : undefined), [balance, line]);
  if (!line) return null;

  const sheetAvail = toNumber(line.avail);
  const summed = sumNet(history);
  const mismatch = Math.abs(sheetAvail - summed) > 0.005;
  const negative = sheetAvail < 0;
  const availCls = negative ? "text-red-600" : sheetAvail === 0 ? "text-gray-400" : "text-emerald-700";
  const bestSibling = negative ? siblings.filter((b) => toNumber(b.avail) > 0).sort((a, b) => toNumber(b.avail) - toNumber(a.avail))[0] : undefined;
  // the bridge accepts a withdrawal against the SUMMED figure — see sumNet()
  const canTake = summed > 0;
  const locLabel = line.loc || s.filters.noLocation;

  return (
    <Modal open title={s.item.title} onClose={onClose} isAr={isAr}>
      {/* identity */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-gray-900 break-words">{line.item}</p>
          <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{line.itemType}</span>
            {line.client && <span>· {line.client}</span>}
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700" dir={line.loc ? "ltr" : undefined}>
              <MapPin size={11} />{locLabel}
            </span>
          </p>
        </div>
        <p className={`shrink-0 text-2xl font-bold tabular-nums ${availCls}`}>
          {fmt(sheetAvail, isAr)} <span className="text-sm font-medium">{line.unit}</span>
        </p>
      </div>

      {/* the two checks */}
      <p className={`text-xs mb-3 ${mismatch ? "text-amber-700" : "text-gray-400"}`}>
        {fill(s.item.sheetSays, { sheet: fmt(sheetAvail, isAr), sum: fmt(summed, isAr) })}
        {mismatch && <> — {s.item.mismatch}</>}
      </p>
      {bestSibling && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {fill(s.item.negativeHint, {
            qty: fmt(toNumber(bestSibling.avail), isAr), unit: bestSibling.unit,
            loc: bestSibling.loc || s.filters.noLocation,
          })}
        </p>
      )}
      {twin && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {fill(s.item.caseTwin, { loc: twin.loc })}
        </p>
      )}

      {/* actions */}
      {canWrite && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <Btn variant="outline" onClick={() => onDeposit(line)}><ArrowDownToLine size={15} /> {s.item.depositHere}</Btn>
          <Btn variant="outline" onClick={() => onWithdraw(line)} disabled={!canTake}><ArrowUpFromLine size={15} /> {s.item.withdrawHere}</Btn>
          <Btn variant="outline" onClick={() => onMove(line)} disabled={!canTake}><MoveRight size={15} /> {s.item.move}</Btn>
        </div>
      )}

      {/* the same item standing elsewhere */}
      {siblings.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1.5">{s.item.elsewhere}</p>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((b, i) => {
              const v = toNumber(b.avail);
              return (
                <button
                  key={`${b.loc}-${i}`}
                  onClick={() => onSwitch(b)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 min-h-9 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    v < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span dir={b.loc ? "ltr" : undefined}>{b.loc || s.filters.noLocation}</span>
                  <b>{fmt(v, isAr)}</b>
                  <span className="opacity-70">{b.unit}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* the movements */}
      <p className="text-xs font-medium text-gray-500 mb-1.5">{s.item.history} <span className="text-gray-400 tabular-nums">({history.length})</span></p>
      {history.length === 0 ? (
        <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">{s.item.noHistory}</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {history.map((m) => {
            const out = m.log === "سحب";
            const iso = storageDate(m.date);
            return (
              <li key={`${m.log}-${m.num}`} className="flex items-center gap-3 px-3 py-2.5 bg-white">
                <span className={`shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center ${out ? "bg-orange-50 text-orange-600" : "bg-emerald-50 text-emerald-600"}`}>
                  {out ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 tabular-nums">
                    <b>{out ? "−" : "+"}{fmt(toNumber(m.net), isAr)}</b> <span className="text-gray-500">{m.unit}</span>
                    {m.forClient && <span className="text-xs text-gray-400"> ← {m.forClient}</span>}
                  </p>
                  <p className="text-xs text-gray-400 flex flex-wrap gap-x-2">
                    <span className="font-mono" dir="ltr">{m.num}</span>
                    {iso
                      ? <span dir="ltr">{iso}</span>
                      : <span className="text-amber-600">{fill(s.badDate, { raw: m.date || "—" })}</span>}
                    {m.notes && <span className="truncate max-w-[14rem]">{m.notes}</span>}
                  </p>
                </div>
                {canWrite && (
                  <div className="shrink-0 flex">
                    <button onClick={() => onEdit(m)} aria-label={s.item.edit} title={s.item.edit}
                      className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => onDelete(m)} aria-label={s.item.del} title={s.item.del}
                      className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/* ------------------------------- the move ------------------------------- */

export type MoveRequest = { toLoc: string; qty: number; date: string; notes: string };
export type MoveHalf = { out: string; error: string };

export function MoveModal({
  line, avail, locations, strict, isAr, s, busy, error, half, onClose, onConfirm, onUndo,
}: {
  line: StorageBalance | null;
  /** what can actually leave this line — the movements summed, as the bridge checks it */
  avail: number;
  /** every place the room offers — the line's own place is filtered out here */
  locations: string[];
  /** true when «أماكن التخزين» is published and the list is authoritative */
  strict: boolean;
  isAr: boolean;
  s: Strings;
  busy: boolean;
  error: string;
  /** the withdrawal landed and the deposit did not — the honest state to show */
  half: MoveHalf | null;
  onClose: () => void;
  onConfirm: (req: MoveRequest) => void;
  onUndo: (out: string) => void;
}) {
  // The parent keys this component on the line, so a different line mounts a
  // fresh form — no reset effect needed.
  const [toLoc, setToLoc] = useState("");
  const [qty, setQty] = useState(avail > 0 ? String(avail) : "");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [notes, setNotes] = useState("");
  const [localErr, setLocalErr] = useState("");
  if (!line) return null;

  const from = line.loc || s.filters.noLocation;
  const options = locations.filter((l) => locKey(l) !== locKey(line.loc));
  const q = toNumber(qty);

  function submit() {
    if (!toLoc.trim()) { setLocalErr(s.move.needTo); return; }
    if (locKey(toLoc) === locKey(line!.loc)) { setLocalErr(s.move.sameLoc); return; }
    if (!(q > 0) || q > avail + 1e-9) { setLocalErr(s.move.needQty); return; }
    setLocalErr("");
    onConfirm({
      toLoc: toLoc.trim(), qty: q, date,
      notes: notes.trim() || fill(s.move.autoNote, { from, to: toLoc.trim() }),
    });
  }

  return (
    <Modal open title={fill(s.move.title, { item: line.item })} onClose={onClose} isAr={isAr}>
      <p className="text-xs text-gray-500 mb-3">{s.move.how}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label={s.move.from}>
          <div className={`${inputCls} bg-gray-50 text-gray-600 flex items-center gap-1.5`}>
            <MapPin size={13} className="text-gray-400" /><span dir={line.loc ? "ltr" : undefined}>{from}</span>
            <span className="ms-auto tabular-nums text-xs">{avail.toLocaleString(isAr ? "ar-EG" : "en-US")} {line.unit}</span>
          </div>
        </Field>
        <Field label={s.move.to}>
          {strict ? (
            <select className={inputCls} value={toLoc} onChange={(e) => setToLoc(e.target.value)} disabled={busy || !!half}>
              <option value="">{s.form.selectItem}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <>
              <input list="storage-move-locations" className={inputCls} value={toLoc} onChange={(e) => setToLoc(e.target.value)} disabled={busy || !!half} />
              <datalist id="storage-move-locations">{options.map((o) => <option key={o} value={o} />)}</datalist>
            </>
          )}
        </Field>
        <Field label={`${s.move.qty} (${line.unit})`}>
          <div className="flex gap-2">
            <input type="number" min={0} max={avail} step="any" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} disabled={busy || !!half} />
            <Btn variant="outline" onClick={() => setQty(String(avail))} disabled={busy || !!half}>{s.move.all}</Btn>
          </div>
        </Field>
        <Field label={s.move.date}>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy || !!half} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={s.move.notes}>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={fill(s.move.autoNote, { from, to: toLoc || "…" })} disabled={busy || !!half} />
          </Field>
        </div>
      </div>

      {(localErr || error) && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{localErr || error}</p>
      )}
      {half && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 space-y-2">
          <p>{fill(s.move.halfDone, { out: half.out, error: half.error })}</p>
          <Btn variant="danger" onClick={() => onUndo(half.out)} disabled={busy}>{fill(s.move.undo, { out: half.out })}</Btn>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Btn variant="outline" onClick={onClose} disabled={busy}>{s.form.cancel}</Btn>
        {!half && <Btn onClick={submit} disabled={busy}>{busy ? s.move.moving : s.move.confirm}</Btn>}
      </div>
    </Modal>
  );
}
