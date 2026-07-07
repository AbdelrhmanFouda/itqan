import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OEEData } from "@/lib/oee-data";

/**
 * Daily AI review of the production data.
 *
 * An LLM (Gemini Flash-Lite by default — cheapest; or Claude Haiku) reads a
 * compact digest of the OEE dataset and returns a bilingual (EN/AR) review:
 * summary, findings with severity, and concrete actions. Generated at most
 * ONCE per day per period (cached in Firestore `aiReviews`), so the cost is
 * one small call a day. If no API key is configured — or the call fails —
 * a deterministic rules-based review is produced instead, so the panel
 * always shows something true.
 *
 * Env: GEMINI_API_KEY or ANTHROPIC_API_KEY (either enables the LLM;
 * Gemini wins if both). Optional: AI_REVIEW_PROVIDER=gemini|anthropic,
 * AI_REVIEW_MODEL=<model id>.
 */

export type Bi = { en: string; ar: string };
export type Finding = { severity: "critical" | "warn" | "good" | "info"; en: string; ar: string };
export type Review = { summary: Bi; findings: Finding[]; actions: Bi[] };
export type ReviewEnvelope = {
  review: Review;
  provider: "gemini" | "anthropic" | "rules";
  model: string | null;
  generatedAt: string; // ISO datetime
  day: string;         // Cairo YYYY-MM-DD the review belongs to
  scope: string;       // "all" or "YYYY-MM"
};

/** The factory's operating day — Cairo time, not server/UTC. */
export const cairoDay = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

/* ------------------------------ provider pick ----------------------------- */

type Provider = { kind: "gemini" | "anthropic"; key: string; model: string };

export function pickProvider(): Provider | null {
  const want = (process.env.AI_REVIEW_PROVIDER || "").toLowerCase();
  const gem = process.env.GEMINI_API_KEY?.trim();
  const ant = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.AI_REVIEW_MODEL?.trim();
  if ((want === "anthropic" || (!want && !gem)) && ant)
    return { kind: "anthropic", key: ant, model: model || "claude-haiku-4-5" };
  if (gem) return { kind: "gemini", key: gem, model: model || "gemini-2.5-flash-lite" };
  if (ant) return { kind: "anthropic", key: ant, model: model || "claude-haiku-4-5" };
  return null;
}

/* -------------------------------- digest ---------------------------------- */

const pct = (x: number) => Math.round(x * 1000) / 10; // 0.6823 → 68.2

/** Compact, numbers-only digest the LLM reasons over. Nothing else is sent. */
export function buildDigest(d: OEEData, scope: string, day: string) {
  const o = d.overall;
  return {
    factory: "ITQAN — plastic injection molding, Egypt",
    day,
    period: scope === "all" ? "all recorded history" : `month ${scope}`,
    shiftModel: "two 12h shifts, supervisors log once per shift",
    overall: o && {
      oeePct: pct(o.oee),
      availabilityPct: pct(o.availability),
      availabilityMeasured: d.explain?.availabilityMeasured ?? false, // false → 100% is an ASSUMPTION (no downtime logged)
      performancePct: o.performanceKnown ? pct(o.performance) : null,
      qualityPct: pct(o.quality),
      qualityMeasured: d.explain?.qualityMeasured ?? false, // false → 100% is an ASSUMPTION (no scrap logged)
      weakestFactor: o.weakest,
      standardCoveragePct: pct(o.standardCoverage),
      plannedMin: d.explain?.plannedMin, downtimeMin: d.explain?.downtimeMin,
      runtimeMin: d.explain?.runtimeMin, idealMin: d.explain?.idealMin,
      overspeedCappedMin: d.explain?.overspeedMin, // ideal minutes discarded because output beat the (wrong) standard
      goodUnits: o.goodUnits, scrapUnits: o.scrapUnits,
    },
    machines: d.machines.slice(0, 16).map((m) => ({
      machine: m.machine,
      oeePct: m.performanceKnown ? pct(m.oee) : null,
      availabilityPct: pct(m.availability),
      performancePct: m.performanceKnown ? pct(m.performance) : null,
      qualityPct: pct(m.quality),
      weakest: m.weakest,
      lostMin: Math.round(m.lossDowntimeMin + m.lossPerformanceMin + m.lossQualityMin),
    })),
    suspectStandards: d.suspects.map((s) => ({
      product: s.mold, unitsLogged: s.units, ranAtPctOfStandard: Math.round(s.ratio * 100),
      masterCycleSec: s.masterCycleSec, cavities: s.cavities, impliedCycleSec: s.impliedCycleSec,
      note: "Master cycle time is probably wrong (or Good units over-reported)",
    })),
    productsMissingStandards: d.standardsGap,
    downtimeParetoMin: d.downtime.slice(0, 6),
    trendLast14Days: d.trend.slice(-14).map((t) => ({
      date: t.date, oeePct: t.oee == null ? null : pct(t.oee),
      availabilityPct: pct(t.availability), qualityPct: pct(t.quality),
      scrapRatePct: pct(t.scrapRate), downtimeMin: t.downtimeMin, goodUnits: t.good,
    })),
    dataReadiness: d.readiness && {
      runs: d.readiness.runs,
      runsWithScrapLogged: d.readiness.withScrap,
      runsWithDowntimeLogged: d.readiness.withDowntime,
      runsWithProductNamed: d.readiness.withMold,
      productsSeen: d.readiness.moldsSeen,
      productsSeenWithStandard: d.readiness.moldsSeenWithStd,
    },
  };
}

/* ------------------------------ LLM prompt -------------------------------- */

const PROMPT = `You are the production-intelligence analyst for an Egyptian plastic injection molding factory. Below is today's OEE digest (JSON). Write a daily review for the factory owner.

Rules:
- Use ONLY numbers present in the digest. Never invent data.
- Bilingual: every text in English AND Egyptian-friendly Modern Standard Arabic.
- Be direct and practical, like a plant manager. Short sentences. No fluff.
- If availabilityMeasured or qualityMeasured is false, say clearly that the 100% is an assumption because downtime/scrap is not being logged — and that real OEE is likely lower.
- suspectStandards = products whose Master cycle time is provably wrong (output implies a much faster cycle). Tell the owner exactly what to change (product, current sec, implied sec).
- Rank at most 3 machines to fix first, with the reason (weakest factor) and the minutes lost.
- Mention the trend only if there are at least 3 dated days.
- severity: "critical" (wrong data / big loss), "warn" (needs attention), "good" (working well), "info" (context).

Return STRICT JSON only, no markdown, exactly this shape:
{"summary":{"en":"...","ar":"..."},"findings":[{"severity":"critical|warn|good|info","en":"...","ar":"..."}],"actions":[{"en":"...","ar":"..."}]}
Max 8 findings, max 5 actions.

DIGEST:
`;

/* ---------------------------- provider calls ------------------------------ */

async function callGemini(p: Provider, digest: unknown): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + JSON.stringify(digest) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("");
  if (!text) throw new Error("gemini_empty");
  return text;
}

async function callAnthropic(p: Provider, digest: unknown): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: 2048,
      temperature: 0.2,
      messages: [{ role: "user", content: PROMPT + JSON.stringify(digest) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j?.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  if (!text) throw new Error("anthropic_empty");
  return text;
}

/** Parse the model's output into a Review — tolerant of stray code fences. */
export function parseReview(raw: string): Review {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no_json");
  const j = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Review>;
  const bi = (x: unknown): Bi => {
    const o = (x ?? {}) as Partial<Bi>;
    return { en: String(o.en ?? ""), ar: String(o.ar ?? "") };
  };
  const sev = (s: unknown): Finding["severity"] =>
    s === "critical" || s === "warn" || s === "good" || s === "info" ? s : "info";
  const findings = (Array.isArray(j.findings) ? j.findings : [])
    .map((f) => ({ severity: sev((f as Finding).severity), ...bi(f) }))
    .filter((f) => f.en || f.ar)
    .slice(0, 8);
  const actions = (Array.isArray(j.actions) ? j.actions : []).map(bi).filter((a) => a.en || a.ar).slice(0, 5);
  const summary = bi(j.summary);
  if (!summary.en && !summary.ar && findings.length === 0) throw new Error("empty_review");
  return { summary, findings, actions };
}

/* --------------------------- rules fallback ------------------------------- */

const f1 = (x: number) => x.toFixed(1);

/** Deterministic review — used when no API key is set or the LLM call fails. */
export function rulesReview(d: OEEData): Review {
  const o = d.overall;
  const ex = d.explain;
  const findings: Finding[] = [];
  const actions: Bi[] = [];

  if (!o || d.runCount === 0) {
    return {
      summary: {
        en: "No production runs in this period — nothing to review yet.",
        ar: "لا توجد تشغيلات إنتاج في هذه الفترة — لا يوجد ما يُراجع بعد.",
      },
      findings: [], actions: [],
    };
  }

  if (ex && !ex.availabilityMeasured)
    findings.push({
      severity: "warn",
      en: "Availability reads 100% only because no downtime minutes are logged. It is an assumption, not a measurement — real OEE is likely lower.",
      ar: "الإتاحة تظهر 100% فقط لأن دقائق التوقف غير مسجَّلة. هذا افتراض وليس قياسًا — OEE الحقيقي غالبًا أقل.",
    });
  if (ex && !ex.qualityMeasured)
    findings.push({
      severity: "warn",
      en: "Quality reads 100% only because scrap is not logged. Record scrap per shift to see the true rate.",
      ar: "الجودة تظهر 100% فقط لأن الهالك غير مسجَّل. سجِّل الهالك كل وردية لمعرفة النسبة الحقيقية.",
    });

  for (const s of d.suspects.slice(0, 3)) {
    findings.push({
      severity: "critical",
      en: `"${s.mold}" produced at ${Math.round(s.ratio * 100)}% of its standard — impossible. Master says ${s.masterCycleSec}s/${s.cavities} cav, but output implies ≈${f1(s.impliedCycleSec)}s. Fix the Master cycle (or check the Good count).`,
      ar: `«${s.mold}» أنتج بنسبة ${Math.round(s.ratio * 100)}% من المعيار — وهذا مستحيل. الماستر يقول ${s.masterCycleSec} ث/${s.cavities} تجويف، لكن الإنتاج الفعلي يعني ≈${f1(s.impliedCycleSec)} ث. صحِّح زمن الدورة في Master (أو راجع عدد السليم).`,
    });
    actions.push({
      en: `Update Master cycle time for "${s.mold}": ${s.masterCycleSec}s → ≈${f1(s.impliedCycleSec)}s (verify at the machine first).`,
      ar: `حدِّث زمن الدورة في Master لـ«${s.mold}»: ${s.masterCycleSec} ث → ≈${f1(s.impliedCycleSec)} ث (تحقق عند الماكينة أولاً).`,
    });
  }

  const known = d.machines.filter((m) => m.performanceKnown);
  for (const m of known.slice(0, 3)) {
    const lost = Math.round(m.lossDowntimeMin + m.lossPerformanceMin + m.lossQualityMin);
    const wk = m.weakest === "availability" ? { en: "downtime", ar: "التوقف" }
      : m.weakest === "quality" ? { en: "scrap", ar: "الهالك" }
      : { en: "slow cycle vs standard", ar: "بطء الدورة عن المعيار" };
    findings.push({
      severity: m.oee < 0.4 ? "critical" : "warn",
      en: `${m.machine}: OEE ${f1(m.oee * 100)}% — main problem is ${wk.en} (≈${lost} min of capacity lost in this period).`,
      ar: `${m.machine}: OEE ‏${f1(m.oee * 100)}% — المشكلة الرئيسية هي ${wk.ar} (≈${lost} دقيقة طاقة مفقودة في هذه الفترة).`,
    });
  }

  if (o.standardCoverage < 1 && d.standardsGap.length > 0) {
    const names = d.standardsGap.slice(0, 4).map((g) => g.mold).join("، ");
    findings.push({
      severity: "info",
      en: `${f1((1 - o.standardCoverage) * 100)}% of output has no cycle standard in Master, so it can't be speed-scored. Biggest: ${names}.`,
      ar: `${f1((1 - o.standardCoverage) * 100)}% من الإنتاج بدون معيار دورة في Master فلا يمكن تقييم سرعته. الأهم: ${names}.`,
    });
    actions.push({
      en: "Fill cycle time + cavities in Master for the products listed in the readiness panel.",
      ar: "أكمل زمن الدورة + عدد التجاويف في Master للمنتجات المذكورة في لوحة الجاهزية.",
    });
  }

  if (d.downtime.length > 0) {
    const top = d.downtime[0];
    findings.push({
      severity: "warn",
      en: `Top downtime reason: ${top.reason} (${Math.round(top.minutes)} min).`,
      ar: `أكبر سبب توقف: ${top.reason} (${Math.round(top.minutes)} دقيقة).`,
    });
  }

  const best = known.length ? known[known.length - 1] : null;
  if (best && best.oee >= 0.6)
    findings.push({
      severity: "good",
      en: `${best.machine} is the best performer at ${f1(best.oee * 100)}% OEE.`,
      ar: `${best.machine} هي الأفضل أداءً بنسبة ${f1(best.oee * 100)}% OEE.`,
    });

  if (ex && !ex.availabilityMeasured)
    actions.push({
      en: "Start logging downtime minutes + reason on every shift — Availability is unmeasured today.",
      ar: "ابدأ بتسجيل دقائق التوقف وسببها في كل وردية — الإتاحة غير مقاسة حاليًا.",
    });
  if (ex && !ex.qualityMeasured)
    actions.push({
      en: "Start logging scrap units on every shift — Quality is unmeasured today.",
      ar: "ابدأ بتسجيل عدد الهالك في كل وردية — الجودة غير مقاسة حاليًا.",
    });

  const wf = o.weakest;
  const wfTxt = wf === "availability" ? { en: "downtime", ar: "التوقف" }
    : wf === "quality" ? { en: "scrap", ar: "الهالك" }
    : { en: "running slower than standard", ar: "التشغيل أبطأ من المعيار" };
  return {
    summary: {
      en: `OEE is ${f1(o.oee * 100)}% (${f1(o.availability * 100)}% availability × ${o.performanceKnown ? f1(o.performance * 100) : "—"}% performance × ${f1(o.quality * 100)}% quality). The main limit is ${wfTxt.en}. ${d.suspects.length ? `${d.suspects.length} product standard(s) in Master are provably wrong and were capped so they can't inflate this number.` : ""}`,
      ar: `OEE هو ${f1(o.oee * 100)}% (إتاحة ${f1(o.availability * 100)}% × أداء ${o.performanceKnown ? f1(o.performance * 100) : "—"}% × جودة ${f1(o.quality * 100)}%). العامل المُقيِّد الرئيسي هو ${wfTxt.ar}. ${d.suspects.length ? `يوجد ${d.suspects.length} معيار خاطئ في Master تم تحييده حتى لا يضخّم الرقم.` : ""}`,
    },
    findings: findings.slice(0, 8),
    actions: actions.slice(0, 5),
  };
}

/* ------------------------------ generation -------------------------------- */

export async function generateReview(
  data: OEEData,
  scope: string,
  day: string,
): Promise<Omit<ReviewEnvelope, "day" | "scope"> & { day: string; scope: string; llmError?: string }> {
  const provider = pickProvider();
  const generatedAt = new Date().toISOString();
  if (provider) {
    try {
      const digest = buildDigest(data, scope, day);
      const raw = provider.kind === "gemini"
        ? await callGemini(provider, digest)
        : await callAnthropic(provider, digest);
      return { review: parseReview(raw), provider: provider.kind, model: provider.model, generatedAt, day, scope };
    } catch (e) {
      console.error("ai-review llm failed, falling back to rules:", e);
      return {
        review: rulesReview(data), provider: "rules", model: null, generatedAt, day, scope,
        llmError: String(e instanceof Error ? e.message : e).slice(0, 200),
      };
    }
  }
  return { review: rulesReview(data), provider: "rules", model: null, generatedAt, day, scope };
}

/* ------------------------------ Firestore cache --------------------------- */

const cacheId = (day: string, scope: string) => `${day}_${scope}`;

export async function readCachedReview(day: string, scope: string): Promise<ReviewEnvelope | null> {
  try {
    const snap = await getDoc(doc(db, "aiReviews", cacheId(day, scope)));
    if (!snap.exists()) return null;
    const d = snap.data() as ReviewEnvelope;
    return d?.review ? d : null;
  } catch {
    return null; // cache is best-effort — never block the review on Firestore
  }
}

export async function writeCachedReview(env: ReviewEnvelope): Promise<void> {
  try {
    await setDoc(doc(db, "aiReviews", cacheId(env.day, env.scope)), env);
  } catch (e) {
    console.error("ai-review cache write failed:", e);
  }
}
