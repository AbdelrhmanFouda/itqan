import { pickProvider } from "@/lib/ai-review";
import { parseCell, detectShift, HOURS_PER_SHIFT, type Shift, type ExtractedRow } from "@/lib/sheet-import";

/**
 * Read a photographed paper production sheet with Gemini vision.
 *
 * Reuses the provider selection from lib/ai-review.ts (same GEMINI_API_KEY, same
 * env overrides) but NOT its prompt or its cache: this is a different job with a
 * different output, and a daily cache would be actively wrong for a page that is
 * photographed twice a day.
 *
 * There is no deterministic fallback here, unlike rulesReview(). Nothing can
 * read handwriting without a model, so with no key configured this reports
 * "no_provider" and the owner types the sheet as before — rather than the
 * feature silently producing nothing.
 */

/** Vision needs a real model. flash-lite is the review default and is too weak
 *  for handwritten Arabic numerals on a photographed grid; override with
 *  AI_VISION_MODEL if the owner wants to trade accuracy for cost. */
const VISION_MODEL = process.env.AI_VISION_MODEL?.trim() || "gemini-2.5-flash";

/**
 * The prompt is written around the two things a first real photograph actually
 * got wrong (09/08/2026 evening sheet, checked cell-by-cell against the rows
 * that page produced in «تسجيل الإنتاج»):
 *
 * 1. ROWS SLID BY ONE. زراير was handed the row below's numbers while keeping
 *    its own (correct) name — the worst possible failure, because the name
 *    looks right and only the digits are somebody else's. Fixed by anchoring
 *    every row to its PRINTED «#» and machine code and making the model report
 *    both back, so a slip is detectable instead of silent.
 * 2. THE HOUR ORDER WAS AMBIGUOUS. The old wording said "left to right in the
 *    printed column order 8:00 … 7:00", which contradicts itself on a
 *    right-to-left sheet: 8:00 is the RIGHTMOST hour column, 7:00 the leftmost.
 *
 * Product names are PRINTED, not handwritten, yet 4 of 9 came back altered
 * (كرسي → «كريمي»). Hence the instruction to copy them character for character
 * and never repair them — a name that reaches the preview unrecognised is
 * caught there and picked from Master, but a name "corrected" into a different
 * real product would not be.
 */
const PROMPT = `You are reading a photograph of a paper production log from an Egyptian plastic injection factory. It is a printed grid filled in BY HAND in blue pen. The sheet is Arabic and reads RIGHT TO LEFT.

The sheet is one shift. Its heading says either «الوردية المسائية» (evening) or «الوردية الصباحية» (morning). Read that heading.

COLUMN LAYOUT, starting from the RIGHT edge of the page and moving LEFT:
  # (row number, printed 1,2,3…) | التاريخ (date, printed) | الماكينة/الكود (machine code, printed, e.g. "PQ 1 — 550") | المنتج / الاسطمبة (product, printed) | then TWELVE hour columns | الأجمالي سستم | الأجمالي الفعلي

THE HOUR COLUMNS — get this right, it is the easiest thing to invert:
  Because the page is right-to-left, the hour labels run 8:00 at the RIGHTMOST hour column, then 9:00, 10:00, 11:00, 12:00, 1:00, 2:00, 3:00, 4:00, 5:00, 6:00, and 7:00 at the LEFTMOST hour column.
  The "hours" array MUST be ordered BY THE PRINTED LABEL: hours[0] is the 8:00 column (rightmost), hours[11] is the 7:00 column (leftmost). Exactly 12 entries, always.

HOW TO READ A ROW — do this one row at a time:
  Find the row's printed «#» and its printed machine code at the RIGHT edge. Then follow that ONE horizontal gridline across the page. Every value you report for that row must sit between the same two horizontal lines. Do not take a value from the line above or below. When two rows have similar handwriting, re-check which gridline the digits sit on.

RULES — they matter more than speed:
- Report the printed «#» as "index" and the printed date of that row as "rowDate". These are printed, not handwritten, so they should be easy and they let a mistake be caught.
- The product name is PRINTED. Copy it character for character exactly as it appears. Do NOT correct it, complete it, or substitute a product you think is more likely. If you genuinely cannot read it, return "".
- Handwritten numbers are often Arabic-Indic (٠١٢٣٤٥٦٧٨٩). Return them as ordinary digits.
- An EMPTY cell is null. A dash, a tick, a scribble, or Arabic words such as «متوقف» / «صيانة» / «عطل» written across the cells are ALSO null — never 0. Only return 0 if a zero is actually written. When a note is written across a row, that row's hours are ALL null and the note text goes in "note" for THAT row only.
- Do NOT copy a value sideways to fill blanks. Many rows genuinely repeat the same number every hour; report only what is written in each cell, and leave a cell null if it is empty.
- Ignore «الأجمالي سستم» — it is computed. For "actualTotal" report «الأجمالي الفعلي» only. Those two right-hand columns are often crowded, overwritten or crossed out; if you are not confident of the exact figure, return null. A null is expected and harmless; a wrong total is not.
- Include every machine row that has any handwriting or any note. Skip entirely blank rows.
- If you cannot read a cell confidently, use null rather than guessing.

Return STRICT JSON only, no markdown, exactly this shape:
{"date":"DD/MM/YYYY or null","shiftHeading":"the Arabic heading text you read","rows":[{"index":1,"rowDate":"DD/MM/YYYY or null","machine":"...","product":"...","hours":[12 numbers or nulls],"actualTotal":number or null,"note":"any Arabic note written across this row, else null"}]}`;

/**
 * `index` is the row's PRINTED «#» — 1, 2, 3 down the page. It is not used to
 * match anything; it is shown in the preview so a slipped row is visible.
 * Row-slip is the observed failure mode on a real photograph (a row keeps its
 * correct machine and product but is handed the numbers from the line below),
 * and it is the one error the owner cannot catch from the numbers alone.
 */
export type VisionRow = ExtractedRow & { note: string | null; index: number | null };
export type VisionResult = {
  ok: true;
  date: string | null;      // as printed on the paper, unnormalized
  shift: Shift | null;      // null ⇒ heading unreadable, the UI must ask
  shiftHeading: string;
  rows: VisionRow[];
  model: string;
} | {
  ok: false;
  reason: "no_provider" | "vision_failed" | "unreadable" | "rate_limited";
  detail?: string;
};

type RawRow = {
  machine?: unknown; product?: unknown; hours?: unknown;
  actualTotal?: unknown; note?: unknown; index?: unknown; rowDate?: unknown;
};

/** Coerce whatever the model returned into exactly 12 cells. */
function twelve(hours: unknown): (number | null)[] {
  const arr = Array.isArray(hours) ? hours : [];
  const out = arr.slice(0, HOURS_PER_SHIFT).map(parseCell);
  while (out.length < HOURS_PER_SHIFT) out.push(null);
  return out;
}

/**
 * One Gemini call, retried through a 429.
 *
 * The free tier allows 20 requests a minute, and the API's own answer to a 429
 * is "Please retry in 4.6s" — it is a per-MINUTE window, not a dead key. Two
 * supervisors photographing at shift change is enough to trip it, and without
 * this the second one just sees a failure. Verified against the live quota on
 * 2026-08-10 while the limit was actually exhausted.
 *
 * Only 429 is retried. A 400 or 403 will fail identically every time, and
 * retrying a 500 risks a duplicate charge on a paid key for no benefit.
 */
async function callGemini(key: string, base64: string, mimeType: string): Promise<Response> {
  const BACKOFF_MS = [6000, 15000]; // the API asks for ~5s; leave headroom
  let res!: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Image part FIRST, instruction second — the documented-better
          // ordering for a single-image prompt.
          contents: [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }] }],
          generationConfig: {
            temperature: 0,          // transcription, not writing
            responseMimeType: "application/json",
            maxOutputTokens: 8192,   // ~10 machine rows × 12 cells
          },
        }),
        signal: AbortSignal.timeout(90000), // a photo is slower than a digest
      },
    );
    if (res.status !== 429 || attempt >= BACKOFF_MS.length) return res;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
  }
}

export async function readSheetPhoto(base64: string, mimeType: string): Promise<VisionResult> {
  const provider = pickProvider();
  // Anthropic could do this too, but the owner's configured key is Gemini and
  // one vision path is enough; say so plainly rather than half-supporting both.
  if (!provider || provider.kind !== "gemini") return { ok: false, reason: "no_provider" };

  let text: string;
  try {
    const res = await callGemini(provider.key, base64, mimeType);
    if (!res.ok) {
      // 429 survives the retries above only when the quota is genuinely gone
      // (the daily cap, not the per-minute one). Report it distinctly so the
      // page can say "busy, try again shortly" instead of "it broke" — the
      // difference matters to whoever is standing on the floor with a phone.
      const reason = res.status === 429 ? "rate_limited" : "vision_failed";
      return { ok: false, reason, detail: `gemini_${res.status}` };
    }
    const j = await res.json();
    text = j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
  } catch (e) {
    return { ok: false, reason: "vision_failed", detail: e instanceof Error ? e.message : "fetch_failed" };
  }
  if (!text.trim()) return { ok: false, reason: "unreadable" };

  try {
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, reason: "unreadable" };
    const j = JSON.parse(cleaned.slice(start, end + 1)) as {
      date?: unknown; shiftHeading?: unknown; rows?: unknown;
    };

    const heading = String(j.shiftHeading ?? "");
    const rows: VisionRow[] = (Array.isArray(j.rows) ? j.rows : [])
      .map((r: RawRow) => ({
        machine: String(r.machine ?? "").trim(),
        product: String(r.product ?? "").trim(),
        hours: twelve(r.hours),
        actualTotal: parseCell(r.actualTotal),
        note: r.note ? String(r.note).trim() : null,
        index: parseCell(r.index),
      }))
      // A row with no machine cannot be matched to anything.
      .filter((r) => r.machine);

    if (rows.length === 0) return { ok: false, reason: "unreadable" };

    return {
      ok: true,
      date: j.date ? String(j.date).trim() : null,
      shift: detectShift(heading),
      shiftHeading: heading,
      rows,
      model: VISION_MODEL,
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
