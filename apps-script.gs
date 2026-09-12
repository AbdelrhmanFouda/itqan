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

// Bumped whenever an action is added. The website asks `?ping=1` and reads the
// feature list, so an OLD deployment degrades (no microphone on the issues
// page) instead of failing saves. An old deployment answers `no_tab` to the
// ping — measured 2026-09-09 — which the site reads as "no features".
const BRIDGE_VERSION = 7; // 6: ?tabs=a,b,c multi-read · 7: `expect` on updates (both 2026-09-10)

function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return _json({ error: "unauthorized" });
  // ?ping=1 → what this deployment can do (see BRIDGE_VERSION).
  if (e.parameter.ping) {
    return _json({ ok: true, version: BRIDGE_VERSION, features: ["audio", "createTab", "multi", "expect"] });
  }
  // ?audio=<Drive file id> → one voice note from «الأعطال», base64. Only files
  // inside the recordings folder are served: the id is the caller's only
  // input, and this script runs as the owner over the owner's whole Drive.
  if (e.parameter.audio) return _readAudio(e.parameter.audio);
  // ?tabs=a,b,c → several tabs in ONE execution (version 6, 2026-09-10). The
  // round trip, not the payload, is what a read costs (a 15-row tab and a
  // 963-row tab both take ~3 s), so a page that needs four tabs pays one. A
  // tab that does not exist answers {error:"no_tab"} in its own slot; the
  // others still come back. Deploy → Manage deployments → New version.
  if (e.parameter.tabs) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const out = {};
    String(e.parameter.tabs).split(",").forEach(function (name) {
      const n = name.trim();
      if (!n) return;
      const sh = ss.getSheetByName(n);
      out[n] = sh ? { values: sh.getDataRange().getDisplayValues() } : { error: "no_tab", values: [] };
    });
    return _json({ ok: true, tabs: out });
  }
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

  // Save a voice note (2026-09-09): {saveAudio:{name, mime, data(base64)}} →
  // a file in the «تسجيلات الأعطال» folder next to this workbook, and its id.
  // The website then writes the Drive link into the issue's row. Handled
  // BEFORE the sheet lookup — a recording is not a tab.
  if (body.saveAudio) return _saveAudio(body.saveAudio);

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
  //
  // ⚠ THIS USED TO BE A BARE forEach, AND THAT WAS A REAL BUG. `setValue`
  // ENFORCES a cell's data validation, so one rejected cell threw out of
  // doPost — leaving every cell BEFORE it committed, every cell after it
  // dropped, and the caller holding an HTML error page with no way to tell.
  // Measured on 2026-08-14: writing «عطل» (a real downtime reason, but not one
  // of the eight in «التوقفات»!C's dropdown) into C2 left row 2 holding a date,
  // a machine and seven empty cells.
  //
  // The batch is now all-or-nothing. The undo restores the UNDERLYING values,
  // not the display strings the web app can see, so a date goes back as the
  // same date rather than being re-parsed by a locale that reads 09/08 as
  // 8 September.
  if (body.updates) {
    const ups = body.updates;
    // `expect`: [{row, col, value}] — the cells that must still hold these
    // display values (whitespace folded) or NOTHING is written (version 7,
    // 2026-09-10). The site used to read the whole tab before every write to
    // check the row had not moved under it; that read is now this comparison,
    // made here, atomically with the write.
    if (body.expect && body.expect.length) {
      const fold = function (v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); };
      for (let i = 0; i < body.expect.length; i++) {
        const x = body.expect[i];
        const cur = fold(sheet.getRange(Number(x.row), Number(x.col)).getDisplayValue());
        if (cur !== fold(x.value)) {
          return _json({ ok: false, error: "row_changed", at: "R" + x.row + "C" + x.col, current: cur });
        }
      }
    }
    // Snapshot first. Per cell rather than one bounding range: the rows in a
    // batch are scattered (an import writes rows 212 and 640), and the box
    // around them can be the whole tab.
    const prev = ups.map(function (u) { return sheet.getRange(u.row, u.col).getValue(); });

    let wrote = 0;
    try {
      for (let i = 0; i < ups.length; i++) {
        sheet.getRange(ups[i].row, ups[i].col).setValue(ups[i].value);
        wrote = i + 1;
      }
      // INSIDE the try: writes are buffered, and a throw that surfaces at the
      // next flush would land outside a catch placed around it — the rule this
      // file has already paid for once.
      SpreadsheetApp.flush();
    } catch (err) {
      // Put back exactly what was there.
      //
      // NOTE: `wrote` is almost always ups.length, and that is not a bug.
      // Spreadsheet writes are BUFFERED — the validation error surfaces at
      // flush(), after the loop has already run past the offending cell — so
      // this restores the WHOLE batch rather than a prefix of it. Restoring a
      // cell that never actually changed is a no-op, so over-restoring is free
      // and under-restoring is not. (Verified live on 2026-08-14: a four-cell
      // batch rejected at C39 reported rolledBack:4 and left the row empty.)
      //
      // Each restore is guarded on its own: a cell whose ORIGINAL value
      // violates today's validation (legacy data, a renamed product) would
      // otherwise throw during the undo and strand the rest of it.
      const failed = [];
      for (let i = 0; i < wrote; i++) {
        try {
          sheet.getRange(ups[i].row, ups[i].col).setValue(prev[i]);
        } catch (undoErr) {
          failed.push("R" + ups[i].row + "C" + ups[i].col);
        }
      }
      try { SpreadsheetApp.flush(); } catch (flushErr) { /* reported below */ }
      return _json({
        ok: false,
        error: "cell_rejected",
        // Sheets' own message names the offending cell ("...in cell C39...") and
        // lists the values the column accepts. Pass it through verbatim — it is
        // far more useful than anything reconstructible here, and because of the
        // buffering above, the loop counter cannot identify the cell.
        at: (String(err && err.message ? err.message : "").match(/\bcell\s+([A-Z]+\d+)\b/) || [])[1] || null,
        message: String(err && err.message ? err.message : err),
        rolledBack: wrote - failed.length,
        // Empty means the tab is exactly as it was before the request.
        notRolledBack: failed,
      });
    }
    return _json({ ok: true, cells: ups.length });
  }

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
  // Voice notes (2026-09-09): a Drive link to the worker's recording of the
  // problem / the fix. Written by the website; the cell is clickable here.
  "تسجيل العطل\nIssue audio",
  "تسجيل الحل\nSolution audio",
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

  const widths = [95, 135, 175, 105, 380, 300, 110, 220, 160, 160];
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

/* ------------------------- voice notes (2026-09-09) ------------------------- */
// A worker records what broke (and later what fixed it) on the issues page.
// The recording is a small audio file; it lives HERE, in the owner's Drive, in
// a folder beside this workbook — not in Firebase (auth and roles only), and
// not in a cell (a cell holds 50,000 characters). The row in «الأعطال» keeps
// the Drive link, so the sheet stays the truth and the owner can click it.
//
// ⚠ Deploying this version asks for the Drive permission once (DriveApp is a
// new scope): Deploy → Manage deployments → edit → New version → Deploy, then
// "Authorize access" when prompted. Until then the website's ?ping=1 sees no
// "audio" feature and hides the microphone.

const AUDIO_FOLDER = "تسجيلات الأعطال";
const AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * RUN THIS ONCE from the editor (toolbar → pick `authorizeDrive` → Run) after
 * deploying version 5. Deploying alone did NOT grant the Drive permission —
 * measured 2026-09-09: the web app answered
 * «ليس لديك إذن لاستدعاء DriveApp.getRootFolder» on the first save. Running
 * any function that touches DriveApp from the editor opens the permission
 * prompt; allow it, and the deployed web app (which runs as you) is covered
 * too — no redeploy needed. Logs the folder it will use.
 */
function authorizeDrive() {
  const folder = _audioFolder();
  const msg = "✔ Drive OK — recordings folder: " + folder.getName() + " (" + folder.getUrl() + ")";
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** The recordings folder, created on first use next to this workbook. */
function _audioFolder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let parent = null;
  try {
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    if (parents.hasNext()) parent = parents.next();
  } catch (err) { /* a shared-drive or odd placement — fall back to My Drive */ }
  if (!parent) parent = DriveApp.getRootFolder();
  const found = parent.getFoldersByName(AUDIO_FOLDER);
  return found.hasNext() ? found.next() : parent.createFolder(AUDIO_FOLDER);
}

function _saveAudio(a) {
  if (!a || typeof a.data !== "string" || !a.data) return _json({ ok: false, error: "bad_audio" });
  const mime = String(a.mime || "");
  if (mime.indexOf("audio/") !== 0) return _json({ ok: false, error: "bad_mime" });
  let bytes;
  try { bytes = Utilities.base64Decode(a.data); } catch (err) { return _json({ ok: false, error: "bad_base64" }); }
  if (bytes.length > AUDIO_MAX_BYTES) return _json({ ok: false, error: "audio_too_large" });
  try {
    const name = String(a.name || ("recording " + new Date().toISOString().slice(0, 19).replace(/[T:]/g, " ")));
    const file = _audioFolder().createFile(Utilities.newBlob(bytes, mime, name));
    return _json({ ok: true, id: file.getId(), url: file.getUrl(), size: bytes.length });
  } catch (err) {
    return _json({ ok: false, error: "drive_error", message: String(err && err.message ? err.message : err) });
  }
}

function _readAudio(id) {
  let file;
  try { file = DriveApp.getFileById(String(id)); } catch (err) { return _json({ ok: false, error: "audio_not_found" }); }
  // Only a file that sits in the recordings folder — never anything else the
  // owner's Drive holds, whatever id the caller brings.
  try {
    const folderId = _audioFolder().getId();
    let inside = false;
    const parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === folderId) { inside = true; break; } }
    if (!inside) return _json({ ok: false, error: "forbidden" });
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    return _json({ ok: true, mime: blob.getContentType(), name: file.getName(), size: bytes.length, data: Utilities.base64Encode(bytes) });
  } catch (err) {
    return _json({ ok: false, error: "drive_error", message: String(err && err.message ? err.message : err) });
  }
}
