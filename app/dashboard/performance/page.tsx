"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { DOWNTIME_REASONS, localize } from "@/lib/prod-meta";
import { Stat, Spinner, EmptyState } from "@/components/dashboard/ui";
import { DonutGauge, TrendChart, Pareto, LossBars, ChartCard, fmtPct, fmtNum } from "@/components/dashboard/charts";
import { formatDate } from "@/lib/dates";
import { useCallback, useEffect, useState } from "react";

type OEE = {
  availability: number; performance: number; quality: number; oee: number;
  performanceKnown: boolean; standardCoverage: number;
  plannedMin: number; runtimeMin: number; downtimeMin: number;
  goodUnits: number; scrapUnits: number; totalUnits: number;
  lossDowntimeMin: number; lossPerformanceMin: number; lossQualityMin: number;
  weakest: "availability" | "performance" | "quality" | null;
};
type MachineRow = OEE & { machine: string };
type Bottleneck = {
  machine: string;
  factor: "downtime" | "performance" | "quality";
  factorMin: number;
  lostMin: number;
  oee: number;
  performanceKnown: boolean;
  recoverablePct: number | null;
  topDowntimeReason: string | null;
};
type TrendPoint = {
  date: string; availability: number; performance: number | null; quality: number;
  oee: number | null; good: number; scrap: number; scrapRate: number; downtimeMin: number;
};
type Readiness = {
  runs: number; stubs: number; withMold: number; withScrap: number; withDowntime: number;
  plannedSource: { column: number; machines: number; default: number };
  machinesTabFound: boolean; defaultShiftMin: number;
  standardsInMaster: number; moldsSeen: number; moldsSeenWithStd: number;
};
type Suspect = {
  mold: string; units: number; runtimeMin: number; ratio: number;
  masterCycleSec: number; cavities: number; impliedCycleSec: number;
};
type Explain = {
  availabilityMeasured: boolean; qualityMeasured: boolean;
  plannedMin: number; downtimeMin: number; runtimeMin: number;
  stdRuntimeMin: number; idealMin: number; overspeedMin: number;
  goodUnits: number; scrapUnits: number;
};
type Data = {
  overall: OEE | null;
  bottlenecks: Bottleneck[];
  machines: MachineRow[];
  downtime: { reason: string; minutes: number }[];
  trend: TrendPoint[];
  months: string[];
  readiness: Readiness | null;
  standardsGap: { mold: string; units: number }[];
  suspects: Suspect[];
  explain: Explain | null;
  runCount: number;
  configured: boolean;
};
type Bi = { en: string; ar: string };
type Finding = { severity: "critical" | "warn" | "good" | "info"; en: string; ar: string };
type ReviewPayload = {
  review: { summary: Bi; findings: Finding[]; actions: Bi[] } | null;
  provider: "gemini" | "anthropic" | "rules" | null;
  model: string | null;
  generatedAt: string | null;
  cached: boolean;
  llmConfigured: boolean;
  configured: boolean;
};

const L = {
  en: {
    title: "Performance — OEE", subtitle: "Overall Equipment Effectiveness, by machine",
    thisMonth: "This month", allTime: "All time",
    oee: "OEE", availability: "Availability", performance: "Performance", quality: "Quality",
    byMachine: "OEE by machine", worstFirst: "constraint first",
    limiting: "Limiting factor", coverage: "standard coverage", noStd: "no cycle standard",
    downtime: "Downtime by reason", scrapTrend: "Scrap-rate trend", min: "min",
    empty: "No production runs in this period yet. Log runs to see OEE.",
    tryAll: "There may be data in other months — view All time.",
    unreachable: "Couldn't reach the data sheet. Check the connection and reload.",
    factor: { availability: "Availability", performance: "Performance", quality: "Quality" },
    bottleneck: "Bottleneck Board", fixFirst: "fix this first",
    lostCap: "lost", recover: "recover", ofOutput: "of this machine's output",
    factorName: { downtime: "Downtime", performance: "Slow cycle", quality: "Scrap" },
    act: {
      downtime: (m: string, r: string) => `Cut downtime on ${m} — biggest cause: ${r}.`,
      performance: (m: string) => `${m} is running slower than its standard — check tooling, material and operator.`,
      quality: (m: string) => `High scrap on ${m} — review the mold's known defects.`,
    },
    trend: "Daily trend", trendHint: "availability · quality · OEE",
    lossTitle: "Where capacity is lost", lossHint: "minutes per machine",
    lossNames: { down: "Downtime", perf: "Slow cycle", qual: "Scrap" },
    assumed: "assumed — scrap not logged yet",
    noDowntimeLogged: "no downtime logged yet",
    needsMold: "needs product names on runs",
    needsStd: "needs cycle+cavities in Master",
    readiness: "Data readiness — what to log to make OEE true",
    readinessIntro: "Each OEE factor only counts what is actually logged. Missing pieces:",
    rMold: (n: number, t: number) => `${n}/${t} runs name their product or mold — required for Performance and full OEE`,
    rScrap: (n: number, t: number) => `${n}/${t} runs log scrap units — Quality is assumed 100% where missing`,
    rDown: (n: number, t: number) => `${n}/${t} runs log downtime — Availability assumes no stops where missing`,
    rMachines: (d: number) => `Machines tab not found — planned time uses the default ${d} min shift`,
    rMachinesPartial: (n: number, d: number) => `${n} runs fell back to the default ${d} min shift — add those machines to the Machines tab`,
    rStd: (k: number, s: number) => `${k}/${s} logged molds have a cycle standard in Master`,
    rStubs: (n: number) => `${n} empty rows in the Production tab were ignored`,
    fillMaster: "Fill cycle + cavities in Master for:", units: "pcs",
    explainTitle: "How is this number calculated?",
    explainIntro: "OEE = Availability × Performance × Quality. Every input below comes straight from the sheet:",
    exA: "Availability = run time ÷ planned time",
    exP: "Performance = ideal time for the units made ÷ run time (only products with a Master standard)",
    exQ: "Quality = good units ÷ total units",
    measured: "measured", assumedChip: "assumed — not logged",
    minutes: "min",
    overspeedNote: (m: number) =>
      `${m} “impossible” ideal minutes were capped: some products out-produce their Master standard, which used to inflate this number. Their wrong standards are listed below.`,
    suspectsTitle: "Wrong cycle standards in Master",
    suspectsIntro: "These products produced far more than their standard allows — the Master cycle time is wrong (or Good counts are over-reported). Until fixed, their speed score is capped at 100%:",
    sProduct: "Product", sMasterCyc: "Master cycle", sImplied: "actual implies", sUnits: "units", sRatio: "ran at",
    aiTitle: "AI Review", aiDaily: "regenerated daily",
    aiUpdated: "Updated", aiRegen: "Regenerate", aiRegenerating: "Regenerating…",
    aiActions: "Do next",
    aiRules: "Built-in analysis (no AI key set — add GEMINI_API_KEY or ANTHROPIC_API_KEY for an AI-written review)",
    aiUnavailable: "Couldn't load the review.",
  },
  ar: {
    title: "الأداء — OEE", subtitle: "الفعالية الكلية للمعدات، لكل ماكينة",
    thisMonth: "هذا الشهر", allTime: "كل الوقت",
    oee: "OEE", availability: "الإتاحة", performance: "الأداء", quality: "الجودة",
    byMachine: "OEE لكل ماكينة", worstFirst: "الأضعف أولاً",
    limiting: "العامل المُقيِّد", coverage: "تغطية المعايير", noStd: "لا يوجد معيار دورة",
    downtime: "التوقف حسب السبب", scrapTrend: "اتجاه نسبة الهالك", min: "د",
    empty: "لا توجد تشغيلات إنتاج في هذه الفترة بعد. سجّل التشغيلات لرؤية OEE.",
    tryAll: "قد توجد بيانات في أشهر أخرى — اعرض كل الوقت.",
    unreachable: "تعذّر الوصول إلى جدول البيانات. تحقق من الاتصال وأعد التحميل.",
    factor: { availability: "الإتاحة", performance: "الأداء", quality: "الجودة" },
    bottleneck: "لوحة الاختناقات", fixFirst: "ابدأ بإصلاح هذا",
    lostCap: "مفقودة", recover: "استرجاع", ofOutput: "من إنتاج هذه الماكينة",
    factorName: { downtime: "توقف", performance: "بطء الدورة", quality: "هالك" },
    act: {
      downtime: (m: string, r: string) => `قلّل توقف ${m} — أكبر سبب: ${r}.`,
      performance: (m: string) => `${m} تعمل أبطأ من المعدل القياسي — افحص الاسطمبة والخامة والعامل.`,
      quality: (m: string) => `هالك مرتفع على ${m} — راجع عيوب الاسطمبة المعروفة.`,
    },
    trend: "الاتجاه اليومي", trendHint: "الإتاحة · الجودة · OEE",
    lossTitle: "أين تُفقد الطاقة الإنتاجية", lossHint: "دقائق لكل ماكينة",
    lossNames: { down: "توقف", perf: "بطء الدورة", qual: "هالك" },
    assumed: "افتراضي — الهالك غير مسجَّل بعد",
    noDowntimeLogged: "لا يوجد توقف مسجَّل بعد",
    needsMold: "يحتاج اسم المنتج في التشغيلات",
    needsStd: "يحتاج زمن الدورة والكافيتي في Master",
    readiness: "جاهزية البيانات — ما يجب تسجيله ليكون OEE حقيقيًا",
    readinessIntro: "كل عامل في OEE يُحسب فقط مما يُسجَّل فعلاً. الناقص:",
    rMold: (n: number, t: number) => `${n}/${t} تشغيلات بها اسم المنتج أو كود الاسطمبة — مطلوب لحساب الأداء وOEE الكامل`,
    rScrap: (n: number, t: number) => `${n}/${t} تشغيلات مسجَّل بها الهالك — الجودة تُفترض 100% عند غيابه`,
    rDown: (n: number, t: number) => `${n}/${t} تشغيلات مسجَّل بها التوقف — الإتاحة تفترض عدم وجود توقف عند غيابه`,
    rMachines: (d: number) => `تبويب Machines غير موجود — الزمن المخطط يستخدم وردية افتراضية ${d} دقيقة`,
    rMachinesPartial: (n: number, d: number) => `${n} تشغيلات استخدمت الوردية الافتراضية ${d} دقيقة — أضف هذه الماكينات إلى تبويب Machines`,
    rStd: (k: number, s: number) => `${k}/${s} من الاسطمبات المسجَّلة لها معيار دورة في Master`,
    rStubs: (n: number) => `تم تجاهل ${n} صفوف فارغة في تبويب Production`,
    fillMaster: "أكمل زمن الدورة + الكافيتي في Master لـ:", units: "قطعة",
    explainTitle: "كيف يُحسب هذا الرقم؟",
    explainIntro: "OEE = الإتاحة × الأداء × الجودة. كل رقم أدناه يأتي مباشرة من الشيت:",
    exA: "الإتاحة = زمن التشغيل ÷ الزمن المخطط",
    exP: "الأداء = الزمن المثالي للقطع المنتَجة ÷ زمن التشغيل (فقط المنتجات التي لها معيار في Master)",
    exQ: "الجودة = القطع السليمة ÷ إجمالي القطع",
    measured: "مُقاس", assumedChip: "افتراضي — غير مسجَّل",
    minutes: "د",
    overspeedNote: (m: number) =>
      `تم تحييد ${m} دقيقة مثالية «مستحيلة»: بعض المنتجات تنتج أكثر مما يسمح به معيارها في Master، وكان هذا يضخّم الرقم سابقًا. معاييرها الخاطئة مذكورة أدناه.`,
    suspectsTitle: "معايير دورة خاطئة في Master",
    suspectsIntro: "هذه المنتجات أنتجت أكثر بكثير مما يسمح به معيارها — زمن الدورة في Master خاطئ (أو عدد السليم مبالغ فيه). حتى يتم التصحيح، سرعتها محسوبة بحد أقصى 100%:",
    sProduct: "المنتج", sMasterCyc: "دورة Master", sImplied: "الفعلي يعني", sUnits: "قطعة", sRatio: "اشتغل بنسبة",
    aiTitle: "المراجعة الذكية", aiDaily: "تتجدد يوميًا",
    aiUpdated: "آخر تحديث", aiRegen: "إعادة التوليد", aiRegenerating: "جارٍ التوليد…",
    aiActions: "الخطوات التالية",
    aiRules: "تحليل مدمج (لا يوجد مفتاح AI — أضف GEMINI_API_KEY أو ANTHROPIC_API_KEY لمراجعة مكتوبة بالذكاء الاصطناعي)",
    aiUnavailable: "تعذّر تحميل المراجعة.",
  },
};

const pf = (x: number) => `${(x * 100).toFixed(1)}%`;
const oeeText = (x: number) => (x >= 0.85 ? "text-green-600" : x >= 0.6 ? "text-amber-600" : "text-red-600");

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden" dir="ltr">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export default function PerformancePage() {
  const { lang } = useLang();
  const p = pd[lang];
  const t = L[lang];
  const isAr = lang === "ar";
  const thisMonth = new Date().toISOString().slice(0, 7);

  const [period, setPeriod] = useState<"month" | "all">("month");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const q = period === "month" ? `?month=${thisMonth}` : "";
      const res = await fetch(`/api/oee${q}`);
      if (!res.ok) throw new Error("bad_status");
      setData(await res.json());
    } catch {
      setError(true); // keep any previously-loaded data on screen
    } finally {
      setLoading(false);
    }
  }, [period, thisMonth]);
  useEffect(() => { load(); }, [load]);

  const loadReview = useCallback(async (refresh = false) => {
    setReviewBusy(true);
    try {
      const params = new URLSearchParams();
      if (period === "month") params.set("month", thisMonth);
      if (refresh) params.set("refresh", "1");
      const qs = params.toString();
      const res = await fetch(`/api/ai-review${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("bad_status");
      setReview(await res.json());
    } catch {
      setReview((r) => r ?? { review: null, provider: null, model: null, generatedAt: null, cached: false, llmConfigured: false, configured: false });
    } finally {
      setReviewBusy(false);
    }
  }, [period, thisMonth]);
  useEffect(() => { loadReview(); }, [loadReview]);

  const reasonLabel = (r: string) => localize(r, DOWNTIME_REASONS, p.runs.reasons);
  const pf0 = (x: number) => `${Math.round(x * 100)}%`;
  const action = (b: Bottleneck) =>
    b.factor === "downtime"
      ? t.act.downtime(b.machine, b.topDowntimeReason ? reasonLabel(b.topDowntimeReason) : "—")
      : b.factor === "performance"
        ? t.act.performance(b.machine)
        : t.act.quality(b.machine);

  if (loading && !data) return <Spinner text={p.common.loading} />;
  if ((error && !data) || (data && !data.configured)) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t.title}</h1>
        <p className="text-sm text-gray-500 mb-6">{t.subtitle}</p>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">{t.unreachable}</div>
      </div>
    );
  }
  if (!data) return <Spinner text={p.common.loading} />;

  const o = data.overall;
  const r = data.readiness;

  // Readiness checklist — only imperfect items are listed.
  const readinessItems: { ok: boolean; text: string }[] = [];
  if (r && r.runs > 0) {
    if (r.withMold < r.runs) readinessItems.push({ ok: false, text: t.rMold(r.withMold, r.runs) });
    if (r.withScrap < r.runs) readinessItems.push({ ok: false, text: t.rScrap(r.withScrap, r.runs) });
    if (r.withDowntime < r.runs) readinessItems.push({ ok: false, text: t.rDown(r.withDowntime, r.runs) });
    if (!r.machinesTabFound) readinessItems.push({ ok: false, text: t.rMachines(r.defaultShiftMin) });
    else if (r.plannedSource.default > 0) readinessItems.push({ ok: false, text: t.rMachinesPartial(r.plannedSource.default, r.defaultShiftMin) });
    if (r.moldsSeen > 0 && r.moldsSeenWithStd < r.moldsSeen) readinessItems.push({ ok: false, text: t.rStd(r.moldsSeenWithStd, r.moldsSeen) });
    if (r.stubs > 0) readinessItems.push({ ok: true, text: t.rStubs(r.stubs) });
  }

  const trendLabels = data.trend.map((d) => formatDate(d.date, lang));
  const maxScrapRate = Math.max(0.05, ...data.trend.map((d) => d.scrapRate * 1.25));
  const lossRows = data.machines
    .map((m) => ({
      label: m.machine,
      down: m.lossDowntimeMin,
      perf: m.lossPerformanceMin,
      qual: m.lossQualityMin,
    }))
    .filter((x) => x.down + x.perf + x.qual > 0)
    .sort((a, b) => b.down + b.perf + b.qual - (a.down + a.perf + a.qual));

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <div className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 ${isAr ? "flex-row-reverse" : ""}`}>
          {(["month", "all"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                period === key ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {key === "month" ? t.thisMonth : t.allTime}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t.subtitle}</p>

      {data.runCount === 0 || !o ? (
        <div>
          <EmptyState text={t.empty} />
          {period === "month" && data.months.length > 0 && (
            <p className="text-center mt-3">
              <button onClick={() => setPeriod("all")} className="text-xs text-blue-600 hover:underline">{t.tryAll}</button>
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Headline: OEE gauge + A / P / Q */}
          <div className={`grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 mb-3 ${isAr ? "sm:grid-cols-[1fr_auto]" : ""}`}>
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-center ${isAr ? "sm:order-2" : ""}`}>
              <DonutGauge
                value={o.oee}
                known={o.performanceKnown}
                label={t.oee}
                sublabel={o.weakest ? `${t.limiting}: ${t.factor[o.weakest]}` : undefined}
                isAr={isAr}
              />
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${isAr ? "sm:order-1" : ""}`}>
              <Stat
                label={t.availability}
                value={pf(o.availability)}
                tone={o.weakest === "availability" ? "red" : undefined}
                sub={r && r.withDowntime === 0 ? t.noDowntimeLogged : undefined}
              />
              <Stat
                label={t.performance}
                value={o.performanceKnown ? pf(o.performance) : "—"}
                tone={o.weakest === "performance" ? "red" : undefined}
                sub={!o.performanceKnown ? (r && r.moldsSeen === 0 ? t.needsMold : t.needsStd) : undefined}
              />
              <Stat
                label={t.quality}
                value={pf(o.quality)}
                tone={o.weakest === "quality" ? "red" : undefined}
                sub={r && r.withScrap === 0 ? t.assumed : undefined}
              />
            </div>
          </div>
          {o.performanceKnown && o.standardCoverage < 1 && (
            <p className="text-xs text-gray-400 mb-3">{t.coverage}: {pf(o.standardCoverage)}</p>
          )}

          {/* How is this number calculated — full audit trail of the headline */}
          {data.explain && (
            <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
              <h2 className={`text-sm font-semibold text-gray-900 mb-1 ${isAr ? "text-right" : ""}`}>{t.explainTitle}</h2>
              <p className={`text-xs text-gray-500 mb-3 ${isAr ? "text-right" : ""}`}>{t.explainIntro}</p>
              <div className="space-y-2">
                {([
                  [t.exA, `${fmtNum(data.explain.runtimeMin, isAr)} ÷ ${fmtNum(data.explain.plannedMin, isAr)} ${t.minutes}`,
                    pf(o.availability), data.explain.availabilityMeasured, true],
                  [t.exP, `${fmtNum(data.explain.idealMin, isAr)} ÷ ${fmtNum(data.explain.stdRuntimeMin, isAr)} ${t.minutes}`,
                    o.performanceKnown ? pf(o.performance) : "—", true, o.performanceKnown],
                  [t.exQ, `${fmtNum(data.explain.goodUnits, isAr)} ÷ ${fmtNum(data.explain.goodUnits + data.explain.scrapUnits, isAr)} ${t.units}`,
                    pf(o.quality), data.explain.qualityMeasured, true],
                ] as const).map(([label, calc, result, measured, known], i) => (
                  <div key={i} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${isAr ? "flex-row-reverse text-right" : ""}`}>
                    <span className="text-gray-600 flex-1 min-w-[220px]">{label}</span>
                    <span className="text-gray-400 whitespace-nowrap" dir="ltr">{calc}</span>
                    <span className={`font-semibold whitespace-nowrap ${known ? "text-gray-900" : "text-gray-300"}`} dir="ltr">= {result}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                      measured ? "border-green-200 bg-green-50 text-green-700" : "border-amber-300 bg-amber-50 text-amber-700"
                    }`}>{measured ? t.measured : t.assumedChip}</span>
                  </div>
                ))}
                <div className={`pt-2 border-t border-gray-100 text-xs font-semibold text-gray-900 ${isAr ? "text-right" : ""}`}>
                  <span dir="ltr">
                    {t.oee} = {pf(o.availability)} × {o.performanceKnown ? pf(o.performance) : "—"} × {pf(o.quality)} ={" "}
                    <span className={o.performanceKnown ? oeeText(o.oee) : "text-gray-300"}>{o.performanceKnown ? pf(o.oee) : "—"}</span>
                  </span>
                </div>
              </div>
              {data.explain.overspeedMin > 1 && (
                <p className={`mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 ${isAr ? "text-right" : ""}`}>
                  {t.overspeedNote(Math.round(data.explain.overspeedMin))}
                </p>
              )}
              {data.suspects.length > 0 && (
                <div className="mt-3">
                  <h3 className={`text-xs font-semibold text-red-700 mb-1 ${isAr ? "text-right" : ""}`}>{t.suspectsTitle}</h3>
                  <p className={`text-xs text-gray-500 mb-2 ${isAr ? "text-right" : ""}`}>{t.suspectsIntro}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" dir={isAr ? "rtl" : "ltr"}>
                      <thead>
                        <tr className="text-gray-400">
                          <th className={`py-1 font-medium ${isAr ? "text-right" : "text-left"}`}>{t.sProduct}</th>
                          <th className={`py-1 font-medium ${isAr ? "text-right" : "text-left"}`}>{t.sMasterCyc}</th>
                          <th className={`py-1 font-medium ${isAr ? "text-right" : "text-left"}`}>{t.sImplied}</th>
                          <th className={`py-1 font-medium ${isAr ? "text-right" : "text-left"}`}>{t.sRatio}</th>
                          <th className={`py-1 font-medium ${isAr ? "text-right" : "text-left"}`}>{t.sUnits}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.suspects.map((s) => (
                          <tr key={s.mold} className="border-t border-gray-100">
                            <td className="py-1.5 font-medium text-gray-900">{s.mold}</td>
                            <td className="py-1.5 text-gray-600" dir="ltr">{s.masterCycleSec}s × {s.cavities}</td>
                            <td className="py-1.5 text-red-600 font-semibold" dir="ltr">≈{s.impliedCycleSec}s</td>
                            <td className="py-1.5 text-gray-600" dir="ltr">{Math.round(s.ratio * 100)}%</td>
                            <td className="py-1.5 text-gray-600">{fmtNum(s.units, isAr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Review — daily narrative, grounded in the same dataset */}
          <div className="mb-10 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <div className={`flex flex-wrap items-center gap-2 mb-2 ${isAr ? "flex-row-reverse" : ""}`}>
              <h2 className="text-sm font-semibold text-indigo-900">{t.aiTitle}</h2>
              <span className="text-xs text-indigo-400">· {t.aiDaily}</span>
              {review?.generatedAt && (
                <span className="text-xs text-gray-400">
                  {t.aiUpdated}: {new Date(review.generatedAt).toLocaleString(isAr ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => loadReview(true)}
                disabled={reviewBusy}
                className="text-xs px-2.5 py-1 rounded-md border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {reviewBusy ? t.aiRegenerating : t.aiRegen}
              </button>
            </div>
            {!review || (reviewBusy && !review.review) ? (
              <p className={`text-xs text-gray-400 ${isAr ? "text-right" : ""}`}>…</p>
            ) : !review.configured || !review.review ? (
              <p className={`text-xs text-gray-500 ${isAr ? "text-right" : ""}`}>{t.aiUnavailable}</p>
            ) : (
              <>
                <p className={`text-sm text-gray-800 mb-3 leading-relaxed ${isAr ? "text-right" : ""}`}>
                  {isAr ? review.review.summary.ar || review.review.summary.en : review.review.summary.en || review.review.summary.ar}
                </p>
                {review.review.findings.length > 0 && (
                  <ul className="space-y-1.5 mb-3">
                    {review.review.findings.map((f, i) => (
                      <li key={i} className={`flex items-start gap-2 text-xs ${isAr ? "flex-row-reverse text-right" : ""}`}>
                        <span className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                          f.severity === "critical" ? "border-red-200 bg-red-100 text-red-700"
                          : f.severity === "warn" ? "border-amber-200 bg-amber-100 text-amber-700"
                          : f.severity === "good" ? "border-green-200 bg-green-100 text-green-700"
                          : "border-gray-200 bg-gray-100 text-gray-600"
                        }`}>●</span>
                        <span className="text-gray-700">{isAr ? f.ar || f.en : f.en || f.ar}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {review.review.actions.length > 0 && (
                  <div className={isAr ? "text-right" : ""}>
                    <h3 className="text-xs font-semibold text-indigo-900 mb-1">{t.aiActions}</h3>
                    <ol className={`space-y-1 ${isAr ? "pr-4" : "pl-4"} list-decimal text-xs text-gray-700`} dir={isAr ? "rtl" : "ltr"}>
                      {review.review.actions.map((a, i) => (
                        <li key={i}>{isAr ? a.ar || a.en : a.en || a.ar}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <p className={`mt-3 text-[10px] text-gray-400 ${isAr ? "text-right" : ""}`}>
                  {review.provider === "rules" ? t.aiRules : review.model ? `${review.provider} · ${review.model}` : ""}
                </p>
              </>
            )}
          </div>

          {/* Data readiness — the honesty panel */}
          {readinessItems.length > 0 && (
            <div className="mb-10 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className={`text-sm font-semibold text-amber-800 mb-1 ${isAr ? "text-right" : ""}`}>{t.readiness}</h2>
              <p className={`text-xs text-amber-700 mb-2 ${isAr ? "text-right" : ""}`}>{t.readinessIntro}</p>
              <ul className="space-y-1.5">
                {readinessItems.map((it, i) => (
                  <li key={i} className={`flex items-start gap-2 text-xs ${isAr ? "flex-row-reverse text-right" : ""}`}>
                    <span className={`mt-0.5 shrink-0 ${it.ok ? "text-green-600" : "text-amber-600"}`}>{it.ok ? "✓" : "●"}</span>
                    <span className="text-gray-700">{it.text}</span>
                  </li>
                ))}
              </ul>
              {data.standardsGap.length > 0 && (
                <div className={`mt-3 ${isAr ? "text-right" : ""}`}>
                  <span className="text-xs font-medium text-amber-800">{t.fillMaster}</span>
                  <div className={`flex flex-wrap gap-1.5 mt-1.5 ${isAr ? "flex-row-reverse" : ""}`}>
                    {data.standardsGap.map((g) => (
                      <span key={g.mold} className="text-xs bg-white border border-amber-200 text-gray-700 rounded-full px-2.5 py-0.5">
                        {g.mold} · {fmtNum(g.units, isAr)} {t.units}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottleneck Board — fix this first */}
          {data.bottlenecks.length > 0 && (
            <div className="mb-10">
              <div className={`flex items-baseline gap-2 mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <h2 className="text-sm font-semibold text-gray-900">{t.bottleneck}</h2>
                <span className="text-xs text-gray-400">· {t.fixFirst}</span>
              </div>
              <div className="space-y-3">
                {data.bottlenecks.map((b, i) => (
                  <div key={b.machine} className={`rounded-xl p-4 border ${i === 0 ? "border-red-300 bg-red-50/50" : "border-gray-200 bg-white"}`}>
                    <div className={`flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                      <div className={`flex items-center gap-2.5 ${isAr ? "flex-row-reverse" : ""}`}>
                        <span className={`w-6 h-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${i === 0 ? "bg-red-600 text-white" : "bg-gray-200 text-gray-600"}`}>{i + 1}</span>
                        <span className="font-medium text-gray-900">{b.machine}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${i === 0 ? "border-red-200 bg-red-100 text-red-700" : "border-gray-200 bg-gray-50 text-gray-600"}`}>{t.factorName[b.factor]}</span>
                      </div>
                      <div className={`shrink-0 ${isAr ? "text-start" : "text-end"}`}>
                        <div className="text-sm font-semibold text-red-600 whitespace-nowrap">{fmtNum(b.factorMin, isAr)} {t.min} {t.lostCap}</div>
                        {b.recoverablePct != null && (
                          <div className="text-xs text-gray-400 whitespace-nowrap">{t.recover} ≈ {pf0(b.recoverablePct)} {t.ofOutput}</div>
                        )}
                      </div>
                    </div>
                    <p className={`text-xs text-gray-600 mt-2 ${isAr ? "text-right" : ""}`}>{action(b)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily trend — availability / quality / OEE */}
          {data.trend.length > 1 && (
            <ChartCard title={t.trend} hint={t.trendHint} isAr={isAr}>
              <TrendChart
                isAr={isAr}
                labels={trendLabels}
                series={[
                  { name: t.availability, color: "#6b7280", values: data.trend.map((d) => d.availability) },
                  { name: t.quality, color: "#16a34a", values: data.trend.map((d) => d.quality) },
                  { name: t.oee, color: "#2563eb", values: data.trend.map((d) => d.oee) },
                ]}
              />
            </ChartCard>
          )}

          {/* Where capacity is lost — stacked minutes per machine */}
          {lossRows.length > 0 && (
            <ChartCard title={t.lossTitle} hint={t.lossHint} isAr={isAr}>
              <LossBars rows={lossRows} isAr={isAr} unit={t.min} names={t.lossNames} />
            </ChartCard>
          )}

          {/* OEE by machine — constraint first */}
          <div className={`flex items-baseline gap-2 mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
            <h2 className="text-sm font-semibold text-gray-900">{t.byMachine}</h2>
            <span className="text-xs text-gray-400">· {t.worstFirst}</span>
          </div>
          <div className="space-y-3 mb-10">
            {data.machines.map((m) => (
              <div key={m.machine} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className={`flex items-center justify-between mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="font-medium text-gray-900">{m.machine}</span>
                  <span className={`text-lg font-bold ${m.performanceKnown ? oeeText(m.oee) : "text-gray-300"}`}>
                    {m.performanceKnown ? pf(m.oee) : t.noStd}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {([
                    ["availability", m.availability, true],
                    ["performance", m.performance, m.performanceKnown],
                    ["quality", m.quality, true],
                  ] as const).map(([k, val, known]) => (
                    <div key={k}>
                      <div className={`flex items-center justify-between text-xs mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                        <span className="text-gray-500">{t.factor[k]}</span>
                        <span className={`font-medium ${m.weakest === k ? "text-red-600" : "text-gray-700"}`}>
                          {known ? pf(val) : "—"}
                        </span>
                      </div>
                      <Bar value={known ? val : 0} max={1} tone={m.weakest === k ? "bg-red-500" : "bg-gray-300"} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Downtime Pareto */}
          {data.downtime.length > 0 && (
            <ChartCard title={t.downtime} isAr={isAr}>
              <Pareto
                isAr={isAr}
                unit={t.min}
                items={data.downtime.map((d) => ({ label: reasonLabel(d.reason), value: d.minutes }))}
              />
            </ChartCard>
          )}

          {/* Scrap-rate trend */}
          {data.trend.length > 1 && r && r.withScrap > 0 && (
            <ChartCard title={t.scrapTrend} isAr={isAr}>
              <TrendChart
                isAr={isAr}
                labels={trendLabels}
                yMax={maxScrapRate}
                yFmt={(v) => fmtPct(v, isAr, 1)}
                series={[{ name: t.scrapTrend, color: "#dc2626", values: data.trend.map((d) => d.scrapRate) }]}
              />
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
