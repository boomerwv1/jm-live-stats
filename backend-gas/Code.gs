/**
 * JM Live Stats - Sheets Backend (with LIVE_PBP + single-tab printable archive)
 * UPDATED: Uses actual TEAM NAMES everywhere (no more "HOME"/"AWAY" in player rows or scoring)
 *
 * Tabs:
 *  - LIVE: meta in A1:E2, headers in A4:V4, player rows start row 5
 *  - LIVE_EventLog: append-only stat events for current game
 *  - LIVE_SubLog: append-only subs for current game (created if missing)
 *  - LIVE_PBP: friendly play-by-play lines for current game (created if missing)
 *  - GAMES: archive index
 *  - Config: key/value with access_token
 *
 * Deploy as Web App:
 *  - Execute as: Me
 *  - Access: Anyone with the link
 */

const TAB_LIVE = "LIVE";
const TAB_EVENTLOG = "LIVE_EventLog";
const TAB_SUBLOG = "LIVE_SubLog";
const TAB_PBP = "LIVE_PBP";
const TAB_GAMES = "GAMES";
const TAB_CONFIG = "Config";

const LIVE_META_LABEL_ROW = 1;
const LIVE_META_VALUE_ROW = 2;

const LIVE_HEADER_ROW = 4;
const LIVE_FIRST_PLAYER_ROW = 5;

// LIVE columns (A..V)  <-- UPDATED: added "starter" + "sec_played"
const LIVE_COLS = [
  "team", "player_id", "jersey", "first", "last", "name", "starter",
  "PTS", "FGM", "FGA",
  "FG2_MADE", "FG2_ATT",
  "FG3_MADE", "FG3_ATT",
  "FTM", "FTA",
  "OREB", "DREB",
  "AST", "STL", "BLK",
  "TO", "FOUL",
  "sec_played" // if you’re tracking playtime in-sheet (recommended)
];

// ✅ NewBlue image folder on the broadcast laptop
// We will output a full Windows path using LASTNAME.png (your requirement)
const TITLER_IMAGE_FOLDER_WIN = "C:\\Broadcast\\Players\\";
const TITLER_IMAGE_EXT = ".png";

function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "";
    const body = raw ? JSON.parse(raw) : {};

    // Auth
    const token = String(body.access_token || "");
    const expected = String(getConfigValue_("access_token") || "");
    if (!expected || token !== expected) return text_("unauthorized");

    const action = String(body.action || "");
    if (!action) return text_("missing_action");

    // Ensure optional tabs exist
    ensureSubLog_();
    ensurePbp_();
    ensureLiveHeader_(); // ✅ always ensure header/schema

    if (action === "init_game") {
      initGame_(body);
      return text_("ok");
    }
    if (action === "set_meta") {
      setMeta_(body);
      return text_("ok");
    }
    if (action === "stat") {
      handleStat_(body);
      return text_("ok");
    }
    if (action === "sub") {
      handleSub_(body);
      return text_("ok");
    }
    if (action === "end_game") {
      endGame_(body);
      return text_("ok");
    }

    // ✅ Starters
    if (action === "set_starters") {
      setStarters_(body);
      return text_("ok");
    }
    if (action === "get_starters") {
      return json_(getStarters_());
    }

    // ✅ Playtime
    if (action === "set_playtime") {
      setPlaytime_(body);
      return text_("ok");
    }
    if (action === "get_playtime") {
      return json_(getPlaytime_());
    }

    return text_("unknown_action");
  } catch (err) {
    return text_("error");
  }
}

/** -------------------------
 *  Actions
 *  ------------------------- */

function initGame_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  const ev = ss.getSheetByName(TAB_EVENTLOG);
  const sub = ss.getSheetByName(TAB_SUBLOG);
  const pbp = ss.getSheetByName(TAB_PBP);

  ensureLiveHeader_();

  const gameId = String(b.game_id || `GAME_${new Date().toISOString()}`);
  const homeTeam = String(b.home_team || "James Monroe");
  const awayTeam = String(b.away_team || "Opponent");
  const period = String(b.period || "Q1");
  const clockSec = Number.isFinite(b.clock_sec) ? Number(b.clock_sec) : 0;

  // Reset LIVE meta values (A2:E2)
  setLiveMeta_(live, { game_id: gameId, home_team: homeTeam, away_team: awayTeam, period, clock_sec: clockSec });

  // Clear player rows (from row 5 down)
  clearPlayerTable_(live);

  // Write roster rows (TEAM COLUMN USES ACTUAL TEAM NAMES)
  const homeRoster = Array.isArray(b.home_roster) ? b.home_roster : [];
  const awayRoster = Array.isArray(b.away_roster) ? b.away_roster : [];

  const rows = [];
  homeRoster.forEach(p => rows.push(makePlayerRow_(homeTeam, p)));
  awayRoster.forEach(p => rows.push(makePlayerRow_(awayTeam, p)));

  if (rows.length > 0) {
    live.getRange(LIVE_FIRST_PLAYER_ROW, 1, rows.length, LIVE_COLS.length).setValues(rows);
  }

  // Reset logs (keep headers)
  clearTabKeepHeader_(ev);
  clearTabKeepHeader_(sub);
  clearTabKeepHeader_(pbp);
}

function setMeta_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  // Optional: if caller wants clock/period changes to be auditable in play-by-play,
  // they can pass:
  //  - meta_event_id (uuid)
  //  - ts_iso (ISO string)
  //  - reason (string)
  const ts = String(b.ts_iso || new Date().toISOString());
  const reason = String(b.reason || "");
  const metaEventId = String(b.meta_event_id || "");
  const wantPbp = Boolean(metaEventId); // only log if explicitly requested (keeps existing behavior stable)

  const prev = getLiveMeta_(live);

  const meta = {};
  if (b.game_id != null) meta.game_id = String(b.game_id);
  if (b.home_team != null) meta.home_team = String(b.home_team);
  if (b.away_team != null) meta.away_team = String(b.away_team);
  if (b.period != null) meta.period = String(b.period);
  if (b.clock_sec != null) meta.clock_sec = Number(b.clock_sec);

  setLiveMeta_(live, meta);

  // ✅ Auditable clock/period updates in PBP (for manual clock correction + quarter changes)
  // We do NOT change sheet schema; we only append to existing LIVE_PBP tab.
  if (wantPbp) {
    try {
      ensurePbp_();
      const cur = getLiveMeta_(live);
      const gameId = String(cur.game_id || "");
      const team = ""; // meta events are not team-specific

      // Period change
      if (meta.period != null && String(prev.period || "") !== String(cur.period || "")) {
        appendPbp_([ts, gameId, String(cur.period || ""), Number(cur.clock_sec || 0), clockDisplay_(cur.clock_sec), team,
          `PERIOD SET → ${String(cur.period || "")}${reason ? " (" + reason + ")" : ""}`]);
      }

      // Clock change
      if (meta.clock_sec != null && Number(prev.clock_sec) !== Number(cur.clock_sec)) {
        appendPbp_([ts, gameId, String(cur.period || ""), Number(cur.clock_sec || 0), clockDisplay_(cur.clock_sec), team,
          `CLOCK SET → ${clockDisplay_(cur.clock_sec)}${reason ? " (" + reason + ")" : ""}`]);
      }
    } catch (err) {
      // never break set_meta
    }
  }
}

function handleStat_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  const ev = ss.getSheetByName(TAB_EVENTLOG);

  ensureLiveHeader_();

  const eventId = String(b.event_id || "");
  if (eventId && hasEventId_(ev, eventId)) return;

  const ts = String(b.ts_iso || new Date().toISOString());
  const gameId = String(b.game_id || "");
  const period = String(b.period || "");
  const clockSec = Number(b.clock_sec ?? "");
  const team = String(b.team || "");
  const playerId = String(b.player_id || "");
  const eventType = String(b.event_type || "");
  const delta = Number(b.delta ?? 1);

  // Log event
  ev.appendRow([eventId, ts, gameId, period, clockSec, team, playerId, eventType, delta]);

  // Apply to LIVE totals
  // ✅ Some event types are "log only" (no stat delta), but still belong in the event log + PBP.
  // Example: JUMP BALL (auditing/resume utility)
  applyStatDeltaToLive_(live, team, playerId, eventType, delta);

  // Update LIVE meta for graphics
  if (period) setLiveMeta_(live, { period });
  if (!Number.isNaN(clockSec)) setLiveMeta_(live, { clock_sec: clockSec });
  if (gameId) setLiveMeta_(live, { game_id: gameId });

  // Append to LIVE_PBP (friendly log)
  appendStatToPbp_(ts, gameId, period, clockSec, team, playerId, eventType, delta);
}

function handleSub_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  const sub = ss.getSheetByName(TAB_SUBLOG);

  const eventId = String(b.event_id || "");
  if (eventId && hasEventId_(sub, eventId)) return;

  const ts = String(b.ts_iso || new Date().toISOString());
  const gameId = String(b.game_id || "");
  const period = String(b.period || "");
  const clockSec = Number(b.clock_sec ?? "");
  const team = String(b.team || "");
  const outId = String(b.player_out || "");
  const inId = String(b.player_in || "");

  sub.appendRow([eventId, ts, gameId, period, clockSec, team, outId, inId]);

  // Append to LIVE_PBP (friendly)
  const outLabel = getPlayerLabelFromLive_(live, team, outId);
  const inLabel = getPlayerLabelFromLive_(live, team, inId);
  appendPbp_([ts, gameId, period, clockSec, clockDisplay_(clockSec), team, `SUB: ${outLabel} → ${inLabel}`]);
}

/**
 * end_game creates ONE printable archive tab containing:
 *  - meta + final score
 *  - LIVE table snapshot (includes starter + sec_played)
 *  - PBP snapshot
 *
 * (Still writes a row to GAMES for indexing.)
 */
function endGame_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  const pbp = ss.getSheetByName(TAB_PBP);
  const games = ss.getSheetByName(TAB_GAMES);

  ensureLiveHeader_();

  const meta = getLiveMeta_(live);
  const gameId = String(b.game_id || meta.game_id || `GAME_${new Date().toISOString()}`);
  const homeTeam = String(meta.home_team || b.home_team || "James Monroe");
  const awayTeam = String(meta.away_team || b.away_team || "Opponent");

  const dateIso = new Date().toISOString().slice(0, 10);
  const baseName = sanitizeSheetName_(`${dateIso}_${homeTeam}_vs_${awayTeam}`);
  const archiveName = uniqueSheetName_(ss, baseName);

  // Compute final points from LIVE (TEAM NAMES)
  const final = computeFinalScore_(live);

  // Build printable archive sheet
  const arch = ss.insertSheet(archiveName);
  buildPrintableArchive_(arch, { gameId, dateIso, homeTeam, awayTeam, final, meta }, live, pbp);

  // Write to GAMES index
  games.appendRow([
    gameId,
    dateIso,
    homeTeam,
    awayTeam,
    final.home_pts,
    final.away_pts,
    archiveName,
    new Date().toISOString()
  ]);

  // Optionally reset LIVE for next game
  if (b.reset_live === true) {
    const ev = ss.getSheetByName(TAB_EVENTLOG);
    const sub = ss.getSheetByName(TAB_SUBLOG);

    setLiveMeta_(live, { game_id: "", home_team: "", away_team: "", period: "", clock_sec: "" });
    clearPlayerTable_(live);
    clearTabKeepHeader_(ev);
    clearTabKeepHeader_(sub);
    clearTabKeepHeader_(pbp);
  }
}

/** -------------------------
 *  Printable archive builder
 *  ------------------------- */

function buildPrintableArchive_(arch, info, live, pbp) {
  // Meta block
  arch.getRange("A1").setValue("GAME_ID");
  arch.getRange("B1").setValue(info.gameId);
  arch.getRange("A2").setValue("DATE");
  arch.getRange("B2").setValue(info.dateIso);
  arch.getRange("A3").setValue("MATCHUP");
  arch.getRange("B3").setValue(`${info.homeTeam} vs ${info.awayTeam}`);
  arch.getRange("A4").setValue("FINAL");
  arch.getRange("B4").setValue(`${info.homeTeam} ${info.final.home_pts} — ${info.awayTeam} ${info.final.away_pts}`);

  arch.getRange("A1:A4").setFontWeight("bold");
  arch.getRange("B1:B4").setFontWeight("bold");

  // Copy LIVE header row to archive row 6
  const liveHeader = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues();
  arch.getRange(6, 1, 1, LIVE_COLS.length).setValues(liveHeader);
  arch.getRange(6, 1, 1, LIVE_COLS.length).setFontWeight("bold");

  // Copy LIVE player table values
  const lastLiveRow = live.getLastRow();
  let playerRows = [];
  if (lastLiveRow >= LIVE_FIRST_PLAYER_ROW) {
    const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, lastLiveRow - LIVE_FIRST_PLAYER_ROW + 1, LIVE_COLS.length).getValues();
    playerRows = data.filter(r => String(r[1] || "").trim() !== "");
  }
  if (playerRows.length > 0) {
    arch.getRange(7, 1, playerRows.length, LIVE_COLS.length).setValues(playerRows);
  }

  let nextRow = 7 + Math.max(playerRows.length, 1) + 2; // blank line

  // PBP section
  arch.getRange(nextRow, 1).setValue("PLAY BY PLAY");
  arch.getRange(nextRow, 1).setFontWeight("bold");
  nextRow++;

  const pbpLastRow = pbp.getLastRow();
  const pbpLastCol = pbp.getLastColumn();
  if (pbpLastRow >= 1 && pbpLastCol >= 1) {
    const pbpHeader = pbp.getRange(1, 1, 1, pbpLastCol).getValues();
    arch.getRange(nextRow, 1, 1, pbpLastCol).setValues(pbpHeader);
    arch.getRange(nextRow, 1, 1, pbpLastCol).setFontWeight("bold");
    nextRow++;

    if (pbpLastRow > 1) {
      const pbpData = pbp.getRange(2, 1, pbpLastRow - 1, pbpLastCol).getValues();
      arch.getRange(nextRow, 1, pbpData.length, pbpLastCol).setValues(pbpData);
    }
  }

  // Optional widths
  try {
    arch.setColumnWidth(1, 90);
    arch.setColumnWidth(2, 160);
    arch.setColumnWidth(3, 80);
    arch.setColumnWidth(4, 220);
  } catch (e) {}
}

/** -------------------------
 *  LIVE schema/header
 *  ------------------------- */

function ensureLiveHeader_() {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  if (!live) throw new Error("Missing LIVE sheet");

  // Ensure header row matches LIVE_COLS exactly
  const cur = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const mismatch = cur.some((v, i) => String(v || "").trim() !== String(LIVE_COLS[i] || "").trim());

  if (mismatch) {
    live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).setValues([LIVE_COLS]);
    live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).setFontWeight("bold");
  }
}

/** -------------------------
 *  LIVE helpers
 *  ------------------------- */

function makePlayerRow_(team, p) {
  const playerId = String(p.player_id || "");
  const jersey = String(p.jersey || "");
  const first = String(p.first || "");
  const last = String(p.last || "");
  const name = String(p.name || `${first} ${last}`.trim());

  const starter = false;

  return [
    team, playerId, jersey, first, last, name, starter,
    0, 0, 0,
    0, 0,
    0, 0,
    0, 0,
    0, 0,
    0, 0, 0,
    0, 0,
    0 // sec_played
  ];
}

function clearPlayerTable_(live) {
  const lastRow = live.getLastRow();
  if (lastRow >= LIVE_FIRST_PLAYER_ROW) {
    live.getRange(LIVE_FIRST_PLAYER_ROW, 1, lastRow - LIVE_FIRST_PLAYER_ROW + 1, LIVE_COLS.length).clearContent();
  }
}

function setLiveMeta_(live, meta) {
  const map = { game_id: 1, home_team: 2, away_team: 3, period: 4, clock_sec: 5 };
  Object.keys(meta).forEach(k => {
    if (!(k in map)) return;
    live.getRange(LIVE_META_VALUE_ROW, map[k]).setValue(meta[k]);
  });
}

function getLiveMeta_(live) {
  const vals = live.getRange(LIVE_META_VALUE_ROW, 1, 1, 5).getValues()[0];
  return {
    game_id: String(vals[0] || ""),
    home_team: String(vals[1] || ""),
    away_team: String(vals[2] || ""),
    period: String(vals[3] || ""),
    clock_sec: vals[4]
  };
}

function applyStatDeltaToLive_(live, team, playerId, eventType, delta) {
  ensureLiveHeader_();

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const col = (name) => header.indexOf(name) + 1;
  const row = findLivePlayerRow_(live, team, playerId, col("team"), col("player_id"));
  if (!row) return;

  const add = (field, amt) => {
    const c = col(field);
    if (c <= 0) return;
    const cell = live.getRange(row, c);
    const v = Number(cell.getValue() || 0) + amt;
    cell.setValue(v);
  };

  switch (eventType) {
    case "2M":
      add("FG2_MADE", delta); add("FG2_ATT", delta);
      add("FGM", delta); add("FGA", delta);
      add("PTS", 2 * delta);
      break;
    case "2X":
      add("FG2_ATT", delta); add("FGA", delta);
      break;
    case "3M":
      add("FG3_MADE", delta); add("FG3_ATT", delta);
      add("FGM", delta); add("FGA", delta);
      add("PTS", 3 * delta);
      break;
    case "3X":
      add("FG3_ATT", delta); add("FGA", delta);
      break;
    case "FTM":
      add("FTM", delta); add("FTA", delta);
      add("PTS", 1 * delta);
      break;
    case "FTX":
      add("FTA", delta);
      break;
    case "OREB": add("OREB", delta); break;
    case "DREB": add("DREB", delta); break;
    case "AST": add("AST", delta); break;
    case "STL": add("STL", delta); break;
    case "BLK": add("BLK", delta); break;
    case "TO": add("TO", delta); break;
    case "FOUL": add("FOUL", delta); break;
    // ✅ log-only (no stat delta)
    case "JUMP":
    case "JUMP_BALL":
    case "JB":
      break;
  }
}

function findLivePlayerRow_(live, team, playerId, teamCol, playerCol) {
  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return null;
  const numRows = lastRow - LIVE_FIRST_PLAYER_ROW + 1;
  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, numRows, Math.max(teamCol, playerCol)).getValues();

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (String(r[teamCol - 1]) === team && String(r[playerCol - 1]) === playerId) {
      return LIVE_FIRST_PLAYER_ROW + i;
    }
  }
  return null;
}

function computeFinalScore_(live) {
  const meta = getLiveMeta_(live);
  const homeName = String(meta.home_team || "");
  const awayName = String(meta.away_team || "");

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const teamIdx = header.indexOf("team");
  const ptsIdx = header.indexOf("PTS");

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return { home_pts: 0, away_pts: 0 };

  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, lastRow - LIVE_FIRST_PLAYER_ROW + 1, LIVE_COLS.length).getValues();
  let home = 0, away = 0;

  data.forEach(r => {
    const t = String(r[teamIdx] || "");
    const pts = Number(r[ptsIdx] || 0);
    if (t === homeName) home += pts;
    if (t === awayName) away += pts;
  });

  return { home_pts: home, away_pts: away };
}

/** -------------------------
 *  STARTERS (stored in LIVE table)
 *  ------------------------- */

function setStarters_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  ensureLiveHeader_();

  const meta = getLiveMeta_(live);
  const homeTeam = String(meta.home_team || "");
  const awayTeam = String(meta.away_team || "");

  const startersHome = Array.isArray(b.starters_home) ? b.starters_home.map(String) : null;
  const startersAway = Array.isArray(b.starters_away) ? b.starters_away.map(String) : null;

  if (startersHome) {
    validateStarters_(startersHome, "HOME");
    applyStartersToLive_(live, homeTeam, startersHome);
  }
  if (startersAway) {
    validateStarters_(startersAway, "AWAY");
    applyStartersToLive_(live, awayTeam, startersAway);
  }
}

function getStarters_() {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  ensureLiveHeader_();

  const meta = getLiveMeta_(live);
  const homeTeam = String(meta.home_team || "");
  const awayTeam = String(meta.away_team || "");

  return {
    ok: true,
    starters_home: readStartersFromLive_(live, homeTeam),
    starters_away: readStartersFromLive_(live, awayTeam)
  };
}

function validateStarters_(arr, label) {
  if (arr.length !== 5) throw new Error(`${label} starters must be exactly 5 (got ${arr.length})`);
  const set = new Set(arr);
  if (set.size !== 5) throw new Error(`${label} starters must be unique`);
}

function applyStartersToLive_(live, teamName, starterIds) {
  if (!teamName) throw new Error("Missing team name in LIVE meta");

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const teamCol = header.indexOf("team") + 1;
  const playerCol = header.indexOf("player_id") + 1;
  const starterCol = header.indexOf("starter") + 1;

  if (teamCol <= 0 || playerCol <= 0 || starterCol <= 0) {
    throw new Error("LIVE header missing required columns (team, player_id, starter)");
  }

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return;

  const numRows = lastRow - LIVE_FIRST_PLAYER_ROW + 1;
  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, numRows, Math.max(teamCol, playerCol)).getValues();

  const starterSet = new Set(starterIds.map(String));

  // Clear + set for only this team
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const t = String(row[teamCol - 1] || "");
    const pid = String(row[playerCol - 1] || "");
    if (t === teamName && pid) {
      live.getRange(LIVE_FIRST_PLAYER_ROW + i, starterCol).setValue(starterSet.has(pid));
    }
  }
}

function readStartersFromLive_(live, teamName) {
  if (!teamName) return [];

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const teamCol = header.indexOf("team") + 1;
  const playerCol = header.indexOf("player_id") + 1;
  const starterCol = header.indexOf("starter") + 1;

  if (teamCol <= 0 || playerCol <= 0 || starterCol <= 0) return [];

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return [];

  const numRows = lastRow - LIVE_FIRST_PLAYER_ROW + 1;
  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, numRows, starterCol).getValues();

  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const t = String(r[teamCol - 1] || "");
    const pid = String(r[playerCol - 1] || "");
    const isStarter = Boolean(r[starterCol - 1]);
    if (t === teamName && pid && isStarter) out.push(pid);
  }
  return out;
}

/** -------------------------
 *  PLAYTIME (stored in LIVE table, seconds)
 *  ------------------------- */

function setPlaytime_(b) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  ensureLiveHeader_();

  const meta = getLiveMeta_(live);
  const homeTeam = String(meta.home_team || "");
  const awayTeam = String(meta.away_team || "");

  const home = normalizePlaytimePayload_(b.playtime_home);
  const away = normalizePlaytimePayload_(b.playtime_away);

  if (home && homeTeam) applyPlaytimeToLive_(live, homeTeam, home);
  if (away && awayTeam) applyPlaytimeToLive_(live, awayTeam, away);
}

function getPlaytime_() {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  ensureLiveHeader_();

  const meta = getLiveMeta_(live);
  const homeTeam = String(meta.home_team || "");
  const awayTeam = String(meta.away_team || "");

  return {
    ok: true,
    playtime_home: readPlaytimeFromLive_(live, homeTeam),
    playtime_away: readPlaytimeFromLive_(live, awayTeam)
  };
}

// Accept either:
// 1) { "H10": 123, "H12": 55 }
// 2) [ {player_id:"H10", sec_played:123}, ... ]
function normalizePlaytimePayload_(x) {
  if (!x) return null;
  if (Array.isArray(x)) {
    const out = {};
    x.forEach(it => {
      const pid = String(it.player_id || "");
      const sec = Number(it.sec_played ?? it.sec ?? 0);
      if (pid) out[pid] = Math.max(0, Math.floor(sec));
    });
    return out;
  }
  if (typeof x === "object") {
    const out = {};
    Object.keys(x).forEach(pid => {
      const sec = Number(x[pid] ?? 0);
      if (pid) out[String(pid)] = Math.max(0, Math.floor(sec));
    });
    return out;
  }
  return null;
}

function applyPlaytimeToLive_(live, teamName, playtimeMap) {
  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const teamCol = header.indexOf("team") + 1;
  const playerCol = header.indexOf("player_id") + 1;
  const secCol = header.indexOf("sec_played") + 1;

  if (teamCol <= 0 || playerCol <= 0 || secCol <= 0) {
    throw new Error("LIVE header missing required columns (team, player_id, sec_played)");
  }

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return;

  const numRows = lastRow - LIVE_FIRST_PLAYER_ROW + 1;
  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, numRows, Math.max(teamCol, playerCol)).getValues();

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const t = String(r[teamCol - 1] || "");
    const pid = String(r[playerCol - 1] || "");
    if (t !== teamName || !pid) continue;

    if (Object.prototype.hasOwnProperty.call(playtimeMap, pid)) {
      live.getRange(LIVE_FIRST_PLAYER_ROW + i, secCol).setValue(Number(playtimeMap[pid] || 0));
    }
  }
}

function readPlaytimeFromLive_(live, teamName) {
  if (!teamName) return {};

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0];
  const teamCol = header.indexOf("team") + 1;
  const playerCol = header.indexOf("player_id") + 1;
  const secCol = header.indexOf("sec_played") + 1;

  if (teamCol <= 0 || playerCol <= 0 || secCol <= 0) return {};

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return {};

  const numRows = lastRow - LIVE_FIRST_PLAYER_ROW + 1;
  const data = live.getRange(LIVE_FIRST_PLAYER_ROW, 1, numRows, secCol).getValues();

  const out = {};
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const t = String(r[teamCol - 1] || "");
    const pid = String(r[playerCol - 1] || "");
    const sec = Number(r[secCol - 1] || 0);
    if (t === teamName && pid) out[pid] = Math.max(0, Math.floor(sec));
  }
  return out;
}

/** -------------------------
 *  PBP helpers
 *  ------------------------- */

function appendStatToPbp_(ts, gameId, period, clockSec, team, playerId, eventType, delta) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);

  const label = getPlayerLabelFromLive_(live, team, playerId);
  const cd = clockDisplay_(clockSec);

  const pretty = ({
    "2M":"2PT MAKE","2X":"2PT MISS",
    "3M":"3PT MAKE","3X":"3PT MISS",
    "FTM":"FT MAKE","FTX":"FT MISS",
    "OREB":"OFF REB","DREB":"DEF REB",
    "AST":"ASSIST","STL":"STEAL","BLK":"BLOCK",
    "TO":"TURNOVER","FOUL":"FOUL"
  })[eventType] || eventType;

  const text = `${label} ${pretty}${delta === -1 ? " (UNDO)" : ""}`;
  appendPbp_([ts, gameId, period, clockSec, cd, team, text]);
}

function ensurePbp_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB_PBP);
  if (sh) return;

  sh = ss.insertSheet(TAB_PBP);
  sh.getRange(1, 1, 1, 8).setValues([[
    "seq","ts_iso","game_id","period","clock_sec","clock_display","team","text"
  ]]);
}

function appendPbp_(row) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB_PBP);
  const seq = Math.max(0, sh.getLastRow());
  sh.appendRow([seq, ...row]);
}

function clockDisplay_(clockSec) {
  const s = Math.max(0, Math.floor(Number(clockSec || 0)));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `'${mm}:${ss}`; // force text in Sheets
}

// ✅ FIXED: uses LIVE headers to find jersey/name/first/last correctly
function getPlayerLabelFromLive_(live, team, playerId) {
  ensureLiveHeader_();

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0].map(h => String(h || "").trim());
  const iTeam = header.indexOf("team");
  const iPid = header.indexOf("player_id");
  const iJersey = header.indexOf("jersey");
  const iName = header.indexOf("name");
  const iFirst = header.indexOf("first");
  const iLast = header.indexOf("last");

  if (iTeam === -1 || iPid === -1) return String(playerId || "");

  const lastRow = live.getLastRow();
  if (lastRow < LIVE_FIRST_PLAYER_ROW) return String(playerId || "");

  const data = live
    .getRange(LIVE_FIRST_PLAYER_ROW, 1, lastRow - LIVE_FIRST_PLAYER_ROW + 1, LIVE_COLS.length)
    .getValues();

  for (const r of data) {
    if (String(r[iTeam] || "") === String(team || "") && String(r[iPid] || "") === String(playerId || "")) {
      const jersey = (iJersey !== -1) ? String(r[iJersey] || "").trim() : "";
      const first = (iFirst !== -1) ? String(r[iFirst] || "").trim() : "";
      const last  = (iLast  !== -1) ? String(r[iLast]  || "").trim() : "";
      const name  = (iName  !== -1) ? String(r[iName]  || "").trim() : "";

      const full = (first || last) ? `${first} ${last}`.trim() : name;
      if (jersey || full) return `${jersey ? "#" + jersey + " " : ""}${full}`.trim();
      return String(playerId || "");
    }
  }

  return String(playerId || "");
}

/** -------------------------
 *  Logs + config helpers
 *  ------------------------- */

function clearTabKeepHeader_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return;
  sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
}

function hasEventId_(sh, eventId) {
  if (!eventId) return false;
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return false;
  const colA = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  return colA.some(v => String(v) === eventId);
}

function getConfigValue_(key) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_CONFIG);
  const values = sh.getDataRange().getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return values[i][1];
  }
  return "";
}

function ensureSubLog_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB_SUBLOG);
  if (sh) return;

  sh = ss.insertSheet(TAB_SUBLOG);
  sh.getRange(1, 1, 1, 8).setValues([[
    "event_id", "ts_iso", "game_id", "period", "clock_sec", "team", "player_out", "player_in"
  ]]);
}

function sanitizeSheetName_(name) {
  return String(name)
    .replace(/[:\\\/\?\*\[\]]/g, "_")
    .slice(0, 90);
}

function uniqueSheetName_(ss, base) {
  let name = base;
  let i = 2;
  while (ss.getSheetByName(name)) {
    name = `${base}_${i}`;
    i++;
  }
  return name;
}

function text_(s) {
  return ContentService.createTextOutput(String(s)).setMimeType(ContentService.MimeType.TEXT);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/*******************************
 * READ-ONLY API WRAPPERS (called by DoGet.gs)
 * 
 * These functions provide read-only access to game state for GET endpoints.
 * They handle ensure* calls internally (idempotent, only create if missing).
 *******************************/

/**
 * Read-only snapshot for multi-user polling.
 * Called by DoGet.gs - no mutations, only reads + aggregation.
 */
function getLiveSnapshotReadOnly_(e) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  if (!live) return { ok: false, error: "Missing LIVE sheet" };
  
  // Ensure tabs exist (idempotent - only creates if missing)
  ensureLiveHeader_();
  ensureSubLog_();
  ensurePbp_();

  const sub = ss.getSheetByName(TAB_SUBLOG);
  const pbp = ss.getSheetByName(TAB_PBP);

  const meta = getLiveMeta_(live);
  const score = computeFinalScore_(live);

  const homeTeam = String(meta.home_team || "");
  const awayTeam = String(meta.away_team || "");

  const starters_home = readStartersFromLive_(live, homeTeam);
  const starters_away = readStartersFromLive_(live, awayTeam);
  const playtime_home = readPlaytimeFromLive_(live, homeTeam);
  const playtime_away = readPlaytimeFromLive_(live, awayTeam);

  // Derive on-floor lineup from starters + sub log
  const derived = deriveOnFloorFromSubs_(sub, String(meta.game_id || ""), starters_home, starters_away, homeTeam, awayTeam);

  const since = Number(e.parameter && e.parameter.since_pbp_seq ? e.parameter.since_pbp_seq : -1);
  const pbpDelta = readPbpDelta_(pbp, since);

  return {
    ok: true,
    live: {
      meta,
      score,
      starters_home,
      starters_away,
      playtime_home,
      playtime_away,
      on_floor_home: derived.on_floor_home,
      on_floor_away: derived.on_floor_away
    },
    pbp: pbpDelta
  };
}

function deriveOnFloorFromSubs_(subSheet, gameId, startersHome, startersAway, homeTeam, awayTeam) {
  let onHome = Array.isArray(startersHome) ? startersHome.slice(0, 5) : [];
  let onAway = Array.isArray(startersAway) ? startersAway.slice(0, 5) : [];

  if (!subSheet || !gameId) {
    return { on_floor_home: onHome, on_floor_away: onAway };
  }

  const lastRow = subSheet.getLastRow();
  if (lastRow <= 1) return { on_floor_home: onHome, on_floor_away: onAway };

  const rows = subSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (const r of rows) {
    const gid = String(r[2] || "");
    if (gid !== String(gameId)) continue;
    const team = String(r[5] || "");
    const outId = String(r[6] || "");
    const inId = String(r[7] || "");
    if (!team || !outId || !inId) continue;

    if (team === homeTeam) {
      onHome = applySubToLineup_(onHome, outId, inId);
    } else if (team === awayTeam) {
      onAway = applySubToLineup_(onAway, outId, inId);
    }
  }

  return { on_floor_home: onHome, on_floor_away: onAway };
}

function applySubToLineup_(lineup, outId, inId) {
  const cur = Array.isArray(lineup) ? lineup.slice() : [];
  const set = new Set(cur.map(String));
  if (!set.has(String(outId))) return cur;
  if (set.has(String(inId))) return cur;
  set.delete(String(outId));
  set.add(String(inId));
  return Array.from(set).slice(0, 5);
}

function readPbpDelta_(pbpSheet, sinceSeq) {
  if (!pbpSheet) return { latest_seq: -1, rows: [] };
  const lastRow = pbpSheet.getLastRow();
  const lastCol = pbpSheet.getLastColumn();
  if (lastRow <= 1) return { latest_seq: 0, rows: [] };

  const data = pbpSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  let latestSeq = 0;
  const out = [];

  for (const r of data) {
    const seq = Number(r[0] || 0);
    if (seq > latestSeq) latestSeq = seq;
    if (Number.isFinite(sinceSeq) && sinceSeq >= 0 && seq <= sinceSeq) continue;
    out.push({
      seq,
      ts_iso: r[1],
      game_id: r[2],
      period: r[3],
      clock_sec: r[4],
      clock_display: r[5],
      team: r[6],
      text: r[7]
    });
  }

  return { latest_seq: latestSeq, rows: out };
}

/**
 * Read-only CSV export for NewBlue Titler.
 * Called by DoGet.gs - handles ensure* internally.
 */
function renderTitlerCsvReadOnly_(e) {
  const ss = SpreadsheetApp.getActive();
  const live = ss.getSheetByName(TAB_LIVE);
  if (!live) {
    return ContentService.createTextOutput("error,Missing LIVE sheet\n").setMimeType(ContentService.MimeType.CSV);
  }

  ensureLiveHeader_();

  const header = live.getRange(LIVE_HEADER_ROW, 1, 1, LIVE_COLS.length).getValues()[0].map(h => String(h || "").trim());
  const idx = (name) => header.indexOf(name);

  const req = ["player_id", "team", "jersey", "name", "PTS", "OREB", "DREB", "AST", "last"];
  for (const c of req) {
    if (idx(c) === -1) {
      return ContentService
        .createTextOutput(`error,Missing column ${c}\n`)
        .setMimeType(ContentService.MimeType.CSV);
    }
  }

  const lastRow = live.getLastRow();
  const out = [];
  out.push(buildTitlerHeaders_());

  if (lastRow < LIVE_FIRST_PLAYER_ROW) return csvOut_(out);

  const rows = live
    .getRange(LIVE_FIRST_PLAYER_ROW, 1, lastRow - LIVE_FIRST_PLAYER_ROW + 1, LIVE_COLS.length)
    .getValues()
    .filter(r => String(r[idx("player_id")] || "").trim() !== "");

  const nowIso = new Date().toISOString();

  for (const r of rows) {
    const player_id = String(r[idx("player_id")] || "").trim();
    const team = String(r[idx("team")] || "").trim();
    const jersey = String(r[idx("jersey")] || "").trim();
    const name = String(r[idx("name")] || "").trim();

    const first_name = (idx("first") !== -1) ? String(r[idx("first")] || "").trim() : "";
    const last_name  = String(r[idx("last")] || "").trim();

    const full = `${first_name} ${last_name}`.trim() || name;
    const display_name = `${jersey ? "#" + jersey + " " : ""}${full}`.trim();

    const PTS = Number(r[idx("PTS")] || 0);
    const REB = Number(r[idx("OREB")] || 0) + Number(r[idx("DREB")] || 0);
    const AST = Number(r[idx("AST")] || 0);

    const image_path = buildImagePathWindows_(first_name, last_name);

    out.push([
      player_id,
      team,
      jersey,
      display_name,
      first_name,
      last_name,
      PTS,
      REB,
      AST,
      image_path,
      nowIso
    ]);
  }

  return csvOut_(out);
}

function buildTitlerHeaders_() {
  return [
    "player_id",
    "team",
    "jersey",
    "display_name",
    "first_name",
    "last_name",
    "PTS",
    "REB",
    "AST",
    "image_path",
    "_last_update_iso"
  ];
}

function buildImagePathWindows_(firstName, lastName) {
  const f = toSafeFilenamePart_(firstName);
  const l = toSafeFilenamePart_(lastName);

  let base = "";
  if (f && l) base = `${f}_${l}`;
  else if (l) base = l;
  else base = "unknown";

  return `${TITLER_IMAGE_FOLDER_WIN}${base}${TITLER_IMAGE_EXT}`;
}

function toSafeFilenamePart_(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-]/g, "");
}

function csvOut_(rows) {
  const csv = rows.map(r => r.map(csvCell_).join(",")).join("\n") + "\n";
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

function csvCell_(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Read-only game list.
 * Called by DoGet.gs.
 */
function listGames_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB_GAMES);
  if (!sh) return { ok: false, error: "Missing GAMES sheet" };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, games: [] };

  const headers = values[0].map(h => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const required = ["game_id","date_iso","home_team","away_team","final_home_pts","final_away_pts","archive_tab","archived_at_iso"];
  for (const r of required) {
    if (idx(r) === -1) return { ok: false, error: `GAMES missing column: ${r}` };
  }

  let liveMeta = {};
  try {
    const live = ss.getSheetByName(TAB_LIVE);
    if (live) liveMeta = getLiveMeta_(live);
  } catch (err) {}

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const game_id = row[idx("game_id")];
    if (!game_id) continue;

    out.push({
      game_id: String(game_id),
      date_iso: row[idx("date_iso")] || "",
      home_team: row[idx("home_team")] || "",
      away_team: row[idx("away_team")] || "",
      final_home_pts: row[idx("final_home_pts")] ?? "",
      final_away_pts: row[idx("final_away_pts")] ?? "",
      archive_tab: row[idx("archive_tab")] || "",
      archived_at_iso: row[idx("archived_at_iso")] || "",
      status: "ARCHIVED",
      period: (String(liveMeta.game_id || "") === String(game_id)) ? (liveMeta.period || "") : "",
      clock_sec: (String(liveMeta.game_id || "") === String(game_id)) ? Number(liveMeta.clock_sec) : null
    });
  }

  out.reverse();
  return { ok: true, games: out };
}

/**
 * Read-only game state for resume.
 * Called by DoGet.gs - handles ensure* internally.
 */
function getGameState_(gameId) {
  if (!gameId) return { ok: false, error: "Missing game_id" };

  const ss = SpreadsheetApp.getActive();
  const games = ss.getSheetByName(TAB_GAMES);
  if (!games) return { ok: false, error: "Missing GAMES sheet" };

  const vals = games.getDataRange().getValues();
  if (vals.length < 2) return { ok: false, error: "No games in GAMES" };

  const headers = vals[0].map(h => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const iGameId = idx("game_id");
  if (iGameId === -1) return { ok: false, error: "GAMES missing game_id" };

  let row = null;
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][iGameId]) === String(gameId)) { row = vals[r]; break; }
  }
  if (!row) return { ok: false, error: "Game not found" };

  const home = row[idx("home_team")] || "";
  const away = row[idx("away_team")] || "";
  const archive_tab = row[idx("archive_tab")] || "";

  let period = "Q1";
  let clock_sec = 8 * 60;

  let starters_home = [];
  let starters_away = [];
  let playtime_home = {};
  let playtime_away = {};

  try {
    const live = ss.getSheetByName(TAB_LIVE);
    if (live) {
      ensureLiveHeader_();
      const meta = getLiveMeta_(live);
      if (String(meta.game_id || "") === String(gameId)) {
        period = meta.period || period;
        const c = Number(meta.clock_sec);
        if (Number.isFinite(c)) clock_sec = c;

        starters_home = readStartersFromLive_(live, String(meta.home_team || ""));
        starters_away = readStartersFromLive_(live, String(meta.away_team || ""));
        playtime_home = readPlaytimeFromLive_(live, String(meta.home_team || ""));
        playtime_away = readPlaytimeFromLive_(live, String(meta.away_team || ""));
      }
    }
  } catch (err) {}

  return {
    ok: true,
    game: {
      game_id: String(gameId),
      home_team: home,
      away_team: away,
      period,
      clock_sec,
      status: "ARCHIVED",
      archive_tab,
      starters_home,
      starters_away,
      playtime_home,
      playtime_away
    }
  };
}
