"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Stat, Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner, LoadError } from "@/components/dashboard/ui";
import {
  JOB_STATUSES, JOB_PRIORITIES, DOWNTIME_REASONS, SHIFTS,
  priorityTone, localize, options, downtimeReasonLabel,
} from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, writeLastSeen, timedJson } from "@/components/dashboard/last-seen";
import { fmtNum } from "@/lib/format";
import { todayIso } from "@/lib/dates";
import { nameKey } from "@/lib/master-lookup";
import { codeKey } from "@/lib/work-orders";
import { MasterProductPicker, findProduct, type MasterPick } from "@/components/dashboard/master-product-picker";

/**
 * One job (sheet row in the `jobs` tab) + the production runs credited to it
 * (matched by product name on/after the start date). Logging a run here
 * appends a production row pre-filled with the job's product.
 */

type Job = {
  id: string; code: string; client: string; product: string; moldCode: string;
  // qtyOrdered is PIECES (kg × 1000 ÷ Master piece weight, see lib/jobs.ts);
  // qtyOrderedKg is what the planner actually typed in the sheet.
  qtyOrdered: number; qtyOrderedKg: number; startDate: string; dueDate: string;
  status: string; priority: string; machine: string;
  materialIssued: string; masterbatch: string; instructions: string; notes: string;
  produced: number; scrapped: number;
  masterClient: string; lastMachine: string; machineMatched: boolean;
  /** The product name is on more than one Master row — show the order's own client. */
  ambiguous?: boolean;
};
type Standard = {
  weight: string; material: string; cavities: number | null; cycleSec: number | null;
  defects: string; ratePerHour: number | null; ratePerShift12h: number | null;
  // Master's MOULD NUMBER (D, else the notes) — lib/mold-number.ts.
  moldNumber: string; moldNumberSource: "code" | "notes" | "none"; moldNotesNumber: string;
  notes: string; ambiguous: boolean;
};
type Run = {
  id: string; date: string; machine: string;
  goodUnits: number; scrapUnits: number; downtimeMin: number;
  downtimeReason: string; operator: string; note: string;
};
// `label` is the registry identity («PQ 7 — 100»); `name` is the bare tonnage.
type MachineAgg = { name: string; label: string };
/** The three pieces the page draws — remembered per work order, per device. */
type JobPayload = { job: Job; runs: Run[]; standard: Standard | null };
const lastKeyFor = (id: string) => `itqan.job.${id}.last`;

export default function JobDetailPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [job, setJob] = useState<Job | null>(null);
  usePageTitle(job ? job.code : p.jobs.title);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [standard, setStandard] = useState<Standard | null>(null);
  const [notFound, setNotFound] = useState(false);
  // A stalled or refused read is NOT a missing work order. It used to render as
  // one: any non-2xx set `notFound`, so a 401 or a slow bridge told the owner
  // his job did not exist. Only a real 404 does that now; everything else is a
  // load error with a retry, and whatever is on screen stays there.
  const [loadErr, setLoadErr] = useState<null | { timedOut: boolean }>(null);
  const [loading, setLoading] = useState(false);
  const [machines, setMachines] = useState<MachineAgg[]>([]);
  const [molds, setMolds] = useState<MasterPick[]>([]);
  const [moldsLoaded, setMoldsLoaded] = useState(false);
  const [moldsFailed, setMoldsFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Edit-job modal — every sheet column of «أوامر العمل», saved as a DIFF.
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  // The product in the edit form: undefined = unchanged (the order's own),
  // null = cleared to pick another, a row = the Master product picked.
  const [editPick, setEditPick] = useState<MasterPick | null | undefined>(undefined);
  const [editMore, setEditMore] = useState(false);

  const today = todayIso();
  const blankRun = useCallback(
    () => ({
      date: today, shift: SHIFTS[0], machine: "", goodUnits: "", scrapUnits: "",
      downtimeMin: "", downtimeReason: "None", operator: "", note: "",
    }),
    [today]
  );
  const [form, setForm] = useState(blankRun());

  /**
   * The datalists behind the EDIT FORM only. They are started after the work
   * order has answered, deliberately: the bridge serialises its tab reads, so
   * firing «الماكينات» and «الاسطمبات» first queued two cold tab reads (2–11 s
   * each) IN FRONT of the read this page exists to show. Nothing on screen
   * needs them until the modal opens.
   */
  const listsStarted = useRef(false);
  const loadLists = useCallback(() => {
    listsStarted.current = true;
    fetch("/api/machines").then((x) => x.json()).then((ma) => setMachines(ma.machines ?? [])).catch(() => {});
    // A hand-typed product name that doesn't match Master exactly breaks the
    // join, so offer the real names the same way the add form does — from
    // MASTER through the guarded /api/molds, not from the «الاسطمبات» formula
    // view (cleanup batch 7; the production and quality pages already did).
    authedFetch("/api/molds")
      .then((x) => { if (!x.ok) throw new Error(String(x.status)); return x.json(); })
      .then((mo) => { setMolds(Array.isArray(mo.molds) ? mo.molds : []); setMoldsFailed(false); })
      // Not final: the picker says so with a retry, and the next edit asks again.
      .catch(() => { setMoldsFailed(true); listsStarted.current = false; })
      .finally(() => setMoldsLoaded(true));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await timedJson<JobPayload>(authedFetch, `/api/jobs/${id}`);
    setLoading(false);
    if (!r.ok) {
      if (r.status === 404) { setNotFound(true); return; }
      setLoadErr({ timedOut: r.timedOut });
      return;
    }
    const j = r.data;
    setJob(j.job);
    setRuns(j.runs ?? []);
    setStandard(j.standard ?? null);
    setLoadErr(null);
    setNotFound(false);
    writeLastSeen(lastKeyFor(id), { job: j.job, runs: j.runs ?? [], standard: j.standard ?? null });
    // Only now — the work order is on screen and the bridge is free.
    if (!listsStarted.current) loadLists();
  }, [id, loadLists]);

  useEffect(() => {
    // What this device saw last time for THIS work order, at once. It is
    // possibly old — the live answer replaces every field of it — and writes
    // never read from it: each one reloads through `load()`.
    const snap = readLastSeen<JobPayload>(lastKeyFor(id));
    if (snap && snap.job) { setJob(snap.job); setRuns(snap.runs ?? []); setStandard(snap.standard ?? null); }
    load();
  }, [id, load]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openLog() {
    // The order's machine when it is a registry label, else where it last ran —
    // a new order's machine cell is often blank (its tonnage named no single press).
    setForm({ ...blankRun(), machine: job ? (job.machineMatched ? job.machine : job.lastMachine || "") : "" });
    setOpen(true);
  }

  async function handleAddRun(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    setSaving(true);
    await authedFetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, machineCode: form.machine, product: job.product }),
    });
    setOpen(false);
    setSaving(false);
    load();
  }

  async function handleStatus(status: string) {
    if (!job) return;
    setJob({ ...job, status });
    await authedFetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  /** The job's editable fields as form strings — the baseline the save diffs against. */
  function jobFormOf(j: Job): Record<string, string> {
    return {
      qtyKg: j.qtyOrderedKg ? String(j.qtyOrderedKg) : "",
      startDate: j.startDate, dueDate: j.dueDate,
      status: j.status, priority: j.priority,
      materialIssued: j.materialIssued, masterbatch: j.masterbatch,
      instructions: j.instructions, notes: j.notes,
    };
  }

  function openEdit() {
    if (!job) return;
    // If the page is showing a remembered copy, the live read has not started
    // the datalists yet — start them the moment they are actually needed.
    if (!listsStarted.current) loadLists();
    setEditErr("");
    setEditForm(jobFormOf(job));
    setEditPick(undefined);
    setEditMore(false);
    setEditOpen(true);
  }

  function setEdit(k: string, v: string) {
    setEditForm((f) => ({ ...f, [k]: v }));
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    // Diff against the loaded job — only CHANGED fields go to the sheet, so a
    // colleague's concurrent edit to an untouched column is never clobbered.
    const base = jobFormOf(job);
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(editForm)) {
      if (v === base[k]) continue;
      // The sheet column is «الكمية المطلوبة (كجم)» — the API knows it as `qty`.
      changes[k === "qtyKg" ? "qty" : k] = v;
    }
    // The product is picked from «الرئيسي»; the server writes the picked row's
    // client, mould number and machine with it.
    const pickedNew = editPick && nameKey(editPick.name) !== nameKey(job.product) ? editPick : null;
    if (Object.keys(changes).length === 0 && !pickedNew) { setEditOpen(false); return; }
    setEditSaving(true); setEditErr("");
    const body: Record<string, unknown> = { ...changes };
    if (pickedNew) { body.product = pickedNew.name; body.masterRow = pickedNew.row; }
    // The row must still be this order — a colleague may delete a row above it.
    if (codeKey(job.code)) body.expect = { code: job.code };
    const res = await authedFetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setEditSaving(false);
    if (!res || !res.ok) {
      const reason = res ? String((await res.json().catch(() => ({}))).reason ?? "") : "";
      // At-least-once: a failed-looking save may have landed — reload before a retry.
      setEditErr((p.jobs.errors as Record<string, string>)[reason] ?? p.jobs.saveNotDoneHere);
      load();
      return;
    }
    setEditOpen(false);
    load();
  }

  async function handleDeleteRun(runId: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await authedFetch(`/api/runs/${runId}`, { method: "DELETE" });
    load();
  }

  async function handleDeleteJob() {
    if (!confirm(p.common.confirmDelete)) return;
    await authedFetch(`/api/jobs/${id}`, { method: "DELETE" });
    router.push("/dashboard/jobs");
  }

  const fmt = (n: number) => fmtNum(n, isAr);
  const startLabel = p.jobs.startDate;

  if (notFound) {
    return (
      <div className="max-w-3xl" dir={isAr ? "rtl" : "ltr"}>
        <Link href="/dashboard/jobs" className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline">{p.common.back}</Link>
        <EmptyState text={p.jobs.empty} />
      </div>
    );
  }
  const errorLine = loadErr ? (
    <LoadError
      variant="banner"
      className="mb-4"
      text={loadErr.timedOut ? p.common.timedOut : p.common.loadError}
      retry={p.common.retry}
      onRetry={load}
    />
  ) : null;

  if (!job || runs === null) {
    return (
      <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
        <Link href="/dashboard/jobs" className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline">{p.common.back}</Link>
        <div className="mt-4">{errorLine}</div>
        {!loadErr && (
          <div className="flex justify-center py-16">
            <Spinner text={p.common.loading} />
          </div>
        )}
      </div>
    );
  }

  const good = job.produced;
  const scrap = job.scrapped;
  const downtime = runs.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";
  const qty = Number(job.qtyOrdered) || 0;
  const remaining = Math.max(0, qty - good);
  const pct = qty ? Math.min(100, (good / qty) * 100) : 0;
  const overdue = !["Completed", "Delivered"].includes(job.status) && job.dueDate && job.dueDate < today;
  // Only a date the person just CHANGED is held to the order of the two — an
  // old row whose start date is after its due date must still save other edits.
  const editDatesBad = !!editForm.startDate && !!editForm.dueDate && editForm.dueDate < editForm.startDate
    && (editForm.startDate !== job.startDate || editForm.dueDate !== job.dueDate);

  return (
    <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
      <Link href="/dashboard/jobs" className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline">{p.common.back}</Link>

      <div className="mt-3">{errorLine}</div>
      {/* A remembered copy is on screen and the live one is still coming. */}
      {loading && !loadErr && <p className="text-xs text-gray-400 mt-2">{p.common.stillLoading}</p>}

      {/* Header. `flex-wrap` + `w-full sm:w-auto` on the controls: title, status
          select and two icon buttons cannot share one 375px line, so on a phone
          the controls drop to their own full-width row (the select stretches,
          the buttons keep their size) instead of pushing the page sideways. */}
      <div className="flex flex-wrap items-start justify-between gap-3 mt-3 mb-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 break-all">{job.code}</h1>
            <Pill text={localize(job.priority, JOB_PRIORITIES, p.jobs.priorities)} tone={priorityTone(job.priority)} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{[job.ambiguous ? job.client || job.masterClient : job.masterClient || job.client, job.product].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-1.5 w-full sm:w-auto">
          <select
            value={job.status}
            onChange={(e) => handleStatus(e.target.value)}
            className={`${inputCls} flex-1 min-w-0 sm:flex-none sm:w-auto`}
          >
            {options(JOB_STATUSES, p.jobs.statuses).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={openEdit}
            className="shrink-0 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            title={p.jobs.edit}
            aria-label={p.jobs.edit}
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={handleDeleteJob}
            className="shrink-0 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-lg p-2 text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            title={p.common.delete}
            aria-label={p.common.delete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Work order — أمر الشغل (matches the paper form; Master fills the standards) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mt-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-gray-900">{p.jobs.workOrder}</h2>
          {/* min-h-11 on the phone keeps Print tappable with a thumb. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => window.print()}
              className="min-h-11 sm:min-h-9 inline-flex items-center text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors print:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              {p.jobs.print}
            </button>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-y-4 gap-x-6 text-sm">
          <Detail label={p.jobs.part} value={job.product || "—"} />
          {/* Master's own number for this product — from the notes when that is where the sheet keeps it. */}
          <Detail
            label={p.jobs.moldNumber}
            value={
              !standard?.moldNumber
                ? "—"
                : standard.moldNumberSource === "notes"
                  ? `${standard.moldNumber} (${p.jobs.moldNumberNotes})`
                  : standard.moldNotesNumber
                    ? `${standard.moldNumber} · ${standard.moldNotesNumber}`
                    : standard.moldNumber
            }
          />
          {/* The order's own machine when it is a registry label, else where it last ran. */}
          <Detail label={p.jobs.machine} value={(job.machineMatched ? job.machine : job.lastMachine || job.machine) || "—"} ltr />
          <Detail label={startLabel} value={job.startDate || "—"} ltr />
          <Detail
            label={p.jobs.due}
            value={job.dueDate || "—"}
            suffix={job.dueDate && overdue ? ` · ${p.jobs.overdue}` : ""}
            danger={!!overdue}
            ltr
          />
          {/* Ordered is recorded in kg; pieces are derived from Master's piece weight. */}
          <Detail label={p.jobs.qtyOrderedKg} value={`${fmt(Number(job.qtyOrderedKg) || 0)} ${p.jobs.kg}`} />
          <Detail label={p.jobs.qtyOrderedPcs} value={qty > 0 ? `${fmt(qty)} ${p.jobs.pcs}` : "—"} />
          <Detail label={p.jobs.materialIssued} value={job.materialIssued || "—"} />
          <Detail label={p.jobs.masterbatch} value={job.masterbatch || "—"} />
          <Detail label={p.jobs.unitsRemaining} value={qty > 0 ? `${fmt(remaining)} ${p.jobs.pcs}` : "—"} />
          {standard ? (
            <>
              <Detail label={p.jobs.partWeight} value={standard.weight || "—"} />
              <Detail label={p.jobs.materialType} value={standard.material || "—"} />
              <Detail
                label={p.jobs.cavitiesXCycle}
                value={standard.cavities && standard.cycleSec ? `${standard.cavities} × ${standard.cycleSec}` : "—"}
              />
              <Detail
                label={p.jobs.expectedPerHour}
                value={standard.ratePerHour ? fmt(standard.ratePerHour) : "—"}
              />
              <Detail
                label={p.jobs.expectedPerShift}
                value={standard.ratePerShift12h ? fmt(standard.ratePerShift12h) : "—"}
              />
              <Detail label={p.jobs.possibleDefects} value={standard.defects || "—"} />
            </>
          ) : (
            <p className="sm:col-span-3 text-xs text-gray-500">{p.jobs.noStandard}</p>
          )}
          {job.instructions ? (
            <div className="sm:col-span-3">
              <p className="text-xs text-gray-500 mb-0.5">{p.jobs.instructions}</p>
              <p className="text-gray-700 whitespace-pre-wrap">{job.instructions}</p>
            </div>
          ) : null}
          {job.notes ? (
            <div className="sm:col-span-3">
              <p className="text-xs text-gray-500 mb-0.5">{p.jobs.notes}</p>
              <p className="text-gray-700 whitespace-pre-wrap">{job.notes}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden" dir="ltr">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums" dir="ltr">
          {qty > 0
            ? `${fmt(good)} / ${fmt(qty)} ${p.jobs.pcs} (${pct.toFixed(0)}%)`
            : `${fmt(good)} ${p.jobs.pcs}`}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <Stat label={p.runs.totalGood} value={fmt(good)} tone="green" />
        <Stat label={p.runs.totalScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={p.runs.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={p.runs.totalDowntime} value={fmt(downtime)} sub={p.overview.minutes} />
      </div>

      {/* Runs credited to this job */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{p.jobs.runsForJob}</h2>
        <Btn onClick={openLog}><Plus size={15} /> {p.runs.add}</Btn>
      </div>

      {runs.length === 0 ? (
        <EmptyState text={p.jobs.noRuns} />
      ) : (
        <>
        {/* Phone: one card per run. Seven columns including a delete button;
            on a 375px screen the delete sat off the right edge, which is both
            unreachable and — once found by scrolling — easy to hit by accident. */}
        <div className="sm:hidden bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {runs.map((r) => (
            <div key={r.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 tabular-nums"><bdi dir="ltr">{r.date}</bdi></div>
                  <div className="text-xs text-gray-500 truncate"><bdi dir="ltr">{r.machine || "—"}</bdi></div>
                </div>
                <button
                  onClick={() => handleDeleteRun(r.id)}
                  aria-label={p.common.delete}
                  className="shrink-0 p-2.5 -m-1.5 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span className="text-green-600 font-medium">{p.runs.good}: {fmt(r.goodUnits)}</span>
                {r.scrapUnits ? <span className="text-red-500">{p.runs.scrap}: {fmt(r.scrapUnits)}</span> : null}
                {r.downtimeMin ? (
                  <span className="text-gray-500">
                    {p.runs.downtime}: {fmt(r.downtimeMin)} {p.overview.minutes}
                    {r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                      : ""}
                  </span>
                ) : null}
              </div>
              {r.operator ? <div className="text-xs text-gray-400">{p.runs.operator}: {r.operator}</div> : null}
            </div>
          ))}
        </div>

        <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.date}</th>
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.machine}</th>
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.good}</th>
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.scrap}</th>
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.downtime}</th>
                  <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.operator}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap tabular-nums"><bdi dir="ltr">{r.date}</bdi></td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap"><bdi dir="ltr">{r.machine || "—"}</bdi></td>
                    <td className="px-4 py-3 text-green-600 font-medium tabular-nums">{fmt(r.goodUnits)}</td>
                    <td className="px-4 py-3 text-red-500 tabular-nums">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">
                      {r.downtimeMin ? `${fmt(r.downtimeMin)} ${p.overview.minutes}` : "—"}
                      {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                        ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                        : ""}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                    <td className="px-4 py-3 text-end">
                      <button
                        onClick={() => handleDeleteRun(r.id)}
                        aria-label={p.common.delete}
                        className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Log run modal — appends a production row for this job's product */}
      <Modal open={open} title={`${p.runs.add} · ${job.code}`} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAddRun}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={p.runs.date}>
              <input className={inputCls} type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={p.runs.shift}>
              <select className={inputCls} value={form.shift} onChange={(e) => set("shift", e.target.value)}>
                {options(SHIFTS, p.runs.shifts).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.machine}>
              {/* The registry LABEL, same as the production page's run form —
                  «الإنتاج»!C joins on it; a bare tonnage cannot be joined. */}
              <select className={inputCls} value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.label} value={m.label}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.good}>
              <input className={inputCls} type="number" min="0" required value={form.goodUnits} onChange={(e) => set("goodUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.scrap}>
              <input className={inputCls} type="number" min="0" value={form.scrapUnits} onChange={(e) => set("scrapUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.downtime}>
              <input className={inputCls} type="number" min="0" value={form.downtimeMin} onChange={(e) => set("downtimeMin", e.target.value)} />
            </Field>
            <Field label={p.runs.reason}>
              <select className={inputCls} value={form.downtimeReason} onChange={(e) => set("downtimeReason", e.target.value)}>
                {options(DOWNTIME_REASONS, p.runs.reasons).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.operator}>
              <input className={inputCls} value={form.operator} onChange={(e) => set("operator", e.target.value)} />
            </Field>
          </div>
          <Field label={p.runs.note}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>

      {/* Edit the order — the product is picked from «الرئيسي» (its client and
          mould number follow it on the server); only changed fields are written. */}
      <Modal open={editOpen} title={`${p.jobs.edit} · ${job.code}`} onClose={() => setEditOpen(false)} isAr={isAr}>
        {/* noValidate: no browser validation bubbles — the grey line says what is wrong. */}
        <form onSubmit={handleEditSave} noValidate>
          {/* Not a <Field>: that is a <label>, and a label wrapping a search box
              and a list of buttons sends every tap to the first control. */}
          <div className="mb-3">
            <span className="block text-xs font-medium text-gray-600 mb-1">{p.jobs.part}</span>
            <MasterProductPicker
              rows={molds}
              value={editPick === undefined ? findProduct(molds, job.product) : editPick}
              onChange={setEditPick}
              loading={!moldsLoaded}
              failed={moldsFailed}
              onRetry={loadLists}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            {/* The sheet column is «الكمية المطلوبة (كجم)» — kilograms, never pieces. */}
            <Field label={p.jobs.qtyOrderedKg}>
              <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={editForm.qtyKg ?? ""} onChange={(e) => setEdit("qtyKg", e.target.value)} />
            </Field>
            <Field label={startLabel}>
              <input className={inputCls} type="date" value={editForm.startDate ?? ""} onChange={(e) => setEdit("startDate", e.target.value)} />
            </Field>
            <Field label={p.jobs.due}>
              <input className={inputCls} type="date" value={editForm.dueDate ?? ""} onChange={(e) => setEdit("dueDate", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Field label={p.jobs.status}>
              <select className={inputCls} value={editForm.status ?? ""} onChange={(e) => setEdit("status", e.target.value)}>
                {options(JOB_STATUSES, p.jobs.statuses).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.jobs.priority}>
              <select className={inputCls} value={editForm.priority ?? ""} onChange={(e) => setEdit("priority", e.target.value)}>
                {options(JOB_PRIORITIES, p.jobs.priorities).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <button
            type="button"
            onClick={() => setEditMore((v) => !v)}
            aria-expanded={editMore}
            className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-1 mb-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <ChevronDown size={15} className={`transition-transform ${editMore ? "rotate-180" : ""}`} /> {p.jobs.moreDetails}
          </button>
          {editMore && (
            <>
              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label={p.jobs.materialIssued}>
                  <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={editForm.materialIssued ?? ""} onChange={(e) => setEdit("materialIssued", e.target.value)} />
                </Field>
                <Field label={p.jobs.masterbatch}>
                  <input className={inputCls} value={editForm.masterbatch ?? ""} onChange={(e) => setEdit("masterbatch", e.target.value)} />
                </Field>
              </div>
              <Field label={p.jobs.instructions}>
                <textarea className={`${inputCls} resize-none`} rows={2} value={editForm.instructions ?? ""} onChange={(e) => setEdit("instructions", e.target.value)} />
              </Field>
              <Field label={p.jobs.notes}>
                <textarea className={`${inputCls} resize-none`} rows={2} value={editForm.notes ?? ""} onChange={(e) => setEdit("notes", e.target.value)} />
              </Field>
            </>
          )}
          {editErr && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{editErr}</p>}
          {editDatesBad && <p className="text-xs text-gray-500 mb-2">{p.jobs.dueBeforeStart}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={editSaving || editDatesBad} className="flex-1 sm:flex-none min-h-12 sm:min-h-10">{editSaving ? p.common.loading : p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setEditOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** `ltr` isolates a Latin label or an ISO date, which would read backwards inside Arabic. */
function Detail({ label, value, danger, ltr, suffix }: { label: string; value: string; danger?: boolean; ltr?: boolean; suffix?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-medium tabular-nums ${danger ? "text-red-600" : "text-gray-900"}`}>
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
        {suffix}
      </p>
    </div>
  );
}
