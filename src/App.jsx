import React, { useEffect, useMemo, useRef, useState } from "react";

// ✅ HARDCODED GAS WEB APP URL (works on all devices)
const ENDPOINT_DEFAULT =
  "https://script.google.com/macros/s/AKfycbylXaA_x1Uw5NNYYJV106qkraj-dq9gBZs8s_Ly1nP80Vtb6wuVSsWcWW8JujL3vyNYAA/exec";

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
const JM_BOYS_ROSTER_PRESET = `3 Hines
10 Taylor
12 Miller
13 Surface
33 Mann
20 Comer
21 Gardinier
22 Adkins
23 Mann
24 Parker
25 Taylor
30 Crislip`;

const JM_GIRLS_ROSTER_PRESET = `0 Dunlap
13 Dunlap
5 Long
10 Griffith
11 Moore
2 Street
4 Hill
12 Jackson
30 Smith`;

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
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const jersey = m[1];
    const name = m[2].trim();
    const player_id = `${prefix}${jersey}`;
    roster.push({ player_id, jersey, name });
  }
  return roster;
}

function openPressSheet(apiUrl, tabName) {
  const base = String(apiUrl || "").split("#")[0].split("?")[0];
  const url = `${base}?view=presssheet&tab=${encodeURIComponent(tabName)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function App() {
  // --- persisted config
  // ✅ use hardcoded URL (do NOT allow localStorage to override)
  const [apiUrl, setApiUrl] = useState(() => ENDPOINT_DEFAULT);

  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [homeTeam, setHomeTeam] = useState(() => localStorage.getItem("homeTeam") || "James Monroe");
  const [awayTeam, setAwayTeam] = useState(() => localStorage.getItem("awayTeam") || "Opponent");

  const [homeRosterText, setHomeRosterText] = useState(
    () => localStorage.getItem("homeRosterText") || JM_BOYS_ROSTER_PRESET
  );
  const [awayRosterText, setAwayRosterText] = useState(() => localStorage.getItem("awayRosterText") || "");

  // ✅ do NOT persist apiUrl anymore (prevents device drift / bad cached URL)
  // useEffect(() => localStorage.setItem("apiUrl", apiUrl), [apiUrl]);

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

  const [status, setStatus] = useState("");

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

  // SUB mode
  const [subMode, setSubMode] = useState(false);
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
      setGamesError("Set API URL + token first.");
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

      // ✅ we still persist token; URL is hardcoded
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

  // ✅ JSONP get_game_state
  async function resumeGame(gameIdToResume, archiveTabFromRow = "") {
    if (!apiUrl || !token) {
      setStatus("Set API URL + token.");
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
      setPeriod(g.period || "Q1");
      setClockSec(Number.isFinite(g.clock_sec) ? g.clock_sec : 8 * 60);

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
      setSubMode(false);
      setTeam(g.home_team || homeTeam);

      const tab = (archiveTabFromRow || g.archive_tab || "").trim();
      if (tab) setLastArchiveTab(tab);

      setStatus(`Resumed ${g.game_id} @ ${g.period} ${fmtClock(g.clock_sec)}`);
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
      setStatus("Set API URL + token.");
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

    // init starter selection defaults + playtime
    initDefaultStarting5();
    initPlaytimeZeros();

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

      // ✅ URL is hardcoded; we only persist token
      localStorage.setItem("token", token);

      setStatus("Game initialized. Select starters…");
      setScreen("starters");
    } catch {
      setStatus("Init failed. Check endpoint/token.");
    }
  }

  async function publishStat(playerId, eventType, delta = 1) {
    if (!apiUrl || !token) {
      setStatus("Set API URL + token.");
      return;
    }
    const payload = {
      access_token: token,
      action: "stat",
      event_id: uuid(),
      ts_iso: new Date().toISOString(),
      game_id: gameId,
      period,
      clock_sec: clockSec,
      team,
      player_id: playerId,
      event_type: eventType,
      delta,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus(`Logged ${eventType} — ${team} ${playerId} @ ${period} ${fmtClock(clockSec)}`);
    } catch {
      setStatus("Publish failed (network?).");
    }
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

  async function publishSub(teamName, outId, inId) {
    if (!apiUrl || !token) {
      setStatus("Set API URL + token.");
      return;
    }
    const payload = {
      access_token: token,
      action: "sub",
      event_id: uuid(),
      ts_iso: new Date().toISOString(),
      game_id: gameId,
      period,
      clock_sec: clockSec,
      team: teamName,
      player_out: outId,
      player_in: inId,
    };
    try {
      await postNoCors(apiUrl, payload);
      setStatus(`SUB ${teamName}: ${outId} → ${inId} @ ${period} ${fmtClock(clockSec)}`);
    } catch {
      setStatus("Sub publish failed.");
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

  async function endGame(resetLive = false) {
    if (!apiUrl || !token) {
      setStatus("Set API URL + token.");
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
          {/* ✅ show the hardcoded URL (read-only) */}
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
              <input value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} style={{ width: "100%", padding: 8 }} />
            </label>
            <label>
              Team 2 (Opponent)
              <input value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} style={{ width: "100%", padding: 8 }} />
            </label>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Team 1 Roster (one per line: “# Name”)</div>

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

          <textarea value={homeRosterText} onChange={(e) => setHomeRosterText(e.target.value)} rows={8} style={{ width: "100%", padding: 8 }} />
        </div>

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Team 2 Roster (one per line: “# Name”)</div>
          <textarea value={awayRosterText} onChange={(e) => setAwayRosterText(e.target.value)} rows={8} style={{ width: "100%", padding: 8 }} />
        </div>

        <button onClick={startGame} style={{ width: "100%", marginTop: 12, padding: 14, fontWeight: 900, borderRadius: 12 }}>
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

        <button onClick={() => setScreen("setup")} style={{ width: "100%", marginTop: 10, padding: 14, borderRadius: 12 }}>
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
            <div key={`${idx}-${g.game_id}-${g.archive_tab || ""}-${g.archived_at_iso || ""}`} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {g.date_iso ? `${String(g.date_iso).slice(0, 10)} — ` : ""}
                  {g.home_team} vs {g.away_team}
                </div>
                <div style={{ opacity: 0.8 }}>
                  {g.period ? g.period : ""}
                  {Number.isFinite(g.clock_sec) ? ` • ${fmtClock(g.clock_sec)}` : ""}
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button onClick={() => resumeGame(g.game_id, g.archive_tab)} style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}>
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
    <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ margin: "8px 0" }}>JM Live Stats</h2>

      <div style={card}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ padding: 8 }}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 32, fontWeight: 800 }}>{fmtClock(clockSec)}</div>

          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setRunning((r) => !r)} style={{ padding: "10px 12px", fontWeight: 900 }}>
              {running ? "STOP" : "START"}
            </button>
            <button onClick={() => setClockSec((s) => Math.max(0, s + 1))} style={{ padding: "10px 12px" }}>
              +1
            </button>
            <button onClick={() => setClockSec((s) => Math.max(0, s - 1))} style={{ padding: "10px 12px" }}>
              -1
            </button>
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
        <button onClick={() => setTeam(homeTeam)} style={{ flex: 1, padding: 10, fontWeight: team === homeTeam ? 900 : 700 }}>
          {homeTeam}
        </button>
        <button onClick={() => setTeam(awayTeam)} style={{ flex: 1, padding: 10, fontWeight: team === awayTeam ? 900 : 700 }}>
          {awayTeam}
        </button>
        <button
          onClick={() => {
            setSubMode((s) => !s);
            setPendingEvent(null);
          }}
          style={{ flex: 1, padding: 10, fontWeight: subMode ? 900 : 700 }}
        >
          {subMode ? "STATS" : "SUB"}
        </button>
      </div>

      {!subMode && (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {EVENTS.map(([code, label]) => (
            <button
              key={code}
              onClick={() => setPendingEvent(code)}
              style={{
                padding: 12,
                borderRadius: 12,
                border: pendingEvent === code ? "2px solid #000" : "1px solid #ddd",
                fontWeight: 900,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!subMode && (
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Select player ({team}) {pendingEvent ? `— ${pendingEvent}` : "(tap an event)"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {onFloorPlayers.map((p) => {
              const sec = isHomeSelected ? homePT[p.player_id] : awayPT[p.player_id];
              return (
                <button
                  key={p.player_id}
                  disabled={!pendingEvent}
                  onClick={() => {
                    publishStat(p.player_id, pendingEvent, 1);
                    setPendingEvent(null);
                  }}
                  style={{ padding: 12, borderRadius: 12, fontWeight: 900, opacity: pendingEvent ? 1 : 0.5 }}
                  title={`Minutes: ${fmtMinutesFromSec(sec || 0)}`}
                >
                  #{p.jersey}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {subMode && (
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>SUB ({team})</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>OUT (on floor)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {(isHomeSelected ? homeOnPlayers : awayOnPlayers).map((p) => (
                  <button
                    key={p.player_id}
                    onClick={() => setSubOut(p.player_id)}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      fontWeight: 900,
                      border: subOut === p.player_id ? "2px solid #000" : "1px solid #ddd",
                    }}
                  >
                    #{p.jersey}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>IN (bench)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {benchPlayers.map((p) => (
                  <button
                    key={p.player_id}
                    onClick={() => setSubIn(p.player_id)}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      fontWeight: 900,
                      border: subIn === p.player_id ? "2px solid #000" : "1px solid #ddd",
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
              if (!subOut || !subIn) {
                setStatus("Pick OUT and IN.");
                return;
              }
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
            }}
            style={{ marginTop: 10, width: "100%", padding: 12, borderRadius: 12, fontWeight: 950 }}
          >
            SAVE SUB
          </button>
        </div>
      )}

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
        <button onClick={() => endGame(false)} style={{ flex: 1, padding: 12, borderRadius: 12, fontWeight: 950 }}>
          END GAME (archive)
        </button>
        <button
          onClick={() => {
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

