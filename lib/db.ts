import { sql } from "@vercel/postgres";

export async function setupDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Operational',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS machine_notes (
      id SERIAL PRIMARY KEY,
      machine_id INTEGER REFERENCES machines(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      note_date DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_reports (
      id SERIAL PRIMARY KEY,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      jobs_completed INTEGER,
      notes TEXT,
      issues TEXT,
      recommendations TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function getMachines() {
  const { rows } = await sql`
    SELECT m.*,
      (SELECT note_date FROM machine_notes WHERE machine_id = m.id ORDER BY note_date DESC LIMIT 1) as last_note_date
    FROM machines m ORDER BY m.created_at DESC
  `;
  return rows;
}

export async function getMachine(id: number) {
  const { rows } = await sql`SELECT * FROM machines WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function addMachine(name: string, type: string, status: string) {
  const { rows } = await sql`
    INSERT INTO machines (name, type, status) VALUES (${name}, ${type}, ${status}) RETURNING *
  `;
  return rows[0];
}

export async function updateMachineStatus(id: number, status: string) {
  await sql`UPDATE machines SET status = ${status} WHERE id = ${id}`;
}

export async function getMachineNotes(machineId: number) {
  const { rows } = await sql`
    SELECT * FROM machine_notes WHERE machine_id = ${machineId} ORDER BY note_date DESC
  `;
  return rows;
}

export async function addMachineNote(machineId: number, note: string, noteDate: string) {
  const { rows } = await sql`
    INSERT INTO machine_notes (machine_id, note, note_date) VALUES (${machineId}, ${note}, ${noteDate}) RETURNING *
  `;
  return rows[0];
}

export async function getReports() {
  const { rows } = await sql`SELECT * FROM monthly_reports ORDER BY year DESC, month DESC`;
  return rows;
}

export async function getReport(id: number) {
  const { rows } = await sql`SELECT * FROM monthly_reports WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function addReport(
  month: number,
  year: number,
  jobsCompleted: number | null,
  notes: string,
  issues: string,
  recommendations: string
) {
  const { rows } = await sql`
    INSERT INTO monthly_reports (month, year, jobs_completed, notes, issues, recommendations)
    VALUES (${month}, ${year}, ${jobsCompleted}, ${notes}, ${issues}, ${recommendations})
    RETURNING *
  `;
  return rows[0];
}
