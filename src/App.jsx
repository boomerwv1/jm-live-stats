import React, { useEffect, useMemo, useRef, useState } from "react";

// ✅ SINGLE SOURCE OF TRUTH for the GAS Web App URL (change this ONE line on new deployments)
const ENDPOINT_DEFAULT =
  "https://script.google.com/macros/s/AKfycbwV1gKTvh7S8sELkUR4NvXyIu5zTL95ZS2ic1kaCoWe5DygE9kKu3B-V-eqT_NJ5TzEBQ/exec";
  

// ✅ App always uses this URL (no localStorage, no user-edit, no drift)
const API_URL = ENDPOINT_DEFAULT;

const EVENTS = [
  ["2M", "2 MAKE"],
  ["2X", "2 MISS"],
  ["3M", "3 MAKE"],
  ["3X", "3 MISS"],
  ["FTM", "FT MAKE"],
  ["FTX", "FT MISS"],
  ["OREB", "O REB"],
  ["DREB", "D REB"],
  ["AST", "AST"],
  ["STL", "STL"],
  ["BLK", "BLK"],
  ["TO", "TO"],
  ["FOUL", "FOUL"],
];

const PERIODS = ["Q1", "Q2", "Q3", "Q4", "OT"];

// ✅ JM presets (Team 1 / James Monroe)
const JM_BOYS_ROSTER_PRESET = `3 Kadyn Hines
10 Lane Taylor
12 Jayden Miller
13 Bryer Surface
33 Ryan Mann
20 Ben Comer
21 Bryce Gardinier
22 Clark Adkins
23 Wyatt Mann
24 Brycen Parker
25 Levi Taylor
30 Holden Crislip
0 Kolton Dowdy`;

const JM_GIRLS_ROSTER_PRESET = `0 Mya Dunlap
13 Lydia Dunlap
5 Kendall Long
10 Peighton Griffith
11 Monaka Moore
1 Chylin Eggleston 
3 Aysha Carter
4 Trinity Hill
12 Rileigh Jackson
14 Grayson Johnson
30 Lizzy Smith`;

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtMinutesFromSec(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

async function postNoCors(url, payload) {
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ✅ JSONP (avoids CORS issues on localhost)
function jsonp(url, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    const full = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;

    let done = false;
    const script = document.createElement("script");
    script.src = full;
    script.async = true;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    window[cb] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("JSONP load error"));
    };

    function cleanup() {
      try {
        delete window[cb];
      } catch {
        window[cb] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    document.body.appendChild(script);
  });
}

function apiUrlFor(apiUrl, params) {
  const base = String(apiUrl || "").split("#")[0].split("?")[0];
  const u = new URL(base);
  u.searchParams.set("view", "api");

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });

  return u.toString();
}

function parseRoster(text, prefix) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const roster = [];
  for (const line of lines) {
    // Expect: "23 John Smith" (last name may include spaces like "Van Buren" -> we’ll keep everything after first as name)
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;

    const jersey = m[1];
    const fullName = m[2].trim();

    // Split first + last (best effort)
    const parts = fullName.split(/\s+/).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ") || ""; // supports multi-part last names

    const player_id = `${prefix}${jersey}`;

    roster.push({
      player_id,
      jersey,
      first,
      last,
      name: `${first} ${last}`.trim(), // keep name for UI
    });
  }
  return roster;
}

function openPressSheet(apiUrl, tabName) {
  const base = String(apiUrl || "").split("#")[0].split("?")[0];
  const url = `${base}?view=presssheet&tab=${encodeURIComponent(tabName)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function App() {
  // ✅ always use the hardcoded deployment URL
  const apiUrl = API_URL;

  // ✅ clean up any legacy cached URL from older builds (prevents drift forever)
  useEffect(() => {
    try {
      localStorage.removeItem("apiUrl");
    } catch {}
  }, []);

  // --- persisted config (token + teams + rosters)
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [homeTeam, setHomeTeam] = useState(() => localStorage.getItem("homeTeam") || "James Monroe");
  const [awayTeam, setAwayTeam] = useState(() => localStorage.getItem("awayTeam") || "Opponent");

  const [homeRosterText, setHomeRosterText] = useState(
    () => localStorage.getItem("homeRosterText") || JM_BOYS_ROSTER_PRESET
  );
  const [awayRosterText, setAwayRosterText] = useState(() => localStorage.getItem("awayRosterText") || "");

  useEffect(() => localStorage.setItem("token", token), [token]);
  useEffect(() => localStorage.setItem("homeTeam", homeTeam), [homeTeam]);
  useEffect(() => localStorage.setItem("awayTeam", awayTeam), [awayTeam]);
  useEffect(() => localStorage.setItem("homeRosterText", homeRosterText), [homeRosterText]);
  useEffect(() => localStorage.setItem("awayRosterText", awayRosterText), [awayRosterText]);

  // --- screens
  const [screen, setScreen] = useState("setup"); // setup | starters | previous | game

  // --- previous games state
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");

  // --- game state
  const [gameId, setGameId] = useState(
    () => localStorage.getItem("gameId") || `JM_${new Date().toISOString().slice(0, 10)}_001`
  );
  useEffect(() => localStorage.setItem("gameId", gameId), [gameId]);

  const [period, setPeriod] = useState("Q1");
  const [clockSec, setClockSec] = useState(8 * 60);
  const [running, setRunning] = useState(false);
  const [clockEdit, setClockEdit] = useState(""); // MM:SS
  
  // ✅ Backend clock (authoritative for stat timestamps, especially for secondary users)
  // This is synced from polling and always reflects what's actually in the backend
  const [backendClockSec, setBackendClockSec] = useState(8 * 60);
  const [backendPeriod, setBackendPeriod] = useState("Q1");

  const [status, setStatus] = useState("");
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [localScore, setLocalScore] = useState({ home: 0, away: 0 }); // ✅ Local score for immediate updates
  const [pbp, setPbp] = useState([]);
  const [pbpSeq, setPbpSeq] = useState(-1);
  
  // ✅ Multi-user: Track if this user is the primary (game creator) or secondary (joined) user
  // Primary user controls clock, secondary users see it but can't modify
  const [isPrimaryUser, setIsPrimaryUser] = useState(false);

  const [team, setTeam] = useState(homeTeam);
  const [pendingEvent, setPendingEvent] = useState(null);

  const [lastArchiveTab, setLastArchiveTab] = useState(() => localStorage.getItem("lastArchiveTab") || "");
  useEffect(() => localStorage.setItem("lastArchiveTab", lastArchiveTab), [lastArchiveTab]);

  useEffect(() => {
    if (team !== homeTeam && team !== awayTeam) setTeam(homeTeam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeTeam, awayTeam]);

  const homeRoster = useMemo(() => parseRoster(homeRosterText, "H"), [homeRosterText]);
  const awayRoster = useMemo(() => parseRoster(awayRosterText, "A"), [awayRosterText]);

  // ✅ starters/on-floor state (IDs)
  const [homeOn, setHomeOn] = useState([]);
  const [awayOn, setAwayOn] = useState([]);

  // ✅ playtime maps (player_id -> seconds)
  const [homePT, setHomePT] = useState({});
  const [awayPT, setAwayPT] = useState({});

  // Substitution state (no separate mode - integrated into main view)
  const [subOut, setSubOut] = useState("");
  const [subIn, setSubIn] = useState("");

  const homeOnPlayers = useMemo(
    () => homeOn.map((id) => homeRoster.find((p) => p.player_id === id)).filter(Boolean),
    [homeOn, homeRoster]
  );
  const awayOnPlayers = useMemo(
    () => awayOn.map((id) => awayRoster.find((p) => p.player_id === id)).filter(Boolean),
    [awayOn, awayRoster]
  );

  const isHomeSelected = team === homeTeam;
  const onFloorPlayers = isHomeSelected ? homeOnPlayers : awayOnPlayers;

  const benchPlayers = useMemo(() => {
    const roster = isHomeSelected ? homeRoster : awayRoster;
    const on = new Set(isHomeSelected ? homeOn : awayOn);
    return roster.filter((p) => !on.has(p.player_id));
  }, [isHomeSelected, homeRoster, awayRoster, homeOn, awayOn]);

  function initDefaultStarting5() {
    setHomeOn(homeRoster.slice(0, 5).map((p) => p.player_id));
    setAwayOn(awayRoster.slice(0, 5).map((p) => p.player_id));
  }

  function initPlaytimeZeros() {
    const h = {};
    const a = {};
    homeRoster.forEach((p) => (h[p.player_id] = 0));
    awayRoster.forEach((p) => (a[p.player_id] = 0));
    setHomePT(h);
    setAwayPT(a);
  }

  // ✅ JSONP list_games
  async function loadPreviousGames() {
    if (!apiUrl || !token) {
      setGamesError("Set token first.");
      return;
    }

    setGamesLoading(true);
    setGamesError("");

    try {
      const base = String(apiUrl || "").split("#")[0].split("?")[0];
      const url = apiUrlFor(base, { action: "list_games", access_token: token });
      const data = await jsonp(url);

      if (!data) throw new Error("No response (JSONP).");
      if (!data.ok) {
        const msg = String(data.error || "list_games failed");
        throw new Error(msg.toLowerCase().includes("unauthorized") ? "Unauthorized (check token in Config tab)" : msg);
      }

      setGames(Array.isArray(data.games) ? data.games : []);
      localStorage.setItem("token", token);
    } catch (err) {
      setGamesError(String(err?.message || err));
    } finally {
      setGamesLoading(false);
    }
  }

  // ✅ send starters to sheet (and leave lineup as the starters)
  async function publishStarters() {
    if (!apiUrl || !token) return;
    if (homeOn.length !== 5 || awayOn.length !== 5) {
      setStatus("Need exactly 5 starters for each team.");
      return;
    }
    const payload = {
      access_token: token,
      action: "set_starters",
      starters_home: homeOn,
      starters_away: awayOn,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus("Starters saved to sheet.");
    } catch {
      setStatus("Failed saving starters.");
    }
  }

  // ✅ send playtime to sheet
  async function publishPlaytime() {
    if (!apiUrl || !token) return;

    const payload = {
      access_token: token,
      action: "set_playtime",
      playtime_home: homePT,
      playtime_away: awayPT,
    };

    try {
      await postNoCors(apiUrl, payload);
    } catch {
      // silent: this runs frequently
    }
  }

  // ✅ Join active game: check for current LIVE game and join it
  async function joinCurrentGame() {
    if (!apiUrl || !token) {
      setStatus("Set token first.");
      return;
    }
    setStatus("Checking for active game…");
    try {
      const url = apiUrlFor(apiUrl, {
        action: "get_live_snapshot",
        access_token: token,
        since_pbp_seq: -1,
      });
      const data = await jsonp(url, { timeoutMs: 8000 });
      if (!data || !data.ok) {
        setStatus(`No active game found (${data?.error || "connection error"}).`);
        return;
      }
      
      const live = data.live || {};
      const meta = live.meta || {};
      const gameIdActive = String(meta.game_id || "").trim();
      const homeTeamActive = String(meta.home_team || "").trim();
      const awayTeamActive = String(meta.away_team || "").trim();
      
      if (!gameIdActive || !homeTeamActive || !awayTeamActive) {
        setStatus("No active game found. Start a new game or use Previous Games to resume.");
        return;
      }
      
      // Found active game - load state directly from live snapshot
      setGameId(gameIdActive);
      setHomeTeam(homeTeamActive);
      setAwayTeam(awayTeamActive);
      const initialPeriod = String(meta.period || "Q1");
      const initialClock = Number.isFinite(meta.clock_sec) ? Number(meta.clock_sec) : 8 * 60;
      setPeriod(initialPeriod);
      setClockSec(initialClock);
      setBackendPeriod(initialPeriod);
      setBackendClockSec(initialClock);
      
      // Set starters from live snapshot (or empty arrays if not set)
      const startersHome = Array.isArray(live.starters_home) && live.starters_home.length === 5 ? live.starters_home : [];
      const startersAway = Array.isArray(live.starters_away) && live.starters_away.length === 5 ? live.starters_away : [];
      setHomeOn(startersHome);
      setAwayOn(startersAway);
      
      // Set playtime from live snapshot
      if (live.playtime_home && typeof live.playtime_home === "object") {
        setHomePT(live.playtime_home);
      } else {
        setHomePT({});
      }
      if (live.playtime_away && typeof live.playtime_away === "object") {
        setAwayPT(live.playtime_away);
      } else {
        setAwayPT({});
      }
      
      // Set on-floor lineups (derived from starters + subs)
      if (Array.isArray(live.on_floor_home) && live.on_floor_home.length === 5) {
        setHomeOn(live.on_floor_home);
      }
      if (Array.isArray(live.on_floor_away) && live.on_floor_away.length === 5) {
        setAwayOn(live.on_floor_away);
      }
      
      // Set score
      if (live.score) {
        const backendScore = {
          home: Number(live.score.home_pts || 0),
          away: Number(live.score.away_pts || 0),
        };
        setLocalScore(backendScore);
        setScore(backendScore);
      } else {
        setLocalScore({ home: 0, away: 0 });
        setScore({ home: 0, away: 0 });
      }
      
      setRunning(false);
      setPendingEvent(null);
      setSubOut("");
      setSubIn("");
      setTeam(homeTeamActive);
      
      // ✅ Mark as secondary user (joined, not creator) - no clock control
      setIsPrimaryUser(false);
      
      // Note: roster will need to be loaded manually or synced later
      // For now, user can enter rosters if needed
      
      setStatus(`Joined active game: ${gameIdActive} — ${homeTeamActive} vs ${awayTeamActive} (Read-only clock)`);
      setScreen("game");
    } catch (err) {
      setStatus(`Join failed: ${String(err.message || err)}`);
    }
  }

  // ✅ JSONP get_game_state
  async function resumeGame(gameIdToResume, archiveTabFromRow = "") {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }
    setStatus("Loading game…");
    try {
      const url = apiUrlFor(apiUrl, {
        action: "get_game_state",
        access_token: token,
        game_id: gameIdToResume,
      });
      const data = await jsonp(url);
      if (!data || !data.ok) throw new Error((data && data.error) || "get_game_state failed");

      const g = data.game;

      setGameId(g.game_id);
      if (g.home_team) setHomeTeam(g.home_team);
      if (g.away_team) setAwayTeam(g.away_team);
      const resumePeriod = g.period || "Q1";
      const resumeClock = Number.isFinite(g.clock_sec) ? g.clock_sec : 8 * 60;
      setPeriod(resumePeriod);
      setClockSec(resumeClock);
      setBackendPeriod(resumePeriod);
      setBackendClockSec(resumeClock);

      // ✅ starters: if present, use those; else default first 5
      const sh = Array.isArray(g.starters_home) ? g.starters_home : null;
      const sa = Array.isArray(g.starters_away) ? g.starters_away : null;

      if (sh && sh.length === 5) setHomeOn(sh);
      else setHomeOn(homeRoster.slice(0, 5).map((p) => p.player_id));

      if (sa && sa.length === 5) setAwayOn(sa);
      else setAwayOn(awayRoster.slice(0, 5).map((p) => p.player_id));

      // ✅ playtime: if present, load; else reset
      const pth = g.playtime_home && typeof g.playtime_home === "object" ? g.playtime_home : null;
      const pta = g.playtime_away && typeof g.playtime_away === "object" ? g.playtime_away : null;

      if (pth) setHomePT(pth);
      else {
        const h = {};
        homeRoster.forEach((p) => (h[p.player_id] = 0));
        setHomePT(h);
      }

      if (pta) setAwayPT(pta);
      else {
        const a = {};
        awayRoster.forEach((p) => (a[p.player_id] = 0));
        setAwayPT(a);
      }

      setRunning(false);
      setPendingEvent(null);
      setSubOut("");
      setSubIn("");
      setTeam(g.home_team || homeTeam);

      const tab = (archiveTabFromRow || g.archive_tab || "").trim();
      if (tab) setLastArchiveTab(tab);

      // ✅ Initialize score (will be synced from backend on first poll)
      setLocalScore({ home: 0, away: 0 });
      setScore({ home: 0, away: 0 });
      
      // ✅ Mark as secondary user (resumed, not creator) - no clock control
      setIsPrimaryUser(false);
      
      setStatus(`Resumed ${g.game_id} @ ${g.period} ${fmtClock(g.clock_sec)} (Read-only clock)`);
      setScreen("game");
    } catch (err) {
      setStatus(`Resume failed: ${String(err.message || err)}`);
    }
  }

  function generatePressSheetFromRow(g) {
    const tab = String(g.archive_tab || "").trim();
    if (!tab) {
      setStatus("No archive tab found for this game row yet.");
      return;
    }
    setLastArchiveTab(tab);
    openPressSheet(apiUrl, tab);
  }

  async function startGame() {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }
    if (homeRoster.length < 5 || awayRoster.length < 5) {
      setStatus("Need at least 5 players per team in roster.");
      return;
    }

    setPeriod("Q1");
    setClockSec(8 * 60);
    setRunning(false);
    setTeam(homeTeam);

    // init starter selection defaults + playtime + score
    initDefaultStarting5();
    initPlaytimeZeros();
    setLocalScore({ home: 0, away: 0 });
    setScore({ home: 0, away: 0 });
    
    // ✅ Mark as primary user (game creator) - full clock control
    setIsPrimaryUser(true);

    const payload = {
      access_token: token,
      action: "init_game",
      game_id: gameId,
      home_team: homeTeam,
      away_team: awayTeam,
      period: "Q1",
      clock_sec: 8 * 60,
      home_roster: homeRoster,
      away_roster: awayRoster,
    };

    try {
      await postNoCors(apiUrl, payload);
      localStorage.setItem("token", token);

      setStatus("Game initialized. Select starters…");
      setScreen("starters");
    } catch {
      setStatus("Init failed. Check endpoint/token.");
    }
  }

  async function publishStat(playerId, eventType, delta = 1) {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }
    
    // ✅ Use backend clock for timestamps (authoritative, synced from polling)
    // Primary users: backendClockSec matches their local clockSec (when stopped) or is close
    // Secondary users: backendClockSec is what primary has, ensuring consistent timestamps
    const statClockSec = backendClockSec;
    const statPeriod = backendPeriod;
    
    // ✅ Update local score IMMEDIATELY (synchronous, before async POST) for instant UI feedback
    const pointsDelta = getPointsForEvent(eventType, delta);
    if (pointsDelta > 0) {
      // Use functional update to ensure we're working with latest state
      setLocalScore((prev) => {
        const newScore = {
          home: team === homeTeam ? prev.home + pointsDelta : prev.home,
          away: team === awayTeam ? prev.away + pointsDelta : prev.away,
        };
        // Force immediate state update (React will batch, but this ensures it happens)
        return newScore;
      });
      // Also update the backend tracking score immediately
      setScore((prev) => ({
        home: team === homeTeam ? prev.home + pointsDelta : prev.home,
        away: team === awayTeam ? prev.away + pointsDelta : prev.away,
      }));
    }
    
    const payload = {
      access_token: token,
      action: "stat",
      event_id: uuid(),
      ts_iso: new Date().toISOString(),
      game_id: gameId,
      period: statPeriod,
      clock_sec: statClockSec,
      team,
      player_id: playerId,
      event_type: eventType,
      delta,
    };
    
    // Fire-and-forget: POST happens async, UI already updated
    postNoCors(apiUrl, payload).then(() => {
      setStatus(`Logged ${eventType} — ${team} ${playerId} @ ${statPeriod} ${fmtClock(statClockSec)}`);
    }).catch(() => {
      setStatus("Publish failed (network?).");
    });
  }
  
  // ✅ Helper: get points for an event type
  function getPointsForEvent(eventType, delta) {
    if (delta <= 0) return 0;
    const e = String(eventType || "").toUpperCase();
    if (e === "2M") return 2;
    if (e === "3M") return 3;
    if (e === "FTM") return 1;
    return 0;
  }

  async function publishMeta() {
    if (!apiUrl || !token) return;
    const payload = {
      access_token: token,
      action: "set_meta",
      game_id: gameId,
      home_team: homeTeam,
      away_team: awayTeam,
      period,
      clock_sec: clockSec,
    };
    try {
      await postNoCors(apiUrl, payload);
    } catch {}
  }

  async function publishMetaWithAudit(next, reason) {
    if (!apiUrl || !token) return;
    const payload = {
      access_token: token,
      action: "set_meta",
      meta_event_id: uuid(),
      ts_iso: new Date().toISOString(),
      reason: String(reason || ""),
      game_id: gameId,
      home_team: homeTeam,
      away_team: awayTeam,
      period: next.period ?? period,
      clock_sec: next.clock_sec ?? clockSec,
    };
    try {
      await postNoCors(apiUrl, payload);
    } catch {}
  }

  async function publishSub(teamName, outId, inId) {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }
    // ✅ Use backend clock for timestamps (authoritative, synced from polling)
    const statClockSec = backendClockSec;
    const statPeriod = backendPeriod;
    
    const payload = {
      access_token: token,
      action: "sub",
      event_id: uuid(),
      ts_iso: new Date().toISOString(),
      game_id: gameId,
      period: statPeriod,
      clock_sec: statClockSec,
      team: teamName,
      player_out: outId,
      player_in: inId,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus(`SUB ${teamName}: ${outId} → ${inId} @ ${statPeriod} ${fmtClock(statClockSec)}`);
    } catch {
      setStatus("Sub publish failed.");
    }
  }

  async function publishJumpBall() {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }
    // ✅ Use backend clock for timestamps (authoritative, synced from polling)
    const statClockSec = backendClockSec;
    const statPeriod = backendPeriod;
    
    const payload = {
      access_token: token,
      action: "stat",
      event_id: uuid(),
      ts_iso: new Date().toISOString(),
      game_id: gameId,
      period: statPeriod,
      clock_sec: statClockSec,
      team: team,
      player_id: "", // jump ball is not player-specific
      event_type: "JUMP_BALL",
      delta: 0,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus(`Logged JUMP BALL @ ${statPeriod} ${fmtClock(statClockSec)}`);
    } catch {
      setStatus("Publish failed (network?).");
    }
  }

  function applySubLocally(teamName, outId, inId) {
    if (teamName === homeTeam) {
      const cur = new Set(homeOn);
      if (!cur.has(outId) || cur.has(inId)) return false;
      cur.delete(outId);
      cur.add(inId);
      if (cur.size !== 5) return false;
      setHomeOn(Array.from(cur));
      return true;
    }
    if (teamName === awayTeam) {
      const cur = new Set(awayOn);
      if (!cur.has(outId) || cur.has(inId)) return false;
      cur.delete(outId);
      cur.add(inId);
      if (cur.size !== 5) return false;
      setAwayOn(Array.from(cur));
      return true;
    }
    return false;
  }

  function parseClockInputToSec(s) {
    const raw = String(s || "").trim();
    const m = raw.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    const mm = Number(m[1]);
    const ss = Number(m[2]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null;
    if (ss < 0 || ss > 59) return null;
    return mm * 60 + ss;
  }

  // ✅ Multi-user polling: pull authoritative LIVE meta/score/lineups/playtime/PBP
  useEffect(() => {
    if (screen !== "game") return;
    if (!apiUrl || !token) return;

    let stopped = false;
    const pollMs = 1200;

    async function poll() {
      if (stopped) return;
      try {
        const url = apiUrlFor(apiUrl, {
          action: "get_live_snapshot",
          access_token: token,
          since_pbp_seq: pbpSeq,
        });
        const data = await jsonp(url, { timeoutMs: 8000 });
        if (!data || !data.ok) return;

        const live = data.live || {};
        const meta = live.meta || {};

        // Score sanity check display (authoritative from backend totals)
        // ✅ Sync backend score - use backend as source of truth for multi-user consistency
        if (live.score) {
          const backendScore = {
            home: Number(live.score.home_pts || 0),
            away: Number(live.score.away_pts || 0),
          };
          setScore(backendScore);
          // ✅ Update local score to backend (handles multi-user updates)
          // Backend is authoritative - if it differs, another user scored
          setLocalScore((prev) => {
            // Only update if backend is different (avoids unnecessary re-renders)
            if (prev.home !== backendScore.home || prev.away !== backendScore.away) {
              return backendScore;
            }
            return prev;
          });
        }

        // ✅ Always update backend clock state (for stat timestamps)
        if (meta.period) {
          setBackendPeriod(String(meta.period));
        }
        if (Number.isFinite(meta.clock_sec)) {
          setBackendClockSec(Number(meta.clock_sec));
        }
        
        // ✅ Clock sync rules:
        // - Primary user (creator): Only sync local clock when NOT running locally (avoids fighting the active timer)
        // - Secondary user (joined): Always sync local clock from backend (read-only, they don't control clock)
        if (isPrimaryUser) {
          // Primary user: only sync when clock is stopped (display matches backend)
          if (!running) {
            if (meta.period) setPeriod(String(meta.period));
            if (Number.isFinite(meta.clock_sec)) setClockSec(Number(meta.clock_sec));
          }
        } else {
          // Secondary user: ALWAYS sync local display from backend (read-only, continuous updates)
          if (meta.period) setPeriod(String(meta.period));
          if (Number.isFinite(meta.clock_sec)) {
            // Force immediate sync for secondary users (they see primary's clock in real-time)
            setClockSec(Number(meta.clock_sec));
          }
          // Also sync running state (if backend has it running, stop it locally - only primary controls it)
          setRunning(false);
        }

        // Sync playtime maps (so all users see consistent minutes)
        if (live.playtime_home && typeof live.playtime_home === "object") setHomePT(live.playtime_home);
        if (live.playtime_away && typeof live.playtime_away === "object") setAwayPT(live.playtime_away);

        // Sync on-floor lineup derived from starters + subs (multi-user safe)
        if (Array.isArray(live.on_floor_home) && live.on_floor_home.length === 5) setHomeOn(live.on_floor_home);
        if (Array.isArray(live.on_floor_away) && live.on_floor_away.length === 5) setAwayOn(live.on_floor_away);

        // Append new PBP rows
        if (data.pbp && Array.isArray(data.pbp.rows)) {
          const rows = data.pbp.rows;
          if (rows.length) {
            setPbp((prev) => {
              const next = [...prev, ...rows];
              // keep last ~120 lines
              return next.length > 120 ? next.slice(next.length - 120) : next;
            });
          }
          if (Number.isFinite(data.pbp.latest_seq)) setPbpSeq(data.pbp.latest_seq);
        }
      } catch {
        // silent
      } finally {
        if (!stopped) setTimeout(poll, pollMs);
      }
    }

    poll();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, apiUrl, token, pbpSeq, running]);

  async function endGame(resetLive = false) {
    if (!apiUrl || !token) {
      setStatus("Set token.");
      return;
    }

    // push latest playtime before archive
    await publishPlaytime();

    const payload = {
      access_token: token,
      action: "end_game",
      game_id: gameId,
      reset_live: resetLive,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus("Game archived. Open Previous Games → Generate Sheet.");
      if (resetLive) setScreen("setup");
    } catch {
      setStatus("End game failed.");
    }
  }

  // keep sheet meta updated
  useEffect(() => {
    if (screen !== "game") return;
    const t = setInterval(() => publishMeta(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, period, clockSec, homeTeam, awayTeam, gameId]);

  // ✅ game clock + playtime tick
  useEffect(() => {
    if (screen !== "game") return;
    if (!running) return;

    const t = setInterval(() => {
      setClockSec((s) => Math.max(0, s - 1));

      // add 1 second to on-floor players for BOTH teams
      setHomePT((prev) => {
        const next = { ...prev };
        homeOn.forEach((pid) => (next[pid] = (next[pid] || 0) + 1));
        return next;
      });
      setAwayPT((prev) => {
        const next = { ...prev };
        awayOn.forEach((pid) => (next[pid] = (next[pid] || 0) + 1));
        return next;
      });
    }, 1000);

    return () => clearInterval(t);
  }, [screen, running, homeOn, awayOn]);

  // ✅ publish playtime periodically while in game screen
  useEffect(() => {
    if (screen !== "game") return;

    const t = setInterval(() => {
      if (Object.keys(homePT).length === 0 && Object.keys(awayPT).length === 0) return;
      publishPlaytime();
    }, 15000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, apiUrl, token, homePT, awayPT]);

  // ✅ when clock stops, push playtime immediately
  const lastRunningRef = useRef(running);
  useEffect(() => {
    if (screen !== "game") return;
    if (lastRunningRef.current === true && running === false) {
      publishPlaytime();
    }
    lastRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, screen]);

  const card = { padding: 10, border: "1px solid #ddd", borderRadius: 12, marginTop: 12 };

  // SETUP
  if (screen === "setup") {
    return (
      <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 680, margin: "0 auto" }}>
        <h2 style={{ margin: "8px 0" }}>JM Live Stats — Setup</h2>

        <div style={card}>
          <label>
            Apps Script URL (hardcoded)
            <input value={apiUrl} readOnly style={{ width: "100%", padding: 8, opacity: 0.85 }} />
          </label>

          <label>
            Access Token
            <input value={token} onChange={(e) => setToken(e.target.value)} style={{ width: "100%", padding: 8 }} />
          </label>

          <label>
            Game ID
            <input value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ width: "100%", padding: 8 }} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label>
              Team 1 (James Monroe)
              <input
                value={homeTeam}
                onChange={(e) => setHomeTeam(e.target.value)}
                style={{ width: "100%", padding: 8 }}
              />
            </label>
            <label>
              Team 2 (Opponent)
              <input
                value={awayTeam}
                onChange={(e) => setAwayTeam(e.target.value)}
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>
        </div>

        {/* ✅ Join Current Game button (multi-user) */}
        {token && (
          <div style={card}>
            <div style={{ fontWeight: 800, marginBottom: 8, color: "#0066cc" }}>
              Multi-User: Join Active Game
            </div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>
              If another stat keeper has started a game, click below to join and track stats together.
            </div>
            <button
              onClick={joinCurrentGame}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                fontWeight: 900,
                backgroundColor: "#0066cc",
                color: "#fff",
                border: "none",
                fontSize: 16,
                width: "100%",
              }}
            >
              JOIN CURRENT GAME
            </button>
          </div>
        )}

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Team 1 Roster (one per line: "# Name")</div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => {
                setHomeTeam("James Monroe");
                setHomeRosterText(JM_BOYS_ROSTER_PRESET);
              }}
              style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}
            >
              Load JM Boys
            </button>

            <button
              onClick={() => {
                setHomeTeam("James Monroe");
                setHomeRosterText(JM_GIRLS_ROSTER_PRESET);
              }}
              style={{ padding: 10, borderRadius: 12, fontWeight: 900 }}
            >
              Load JM Girls
            </button>
          </div>

          <textarea
            value={homeRosterText}
            onChange={(e) => setHomeRosterText(e.target.value)}
            rows={8}
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Team 2 Roster (one per line: “# Name”)</div>
          <textarea
            value={awayRosterText}
            onChange={(e) => setAwayRosterText(e.target.value)}
            rows={8}
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <button
          onClick={startGame}
          style={{ width: "100%", marginTop: 12, padding: 14, fontWeight: 900, borderRadius: 12 }}
        >
          START GAME (writes LIVE + clears logs)
        </button>

        <button
          onClick={async () => {
            setScreen("previous");
            await loadPreviousGames();
          }}
          style={{ width: "100%", marginTop: 10, padding: 14, fontWeight: 900, borderRadius: 12 }}
        >
          PREVIOUS GAMES (resume / press sheet)
        </button>

        <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 12 }}>
          <div style={{ fontWeight: 700 }}>Status:</div>
          <div style={{ fontSize: 13 }}>{status || "Ready."}</div>
        </div>
      </div>
    );
  }

  // STARTERS SCREEN
  if (screen === "starters") {
    const hSelected = new Set(homeOn);
    const aSelected = new Set(awayOn);

    const toggleStarter = (which, pid) => {
      if (which === "home") {
        setHomeOn((cur) => {
          const set = new Set(cur);
          if (set.has(pid)) set.delete(pid);
          else {
            if (set.size >= 5) return cur;
            set.add(pid);
          }
          return Array.from(set);
        });
      } else {
        setAwayOn((cur) => {
          const set = new Set(cur);
          if (set.has(pid)) set.delete(pid);
          else {
            if (set.size >= 5) return cur;
            set.add(pid);
          }
          return Array.from(set);
        });
      }
    };

    return (
      <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ margin: "8px 0" }}>Select Starters</h2>

        <div style={{ opacity: 0.8, marginBottom: 8 }}>
          Pick exactly <b>5</b> for each team. This will persist + print on the press sheet.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={card}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>
              {homeTeam} ({homeOn.length}/5)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {homeRoster.map((p) => (
                <button
                  key={p.player_id}
                  onClick={() => toggleStarter("home", p.player_id)}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    fontWeight: 900,
                    border: hSelected.has(p.player_id) ? "2px solid #000" : "1px solid #ddd",
                  }}
                >
                  #{p.jersey}
                </button>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>
              {awayTeam} ({awayOn.length}/5)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {awayRoster.map((p) => (
                <button
                  key={p.player_id}
                  onClick={() => toggleStarter("away", p.player_id)}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    fontWeight: 900,
                    border: aSelected.has(p.player_id) ? "2px solid #000" : "1px solid #ddd",
                  }}
                >
                  #{p.jersey}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={async () => {
            if (homeOn.length !== 5 || awayOn.length !== 5) {
              setStatus("Must pick exactly 5 starters per team.");
              return;
            }
            await publishStarters();
            await publishPlaytime(); // initial 0s
            setScreen("game");
            setStatus("Ready.");
          }}
          style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 12, fontWeight: 950 }}
        >
          SAVE STARTERS + START GAME UI
        </button>

        <button
          onClick={() => setScreen("setup")}
          style={{ width: "100%", marginTop: 10, padding: 14, borderRadius: 12 }}
        >
          Back to Setup
        </button>

        <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 12 }}>
          <div style={{ fontWeight: 700 }}>Status:</div>
          <div style={{ fontSize: 13 }}>{status || "Ready."}</div>
        </div>
      </div>
    );
  }

  // PREVIOUS
  if (screen === "previous") {
    return (
      <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ margin: "8px 0" }}>Previous Games</h2>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={loadPreviousGames} style={{ padding: 12, borderRadius: 12, fontWeight: 900 }}>
            Refresh
          </button>
          <button onClick={() => setScreen("setup")} style={{ padding: 12, borderRadius: 12 }}>
            Back
          </button>
        </div>

        {gamesLoading && <div style={{ marginTop: 12 }}>Loading…</div>}
        {gamesError && (
          <div style={{ marginTop: 12, padding: 10, border: "1px solid #f99", borderRadius: 12 }}>
            <b>Error:</b> {gamesError}
          </div>
        )}

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {games.map((g, idx) => (
            <div
              key={`${idx}-${g.game_id}-${g.archive_tab || ""}-${g.archived_at_iso || ""}`}
              style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {g.date_iso ? `${String(g.date_iso).slice(0, 10)} — ` : ""}
                  {g.home_team} vs {g.away_team}
                  {/* ✅ Visual indicator for active (non-archived) games */}
                  {!g.archive_tab && (
                    <span style={{ marginLeft: 8, padding: "2px 8px", backgroundColor: "#28a745", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                <div style={{ opacity: 0.8 }}>
                  {g.period ? g.period : ""}
                  {Number.isFinite(g.clock_sec) ? ` • ${fmtClock(g.clock_sec)}` : ""}
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  onClick={() => resumeGame(g.game_id, g.archive_tab)}
                  style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                >
                  Resume
                </button>

                <button
                  onClick={() => generatePressSheetFromRow(g)}
                  style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                  disabled={!String(g.archive_tab || "").trim()}
                >
                  Generate Sheet
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                game_id: <code>{g.game_id}</code>
                {g.archive_tab ? (
                  <>
                    {" "}
                    • archive_tab: <code>{g.archive_tab}</code>
                  </>
                ) : (
                  " • (not archived yet)"
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // GAME
  const startersTextHome = homeOnPlayers.map((p) => `#${p.jersey}`).join(", ");
  const startersTextAway = awayOnPlayers.map((p) => `#${p.jersey}`).join(", ");

  return (
    <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ margin: "8px 0" }}>JM Live Stats</h2>

      <div style={card}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <select
            value={period}
            onChange={async (e) => {
              if (!isPrimaryUser) return; // ✅ Secondary users can't change period
              const nextPeriod = e.target.value;
              // ✅ Quarter change resets clock to 8:00 (still manually adjustable after reset)
              setPeriod(nextPeriod);
              setClockSec(8 * 60);
              setRunning(false);
              await publishMetaWithAudit({ period: nextPeriod, clock_sec: 8 * 60 }, "quarter_change_reset");
            }}
            disabled={!isPrimaryUser}
            style={{ padding: 8, opacity: isPrimaryUser ? 1 : 0.5 }}
            title={!isPrimaryUser ? "Clock controlled by primary stat keeper" : ""}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 32, fontWeight: 800 }}>
            {fmtClock(clockSec)}
            {!isPrimaryUser && (
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: "#666" }}>(Read-only)</span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button 
              onClick={() => {
                if (!isPrimaryUser) return;
                setRunning((r) => !r);
              }}
              disabled={!isPrimaryUser}
              style={{ 
                padding: "10px 12px", 
                fontWeight: 900,
                backgroundColor: isPrimaryUser ? (running ? "#dc3545" : "#28a745") : "#ccc",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                opacity: isPrimaryUser ? 1 : 0.5,
                cursor: isPrimaryUser ? "pointer" : "not-allowed",
              }}
              title={!isPrimaryUser ? "Clock controlled by primary stat keeper" : ""}
            >
              {running ? "STOP" : "START"}
            </button>
            <button 
              onClick={() => {
                if (!isPrimaryUser) return;
                setClockSec((s) => Math.max(0, s + 1));
              }}
              disabled={!isPrimaryUser}
              style={{ 
                padding: "10px 12px",
                backgroundColor: isPrimaryUser ? "#f8f9fa" : "#e9ecef",
                border: `2px solid ${isPrimaryUser ? "#666" : "#ccc"}`,
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                opacity: isPrimaryUser ? 1 : 0.5,
                cursor: isPrimaryUser ? "pointer" : "not-allowed",
              }}
              title={!isPrimaryUser ? "Clock controlled by primary stat keeper" : ""}
            >
              +1
            </button>
            <button 
              onClick={() => {
                if (!isPrimaryUser) return;
                setClockSec((s) => Math.max(0, s - 1));
              }}
              disabled={!isPrimaryUser}
              style={{ 
                padding: "10px 12px",
                backgroundColor: isPrimaryUser ? "#f8f9fa" : "#e9ecef",
                border: `2px solid ${isPrimaryUser ? "#666" : "#ccc"}`,
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                opacity: isPrimaryUser ? 1 : 0.5,
                cursor: isPrimaryUser ? "pointer" : "not-allowed",
              }}
              title={!isPrimaryUser ? "Clock controlled by primary stat keeper" : ""}
            >
              -1
            </button>
          </div>
        </div>

        {/* ✅ Manual clock correction (audited + multi-user propagates via polling) */}
        {/* Only show clock controls to primary user */}
        {isPrimaryUser && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={clockEdit}
              onChange={(e) => setClockEdit(e.target.value)}
              placeholder="Set clock (MM:SS) e.g. 07:32"
              style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", width: 220 }}
            />
            <button
              onClick={async () => {
                const sec = parseClockInputToSec(clockEdit);
                if (sec == null) {
                  setStatus("Clock format must be MM:SS (seconds 00-59).");
                  return;
                }
                setClockSec(sec);
                setRunning(false);
                await publishMetaWithAudit({ clock_sec: sec }, "manual_clock_edit");
                setStatus(`Clock set to ${fmtClock(sec)}`);
                setClockEdit("");
              }}
              style={{ 
                padding: "10px 12px", 
                fontWeight: 900,
                backgroundColor: "#0066cc",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              SET CLOCK
            </button>
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={publishJumpBall}
            style={{ 
              padding: "10px 12px", 
              fontWeight: 900,
              backgroundColor: "#6c757d",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
            }}
            title="Logs an event (no stat delta) for auditing/resume"
          >
            JUMP BALL
          </button>
          <div style={{ marginLeft: "auto", fontWeight: 900, fontSize: 18, color: "#000" }}>
            {/* ✅ Live score: local for immediate updates, backend for multi-user sync */}
            {homeTeam}: <span style={{ color: "#0066cc" }}>{localScore.home}</span> &nbsp;|&nbsp; {awayTeam}: <span style={{ color: "#0066cc" }}>{localScore.away}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
        <div>
          <b>{homeTeam}</b> starters: {startersTextHome || "(not set)"}{" "}
        </div>
        <div>
          <b>{awayTeam}</b> starters: {startersTextAway || "(not set)"}{" "}
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          onClick={() => {
            setTeam(homeTeam);
            setSubOut("");
            setSubIn("");
            setPendingEvent(null);
          }}
          style={{ 
            flex: 1, 
            padding: 10, 
            fontWeight: team === homeTeam ? 900 : 700,
            backgroundColor: team === homeTeam ? "#0066cc" : "#f8f9fa",
            color: team === homeTeam ? "#fff" : "#000",
            border: team === homeTeam ? "none" : "2px solid #666",
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          {homeTeam}
        </button>
        <button
          onClick={() => {
            setTeam(awayTeam);
            setSubOut("");
            setSubIn("");
            setPendingEvent(null);
          }}
          style={{ 
            flex: 1, 
            padding: 10, 
            fontWeight: team === awayTeam ? 900 : 700,
            backgroundColor: team === awayTeam ? "#0066cc" : "#f8f9fa",
            color: team === awayTeam ? "#fff" : "#000",
            border: team === awayTeam ? "none" : "2px solid #666",
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          {awayTeam}
        </button>
      </div>

      {/* Event buttons */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {EVENTS.map(([code, label]) => (
          <button
            key={code}
            onClick={() => {
              setPendingEvent(code);
              setSubOut(""); // Clear sub selection when selecting event
              setSubIn("");
            }}
            style={{
              padding: 12,
              borderRadius: 12,
              border: pendingEvent === code ? "3px solid #000" : "2px solid #666",
              backgroundColor: pendingEvent === code ? "#000" : "#fff",
              color: pendingEvent === code ? "#fff" : "#000",
              fontWeight: 900,
              fontSize: 14,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Unified player view: ALL players on one screen */}
      <div style={card}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>
          {pendingEvent ? (
            <>Select player ({team}) — {pendingEvent}</>
          ) : subOut || subIn ? (
            <>SUB ({team}): {subOut ? `OUT: #${(isHomeSelected ? homeRoster : awayRoster).find((p) => p.player_id === subOut)?.jersey || subOut}` : ""} {subIn ? `IN: #${(isHomeSelected ? homeRoster : awayRoster).find((p) => p.player_id === subIn)?.jersey || subIn}` : ""}</>
          ) : (
            <>Select player ({team}) — tap an event for stats, or tap players for sub</>
          )}
        </div>

        {/* ON-COURT PLAYERS (pinned to top, visually distinct) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 14, color: "#0066cc", backgroundColor: "#e7f3ff", padding: "6px 8px", borderRadius: 6 }}>
            ON COURT ({onFloorPlayers.length}/5)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {onFloorPlayers.map((p) => {
              const sec = isHomeSelected ? homePT[p.player_id] : awayPT[p.player_id];
              const isSelectedForSub = subOut === p.player_id;
              
              return (
                <button
                  key={p.player_id}
                  onClick={() => {
                    if (pendingEvent) {
                      // Stat entry mode: log the stat
                      publishStat(p.player_id, pendingEvent, 1);
                      setPendingEvent(null);
                    } else {
                      // Sub mode: select this player to come OUT
                      if (subOut === p.player_id) {
                        setSubOut(""); // Deselect
                      } else {
                        setSubOut(p.player_id);
                        setSubIn(""); // Clear IN selection when changing OUT
                      }
                    }
                  }}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    fontWeight: 900,
                    backgroundColor: isSelectedForSub ? "#fff3cd" : "#e7f3ff",
                    color: "#000",
                    border: isSelectedForSub ? "3px solid #ff8800" : pendingEvent ? "3px solid #0066cc" : "2px solid #0066cc",
                    cursor: "pointer",
                    fontSize: 18,
                    textShadow: "none",
                  }}
                  title={`${p.name || `#${p.jersey}`} • Minutes: ${fmtMinutesFromSec(sec || 0)}`}
                >
                  <span style={{ fontWeight: 950, fontSize: 20 }}>#{p.jersey}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* BENCH PLAYERS (below on-court, always visible) */}
        {benchPlayers.length > 0 && (
          <div>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 14, color: "#666", backgroundColor: "#f8f9fa", padding: "6px 8px", borderRadius: 6 }}>
              BENCH ({benchPlayers.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {benchPlayers.map((p) => {
                const sec = isHomeSelected ? homePT[p.player_id] : awayPT[p.player_id];
                const isSelectedForSub = subIn === p.player_id;
                
                return (
                  <button
                    key={p.player_id}
                    onClick={() => {
                      if (pendingEvent) {
                        // In stat mode, ignore bench clicks (only on-court players can have stats)
                        return;
                      }
                      // Sub mode: select this player to come IN
                      if (subIn === p.player_id) {
                        setSubIn(""); // Deselect
                      } else {
                        setSubIn(p.player_id);
                      }
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      fontWeight: 900,
                      backgroundColor: isSelectedForSub ? "#d4edda" : "#ffffff",
                      color: "#000",
                      border: isSelectedForSub ? "3px solid #28a745" : "2px solid #333",
                      opacity: pendingEvent ? 0.4 : 1,
                      cursor: pendingEvent ? "not-allowed" : "pointer",
                      fontSize: 18,
                      textShadow: "none",
                    }}
                    title={`${p.name || `#${p.jersey}`} • Minutes: ${fmtMinutesFromSec(sec || 0)}`}
                  >
                    <span style={{ fontWeight: 950, fontSize: 20 }}>#{p.jersey}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* SUB button (only shown when both OUT and IN are selected) */}
        {!pendingEvent && subOut && subIn && (
          <button
            onClick={async () => {
              const ok = applySubLocally(team, subOut, subIn);
              if (!ok) {
                setStatus("Illegal sub (lineup state).");
                return;
              }
              await publishSub(team, subOut, subIn);

              // ✅ push playtime after lineup changes
              await publishPlaytime();

              setSubOut("");
              setSubIn("");
              setStatus(`SUB ${team}: ${subOut} → ${subIn} @ ${period} ${fmtClock(clockSec)}`);
            }}
            style={{
              marginTop: 12,
              width: "100%",
              padding: 14,
              borderRadius: 12,
              fontWeight: 950,
              backgroundColor: "#28a745",
              color: "white",
              border: "none",
            }}
          >
            SUB: #{onFloorPlayers.find((p) => p.player_id === subOut)?.jersey || subOut} → #{benchPlayers.find((p) => p.player_id === subIn)?.jersey || subIn}
          </button>
        )}
      </div>

      <button
        onClick={() => {
          if (!lastArchiveTab) {
            setStatus("No archive tab saved yet. Use Previous Games → Generate Sheet.");
            return;
          }
          openPressSheet(apiUrl, lastArchiveTab);
        }}
        style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12, fontWeight: 950 }}
      >
        PRESS SHEET (print / save PDF)
      </button>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          onClick={() => {
            // ✅ Confirm dialog before ending a game (never auto-end)
            if (!confirm("End game and archive? This cannot be undone.")) return;
            endGame(false);
          }}
          style={{ flex: 1, padding: 12, borderRadius: 12, fontWeight: 950 }}
        >
          END GAME (archive)
        </button>
        <button
          onClick={() => {
            // ✅ Confirm dialog before ending + resetting LIVE
            if (!confirm("End game, archive, AND reset LIVE? This will clear the LIVE view for the next game.")) return;
            endGame(true);
            setScreen("setup");
          }}
          style={{ flex: 1, padding: 12, borderRadius: 12, fontWeight: 950 }}
        >
          END + RESET LIVE
        </button>
      </div>

      <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 12, minHeight: 44 }}>
        <div style={{ fontWeight: 800 }}>Status:</div>
        <div style={{ fontSize: 13 }}>{status || "Ready."}</div>
      </div>

      {/* Optional: lightweight play-by-play (last ~120) */}
      <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Play-by-Play (live)</div>
        <div style={{ fontSize: 12, maxHeight: 220, overflow: "auto", textAlign: "left" }}>
          {pbp.length ? (
            pbp
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.seq} style={{ padding: "2px 0", borderBottom: "1px dashed #eee" }}>
                  <span style={{ opacity: 0.75 }}>{r.period} {String(r.clock_display || "").replace(/^'/, "")} </span>
                  <b>{r.team ? `${r.team}: ` : ""}</b>
                  {r.text}
                </div>
              ))
          ) : (
            <div style={{ opacity: 0.7 }}>No events yet.</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={async () => {
            setScreen("previous");
            await loadPreviousGames();
          }}
          style={{ flex: 1, padding: 12, borderRadius: 12 }}
        >
          Previous Games
        </button>
        <button onClick={() => setScreen("setup")} style={{ flex: 1, padding: 12, borderRadius: 12 }}>
          Back to Setup
        </button>
      </div>
    </div>
  );
}