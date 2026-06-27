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
  clients: "clients",
} as const;

function rows<T extends object = DocumentData>(
  snap: QuerySnapshot<DocumentData>
): (T & { id: string })[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

/* ----------------------------- Machines ----------------------------- */

type MachineDoc = { name: string; type: string; status: string; createdAt?: number };
type NoteDoc = { machineId: string; note: string; noteDate: string; createdAt?: number };

export async function getMachines() {
  const [mSnap, nSnap] = await Promise.all([
    getDocs(collection(db, COL.machines)),
    getDocs(collection(db, COL.notes)),
  ]);
  const machines = rows<MachineDoc>(mSnap).sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
  const notes = rows<NoteDoc>(nSnap);

  return machines.map((m) => {
    const last = notes
      .filter((n) => n.machineId === m.id)
      .sort((a, b) => (a.noteDate < b.noteDate ? 1 : -1))[0];
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      status: m.status,
      last_note_date: last?.noteDate ?? null,
    };
  });
}

export async function getMachine(id: string) {
  const snap = await getDoc(doc(db, COL.machines, id));
  if (!snap.exists()) return null;
  const d = snap.data() as MachineDoc;
  return { id: snap.id, name: d.name, type: d.type, status: d.status };
}

export async function addMachine(name: string, type: string, status: string) {
  const ref = await addDoc(collection(db, COL.machines), {
    name,
    type,
    status,
    createdAt: Date.now(),
  });
  return { id: ref.id, name, type, status };
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
};

export async function addInquiry(input: InquiryInput) {
  await addDoc(collection(db, COL.inquiries), {
    name: input.name ?? "",
    company: input.company ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    inquiryType: input.inquiry_type ?? "",
    message: input.message ?? "",
    createdAt: Date.now(),
  });
  return { ok: true };
}

/* ------------------------------ Clients ----------------------------- */

type ClientDoc = {
  name: string;
  industry?: string;
  logo?: string;
  order?: number;
  createdAt?: number;
};

export async function getClients() {
  const snap = await getDocs(collection(db, COL.clients));
  return rows<ClientDoc>(snap)
    .map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry ?? "",
      logo: c.logo ?? "",
      order: c.order ?? 0,
    }))
    .sort((a, b) => a.order - b.order);
}

export async function addClient(name: string, industry: string, logo: string) {
  const ref = await addDoc(collection(db, COL.clients), {
    name,
    industry,
    logo,
    order: Date.now(),
    createdAt: Date.now(),
  });
  return { id: ref.id, name, industry, logo };
}

export async function deleteClient(id: string) {
  await deleteDoc(doc(db, COL.clients, id));
  return { ok: true };
}

/* ===================================================================
 * PHASE 1 — PRODUCTION SPINE
 * Collections: molds, jobs (work orders), productionRuns.
 * Same conventions as above: string ids, createdAt epoch ms,
 * dates as "YYYY-MM-DD", in-memory sort/filter (no composite indexes).
 * =================================================================== */

const PCOL = {
  molds: "molds",
  jobs: "jobs",
  runs: "productionRuns",
} as const;

/* ------------------------------- Molds ------------------------------ */

export type Mold = {
  id: string;
  code: string;
  partName: string;
  client: string;
  cavities: number;
  material: string;
  cycleTimeSec: number;
  status: string; // Active | In Repair | Retired
  location: string;
};
type MoldDoc = Omit<Mold, "id"> & { createdAt?: number };

function shapeMold(id: string, d: Partial<MoldDoc>): Mold {
  return {
    id,
    code: d.code ?? "",
    partName: d.partName ?? "",
    client: d.client ?? "",
    cavities: d.cavities ?? 0,
    material: d.material ?? "",
    cycleTimeSec: d.cycleTimeSec ?? 0,
    status: d.status ?? "Active",
    location: d.location ?? "",
  };
}

export async function getMolds(): Promise<Mold[]> {
  const snap = await getDocs(collection(db, PCOL.molds));
  return rows<MoldDoc>(snap)
    .map((m) => shapeMold(m.id, m))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
}

export async function getMold(id: string): Promise<Mold | null> {
  const snap = await getDoc(doc(db, PCOL.molds, id));
  if (!snap.exists()) return null;
  return shapeMold(snap.id, snap.data() as MoldDoc);
}

export async function addMold(input: Omit<Mold, "id">) {
  const ref = await addDoc(collection(db, PCOL.molds), {
    ...input,
    createdAt: Date.now(),
  });
  return { id: ref.id, ...input };
}

export async function updateMold(id: string, patch: Partial<Omit<Mold, "id">>) {
  await updateDoc(doc(db, PCOL.molds, id), patch);
  return { ok: true };
}

export async function deleteMold(id: string) {
  await deleteDoc(doc(db, PCOL.molds, id));
  return { ok: true };
}

/* ----------------------------- Jobs / WOs --------------------------- */

export type Job = {
  id: string;
  code: string;
  client: string;
  partName: string;
  moldId: string;
  machineId: string;
  qtyOrdered: number;
  dueDate: string; // YYYY-MM-DD
  status: string; // Quoted | In Production | Completed | Delivered | On Hold
  priority: string; // Low | Normal | High
  notes: string;
  createdAt?: number;
};
type JobDoc = Omit<Job, "id">;

function shapeJob(id: string, d: Partial<JobDoc>): Job {
  return {
    id,
    code: d.code ?? "",
    client: d.client ?? "",
    partName: d.partName ?? "",
    moldId: d.moldId ?? "",
    machineId: d.machineId ?? "",
    qtyOrdered: d.qtyOrdered ?? 0,
    dueDate: d.dueDate ?? "",
    status: d.status ?? "Quoted",
    priority: d.priority ?? "Normal",
    notes: d.notes ?? "",
    createdAt: d.createdAt,
  };
}

export async function getJobs(): Promise<Job[]> {
  const snap = await getDocs(collection(db, PCOL.jobs));
  return rows<JobDoc>(snap)
    .map((j) => shapeJob(j.id, j))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getJob(id: string): Promise<Job | null> {
  const snap = await getDoc(doc(db, PCOL.jobs, id));
  if (!snap.exists()) return null;
  return shapeJob(snap.id, snap.data() as JobDoc);
}

export async function addJob(input: Omit<Job, "id" | "createdAt">) {
  const ref = await addDoc(collection(db, PCOL.jobs), {
    ...input,
    createdAt: Date.now(),
  });
  return { id: ref.id, ...input };
}

export async function updateJob(id: string, patch: Partial<Omit<Job, "id">>) {
  await updateDoc(doc(db, PCOL.jobs, id), patch);
  return { ok: true };
}

export async function deleteJob(id: string) {
  // cascade: remove production runs that belong to this job
  const runSnap = await getDocs(
    query(collection(db, PCOL.runs), where("jobId", "==", id))
  );
  await Promise.all(runSnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, PCOL.jobs, id));
  return { ok: true };
}

/* -------------------------- Production runs ------------------------- */

export type Run = {
  id: string;
  jobId: string;
  machineId: string;
  date: string; // YYYY-MM-DD
  goodUnits: number;
  scrapUnits: number;
  downtimeMin: number;
  downtimeReason: string;
  operator: string;
  note: string;
  createdAt?: number;
};
type RunDoc = Omit<Run, "id">;

function shapeRun(id: string, d: Partial<RunDoc>): Run {
  return {
    id,
    jobId: d.jobId ?? "",
    machineId: d.machineId ?? "",
    date: d.date ?? "",
    goodUnits: d.goodUnits ?? 0,
    scrapUnits: d.scrapUnits ?? 0,
    downtimeMin: d.downtimeMin ?? 0,
    downtimeReason: d.downtimeReason ?? "",
    operator: d.operator ?? "",
    note: d.note ?? "",
    createdAt: d.createdAt,
  };
}

export async function getRuns(): Promise<Run[]> {
  const snap = await getDocs(collection(db, PCOL.runs));
  return rows<RunDoc>(snap)
    .map((r) => shapeRun(r.id, r))
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? 0) - (a.createdAt ?? 0)
    );
}

export async function getRunsForJob(jobId: string): Promise<Run[]> {
  const snap = await getDocs(
    query(collection(db, PCOL.runs), where("jobId", "==", jobId))
  );
  return rows<RunDoc>(snap)
    .map((r) => shapeRun(r.id, r))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getRunsForMachine(machineId: string): Promise<Run[]> {
  const snap = await getDocs(
    query(collection(db, PCOL.runs), where("machineId", "==", machineId))
  );
  return rows<RunDoc>(snap)
    .map((r) => shapeRun(r.id, r))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function addRun(input: Omit<Run, "id" | "createdAt">) {
  const ref = await addDoc(collection(db, PCOL.runs), {
    ...input,
    createdAt: Date.now(),
  });
  return { id: ref.id, ...input };
}

export async function deleteRun(id: string) {
  await deleteDoc(doc(db, PCOL.runs, id));
  return { ok: true };
}

/* --------------------------- Aggregates ----------------------------- */

export type ProductionStats = {
  goodUnits: number;
  scrapUnits: number;
  totalUnits: number;
  scrapRate: number; // 0..1
  downtimeMin: number;
};

/** Roll up a list of runs into headline numbers. */
export function summarizeRuns(runs: Run[]): ProductionStats {
  const goodUnits = runs.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrapUnits = runs.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtimeMin = runs.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const totalUnits = goodUnits + scrapUnits;
  return {
    goodUnits,
    scrapUnits,
    totalUnits,
    scrapRate: totalUnits ? scrapUnits / totalUnits : 0,
    downtimeMin,
  };
}

/** Map of jobId -> good units produced (from runs). */
export function producedByJob(runs: Run[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) out[r.jobId] = (out[r.jobId] ?? 0) + (r.goodUnits || 0);
  return out;
}
