"use client";
/**
 * «تسجيل إنتاج» — one row of «الإنتاج», written once.
 *
 * The production log and the quality log each carried their own sixty-line
 * copy of this form; they differed in the label table they read and in whether
 * the note field was shown (cleanup batch 7). Everything that MATTERS is the
 * same in both, and that is the point of folding them together:
 *
 *  - the machine column is written with the registry LABEL, never the tonnage;
 *  - picking a machine defaults planned minutes to that machine's shift;
 *  - picking a mould also records the PRODUCT NAME, because OEE joins
 *    «الإنتاج» to Master by that name;
 *  - downtime greater than zero must carry a reason before the row is saved.
 */
import { useState } from "react";
import { DOWNTIME_REASONS, SHIFTS, options } from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { Btn, Field, inputCls, Modal } from "@/components/dashboard/ui";
import type { MachineRow, MoldRow, RunForm } from "@/lib/run-row";

/** Every label the form prints. The pages pass pd.runs + pd.common. */
export type LogRunLabels = {
  title: string;
  date: string; shift: string; shifts: string[]; machine: string; mold: string;
  planned: string; good: string; scrap: string; openCav: string;
  downtime: string; reason: string; reasons: string[]; operator: string; note: string;
  select: string; save: string; cancel: string;
  reasonRequired: string; saveFailed: string;
};

export function blankRunForm(date: string): RunForm {
  return {
    date, shift: SHIFTS[0], machine: "", mold: "", product: "", plannedMin: "720",
    goodUnits: "", scrapUnits: "", openCavities: "", downtimeMin: "", downtimeReason: "None",
    operator: "", note: "",
  };
}

export function LogRunModal({
  open,
  onClose,
  onSaved,
  machines,
  molds,
  defaultDate,
  showNote,
  labels,
  isAr,
}: {
  open: boolean;
  onClose: () => void;
  /** The row landed — the page reloads its log. */
  onSaved: () => void;
  machines: MachineRow[];
  molds: MoldRow[];
  /** The date the form opens on: today, or the day the quality page is showing. */
  defaultDate: string;
  /** «الإنتاج» has a notes column; only the production page offers it. */
  showNote?: boolean;
  labels: LogRunLabels;
  isAr: boolean;
}) {
  const [form, setForm] = useState<RunForm>(() => blankRunForm(defaultDate));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Re-seed whenever the modal opens, so it never reopens on the last entry.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setForm(blankRunForm(defaultDate)); setSaveError(null); }
  }

  function set<K extends keyof RunForm>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Picking a machine (by its registry label) defaults planned minutes to
      // that machine's shift length.
      if (k === "machine") {
        const mc = machines.find((m) => m.label === v);
        if (mc && mc.shiftLength > 0) next.plannedMin = String(mc.shiftLength);
      }
      // Picking a mould also records the PRODUCT NAME — OEE joins production
      // rows to Master by that name.
      if (k === "mold") {
        const md = molds.find((m) => (m.code || m.name) === v);
        next.product = md?.name ?? "";
      }
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    // Data-quality rule: downtime must carry a reason.
    if (Number(form.downtimeMin) > 0 && (!form.downtimeReason || form.downtimeReason === "None")) {
      setSaveError(labels.reasonRequired);
      return;
    }
    setSaving(true);
    try {
      // The production tab's machine column holds the registry LABEL
      // ("PQPI 4 — 220") — the machine's identity everywhere (board included).
      const mac = machines.find((m) => m.label === form.machine);
      const payload = { ...form, machine: mac ? mac.label : form.machine, machineCode: mac ? mac.label : "" };
      const res = await authedFetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error("save_failed");
      onClose();
      onSaved();
    } catch {
      setSaveError(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={labels.title} onClose={onClose} isAr={isAr}>
      <form onSubmit={handleAdd}>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label={labels.date}>
            <input className={inputCls} type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label={labels.shift}>
            <select className={inputCls} value={form.shift} onChange={(e) => set("shift", e.target.value)}>
              {options(SHIFTS, labels.shifts).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label={labels.machine}>
            <select className={inputCls} required value={form.machine} onChange={(e) => set("machine", e.target.value)}>
              <option value="">{labels.select}</option>
              {machines.map((m) => (
                <option key={m.row} value={m.label}>
                  {m.label}{m.product ? ` · ${m.product}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label={labels.mold}>
            <select className={inputCls} required value={form.mold} onChange={(e) => set("mold", e.target.value)}>
              <option value="">{labels.select}</option>
              {molds.map((m) => {
                const v = m.code || m.name || "";
                return <option key={m.row} value={v}>{m.name || v}</option>;
              })}
            </select>
          </Field>
          <Field label={labels.planned}>
            <input className={inputCls} type="number" min="0" value={form.plannedMin} onChange={(e) => set("plannedMin", e.target.value)} />
          </Field>
          <Field label={labels.good}>
            <input className={inputCls} type="number" min="0" required value={form.goodUnits} onChange={(e) => set("goodUnits", e.target.value)} />
          </Field>
          <Field label={labels.scrap}>
            <input className={inputCls} type="number" min="0" value={form.scrapUnits} onChange={(e) => set("scrapUnits", e.target.value)} />
          </Field>
          <Field label={labels.openCav}>
            <input className={inputCls} type="number" min="1" value={form.openCavities} onChange={(e) => set("openCavities", e.target.value)} />
          </Field>
          <Field label={labels.downtime}>
            <input className={inputCls} type="number" min="0" value={form.downtimeMin} onChange={(e) => set("downtimeMin", e.target.value)} />
          </Field>
          <Field label={labels.reason}>
            <select className={inputCls} value={form.downtimeReason} onChange={(e) => set("downtimeReason", e.target.value)}>
              {options(DOWNTIME_REASONS, labels.reasons).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label={labels.operator}>
            <input className={inputCls} value={form.operator} onChange={(e) => set("operator", e.target.value)} />
          </Field>
        </div>
        {showNote && (
          <Field label={labels.note}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        )}
        {saveError && <p className="text-xs text-red-600 mt-1">{saveError}</p>}
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <Btn type="submit" disabled={saving}>{labels.save}</Btn>
          <Btn type="button" variant="outline" onClick={onClose}>{labels.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}
