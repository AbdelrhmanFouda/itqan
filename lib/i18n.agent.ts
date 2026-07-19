import type { Lang } from "./i18n";

/**
 * AI assistant page strings (bilingual). Kept apart from the big i18n bundles so
 * the agent UI can evolve on its own. Use as: ag[lang].xxx
 */
export const ag: Record<Lang, {
  title: string;
  subtitle: string;
  placeholder: string;
  send: string;
  thinking: string;
  intro: string;
  examplesTitle: string;
  examples: string[];
  remaining: (n: number) => string;
  unlimited: string;
  limitReached: string;
  notConfigured: string;
  noAccess: string;
  errorGeneric: string;
  // preview
  reviewTitle: string;
  reviewIssueTitle: string;
  reviewUpdateTitle: string;
  reviewHint: string;
  confirm: string;
  cancel: string;
  writing: string;
  writtenOk: (n: number) => string;
  writeFailed: string;
  faultsTabMissing: string;
  cancelled: string;
  blocked: string;
  errorsLabel: string;
  warningsLabel: string;
  // production columns
  colDate: string;
  colShift: string;
  colMachine: string;
  colProduct: string;
  colGood: string;
  colScrap: string;
  colCavities: string;
  colDowntime: string;
  // issue fields
  issueMachine: string;
  issueProduct: string;
  issueCategory: string;
  issueDescription: string;
  issueAction: string;
  issueStatus: string;
  issueNote: string;
  // update fields
  updEntity: string;
  updRow: string;
  updField: string;
  updValue: string;
}> = {
  en: {
    title: "Production Assistant",
    subtitle: "Ask questions or paste a crew report — I read the sheet, check it, and propose the write for you to confirm.",
    placeholder: "Paste a shift report, or ask about OEE, downtime, a product…",
    send: "Send",
    thinking: "Reading the sheet…",
    intro: "Hi 👋 I can read the factory sheet, check crew reports for mistakes, and draft production rows or issues. Nothing is saved until you press Confirm.",
    examplesTitle: "Try",
    examples: [
      "PQ 4 ran product X morning shift, 1200 good, 30 scrap",
      "What's this month's OEE?",
      "Which machine lost the most time this week?",
      "Log an issue: machine 3 hydraulic leak",
    ],
    remaining: (n) => `${n} messages left today`,
    unlimited: "Unlimited",
    limitReached: "You've reached today's message limit. It resets tomorrow.",
    notConfigured: "The assistant isn't configured yet (missing API key). Ask the owner to add it.",
    noAccess: "Your role doesn't have access to the assistant.",
    errorGeneric: "Something went wrong. Please try again.",
    reviewTitle: "Review production rows before saving",
    reviewIssueTitle: "Review issue before saving",
    reviewUpdateTitle: "Review the correction before saving",
    reviewHint: "Check the numbers. Nothing is written until you confirm.",
    confirm: "Confirm & save",
    cancel: "Cancel",
    writing: "Saving…",
    writtenOk: (n) => `Saved ${n} row(s) to the sheet.`,
    writeFailed: "Save failed. Nothing was written.",
    faultsTabMissing: "The faults log isn't set up yet. Run setupIssuesTab() once in Apps Script (Extensions → Apps Script), then try again.",
    cancelled: "Cancelled — nothing was saved.",
    blocked: "Can't save yet — fix the errors above.",
    errorsLabel: "Errors",
    warningsLabel: "Warnings",
    colDate: "Date",
    colShift: "Shift",
    colMachine: "Machine",
    colProduct: "Product",
    colGood: "Good",
    colScrap: "Scrap",
    colCavities: "Cavities",
    colDowntime: "Downtime (min)",
    issueMachine: "Machine",
    issueProduct: "Product",
    issueCategory: "Category",
    issueDescription: "Description",
    issueAction: "Action",
    issueStatus: "Status",
    issueNote: "Notes",
    updEntity: "Tab",
    updRow: "Row",
    updField: "Field",
    updValue: "New value",
  },
  ar: {
    title: "مساعد الإنتاج",
    subtitle: "اسأل أو الصق تقرير الوردية — أقرأ الشيت، أراجعه، وأقترح الإدخال لتؤكّده أنت.",
    placeholder: "الصق تقرير وردية، أو اسأل عن OEE أو التوقفات أو منتج…",
    send: "إرسال",
    thinking: "جارٍ قراءة الشيت…",
    intro: "أهلًا 👋 أقدر أقرأ شيت المصنع، أراجع تقارير العمال لاكتشاف الأخطاء، وأجهّز صفوف الإنتاج أو الأعطال. لا يُحفَظ أي شيء إلا بعد ضغطك على «تأكيد».",
    examplesTitle: "جرّب",
    examples: [
      "ماكينة PQ 4 شغّلت المنتج س وردية صباحي، 1200 سليم، 30 هالك",
      "كام OEE الشهر ده؟",
      "أنهي ماكينة ضيّعت أكتر وقت الأسبوع ده؟",
      "سجّل عطل: ماكينة 3 تسريب هيدروليك",
    ],
    remaining: (n) => `باقي ${n} رسالة اليوم`,
    unlimited: "غير محدود",
    limitReached: "لقد وصلت إلى الحد اليومي للرسائل. سيتجدد غدًا.",
    notConfigured: "المساعد غير مُهيّأ بعد (مفتاح API غير موجود). اطلب من المالك إضافته.",
    noAccess: "دورك لا يملك صلاحية استخدام المساعد.",
    errorGeneric: "حدث خطأ ما. حاول مرة أخرى.",
    reviewTitle: "راجِع صفوف الإنتاج قبل الحفظ",
    reviewIssueTitle: "راجِع العطل قبل الحفظ",
    reviewUpdateTitle: "راجِع التصحيح قبل الحفظ",
    reviewHint: "راجِع الأرقام. لن يُكتب شيء إلا بعد التأكيد.",
    confirm: "تأكيد وحفظ",
    cancel: "إلغاء",
    writing: "جارٍ الحفظ…",
    writtenOk: (n) => `تم حفظ ${n} صف في الشيت.`,
    writeFailed: "فشل الحفظ. لم يُكتب أي شيء.",
    faultsTabMissing: "سجل الأعطال غير مُهيّأ بعد. شغّل الدالة setupIssuesTab() مرة واحدة من Apps Script (الإضافات ← Apps Script) ثم حاول مجددًا.",
    cancelled: "أُلغِي — لم يُحفَظ شيء.",
    blocked: "لا يمكن الحفظ الآن — صحّح الأخطاء بالأعلى.",
    errorsLabel: "أخطاء",
    warningsLabel: "تنبيهات",
    colDate: "التاريخ",
    colShift: "الوردية",
    colMachine: "الماكينة",
    colProduct: "المنتج",
    colGood: "سليم",
    colScrap: "هالك",
    colCavities: "التجاويف",
    colDowntime: "التوقف (دقيقة)",
    issueMachine: "الماكينة",
    issueProduct: "المنتج",
    issueCategory: "التصنيف",
    issueDescription: "الوصف",
    issueAction: "الإجراء",
    issueStatus: "الحالة",
    issueNote: "ملاحظات",
    updEntity: "التبويب",
    updRow: "الصف",
    updField: "الحقل",
    updValue: "القيمة الجديدة",
  },
};
