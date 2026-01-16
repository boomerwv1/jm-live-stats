/*******************************
 * doGet(e) — Routing + Read-Only Access Layer
 * 
 * PRIMARY PURPOSE: Exposes multiple GET-based endpoints from a single Web App deployment.
 * 
 * This file is a THIN routing and formatting layer. It does NOT:
 *  - mutate game state
 *  - write stats
 *  - perform business logic calculations
 *  - access sheets directly (except for read-only formatting)
 * 
 * All business logic lives in Code.gs and is called from here.
 *******************************/

function doGet(e) {
  const view = (e && e.parameter && e.parameter.view) ? String(e.parameter.view) : "app";

  if (view === "presssheet") return renderPressSheet_(e);
  if (view === "tl_csv") return renderTitlerCsv_(e);   // ✅ NewBlue Titler CSV
  if (view === "api") return apiGet_(e);

  // Default: React App shell
  return HtmlService
    .createTemplateFromFile("App")
    .evaluate()
    .setTitle("JM Live Stats");
}

/*******************************
 * API (read-only) — GET endpoints
 * 
 * Supports JSONP via ?callback= parameter
 * Must never throw raw errors (always return JSON)
 *******************************/
function apiGet_(e) {
  try {
    const token = String((e.parameter && e.parameter.access_token) || "");
    const expected = String(getConfigValue_("access_token") || "");
    if (!expected || token !== expected) {
      return jsonOrJsonp_(e, { ok: false, error: "Unauthorized" });
    }

    const action = String(e.parameter.action || "");
    if (action === "list_games") return jsonOrJsonp_(e, listGames_());
    if (action === "get_game_state") {
      return jsonOrJsonp_(e, getGameState_(String(e.parameter.game_id || "")));
    }
    if (action === "get_live_snapshot") {
      return jsonOrJsonp_(e, getLiveSnapshotReadOnly_(e));
    }

    return jsonOrJsonp_(e, { ok: false, error: "Unknown action" });
  } catch (err) {
    // CRITICAL: Never throw (would break JSONP). Always return JSON.
    return jsonOrJsonp_(e, { ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/*******************************
 * JSON/JSONP formatting helper
 *******************************/
function jsonOrJsonp_(e, obj) {
  const callback = String((e.parameter && e.parameter.callback) || "").trim();
  const payload = JSON.stringify(obj);

  if (callback) {
    // JSONP: wrap in callback function
    const safeCb = callback.replace(/[^\w$.]/g, "");
    return ContentService
      .createTextOutput(`${safeCb}(${payload});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // Regular JSON
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

/*******************************
 * PRESS SHEET (HTML)
 * 
 * Reads from archived game tab and formats as printable HTML.
 * Pure formatting - no business logic.
 *******************************/
function renderPressSheet_(e) {
  const tabName = String(e.parameter.tab || "");
  if (!tabName) throw new Error("Missing tab parameter (expected archive_tab).");

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error(`Archive tab not found: ${tabName}`);

  // Read-only: extract data from archive tab
  const values = sh.getDataRange().getValues();

  const statsHeaderIdx = values.findIndex(r => r[0] === "team" && r.includes("PTS") && r.includes("FGA"));
  if (statsHeaderIdx === -1) throw new Error("Could not find stats header row (team/PTS/FGA).");

  const meta = {};
  for (let i = 0; i < statsHeaderIdx; i++) {
    const k = values[i][0];
    const v = values[i][1];
    if (k && v !== "") meta[String(k).trim()] = v;
  }

  const statsHeaders = values[statsHeaderIdx];
  const statsRows = [];
  for (let i = statsHeaderIdx + 1; i < values.length; i++) {
    if (!values[i][0]) break;
    statsRows.push(values[i]);
  }

  const pbpLabelIdx = values.findIndex(r => String(r[0] || "").trim().toUpperCase() === "PLAY BY PLAY");
  let pbpHeaders = [];
  let pbpRows = [];

  if (pbpLabelIdx !== -1) {
    const headerRowIdx = pbpLabelIdx + 1;
    if (headerRowIdx < values.length) {
      pbpHeaders = values[headerRowIdx];
      for (let i = headerRowIdx + 1; i < values.length; i++) {
        const row = values[i];
        const nonEmpty = row.some(c => String(c || "").trim() !== "");
        if (!nonEmpty) break;
        pbpRows.push(row);
      }
    }
  }

  // Format as HTML template
  const t = HtmlService.createTemplateFromFile("PressSheet");
  t.tabName = tabName;
  t.meta = meta;
  t.statsHeaders = statsHeaders;
  t.statsRows = statsRows;
  t.pbpHeaders = pbpHeaders;
  t.pbpRows = pbpRows;

  return t.evaluate().setTitle(`Press Sheet - ${meta.MATCHUP || tabName}`);
}

/*******************************
 * NEWBLUE TITLER CSV (one row per player)
 * 
 * Exports LIVE table as CSV for polling by Node.js bridge.
 * 
 * CRITICAL: CSV format must remain STABLE
 * - Column order matters
 * - No header reordering
 * - No key/value transforms
 *******************************/
function renderTitlerCsv_(e) {
  // Auth check
  const token = String((e.parameter && e.parameter.access_token) || "");
  const expected = String(getConfigValue_("access_token") || "");
  if (!expected || token !== expected) {
    return ContentService.createTextOutput("error,Unauthorized\n").setMimeType(ContentService.MimeType.CSV);
  }

  // Delegate CSV generation to Code.gs (read-only wrapper)
  try {
    return renderTitlerCsvReadOnly_(e);
  } catch (err) {
    return ContentService
      .createTextOutput(`error,${String(err && err.message ? err.message : err)}\n`)
      .setMimeType(ContentService.MimeType.CSV);
  }
}
