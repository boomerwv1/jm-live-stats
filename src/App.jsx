import React, { useEffect, useMemo, useState } from "react";

const ENDPOINT_DEFAULT = import.meta.env.VITE_GAS_WEBAPP_URL || "";

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

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
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

    console.log("[JSONP] Loading:", full);

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
      try { delete window[cb]; } catch { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    document.body.appendChild(script);
  });
}


function apiUrlFor(apiUrl, params) {
  // Ensure we always start from a clean /exec base URL
  const base = String(apiUrl || "").split("#")[0].split("?")[0];

  const u = new URL(base);
  u.searchParams.set("view", "api");

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });

  return u.toString();
}

// Parse roster lines like:
// 12 Smith
// 3 Jones
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
    const player_id = `${prefix}${jersey}`; // simple stable id
    roster.push({ player_id, jersey, name });
  }
  return roster;
}

/**
 * Opens the Apps Script press sheet HTML view in a new tab.
 * NOTE: apiUrl must be the /exec deployed URL.
 */
function openPressSheet(apiUrl, tabName) {
  const url = `${apiUrl}?view=presssheet&tab=${encodeURIComponent(tabName)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function App() {
  // --- persisted config
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem("apiUrl") || ENDPOINT_DEFAULT);
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [homeTeam, setHomeTeam] = useState(localStorage.getItem("homeTeam") || "James Monroe");
  const [awayTeam, setAwayTeam] = useState(localStorage.getItem("awayTeam") || "Opponent");

  const [homeRosterText, setHomeRosterText] = useState(
    localStorage.getItem("homeRosterText") ||
      "12 Smith\n3 Jones\n1 Lee\n22 Davis\n5 Miller\n10 Martin\n11 Walker"
  );
  const [awayRosterText, setAwayRosterText] = useState(
    localStorage.getItem("awayRosterText") || "1 Brown\n2 Taylor\n3 Wilson\n4 Moore\n5 Clark\n10 Hall"
  );


  useEffect(() => localStorage.setItem("homeTeam", homeTeam), [homeTeam]);
  useEffect(() => localStorage.setItem("awayTeam", awayTeam), [awayTeam]);
  useEffect(() => localStorage.setItem("homeRosterText", homeRosterText), [homeRosterText]);
  useEffect(() => localStorage.setItem("awayRosterText", awayRosterText), [awayRosterText]);

  // --- screens
  const [screen, setScreen] = useState("setup"); // setup | previous | game

  // --- previous games state
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");

  // --- game state
  const [gameId, setGameId] = useState(
    localStorage.getItem("gameId") || `JM_${new Date().toISOString().slice(0, 10)}_001`
  );
  useEffect(() => localStorage.setItem("gameId", gameId), [gameId]);

  const [period, setPeriod] = useState("Q1");
  const [clockSec, setClockSec] = useState(8 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setClockSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const [status, setStatus] = useState("");

  // IMPORTANT: team is now the TEAM NAME (not "HOME"/"AWAY")
  const [team, setTeam] = useState(homeTeam);
  const [pendingEvent, setPendingEvent] = useState(null);

  // remember last archive tab (from list_games)
  const [lastArchiveTab, setLastArchiveTab] = useState(localStorage.getItem("lastArchiveTab") || "");
  useEffect(() => localStorage.setItem("lastArchiveTab", lastArchiveTab), [lastArchiveTab]);

  // Keep selected team sane if user edits team names
  useEffect(() => {
    if (team !== homeTeam && team !== awayTeam) setTeam(homeTeam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeTeam, awayTeam]);

  const homeRoster = useMemo(() => parseRoster(homeRosterText, "H"), [homeRosterText]);
  const awayRoster = useMemo(() => parseRoster(awayRosterText, "A"), [awayRosterText]);

  const [homeOn, setHomeOn] = useState([]);
  const [awayOn, setAwayOn] = useState([]);

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

  function initStarting5() {
    setHomeOn(homeRoster.slice(0, 5).map((p) => p.player_id));
    setAwayOn(awayRoster.slice(0, 5).map((p) => p.player_id));
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
      // ✅ normalize /exec URL
      const base = String(apiUrl || "").split("#")[0].split("?")[0];
  
      // ✅ build API url WITHOUT callback (jsonp() will add it)
      const url = apiUrlFor(base, {
        action: "list_games",
        access_token: token,
      });
  
      console.log("LIST_GAMES URL (pre-jsonp):", url);
  
      const data = await jsonp(url);
  
      if (!data) throw new Error("No response (JSONP).");
      if (!data.ok) {
        // nice message for auth failures
        const msg = String(data.error || "list_games failed");
        throw new Error(msg.toLowerCase().includes("unauthorized") ? "Unauthorized (check token in Config tab)" : msg);
      }
  
      setGames(Array.isArray(data.games) ? data.games : []);
  
      // ✅ persist ONLY after a successful list
      localStorage.setItem("apiUrl", base);
      localStorage.setItem("token", token);
    } catch (err) {
      setGamesError(String(err?.message || err));
    } finally {
      setGamesLoading(false);
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

      initStarting5();
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

    initStarting5();
    setPeriod("Q1");
    setClockSec(8 * 60);
    setRunning(false);
    setTeam(homeTeam);

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
    
      // ✅ Persist ONLY after a successful init_game
      localStorage.setItem("apiUrl", apiUrl);
      localStorage.setItem("token", token);
    
      setStatus("Game initialized in sheet. Switching to game screen...");
      setScreen("game");
      setTimeout(() => setStatus("Ready."), 1000);
    } catch {
      setStatus("Init failed. Check endpoint/token.");
    }
  } // ✅ CLOSE startGame()
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

  const card = { padding: 10, border: "1px solid #ddd", borderRadius: 12, marginTop: 12 };

  // SETUP
  if (screen === "setup") {
    return (
      <div style={{ fontFamily: "system-ui", padding: 12, maxWidth: 680, margin: "0 auto" }}>
        <h2 style={{ margin: "8px 0" }}>JM Live Stats — Setup</h2>

        <div style={card}>
          <label>
            Apps Script URL
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} style={{ width: "100%", padding: 8 }} />
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
          <textarea value={homeRosterText} onChange={(e) => setHomeRosterText(e.target.value)} rows={7} style={{ width: "100%", padding: 8 }} />
        </div>

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Team 2 Roster (one per line: “# Name”)</div>
          <textarea value={awayRosterText} onChange={(e) => setAwayRosterText(e.target.value)} rows={7} style={{ width: "100%", padding: 8 }} />
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
            {onFloorPlayers.map((p) => (
              <button
                key={p.player_id}
                disabled={!pendingEvent}
                onClick={() => {
                  publishStat(p.player_id, pendingEvent, 1);
                  setPendingEvent(null);
                }}
                style={{ padding: 12, borderRadius: 12, fontWeight: 900, opacity: pendingEvent ? 1 : 0.5 }}
              >
                #{p.jersey}
              </button>
            ))}
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
