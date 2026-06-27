/**
 * Seed Firestore with realistic Itqan data.
 *
 * Usage:
 *   1. Create .env.local with your NEXT_PUBLIC_FIREBASE_* values (see .env.example)
 *   2. npm install
 *   3. npm run seed
 *
 * WARNING: this clears the machines, machineNotes, monthlyReports,
 * contactInquiries and clients collections before inserting sample data.
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";

// Load .env.local without any extra dependency.
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env.local present — fall back to whatever is in process.env
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  console.error(
    "\n  Missing Firebase config. Create .env.local (copy .env.example) and run with `npm run seed`.\n"
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const now = Date.now();

async function clear(name) {
  const snap = await getDocs(collection(db, name));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  console.log(`  cleared ${snap.size} doc(s) from ${name}`);
}

/* ------------------------------ data ------------------------------- */

const machines = [];
for (let i = 1; i <= 16; i++) {
  const n = String(i).padStart(2, "0");
  let status = "Operational";
  if (i === 4 || i === 11) status = "Under Maintenance";
  if (i === 9) status = "Idle";
  if (i === 14) status = "Out of Service";
  machines.push({ name: `IMM-${n}`, type: "Injection Molding", status });
}
machines.push({ name: "CNC-01", type: "CNC", status: "Operational" });
machines.push({ name: "3DP-01", type: "3D Printer", status: "Operational" });
machines.push({ name: "EDM-01", type: "Other", status: "Idle" });

const notesByMachine = {
  "IMM-01": [{ note: "Routine preventive maintenance completed.", noteDate: "2026-05-30" }],
  "IMM-04": [
    { note: "Heater band replaced on zone 2; temperature now stable.", noteDate: "2026-06-10" },
    { note: "Scheduled for hydraulic seal inspection next week.", noteDate: "2026-06-22" },
  ],
  "IMM-07": [{ note: "Minor flash defect; mold polished in-house.", noteDate: "2026-03-14" }],
  "IMM-11": [{ note: "Screw showing wear, replacement ordered.", noteDate: "2026-06-18" }],
  "IMM-14": [{ note: "Hydraulic pump failure — out of service pending part.", noteDate: "2026-01-08" }],
  "CNC-01": [{ note: "Spindle recalibrated, tolerances within spec.", noteDate: "2026-06-05" }],
};

const reports = [
  {
    month: 1,
    year: 2026,
    jobsCompleted: 142,
    notes: "Strong start to the year; two new molds commissioned.",
    issues: "IMM-14 down 3 days for hydraulic pump failure.",
    recommendations: "Keep spare hydraulic pumps in inventory.",
  },
  {
    month: 2,
    year: 2026,
    jobsCompleted: 128,
    notes: "Counterweight order volume up 15% month over month.",
    issues: "Resin delivery delayed early in the month.",
    recommendations: "Qualify a second resin supplier to reduce risk.",
  },
  {
    month: 3,
    year: 2026,
    jobsCompleted: 156,
    notes: "Record month for automotive cable-clip production.",
    issues: "Minor flash defects on IMM-07, mold reworked in-house.",
    recommendations: "Add quarterly preventive mold polishing.",
  },
  {
    month: 4,
    year: 2026,
    jobsCompleted: 134,
    notes: "CNC fully booked with new tooling jobs.",
    issues: "IMM-04 heater band failure, repaired same day.",
    recommendations: "Stock common heater bands on site.",
  },
  {
    month: 5,
    year: 2026,
    jobsCompleted: 149,
    notes: "Quality pass rate reached 98.6%.",
    issues: "No significant downtime.",
    recommendations: "Maintain current QC checkpoints.",
  },
];

const inquiries = [
  {
    name: "Karim Adel",
    company: "Nile Appliances",
    phone: "+20 100 555 1212",
    email: "karim@nile-appliances.example",
    inquiryType: "Injection Molding",
    message: "Need a quote for 50k ABS fan housings, multi-cavity.",
  },
  {
    name: "Mona Fathy",
    company: "Delta Electric",
    phone: "+20 122 444 9090",
    email: "mona@delta-electric.example",
    inquiryType: "Mold Manufacturing",
    message: "Looking for an in-house CNC mold for a junction box design.",
  },
  {
    name: "Tarek Sami",
    company: "",
    phone: "+20 111 222 3344",
    email: "tarek.sami@example.com",
    inquiryType: "Prototyping",
    message: "Can you 3D print a prototype before committing to tooling?",
  },
];

const clients = [
  { name: "Nile Appliances", industry: "Home Appliances", logo: "/clients/nile-appliances.png" },
  { name: "Delta Electric", industry: "Electrical", logo: "/clients/delta-electric.png" },
  { name: "Cairo Auto Parts", industry: "Automotive", logo: "/clients/cairo-auto.png" },
  { name: "Pharaoh Plastics", industry: "Plastics", logo: "/clients/pharaoh-plastics.png" },
  { name: "Giza Home Systems", industry: "Consumer Electronics", logo: "/clients/giza-home.png" },
  { name: "Suez Industrial Group", industry: "Industrial", logo: "/clients/suez-industrial.png" },
];

/* ----------------------- Phase 1: production ----------------------- */

const molds = [
  { code: "MOLD-001", partName: "Fan Housing Shell", client: "Nile Appliances", cavities: 4, material: "ABS", cycleTimeSec: 28, status: "Active", location: "Rack A-1" },
  { code: "MOLD-002", partName: "Fan Counterweight", client: "Nile Appliances", cavities: 8, material: "PP", cycleTimeSec: 12, status: "Active", location: "Rack A-2" },
  { code: "MOLD-003", partName: "Cable Clip", client: "Cairo Auto Parts", cavities: 8, material: "PA66", cycleTimeSec: 9, status: "Active", location: "Rack B-1" },
  { code: "MOLD-004", partName: "Junction Box", client: "Delta Electric", cavities: 2, material: "PP", cycleTimeSec: 35, status: "In Repair", location: "Rack B-3" },
  { code: "MOLD-005", partName: "Control Bezel", client: "Giza Home Systems", cavities: 4, material: "ABS", cycleTimeSec: 22, status: "Active", location: "Rack C-1" },
  { code: "MOLD-006", partName: "Mounting Bracket", client: "Suez Industrial Group", cavities: 2, material: "GF Nylon", cycleTimeSec: 40, status: "Active", location: "Rack C-2" },
];

// jobs reference molds by code and machines by name (resolved to ids at seed time)
const jobs = [
  { code: "JOB-0041", client: "Nile Appliances", partName: "Fan Housing Shell", moldCode: "MOLD-001", machine: "IMM-01", qtyOrdered: 50000, dueDate: "2026-07-10", status: "In Production", priority: "High", notes: "" },
  { code: "JOB-0042", client: "Cairo Auto Parts", partName: "Cable Clips", moldCode: "MOLD-003", machine: "IMM-03", qtyOrdered: 200000, dueDate: "2026-07-05", status: "In Production", priority: "Normal", notes: "" },
  { code: "JOB-0043", client: "Nile Appliances", partName: "Fan Counterweights", moldCode: "MOLD-002", machine: "IMM-02", qtyOrdered: 80000, dueDate: "2026-06-20", status: "In Production", priority: "High", notes: "Rush order — balance tolerance ±0.5g." },
  { code: "JOB-0044", client: "Giza Home Systems", partName: "Control Bezels", moldCode: "MOLD-005", machine: "IMM-05", qtyOrdered: 30000, dueDate: "2026-07-20", status: "Quoted", priority: "Normal", notes: "" },
  { code: "JOB-0045", client: "Delta Electric", partName: "Junction Boxes", moldCode: "MOLD-004", machine: "IMM-06", qtyOrdered: 15000, dueDate: "2026-06-15", status: "On Hold", priority: "Low", notes: "Waiting on mold repair." },
  { code: "JOB-0040", client: "Suez Industrial Group", partName: "Mounting Brackets", moldCode: "MOLD-006", machine: "IMM-08", qtyOrdered: 12000, dueDate: "2026-06-10", status: "Delivered", priority: "Normal", notes: "" },
];

// runs reference jobs by code and machines by name (resolved at seed time)
const runs = [
  { jobCode: "JOB-0041", machine: "IMM-01", date: "2026-06-08", goodUnits: 7800, scrapUnits: 120, downtimeMin: 30, downtimeReason: "Mold change", operator: "Ahmed" },
  { jobCode: "JOB-0041", machine: "IMM-01", date: "2026-06-15", goodUnits: 8200, scrapUnits: 95, downtimeMin: 0, downtimeReason: "None", operator: "Ahmed" },
  { jobCode: "JOB-0041", machine: "IMM-01", date: "2026-06-22", goodUnits: 8050, scrapUnits: 140, downtimeMin: 45, downtimeReason: "Material", operator: "Mahmoud" },
  { jobCode: "JOB-0041", machine: "IMM-01", date: "2026-06-26", goodUnits: 8300, scrapUnits: 80, downtimeMin: 0, downtimeReason: "None", operator: "Ahmed" },
  { jobCode: "JOB-0042", machine: "IMM-03", date: "2026-06-05", goodUnits: 24000, scrapUnits: 350, downtimeMin: 20, downtimeReason: "None", operator: "Youssef" },
  { jobCode: "JOB-0042", machine: "IMM-03", date: "2026-06-12", goodUnits: 26500, scrapUnits: 410, downtimeMin: 0, downtimeReason: "None", operator: "Youssef" },
  { jobCode: "JOB-0042", machine: "IMM-03", date: "2026-06-19", goodUnits: 25800, scrapUnits: 380, downtimeMin: 60, downtimeReason: "Breakdown", operator: "Hassan" },
  { jobCode: "JOB-0042", machine: "IMM-03", date: "2026-06-25", goodUnits: 27000, scrapUnits: 300, downtimeMin: 0, downtimeReason: "None", operator: "Youssef" },
  { jobCode: "JOB-0043", machine: "IMM-02", date: "2026-06-03", goodUnits: 14500, scrapUnits: 600, downtimeMin: 25, downtimeReason: "Quality hold", operator: "Mahmoud" },
  { jobCode: "JOB-0043", machine: "IMM-02", date: "2026-06-10", goodUnits: 15200, scrapUnits: 520, downtimeMin: 0, downtimeReason: "None", operator: "Mahmoud" },
  { jobCode: "JOB-0043", machine: "IMM-02", date: "2026-06-17", goodUnits: 15800, scrapUnits: 480, downtimeMin: 40, downtimeReason: "Mold change", operator: "Hassan" },
  { jobCode: "JOB-0043", machine: "IMM-02", date: "2026-06-24", goodUnits: 14900, scrapUnits: 700, downtimeMin: 90, downtimeReason: "Breakdown", operator: "Mahmoud" },
  { jobCode: "JOB-0040", machine: "IMM-08", date: "2026-05-28", goodUnits: 6000, scrapUnits: 150, downtimeMin: 30, downtimeReason: "None", operator: "Hassan" },
  { jobCode: "JOB-0040", machine: "IMM-08", date: "2026-06-02", goodUnits: 6000, scrapUnits: 90, downtimeMin: 0, downtimeReason: "None", operator: "Hassan" },
];

/* ------------------------------ run -------------------------------- */

async function run() {
  console.log("Clearing existing data...");
  for (const c of [
    "productionRuns", "jobs", "molds",
    "machineNotes", "machines", "monthlyReports", "contactInquiries", "clients",
  ]) {
    await clear(c);
  }

  console.log("Seeding machines...");
  const idByName = {};
  for (const m of machines) {
    const ref = await addDoc(collection(db, "machines"), { ...m, createdAt: now });
    idByName[m.name] = ref.id;
  }
  console.log(`  added ${machines.length} machines`);

  console.log("Seeding machine notes...");
  let noteCount = 0;
  for (const [mName, ns] of Object.entries(notesByMachine)) {
    const machineId = idByName[mName];
    if (!machineId) continue;
    for (const n of ns) {
      await addDoc(collection(db, "machineNotes"), {
        machineId,
        note: n.note,
        noteDate: n.noteDate,
        createdAt: now,
      });
      noteCount++;
    }
  }
  console.log(`  added ${noteCount} notes`);

  console.log("Seeding monthly reports...");
  for (const r of reports) {
    await addDoc(collection(db, "monthlyReports"), { ...r, createdAt: now });
  }
  console.log(`  added ${reports.length} reports`);

  console.log("Seeding contact inquiries...");
  for (const q of inquiries) {
    await addDoc(collection(db, "contactInquiries"), { ...q, createdAt: now });
  }
  console.log(`  added ${inquiries.length} inquiries`);

  console.log("Seeding clients...");
  let order = 1;
  for (const c of clients) {
    await addDoc(collection(db, "clients"), { ...c, order: order++, createdAt: now });
  }
  console.log(`  added ${clients.length} clients`);

  console.log("Seeding molds...");
  const moldIdByCode = {};
  for (const m of molds) {
    const ref = await addDoc(collection(db, "molds"), { ...m, createdAt: now });
    moldIdByCode[m.code] = ref.id;
  }
  console.log(`  added ${molds.length} molds`);

  console.log("Seeding jobs...");
  const jobIdByCode = {};
  let jobSeq = 0;
  for (const j of jobs) {
    const { moldCode, machine, ...rest } = j;
    const ref = await addDoc(collection(db, "jobs"), {
      ...rest,
      moldId: moldIdByCode[moldCode] ?? "",
      machineId: idByName[machine] ?? "",
      createdAt: now + jobSeq++, // keep insertion order stable for sorting
    });
    jobIdByCode[j.code] = ref.id;
  }
  console.log(`  added ${jobs.length} jobs`);

  console.log("Seeding production runs...");
  for (const r of runs) {
    const { jobCode, machine, ...rest } = r;
    await addDoc(collection(db, "productionRuns"), {
      ...rest,
      jobId: jobIdByCode[jobCode] ?? "",
      machineId: idByName[machine] ?? "",
      note: "",
      createdAt: now,
    });
  }
  console.log(`  added ${runs.length} production runs`);

  console.log("\n✅ Seed complete.\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
