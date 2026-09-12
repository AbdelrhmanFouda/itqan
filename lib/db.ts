import { db } from "./firebase";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { planBackdate } from "./downtime";

/**
 * Firestore data layer for Itqan.
 *
 * Design notes:
 * - Document ids are Firestore string ids (exposed to the frontend as `id`).
 * - `createdAt` is stored as epoch ms (number) so results serialize cleanly
 *   over JSON and can be sorted without Timestamp conversion.
 * - Dates (note_date) are stored as "YYYY-MM-DD" strings.
 * - We deliberately sort/filter in memory instead of using composite Firestore
 *   queries, so the app works without any custom Firestore indexes.
 */

const COL = {
  machines: "machines",
  notes: "machineNotes",
  reports: "monthlyReports",
  inquiries: "contactInquiries",
} as const;

function rows<T extends object = DocumentData>(
  snap: QuerySnapshot<DocumentData>
): (T & { id: string })[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

/* ----------------------------- Machines ----------------------------- */

type MachineDoc = { name: string; type: string; status: string; createdAt?: number };
type NoteDoc = { machineId: string; note: string; noteDate: string; createdAt?: number };

export async function getMachine(id: string) {
  const snap = await getDoc(doc(db, COL.machines, id));
  if (!snap.exists()) return null;
  const d = snap.data() as MachineDoc;
  return { id: snap.id, name: d.name, type: d.type, status: d.status };
}

export async function updateMachineStatus(id: string, status: string) {
  await updateDoc(doc(db, COL.machines, id), { status });
  return { ok: true };
}

export async function deleteMachine(id: string) {
  const noteSnap = await getDocs(
    query(collection(db, COL.notes), where("machineId", "==", id))
  );
  await Promise.all(noteSnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, COL.machines, id));
  return { ok: true };
}

/* --------------------------- Machine notes -------------------------- */

export async function getMachineNotes(machineId: string) {
  const snap = await getDocs(
    query(collection(db, COL.notes), where("machineId", "==", machineId))
  );
  return rows<NoteDoc>(snap)
    .map((n) => ({ id: n.id, note: n.note, note_date: n.noteDate }))
    .sort((a, b) => (a.note_date < b.note_date ? 1 : -1));
}

export async function addMachineNote(machineId: string, note: string, noteDate: string) {
  const ref = await addDoc(collection(db, COL.notes), {
    machineId,
    note,
    noteDate,
    createdAt: Date.now(),
  });
  return { id: ref.id, note, note_date: noteDate };
}

/* ------------------------- Monthly reports -------------------------- */

type ReportDoc = {
  month: number;
  year: number;
  jobsCompleted?: number | null;
  notes?: string;
  issues?: string;
  recommendations?: string;
  createdAt?: number;
};

function shapeReport(id: string, d: ReportDoc) {
  return {
    id,
    month: d.month,
    year: d.year,
    jobs_completed: d.jobsCompleted ?? null,
    notes: d.notes ?? "",
    issues: d.issues ?? "",
    recommendations: d.recommendations ?? "",
    created_at: d.createdAt ? new Date(d.createdAt).toISOString() : null,
  };
}

export async function getReports() {
  const snap = await getDocs(collection(db, COL.reports));
  return rows<ReportDoc>(snap)
    .map((r) => shapeReport(r.id, r))
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

export async function getReport(id: string) {
  const snap = await getDoc(doc(db, COL.reports, id));
  if (!snap.exists()) return null;
  return shapeReport(snap.id, snap.data() as ReportDoc);
}

export async function addReport(
  month: number,
  year: number,
  jobsCompleted: number | null,
  notes: string,
  issues: string,
  recommendations: string
) {
  const ref = await addDoc(collection(db, COL.reports), {
    month,
    year,
    jobsCompleted,
    notes,
    issues,
    recommendations,
    createdAt: Date.now(),
  });
  return { id: ref.id };
}

export async function deleteReport(id: string) {
  await deleteDoc(doc(db, COL.reports, id));
  return { ok: true };
}

/* -------------------------- Contact inquiries ----------------------- */

export type InquiryInput = {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  inquiry_type?: string;
  message?: string;
  /** Where the visitor came from: utm_* params + referrer, captured client-side
   *  at submit. Stored from day one so ad attribution never needs to be
   *  reconstructed retrospectively. */
  source?: string;
};

export async function addInquiry(input: InquiryInput) {
  await addDoc(collection(db, COL.inquiries), {
    name: input.name ?? "",
    company: input.company ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    inquiryType: input.inquiry_type ?? "",
    message: input.message ?? "",
    source: input.source ?? "",
    createdAt: Date.now(),
  });
  return { ok: true };
}

type InquiryDoc = {
  name?: string; company?: string; phone?: string;
  email?: string; inquiryType?: string; message?: string; source?: string; createdAt?: number;
};

export async function getInquiries() {
  const snap = await getDocs(collection(db, COL.inquiries));
  return rows<InquiryDoc>(snap)
    .map((d) => ({
      id: d.id,
      name: d.name ?? "",
      company: d.company ?? "",
      phone: d.phone ?? "",
      email: d.email ?? "",
      inquiryType: d.inquiryType ?? "",
      message: d.message ?? "",
      source: d.source ?? "",
      createdAt: d.createdAt ?? 0,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/* ===================================================================
 * DOWNTIME CAPTURE
 * The one operational collection left in Firestore: the stoppage a
 * machine is in RIGHT NOW. Everything else (molds, work orders,
 * production runs, clients) lives in the workbook and was removed here
 * on 2026-09-12 — recoverable from git at 0fa42b6.
 * Same conventions as above: string ids, createdAt epoch ms,
 * dates as "YYYY-MM-DD", in-memory sort/filter (no composite indexes).
 * =================================================================== */

const PCOL = {
  downtime: "downtimeEvents",
} as const;

/* -------------------------- Downtime events ------------------------- */

/**
 * Downtime capture. **The stoppage LOG is the sheet tab «التوقفات»** as of
 * 2026-08-14 — see lib/downtime-data.ts. What is left here is the running
 * state: the stoppage a machine is in right now, which has no minutes yet and
 * therefore no legal row (!D is validated greater than zero). The sheet row is
 * appended when somebody taps stop.
 *
 * So a document in this collection is one of three things:
 *   • OPEN     — `endedAt: null`. A machine is down at this second.
 *   • SYNCED   — closed AND `sheetSynced: true`. Its row is in «التوقفات»; kept
 *                only as a receipt, and read by NOTHING that reports a number.
 *   • PENDING  — closed but `sheetSynced: false`. The stop was recorded and the
 *                append failed. Retried on the next read; see the route.
 * Documents written before the cutover carry no `sheetSynced` field at all,
 * which is what keeps them out of the pending query — their rows were migrated
 * by hand and re-appending them would double-count the month.
 *
 * `machine` is the «الماكينات»!J label ("PQ 7 — 100"), the same string the
 * production tab uses, because that is the only unique machine id —
 * PQ 5 and PQ 7 are both 100 t, so tonnage alone would merge two machines.
 *
 * `date` is the FACTORY day (factoryDay(), 08:00→07:00), not the calendar day,
 * so a 02:00 stoppage joins to the shift that started the previous morning —
 * matching how «تسجيل الإنتاج» dates its rows.
 *
 * An OPEN event (operator tapped start, not yet stop) has `endedAt: null` and
 * `minutes: 0`; stopping sets both. Storing the start server-side rather than
 * holding it in the phone means a closed browser, a dead battery or a stop from
 * a different device cannot lose the event.
 */
export type DowntimeEvent = {
  id: string;
  date: string;        // YYYY-MM-DD, factory day (08:00→07:00)
  machine: string;     // «الماكينات»!J label, e.g. "PQ 7 — 100"
  reason: string;      // a DOWNTIME_CAPTURE_REASONS key (see lib/prod-meta.ts)
  minutes: number;     // 0 while running; set on stop
  startedAt: number;   // epoch ms
  endedAt: number | null; // epoch ms, null while running
  createdBy: string;   // verified caller's email (or uid when no email claim)
  /**
   * TRUE when nobody tapped stop and the stop time was reconstructed instead —
   * the operator walked off at end of shift. Estimated minutes are capped at the
   * end of the event's factory day, and stay flagged everywhere downstream so a
   * guess is never mistaken for a measurement. Nothing sets this automatically:
   * a human has to review the stoppage and close it (see closeStaleDowntime).
   */
  estimated: boolean;
  /** who closed it — empty for a tapped stop (that was `createdBy` at the machine). */
  closedBy: string;
  /**
   * Minutes the START was pulled back with the «+30 دقيقة» button (owner's
   * rule, 2026-09-07 meeting) — cumulative, capped at BACKDATE_CAP_MIN in
   * lib/downtime.ts. Kept so the cap survives across presses and devices;
   * absent on events that were never backdated.
   */
  backdatedMin?: number;
  /**
   * Has this stoppage's row reached «التوقفات»?
   *
   * `undefined` on every pre-cutover document (those were migrated by hand and
   * must never be re-appended), `false` for the moments between closing the
   * event and the bridge accepting the row, `true` once it is in the sheet.
   */
  sheetSynced?: boolean;
  createdAt?: number;
};
type DowntimeDoc = Omit<DowntimeEvent, "id">;

function shapeDowntime(id: string, d: Partial<DowntimeDoc>): DowntimeEvent {
  return {
    id,
    date: d.date ?? "",
    machine: d.machine ?? "",
    reason: d.reason ?? "",
    minutes: d.minutes ?? 0,
    startedAt: d.startedAt ?? 0,
    endedAt: d.endedAt ?? null,
    createdBy: d.createdBy ?? "",
    estimated: d.estimated ?? false,
    closedBy: d.closedBy ?? "",
    backdatedMin: d.backdatedMin,
    // Left undefined rather than defaulted: "this document predates the sheet"
    // and "this row has not landed yet" are different states and only one of
    // them should be retried.
    sheetSynced: d.sheetSynced,
    createdAt: d.createdAt,
  };
}

const byDateDesc = (a: DowntimeEvent, b: DowntimeEvent) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : (b.startedAt ?? 0) - (a.startedAt ?? 0);

/**
 * Stoppages that were stopped but whose row never reached the sheet.
 *
 * A single-field equality, so no composite index — the rule this file is built
 * around. Pre-cutover documents have no `sheetSynced` field and Firestore's
 * equality does not match a missing field, so the archive stays out of this
 * automatically; only rows this app itself failed to append come back.
 */
export async function getPendingDowntimeEvents(): Promise<DowntimeEvent[]> {
  const snap = await getDocs(
    query(collection(db, PCOL.downtime), where("sheetSynced", "==", false)),
  );
  return rows<DowntimeDoc>(snap).map((r) => shapeDowntime(r.id, r)).sort(byDateDesc);
}

/** The row is in «التوقفات» — stop retrying this one. */
export async function markDowntimeSynced(id: string) {
  await updateDoc(doc(db, PCOL.downtime, id), { sheetSynced: true });
  return { ok: true as const };
}

/** The still-running events (endedAt === null) — what the phone shows as "stop". */
export async function getOpenDowntimeEvents(): Promise<DowntimeEvent[]> {
  const snap = await getDocs(
    query(collection(db, PCOL.downtime), where("endedAt", "==", null))
  );
  return rows<DowntimeDoc>(snap)
    .map((r) => shapeDowntime(r.id, r))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

export async function addDowntimeEvent(input: Omit<DowntimeEvent, "id" | "createdAt">) {
  const ref = await addDoc(collection(db, PCOL.downtime), {
    ...input,
    createdAt: Date.now(),
  });
  return { id: ref.id, ...input };
}

/**
 * Close an open event. Minutes are computed from the STORED start, never from a
 * duration the client sends, so a wrong phone clock cannot invent downtime.
 * Already-stopped events are left untouched (a double-tapped stop is a no-op).
 *
 * The close is deliberately committed BEFORE the sheet row is appended, and it
 * writes `sheetSynced: false` as it goes. The alternative — append first, close
 * second — loses the race the wrong way: if the close then failed, the stoppage
 * would still be open, the operator would tap stop again, and «التوقفات» would
 * gain a SECOND row for the same stoppage. Double-counted downtime is invisible;
 * a row that has not landed yet is a flag the next read can act on.
 *
 * Returns the closed event so the caller can build the row without re-reading.
 */
export async function stopDowntimeEvent(
  id: string,
  opts: { endedAt?: number; estimated?: boolean; closedBy?: string } = {},
) {
  const { endedAt = Date.now(), estimated = false, closedBy = "" } = opts;
  const ref = doc(db, PCOL.downtime, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false as const, reason: "not_found" };
  const d = snap.data() as DowntimeDoc;
  if (d.endedAt != null) {
    return {
      ok: true as const,
      minutes: d.minutes ?? 0,
      already: true,
      event: shapeDowntime(id, d),
    };
  }
  const minutes = Math.max(0, Math.round((endedAt - (d.startedAt ?? endedAt)) / 60000));
  await updateDoc(ref, { endedAt, minutes, estimated, closedBy, sheetSynced: false });
  return {
    ok: true as const,
    minutes,
    already: false,
    event: shapeDowntime(id, { ...d, endedAt, minutes, estimated, closedBy, sheetSynced: false }),
  };
}

/**
 * Pull an OPEN stoppage's start back one fixed step («+30 دقيقة» — owner's
 * rule, 2026-09-07 meeting). All the rules live in `planBackdate()`
 * (lib/downtime.ts, pure, tested): open events only, fixed step, 12 h cap.
 * The minutes are still computed from the stored start on stop, so the
 * adjusted start flows into «التوقفات» exactly like a timely tap would have.
 */
export async function backdateDowntimeEvent(id: string) {
  const ref = doc(db, PCOL.downtime, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false as const, reason: "not_found" as const };
  const d = snap.data() as DowntimeDoc;
  const plan = planBackdate({
    startedAt: d.startedAt ?? 0,
    endedAt: d.endedAt ?? null,
    backdatedMin: d.backdatedMin,
  });
  if (!plan.ok) return { ok: false as const, reason: plan.reason };
  await updateDoc(ref, { startedAt: plan.startedAt, backdatedMin: plan.backdatedMin });
  return {
    ok: true as const,
    event: shapeDowntime(id, {
      ...d,
      startedAt: plan.startedAt,
      backdatedMin: plan.backdatedMin,
    }),
  };
}
