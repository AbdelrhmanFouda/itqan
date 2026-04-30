import { prisma } from "./prisma";

export async function getMachines() {
  return prisma.machine.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      notes: {
        orderBy: { noteDate: "desc" },
        take: 1,
        select: { noteDate: true },
      },
    },
  });
}

export async function getMachine(id: number) {
  return prisma.machine.findUnique({ where: { id } });
}

export async function addMachine(name: string, type: string, status: string) {
  return prisma.machine.create({ data: { name, type, status } });
}

export async function updateMachineStatus(id: number, status: string) {
  return prisma.machine.update({ where: { id }, data: { status } });
}

export async function getMachineNotes(machineId: number) {
  return prisma.machineNote.findMany({
    where: { machineId },
    orderBy: { noteDate: "desc" },
  });
}

export async function addMachineNote(
  machineId: number,
  note: string,
  noteDate: string
) {
  return prisma.machineNote.create({
    data: { machineId, note, noteDate: new Date(noteDate) },
  });
}

export async function getReports() {
  return prisma.monthlyReport.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export async function getReport(id: number) {
  return prisma.monthlyReport.findUnique({ where: { id } });
}

export async function addReport(
  month: number,
  year: number,
  jobsCompleted: number | null,
  notes: string,
  issues: string,
  recommendations: string
) {
  return prisma.monthlyReport.create({
    data: { month, year, jobsCompleted, notes, issues, recommendations },
  });
}
