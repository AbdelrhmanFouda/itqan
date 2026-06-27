/**
 * Canonical (English) values stored in Firestore for production records, plus
 * colour tones and a localiser that pairs a stored value with its translated
 * label (see lib/i18n.prod.ts arrays, which are index-aligned with these).
 */

export const MACHINE_STATUSES = ["Operational", "Under Maintenance", "Idle", "Out of Service"];
export const MOLD_STATUSES = ["Active", "In Repair", "Retired"];
export const JOB_STATUSES = ["Quoted", "In Production", "Completed", "Delivered", "On Hold"];
export const JOB_PRIORITIES = ["Low", "Normal", "High"];
export const DOWNTIME_REASONS = ["None", "Mold change", "Breakdown", "Material", "No order", "Quality hold", "Other"];

export type Tone = "green" | "amber" | "red" | "gray" | "blue";

export const toneClasses: Record<Tone, string> = {
  green: "bg-green-50 text-green-700 border-green-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  gray: "bg-gray-100 text-gray-600 border-gray-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
};

export function machineTone(s: string): Tone {
  if (s === "Operational") return "green";
  if (s === "Under Maintenance") return "amber";
  if (s === "Out of Service") return "red";
  return "gray";
}

export function moldTone(s: string): Tone {
  if (s === "Active") return "green";
  if (s === "In Repair") return "amber";
  return "gray";
}

export function jobTone(s: string): Tone {
  if (s === "Completed" || s === "Delivered") return "green";
  if (s === "In Production") return "blue";
  if (s === "On Hold") return "amber";
  return "gray";
}

export function priorityTone(s: string): Tone {
  if (s === "High") return "red";
  if (s === "Normal") return "blue";
  return "gray";
}

/** Translate a canonical English value using index-aligned arrays. */
export function localize(value: string, canon: string[], localized: string[]): string {
  const i = canon.indexOf(value);
  return i >= 0 && localized[i] ? localized[i] : value;
}

/** Build {value,label} option pairs for a <select>. */
export function options(canon: string[], localized: string[]) {
  return canon.map((value, i) => ({ value, label: localized[i] ?? value }));
}
