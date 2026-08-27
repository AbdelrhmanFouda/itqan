/**
 * Scrap join maths — pure, ZERO imports, so Node's test runner can load it
 * directly (the same trade lib/oee.ts and lib/downtime.ts make). Extracted from
 * lib/hourly.ts on 2026-08-27, when the fetch half's imports were keeping this
 * untestable; lib/hourly.ts re-exports it so no caller changed.
 */

// Behaviour matches latinDigits(): both Arabic-Indic ranges fold to 0-9.
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const normKey = (s: string | undefined): string =>
  (s ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type ScrapJoinRun = { date: string; machine: string; goodUnits: number; scrapUnits: number };

/** The only fields of an hourly row this join reads. */
export type HourlyScrapSource = { date: string; machine: string; scrap: number | null };

/**
 * Distribute the hourly-derived scrap (سستم − فعلي) onto production runs that
 * have NO logged scrap of their own. Grouped by day+machine; when a day has
 * several runs (shifts) on one machine, the scrap is split proportionally to
 * their good units (remainder-exact). Returns one derived value per run (0 = none).
 *
 * ── Logged scrap is CREDITED first (fixed 2026-08-27) ─────────────────────
 * «الإنتاج» rows carry native scrap now (374 of 593 rows on the day this was
 * fixed), and the hourly day-total contains that same scrap — the sheet derives
 * both from the same counters. The old rule only excluded a logged row from
 * RECEIVING derived scrap; the day's FULL hourly total then landed on the
 * remaining scrapless rows, counting the logged share twice. A day mixing one
 * native-scrap row with one «لم يُعد بعد» row — the common case since the tab
 * gained its own هالك column — overstated Quality loss on every such day.
 *
 * So: only the part of the hourly total NOT already logged on the day's runs is
 * distributed. Logged ≥ derived ⇒ nothing to distribute, which is also what
 * makes this idempotent as the crew back-fills «الفعلي» during the day.
 */
export function deriveScrap(runs: ScrapJoinRun[], hourly: HourlyScrapSource[]): number[] {
  const scrapByKey = new Map<string, number>();
  for (const h of hourly) {
    if (h.scrap === null || h.scrap <= 0) continue;
    const k = `${h.date}|${normKey(h.machine)}`;
    scrapByKey.set(k, (scrapByKey.get(k) ?? 0) + h.scrap);
  }

  // Scrap already on the day's own rows — the credit against the hourly total.
  const loggedByKey = new Map<string, number>();
  for (const r of runs) {
    if (!r.date || !(r.scrapUnits > 0)) continue;
    const k = `${r.date}|${normKey(r.machine)}`;
    if (!scrapByKey.has(k)) continue;
    loggedByKey.set(k, (loggedByKey.get(k) ?? 0) + r.scrapUnits);
  }

  const groups = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (r.scrapUnits > 0 || !r.date) return; // logged scrap wins; undated rows skip
    const k = `${r.date}|${normKey(r.machine)}`;
    if (!scrapByKey.has(k)) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  const out = new Array<number>(runs.length).fill(0);
  for (const [k, idxs] of groups) {
    const total = Math.max(0, (scrapByKey.get(k) ?? 0) - (loggedByKey.get(k) ?? 0));
    if (total <= 0) continue;
    const goods = idxs.map((i) => Math.max(0, runs[i].goodUnits));
    const sumGood = goods.reduce((a, b) => a + b, 0);
    let assigned = 0;
    idxs.forEach((i, j) => {
      let share =
        j === idxs.length - 1
          ? Math.max(0, total - assigned)
          : sumGood > 0
          ? Math.round((goods[j] / sumGood) * total)
          : Math.round(total / idxs.length);
      if (share < 0) share = 0;
      assigned += share;
      out[i] = share;
    });
  }
  return out;
}
