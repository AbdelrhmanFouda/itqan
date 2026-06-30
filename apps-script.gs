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
