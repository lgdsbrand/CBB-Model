/* ============================================================
   CONFIG – YOUR REAL CSV URLS
   ============================================================ */

// PPG / OPPG / Possessions
const TR_PPG_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1113850959&single=true&output=csv";
const TR_OPPG_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1318289545&single=true&output=csv";
const TR_POSS_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1494766046&single=true&output=csv";

// Advanced TR stats
const TR_OFF_EFF_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv";
const TR_DEF_EFF_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv";
const TR_OFF_REB_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv";
const TR_DEF_REB_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv";
const TR_TOV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv";
const TR_EFG_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv";

/*
  Team mapping CSV (TR names + ESPN names):
  Expected header (case-insensitive):
    TeamRanking, ESPN, Display   (Display optional but preferred)
*/
const TEAM_MAP_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1061863749&single=true&output=csv";

/*
  Daily games CSV from Apps Script:
  Expected header (case-insensitive):
    Date, Time, Away, Home, BookSpreadHome, BookTotal, BookName, EspnId
*/
const CBB_GAMES_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1912820604&single=true&output=csv";

/* ============================================================
   MODEL PARAMETERS
   ============================================================ */

const HOME_EDGE_POINTS = 3.0; // home-court bump
const TOTAL_EDGE_TH = 2.0; // pts vs book total to trigger play
const SPREAD_EDGE_TH = 2.0; // pts vs book spread to trigger play

// feature weights
const W_EFG = 0.4;
const W_TOV = 0.25;
const W_REB = 0.2;

/* ============================================================
   GLOBAL STATE
   ============================================================ */

// keyed by TR team name
let teamStatsByTR = {};

// name maps
let trToDisplay = {}; // TR -> pretty display
let displayToTR = {}; // display -> TR
let espnNormToTR = {}; // normalized ESPN name -> TR

let TEAM_DISPLAY_NAMES = []; // for datalist

let savedGames = [];

/* ============================================================
   UTILS
   ============================================================ */

function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

function normalizeName(raw) {
  if (!raw) return "";
  return raw
    .toString()
    .trim()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// very basic CSV parser
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.map((line) => line.split(","));
}

async function fetchCsv(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const txt = await resp.text();
  return parseCsv(txt);
}

function getHeaderIndexes(headerRow, wanted) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = h.toString().trim().toLowerCase();
    if (wanted.includes(key)) idx[key] = i;
  });
  return idx;
}

/* ============================================================
   TEAM MAP LOADER
   ============================================================ */

async function loadTeamMap() {
  const rows = await fetchCsv(TEAM_MAP_URL);
  if (!rows.length) return;

  const header = rows[0].map((h) => h.toString().trim().toLowerCase());
  const trIdx = header.indexOf("teamranking");
  const espnIdx = header.indexOf("espn");
  const dispIdx = header.indexOf("display");

  if (trIdx === -1) {
    throw new Error("TEAM_MAP missing 'TeamRanking' column");
  }

  trToDisplay = {};
  displayToTR = {};
  espnNormToTR = {};

  rows.slice(1).forEach((row) => {
    const trName = (row[trIdx] || "").trim();
    if (!trName) return;
    const espnName = espnIdx >= 0 ? (row[espnIdx] || "").trim() : "";
    const display = dispIdx >= 0 ? (row[dispIdx] || "").trim() : trName;

    trToDisplay[trName] = display;
    displayToTR[display] = trName;

    if (espnName) {
      espnNormToTR[normalizeName(espnName)] = trName;
    }
  });
}

/* ============================================================
   TEAMRANKINGS STATS LOADER
   ============================================================ */

// B = team (index 1), C = 2025 (index 2), H = 2024 (index 7)
function buildIndexByTeam(rows) {
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const team = (row[1] || "").trim();
    if (!team) return;
    map.set(team, row);
  });
  return map;
}

function avgValFromRow(row) {
  if (!row) return null;
  const v2025 = parseFloat(row[2]);
  const v2024 = parseFloat(row[7]);
  const has25 = Number.isFinite(v2025);
  const has24 = Number.isFinite(v2024);
  if (has25 && has24) return (v2025 + v2024) / 2;
  if (has25) return v2025;
  if (has24) return v2024;
  return null;
}

async function loadTeamRankings() {
  const [
    ppgRows,
    oppgRows,
    possRows,
    offEffRows,
    defEffRows,
    offRebRows,
    defRebRows,
    tovRows,
    efgRows,
  ] = await Promise.all([
    fetchCsv(TR_PPG_URL),
    fetchCsv(TR_OPPG_URL),
    fetchCsv(TR_POSS_URL),
    fetchCsv(TR_OFF_EFF_URL),
    fetchCsv(TR_DEF_EFF_URL),
    fetchCsv(TR_OFF_REB_URL),
    fetchCsv(TR_DEF_REB_URL),
    fetchCsv(TR_TOV_URL),
    fetchCsv(TR_EFG_URL),
  ]);

  const idxPPG = buildIndexByTeam(ppgRows);
  const idxOPPG = buildIndexByTeam(oppgRows);
  const idxPOSS = buildIndexByTeam(possRows);
  const idxOffEff = buildIndexByTeam(offEffRows);
  const idxDefEff = buildIndexByTeam(defEffRows);
  const idxOffReb = buildIndexByTeam(offRebRows);
  const idxDefReb = buildIndexByTeam(defRebRows);
  const idxTov = buildIndexByTeam(tovRows);
  const idxEfg = buildIndexByTeam(efgRows);

  const stats = {};

  // Use PPG table as base list of teams
  ppgRows.slice(1).forEach((row) => {
    const trName = (row[1] || "").trim();
    if (!trName) return;

    const ppg = avgValFromRow(idxPPG.get(trName));
    const oppg = avgValFromRow(idxOPPG.get(trName));
    const poss = avgValFromRow(idxPOSS.get(trName));

    const offEffTR = avgValFromRow(idxOffEff.get(trName));
    const defEffTR = avgValFromRow(idxDefEff.get(trName));

    const offReb = avgValFromRow(idxOffReb.get(trName));
    const defReb = avgValFromRow(idxDefReb.get(trName));
    const tov = avgValFromRow(idxTov.get(trName));
    const offEfg = avgValFromRow(idxEfg.get(trName));

    // derive efficiencies from PPG & possessions (per 100 poss)
    let offEffPPG = null;
    let defEffPPG = null;
    if (Number.isFinite(ppg) && Number.isFinite(poss) && poss > 0) {
      offEffPPG = (ppg / poss) * 100;
    }
    if (Number.isFinite(oppg) && Number.isFinite(poss) && poss > 0) {
      defEffPPG = (oppg / poss) * 100;
    }

    // combine TR eff + PPG-based eff if both exist
    function blend(a, b) {
      if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
      if (Number.isFinite(a)) return a;
      return b;
    }

    const offEff = blend(offEffTR, offEffPPG);
    const defEff = blend(defEffTR, defEffPPG);

    stats[trName] = {
      trName,
      ppg,
      oppg,
      poss,
      offEff,
      defEff,
      offReb,
      defReb,
      tov,
      offEfg,
      // pace = possessions (if your TR poss is per game), clamp
      pace: Number.isFinite(poss) ? Math.max(60, Math.min(75, poss)) : 70,
    };
  });

  teamStatsByTR = stats;
}

/* ============================================================
   TEAM LIST / MANUAL NAME RESOLUTION
   ============================================================ */

function populateTeamDatalist() {
  TEAM_DISPLAY_NAMES = Object.keys(teamStatsByTR)
    .map((trName) => trToDisplay[trName] || trName)
    .sort();

  const dl = document.getElementById("teamList");
  if (!dl) return;
  dl.innerHTML = TEAM_DISPLAY_NAMES.map(
    (name) => `<option value="${name}"></option>`
  ).join("");
}

// Take whatever user typed and resolve to TR name
function resolveManualInputToTR(input) {
  if (!input) return null;
  if (displayToTR[input]) return displayToTR[input];
  if (teamStatsByTR[input]) return input;

  const norm = normalizeName(input);

  for (const [display, trName] of Object.entries(displayToTR)) {
    if (normalizeName(display) === norm) return trName;
  }
  for (const trName of Object.keys(teamStatsByTR)) {
    if (normalizeName(trName) === norm) return trName;
  }
  return null;
}

/* ============================================================
   CORE MODEL
   ============================================================ */

function projectGame(awayStats, homeStats, bookSpread, bookTotal) {
  // base efficiencies (per 100 poss)
  const awayOffBase =
    (awayStats.offEff ?? 100) + (100 - (homeStats.defEff ?? 100));
  const homeOffBase =
    (homeStats.offEff ?? 100) + (100 - (awayStats.defEff ?? 100));

  function adjustOff(base, s) {
    let adj = base;
    if (Number.isFinite(s.offEfg)) adj += W_EFG * (s.offEfg - 50);
    if (Number.isFinite(s.offReb)) adj += W_REB * (s.offReb - 30);
    if (Number.isFinite(s.tov)) adj -= W_TOV * (s.tov - 15);
    return adj;
  }

  const awayOff = adjustOff(awayOffBase, awayStats);
  const homeOff = adjustOff(homeOffBase, homeStats);

  const paceRaw =
    (awayStats.pace ?? 70) / 2 + (homeStats.pace ?? 70) / 2;
  const pace = Math.max(60, Math.min(75, paceRaw));

  const awayScore = (awayOff / 200) * pace; // divide by 200 because we summed two terms
  const homeScore = (homeOff / 200) * pace + HOME_EDGE_POINTS;

  const total = awayScore + homeScore;
  const spreadHome = homeScore - awayScore;

  const winProbHome = 1 / (1 + Math.exp(-spreadHome / 6));

  // plays vs book
  let spreadPlay = "NO BET";
  if (Number.isFinite(bookSpread)) {
    const diff = spreadHome - bookSpread;
    if (Math.abs(diff) >= SPREAD_EDGE_TH) {
      spreadPlay =
        diff > 0
          ? `Home ${bookSpread.toFixed(1)} (model -${spreadHome.toFixed(1)})`
          : `Away +${Math.abs(bookSpread).toFixed(1)}`;
    }
  }

  let totalPlay = "NO BET";
  if (Number.isFinite(bookTotal)) {
    const diffT = total - bookTotal;
    if (Math.abs(diffT) >= TOTAL_EDGE_TH) {
      totalPlay = diffT > 0 ? "Over" : "Under";
    }
  }

  const edgeSpread = Number.isFinite(bookSpread)
    ? Math.abs(spreadHome - bookSpread)
    : 0;
  const edgeTotal = Number.isFinite(bookTotal)
    ? Math.abs(total - bookTotal)
    : 0;
  const edge = Math.max(edgeSpread, edgeTotal);
  const confidence = Math.max(0, Math.min(10, edge * 1.5));

  return {
    awayScore,
    homeScore,
    total,
    spreadHome,
    winProbHome,
    spreadPlay,
    totalPlay,
    confidence,
  };
}

/* ============================================================
   MANUAL MODEL UI
   ============================================================ */

function renderManualResult(
  trAway,
  trHome,
  proj,
  bookSpread,
  bookTotal
) {
  const resEl = document.getElementById("results");
  const body = document.getElementById("resultBody");
  resEl.classList.remove("hidden");

  const awayDisp = trToDisplay[trAway] || trAway;
  const homeDisp = trToDisplay[trHome] || trHome;

  const homeWinProb = (proj.winProbHome * 100).toFixed(1);
  const awayWinProb = (100 - homeWinProb).toFixed(1);

  body.innerHTML = `
    <p><strong>Model Score:</strong> ${awayDisp} ${proj.awayScore.toFixed(
    1
  )} – ${homeDisp} ${proj.homeScore.toFixed(1)}</p>
    <p><strong>Book Line / Total:</strong>
      ${Number.isFinite(bookSpread) ? bookSpread : "N/A"} /
      ${Number.isFinite(bookTotal) ? bookTotal : "N/A"}
    </p>
    <p><strong>Model Line / Total:</strong>
      ${proj.spreadHome.toFixed(1)} /
      ${proj.total.toFixed(1)}
    </p>
    <p><strong>Spread Play:</strong> ${proj.spreadPlay}</p>
    <p><strong>Total Play:</strong> ${proj.totalPlay}</p>
    <p><strong>Win Probability:</strong>
      ${homeDisp}: ${homeWinProb}%,
      ${awayDisp}: ${awayWinProb}%
    </p>
    <p><strong>Confidence:</strong> ${proj.confidence.toFixed(1)} / 10</p>
  `;
}

function handleRunManual() {
  const awayInput = document.getElementById("awayTeamInput").value.trim();
  const homeInput = document.getElementById("homeTeamInput").value.trim();
  const bookSpread = parseFloat(
    document.getElementById("bookSpread").value
  );
  const bookTotal = parseFloat(document.getElementById("bookTotal").value);

  const trAway = resolveManualInputToTR(awayInput);
  const trHome = resolveManualInputToTR(homeInput);

  if (!trAway || !trHome) {
    setStatus(
      "One or both team names not recognized. Use the dropdown suggestions.",
      true
    );
    return;
  }

  const awayStats = teamStatsByTR[trAway];
  const homeStats = teamStatsByTR[trHome];

  if (!awayStats || !homeStats) {
    setStatus("Stats missing for one of the teams.", true);
    return;
  }

  const proj = projectGame(awayStats, homeStats, bookSpread, bookTotal);
  renderManualResult(trAway, trHome, proj, bookSpread, bookTotal);

  document.getElementById("saveBtn").disabled = false;

  window.latestResult = {
    trAway,
    trHome,
    awayDisp: trToDisplay[trAway] || trAway,
    homeDisp: trToDisplay[trHome] || trHome,
    bookSpread: Number.isFinite(bookSpread) ? bookSpread : "",
    bookTotal: Number.isFinite(bookTotal) ? bookTotal : "",
    ...proj,
  };

  setStatus("Manual projection ready.");
}

/* ---------- Saved games ---------- */

function loadSavedFromStorage() {
  try {
    const raw = localStorage.getItem("cbb_saved") || "[]";
    savedGames = JSON.parse(raw);
  } catch {
    savedGames = [];
  }
}

function persistSaved() {
  localStorage.setItem("cbb_saved", JSON.stringify(savedGames));
}

function renderSavedTable() {
  const wrap = document.getElementById("savedTableWrap");
  if (!savedGames.length) {
    wrap.innerHTML = '<p class="muted">No games saved yet.</p>';
    return;
  }

  let html =
    "<table><thead><tr>" +
    "<th>Away</th><th>Home</th><th>Model Score</th>" +
    "<th>Book Spread</th><th>Model Spread</th>" +
    "<th>Book Total</th><th>Model Total</th>" +
    "<th>Spread Play</th><th>Total Play</th><th>Conf</th>" +
    "</tr></thead><tbody>";

  savedGames.forEach((g) => {
    html += `<tr>
      <td>${g.awayDisp}</td>
      <td>${g.homeDisp}</td>
      <td>${g.awayScore.toFixed(1)} - ${g.homeScore.toFixed(1)}</td>
      <td>${g.bookSpread}</td>
      <td>${g.spreadHome.toFixed(1)}</td>
      <td>${g.bookTotal}</td>
      <td>${g.total.toFixed(1)}</td>
      <td>${g.spreadPlay}</td>
      <td>${g.totalPlay}</td>
      <td>${g.confidence.toFixed(1)}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  wrap.innerHTML = html;
}

function handleSaveGame() {
  const r = window.latestResult;
  if (!r) return;
  savedGames.push(r);
  persistSaved();
  renderSavedTable();
}

function handleUndoLast() {
  if (!savedGames.length) return;
  savedGames.pop();
  persistSaved();
  renderSavedTable();
}

function handleClearAll() {
  if (!savedGames.length) return;
  savedGames = [];
  persistSaved();
  renderSavedTable();
}

function handleDownloadCsv() {
  if (!savedGames.length) return;

  const header = [
    "Away",
    "Home",
    "AwayScore",
    "HomeScore",
    "BookSpread",
    "ModelSpread",
    "BookTotal",
    "ModelTotal",
    "SpreadPlay",
    "TotalPlay",
    "Confidence",
  ];

  const rows = savedGames.map((g) => [
    g.awayDisp,
    g.homeDisp,
    g.awayScore.toFixed(1),
    g.homeScore.toFixed(1),
    g.bookSpread,
    g.spreadHome.toFixed(1),
    g.bookTotal,
    g.total.toFixed(1),
    g.spreadPlay,
    g.totalPlay,
    g.confidence.toFixed(1),
  ]);

  const csv =
    [header.join(","), ...rows.map((r) => r.join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cbb_saved_games.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   ESPN / CBB_GAMES VIEW
   ============================================================ */

async function loadCbbGamesFromSheet() {
  const rows = await fetchCsv(CBB_GAMES_URL);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.toString().trim().toLowerCase());
  const idxDate = header.indexOf("date");
  const idxTime = header.indexOf("time");
  const idxAway = header.indexOf("away");
  const idxHome = header.indexOf("home");
  const idxSpread = header.indexOf("bookspreadhome");
  const idxTotal = header.indexOf("booktotal");
  const idxBook = header.indexOf("bookname");

  const games = [];

  rows.slice(1).forEach((row) => {
    const awayEspn = row[idxAway] || "";
    const homeEspn = row[idxHome] || "";
    if (!awayEspn || !homeEspn) return;
    games.push({
      date: row[idxDate] || "",
      time: row[idxTime] || "",
      awayEspn,
      homeEspn,
      bookSpread: parseFloat(row[idxSpread]),
      bookTotal: parseFloat(row[idxTotal]),
      bookName: row[idxBook] || "",
    });
  });

  return games;
}

function mapEspnToTR(name) {
  const key = normalizeName(name);
  return espnNormToTR[key] || null;
}

function renderDailyCards(games) {
  const wrap = document.getElementById("dailyCards");
  wrap.innerHTML = "";

  if (!games.length) {
    wrap.innerHTML = '<p class="muted">No games found for today.</p>';
    return;
  }

  games.forEach((g) => {
    const card = document.createElement("div");
    card.className = "game-card";

    if (g.error) {
      card.innerHTML = `
        <div class="game-time">${g.time || ""}</div>
        <div class="game-matchup">${g.awayEspn} @ ${g.homeEspn}</div>
        <p class="error">${g.error}</p>
      `;
      wrap.appendChild(card);
      return;
    }

    const confScore = g.confidence || 0;
    const confPct = Math.max(0, Math.min(10, confScore)) * 10;

    const spreadClass =
      g.spreadPlay && !g.spreadPlay.toUpperCase().includes("NO BET")
        ? "play-green"
        : "";
    const totalClass =
      g.totalPlay && !g.totalPlay.toUpperCase().includes("NO BET")
        ? "play-green"
        : "";

    card.innerHTML = `
      <div class="game-time">${g.time || ""}</div>
      <div class="game-matchup">${g.awayDisp} @ ${g.homeDisp}</div>

      <div class="game-model-score">
        Model Score: ${g.awayDisp} ${g.awayScore.toFixed(
      1
    )} – ${g.homeDisp} ${g.homeScore.toFixed(1)}
      </div>

      <div class="game-line">
        Book Line / Total:
        ${Number.isFinite(g.bookSpread) ? g.bookSpread : "N/A"} /
        ${Number.isFinite(g.bookTotal) ? g.bookTotal : "N/A"}
      </div>

      <div class="game-line">
        Model Line / Total:
        ${g.spreadHome.toFixed(1)} /
        ${g.total.toFixed(1)}
      </div>

      <div class="game-play-row">
        Spread Play:
        <span class="${spreadClass}">${g.spreadPlay}</span>
      </div>
      <div class="game-play-row">
        Total Play:
        <span class="${totalClass}">${g.totalPlay}</span>
      </div>

      <div class="confidence-row">
        <span>Confidence: ${confScore.toFixed(1)} / 10</span>
        <div class="confidence-bar">
          <div class="conf-fill" style="width:${confPct}%;"></div>
        </div>
      </div>
    `;

    wrap.appendChild(card);
  });

  setStatus(`Loaded ${games.length} games.`);
}

async function handleReloadEspn() {
  try {
    setStatus("Loading CBB_Games sheet…");
    const rawGames = await loadCbbGamesFromSheet();

    const modeled = rawGames.map((g) => {
      const trAway = mapEspnToTR(g.awayEspn);
      const trHome = mapEspnToTR(g.homeEspn);

      if (!trAway || !trHome) {
        return {
          ...g,
          error: `Model error: no stats found for "${!trAway
            ? g.awayEspn
            : g.homeEspn}"`,
        };
      }

      const awayStats = teamStatsByTR[trAway];
      const homeStats = teamStatsByTR[trHome];

      if (!awayStats || !homeStats) {
        return {
          ...g,
          error: `Model error: missing stats for "${!awayStats
            ? trAway
            : trHome}"`,
        };
      }

      const proj = projectGame(
        awayStats,
        homeStats,
        g.bookSpread,
        g.bookTotal
      );

      return {
        ...g,
        trAway,
        trHome,
        awayDisp: trToDisplay[trAway] || trAway,
        homeDisp: trToDisplay[trHome] || trHome,
        ...proj,
      };
    });

    renderDailyCards(modeled);
  } catch (err) {
    console.error(err);
    setStatus(`Data load error: ${err.message}`, true);
    alert(`Data load error:\n${err.message}`);
  }
}

/* ============================================================
   INIT + EVENT HOOKUP
   ============================================================ */

async function init() {
  try {
    setStatus("Loading team map…");
    await loadTeamMap();

    setStatus("Loading TeamRankings stats…");
    await loadTeamRankings();

    populateTeamDatalist();

    loadSavedFromStorage();
    renderSavedTable();

    document.getElementById("runBtn").disabled = false;

    setStatus("Ready.");
  } catch (err) {
    console.error(err);
    setStatus(`Init error: ${err.message}`, true);
    alert(`Init error:\n${err.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const manualSection = document.getElementById("manualSection");
  const espnSection = document.getElementById("espnSection");
  const btnManual = document.getElementById("btnManual");
  const btnEspn = document.getElementById("btnEspn");

  btnManual.addEventListener("click", () => {
    btnManual.classList.add("active");
    btnEspn.classList.remove("active");
    manualSection.classList.remove("hidden");
    espnSection.classList.add("hidden");
  });

  btnEspn.addEventListener("click", () => {
    btnEspn.classList.add("active");
    btnManual.classList.remove("active");
    espnSection.classList.remove("hidden");
    manualSection.classList.add("hidden");
  });

  document.getElementById("runBtn").addEventListener("click", handleRunManual);
  document.getElementById("saveBtn").addEventListener("click", handleSaveGame);
  document.getElementById("undoBtn").addEventListener("click", handleUndoLast);
  document.getElementById("clearBtn").addEventListener("click", handleClearAll);
  document
    .getElementById("downloadBtn")
    .addEventListener("click", handleDownloadCsv);

  document
    .getElementById("reloadEspnBtn")
    .addEventListener("click", handleReloadEspn);

  init();
});
