/**
 * What a row of «الإنتاج» is on screen, and the three rules for reading one.
 *
 * The production log and the quality log render the same rows from the same
 * route and had grown byte-identical copies of all of this — types, the
 * product-name fallback, the mould-number index and the shift label (cleanup
 * batch 7 measured 323 shared lines between the two pages).
 *
 * The rules themselves are older and each cost a bug:
 *  - «كود الاسطمبة» is empty on EVERY row of the tab, so a row labelled by the
 *    mould code alone read «—» everywhere until 2026-09-04. «أسم المنتج» is
 *    what the sheet actually fills in, and it is the join key to Master.
 *  - the mould NUMBER therefore has to be looked up by product name, folded
 *    through moldKey (lib/mold-number.ts).
 *  - the machine column holds the registry LABEL («PQPI 4 — 220»), never the
 *    tonnage: PQ 5 and PQ 7 are both 100 t.
 */
import { moldKey } from "@/lib/mold-number";

/** A «الإنتاج» row as /api/runs serves it. */
export type RunRow = {
  id: string;
  date: string;
  shift: string;
  machine: string;
  machineCode: string;
  /** «كود الاسطمبة» — empty on every row of the live tab. */
  mold: string;
  /** «أسم المنتج» — the join key everywhere. */
  product: string;
  plannedMin: number;
  goodUnits: number;
  scrapUnits: number;
  downtimeMin: number;
  downtimeReason: string;
  operator: string;
  note: string;
};

/** A Master row as GET /api/molds serves it — `number` is D, else the notes. */
export type MoldRow = { row: number; code?: string; name?: string; number?: string; notesNumber?: string };

/** A registry row; `label` («PQ 7 — 100») is the machine's identity everywhere. */
export type MachineRow = {
  row: number; code: string; name: string; label: string;
  product: string; status: string; shiftLength: number;
};

/** What the log form holds while it is being filled in — every field a string. */
export type RunForm = {
  date: string; shift: string; machine: string; mold: string; product: string;
  plannedMin: string; goodUnits: string; scrapUnits: string; openCavities: string;
  downtimeMin: string; downtimeReason: string; operator: string; note: string;
};

/** The product name a row should be labelled with, never an empty cell. */
export function productOf(r: RunRow, molds: MoldRow[]): string {
  if (r.product) return r.product;
  const key = r.mold;
  return molds.find((m) => (m.code || m.name) === key)?.name || key || "—";
}

/** Master rows indexed by folded product NAME — first match wins, as the sheet does. */
export function moldsByName(molds: MoldRow[]): Map<string, MoldRow> {
  const map = new Map<string, MoldRow>();
  for (const m of molds) {
    const k = moldKey(m.name);
    if (k && !map.has(k)) map.set(k, m);
  }
  return map;
}

/** The mould number for a row, or "" when Master has none. */
export function moldNumberOf(r: RunRow, byName: Map<string, MoldRow>): string {
  return byName.get(moldKey(r.product))?.number || "";
}
