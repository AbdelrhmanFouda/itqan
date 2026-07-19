/**
 * Itqan — sheet bridge for the website (read + write).
 *
 * Setup (one time):
 *  1. Open the combined sheet → Extensions → Apps Script.
 *  2. Delete the default code, paste ALL of this, and Save.
 *  3. Deploy → New deployment → type "Web app"
 *       Execute as: Me        Who has access: Anyone
 *     → Deploy → authorize/allow when prompted → copy the Web app URL.
 *  4. In website/.env.local set:
 *       GOOGLE_APPS_SCRIPT_URL=<the Web app URL>
 *       GOOGLE_APPS_SCRIPT_SECRET=<the TOKEN below>
 *  5. Once it works you can make the sheet PRIVATE (remove "anyone with link") —
 *     reads now go through this script, which runs as you.
 *
 * Security: the website (server-side) sends TOKEN with every call; requests
 * without it are rejected. Change TOKEN to your own random string if you like —
 * just keep it identical here and in GOOGLE_APPS_SCRIPT_SECRET.
 */
const TOKEN = "itqan_bridge_8fK2pXq9Lm4Rv7Tz1Wn6Bd";

function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return _json({ error: "unauthorized" });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(e.parameter.tab);
  if (!sheet) return _json({ error: "no_tab", values: [] });
  return _json({ values: sheet.getDataRange().getDisplayValues() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return _json({ ok: false, error: "bad_json" }); }
  if (!body || body.token !== TOKEN) return _json({ ok: false, error: "unauthorized" });

  // Create a tab (with an optional header row) if it doesn't exist yet. Handled
  // BEFORE the sheet lookup so the app can self-provision logs like «الأعطال».
  // Idempotent: does nothing when the tab already exists.
  if (body.createTab) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existed = !!ss.getSheetByName(body.createTab);
    _ensureTab(body.createTab, body.headers || null);
    return _json({ ok: true, existed: existed });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(body.tab);
  if (!sheet) return _json({ ok: false, error: "no_tab" });

  // Append a new row, e.g. logging a production run. `append` is an array of
  // cell values already ordered to match the tab's header columns.
  if (body.append) {
    sheet.appendRow(body.append);
    return _json({ ok: true, row: sheet.getLastRow() });
  }

  // Delete a row by its 1-based index (e.g. removing a logged run).
  if (body.deleteRow) {
    const r = Number(body.deleteRow);
    if (r >= 2 && r <= sheet.getLastRow()) sheet.deleteRow(r);
    return _json({ ok: true });
  }

  // Default: in-place cell updates.
  (body.updates || []).forEach(function (u) {
    sheet.getRange(u.row, u.col).setValue(u.value);
  });
  return _json({ ok: true });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------- tab provisioning --------------------------- */
// The bridge normally cannot create tabs; these helpers add exactly that, so the
// website's AI assistant can log faults into «الأعطال». Headers are bilingual
// "ar\nen" to match the rest of the workbook and lib/sheets.ts ENTITIES.issues.

const ISSUES_TAB = "الأعطال";
const ISSUES_HEADERS = [
  "التاريخ\nDate",
  "الماكينة\nMachine",
  "المنتج\nProduct",
  "التصنيف\nCategory",
  "الوصف\nDescription",
  "الإجراء\nAction",
  "الحالة\nStatus",
  "ملاحظات\nNotes",
];

/**
 * Run from the Apps Script editor (pick this function in the toolbar → Run).
 * Creates the «الأعطال» faults-log tab if missing, then ALWAYS (re)applies the
 * layout: styled bilingual headers, RTL, column widths, and linked dropdowns —
 * الماكينة ← machines!J (registry labels), المنتج ← Master!C (product names),
 * التصنيف/الحالة ← fixed lists. Safe to re-run any time to repair the layout.
 * No redeploy needed — the live web app can append to it at once.
 */
/**
 * Rename all tabs to Arabic (run ONCE from the editor; safe to re-run — skips
 * tabs already renamed). Google Sheets auto-updates direct formula references;
 * afterwards RE-RUN applyAllFormatting (board-formatting.gs) because its
 * conditional-format INDIRECT("...") strings do NOT auto-update, and push the
 * matching website code (lib/sheets.ts knows both old and new names).
 */
const TAB_RENAMES = [
  ["Dashboard", "لوحة البيانات"],
  ["Master", "الرئيسي"],
  ["jobs", "أوامر العمل"],
  ["Molds", "الاسطمبات"],
  ["Products", "المنتجات"],
  ["Clients", "العملاء"],
  ["machines", "الماكينات"],
  ["production", "الإنتاج"],
];
function renameTabsToArabic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const done = [], skipped = [];
  TAB_RENAMES.forEach(function (p) {
    const s = ss.getSheetByName(p[0]);
    if (s) { s.setName(p[1]); done.push(p[0] + " ← " + p[1]); }
    else skipped.push(p[0] + (ss.getSheetByName(p[1]) ? " (تم من قبل)" : " (غير موجود)"));
  });
  const msg = "تمت إعادة التسمية: " + done.length + "\n" + done.join("\n") +
    (skipped.length ? "\n\nتخطّي: " + skipped.join("، ") : "");
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** First existing sheet among the given names (new Arabic name first, old name as fallback). */
function _sheetByNames(names) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (var i = 0; i < names.length; i++) {
    const s = ss.getSheetByName(names[i]);
    if (s) return s;
  }
  return null;
}

function setupIssuesTab() {
  const sheet = _ensureTab(ISSUES_TAB, null);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = ISSUES_HEADERS.length;

  // Header row — styled like the rest of the workbook (navy, white, frozen).
  sheet.getRange(1, 1, 1, n).setValues([ISSUES_HEADERS])
    .setBackground("#203864").setFontColor("#ffffff").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 44);
  sheet.setRightToLeft(true);

  const widths = [95, 135, 175, 105, 380, 300, 110, 220];
  for (var i = 0; i < n; i++) sheet.setColumnWidth(i + 1, widths[i]);

  // Linked dropdowns (allowInvalid → unusual values get a warning, not a block).
  const rows = 999;
  const dvRange = function (a1) {
    return SpreadsheetApp.newDataValidation().requireValueInRange(ss.getRange(a1), true).setAllowInvalid(true).build();
  };
  const dvList = function (list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  };
  const machinesSheet = _sheetByNames(["الماكينات", "machines"]);
  const masterSheet = _sheetByNames(["الرئيسي", "Master"]);
  if (machinesSheet) sheet.getRange(2, 2, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(machinesSheet.getRange("J2:J299"), true).setAllowInvalid(true).build()); // الماكينة
  if (masterSheet) sheet.getRange(2, 3, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(masterSheet.getRange("C3:C800"), true).setAllowInvalid(true).build());   // المنتج
  sheet.getRange(2, 4, rows, 1).setDataValidation(dvList(["خامة", "اسطمبة", "ماكينة", "كهرباء", "أخرى"])); // التصنيف
  sheet.getRange(2, 7, rows, 1).setDataValidation(dvList(["مفتوح", "قيد التنفيذ", "تم"]));                 // الحالة
}

/** Return the named sheet, creating it (with an optional bold, frozen header row) if absent. */
function _ensureTab(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(name);
  if (existing) return existing;
  const sheet = ss.insertSheet(name);
  if (headers && headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
