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

const PROMPT = `You are reading a photograph of a paper production log from an Egyptian plastic injection factory. It is a printed grid filled in BY HAND in blue pen.

The sheet is one shift. Its heading says either «الوردية المسائية» (evening) or «الوردية الصباحية» (morning). Read that heading.

Columns, RIGHT to LEFT as printed:
  # | التاريخ (date) | الماكينة/الكود (machine code, e.g. "PQ 1 — 550") | المنتج / الاسطمبة (product) | then TWELVE hour columns labelled 8:00 9:00 10:00 11:00 12:00 1:00 2:00 3:00 4:00 5:00 6:00 7:00 | الأجمالي سستم | الأجمالي الفعلي

RULES — read them carefully, they matter more than speed:
- Numbers are handwritten, often in Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩). Return them as ordinary digits.
- "hours" MUST have exactly 12 entries, left to right in the PRINTED column order 8:00 … 7:00.
- An EMPTY cell is null. A dash, a tick, a scribble or Arabic words such as «متوقف» or «صيانة» written across cells is ALSO null — never 0. Only return 0 if a zero is actually written.
- Do NOT copy a value sideways to fill blanks. Many rows genuinely repeat the same number every hour; only report what you can see in each cell.
- Ignore the printed «الأجمالي سستم» column — it is computed. Report only «الأجمالي الفعلي» as actualTotal, or null.
- Include every machine row that has any handwriting. Skip entirely blank rows.
- If you cannot read a cell confidently, use null rather than guessing.

Return STRICT JSON only, no markdown, exactly this shape:
{"date":"DD/MM/YYYY or null","shiftHeading":"the Arabic heading text you read","rows":[{"machine":"...","product":"...","hours":[12 numbers or nulls],"actualTotal":number or null,"note":"any Arabic note written across this row, else null"}]}`;

export type VisionRow = ExtractedRow & { note: string | null };
export type VisionResult = {
  ok: true;
  date: string | null;      // as printed on the paper, unnormalized
  shift: Shift | null;      // null ⇒ heading unreadable, the UI must ask
  shiftHeading: string;
  rows: VisionRow[];
  model: string;
} | {
  ok: false;
  reason: "no_provider" | "vision_failed" | "unreadable";
  detail?: string;
};

type RawRow = {
  machine?: unknown; product?: unknown; hours?: unknown;
  actualTotal?: unknown; note?: unknown;
};

/** Coerce whatever the model returned into exactly 12 cells. */
function twelve(hours: unknown): (number | null)[] {
  const arr = Array.isArray(hours) ? hours : [];
  const out = arr.slice(0, HOURS_PER_SHIFT).map(parseCell);
  while (out.length < HOURS_PER_SHIFT) out.push(null);
  return out;
}

export async function readSheetPhoto(base64: string, mimeType: string): Promise<VisionResult> {
  const provider = pickProvider();
  // Anthropic could do this too, but the owner's configured key is Gemini and
  // one vision path is enough; say so plainly rather than half-supporting both.
  if (!provider || provider.kind !== "gemini") return { ok: false, reason: "no_provider" };

  let text: string;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${provider.key}`,
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
    if (!res.ok) {
      return { ok: false, reason: "vision_failed", detail: `gemini_${res.status}` };
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
