// ===============================
// CONFIG: DATA SOURCES
// ===============================
const TR_PPG_URL   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1113850959&single=true&output=csv";
const TR_OPPG_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1318289545&single=true&output=csv";
const TR_POSS_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1494766046&single=true&output=csv";

const TR_OFF_EFF_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv";
const TR_DEF_EFF_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv";
const TR_OFF_REB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv";
const TR_DEF_REB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv";
const TR_TOV_URL     = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv";
const TR_EFG_URL     = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv";

const TEAM_MAP_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1061863749&single=true&output=csv";

const CBB_GAMES_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1912820604&single=true&output=csv";

// ===============================
// CONFIG: MODEL PARAMETERS
// ===============================

// 50/50 blend now; you can change later mid-season (e.g. effWeight = 0.7, ppgWeight = 0.3)
const EFF_WEIGHT = 0.5;
const PPG_WEIGHT = 0.5;

// Home court advantage in points (you can tune if needed)
const HOME_EDGE_POINTS = 3.0;

// For confidence bar
const MAX_EDGE_FOR_CONF = 12;   // 10/10 at ~12 points of model edge

// ===============================
// GLOBAL STATE
// ===============================
let teamsByTR = {};       // key: TeamRanking name
let teamsByDisplay = {};  // key: display name (what user types/sees)
let espmToTR = {};        // ESPN name -> TR name
let leaguePPP = 1.05;
let games = [];           // daily games objects

// ===============================
// CSV HELPERS
// ===============================
async function fetchCsv(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${url}`);
  return await resp.text();
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  return rows.map(r => r.split(","));
}

// Safely parse number, stripping +, % etc.
function toNum(v) {
  if (v === undefined || v === null) return NaN;
  const cleaned = String(v).replace(/[+%]/g, "").trim();
  const x = parseFloat(cleaned);
  return Number.isFinite(x) ? x : NaN;
}

// ===============================
// LOAD TEAMRANKINGS STATS
// ===============================
async function loadTRSheet(url, valueColIndex = 2) {
  const csv = await fetchCsv(url);
  const rows = parseCsv(csv);

  const header = rows[0];
  const data = rows.slice(1);

  const map = {}; // teamName -> {rk?, value}

  for (const row of data) {
    if (!row.length) continue;
    const rk = parseInt(row[0], 10);
    const team = row[1]?.trim();
    if (!team) continue;
    const val = toNum(row[valueColIndex]);
    map[team] = { rk: Number.isFinite(rk) ? rk : null, value: val };
  }
  return { header, map };
}

async function loadAllTeamStats() {
  // Basic scoring & pace
  const [ppg, oppg, poss] = await Promise.all([
    loadTRSheet(TR_PPG_URL, 2),
    loadTRSheet(TR_OPPG_URL, 2),
    loadTRSheet(TR_POSS_URL, 2)
  ]);

  // Advanced features
  const [offEff, defEff, offReb, defReb, tov, efg] = await Promise.all([
    loadTRSheet(TR_OFF_EFF_URL, 2),
    loadTRSheet(TR_DEF_EFF_URL, 2),
    loadTRSheet(TR_OFF_REB_URL, 2),
    loadTRSheet(TR_DEF_REB_URL, 2),
    loadTRSheet(TR_TOV_URL, 2),
    loadTRSheet(TR_EFG_URL, 2)
  ]);

  const allTeams = new Set([
    ...Object.keys(ppg.map),
    ...Object.keys(oppg.map),
    ...Object.keys(poss.map)
  ]);

  const result = {};
  for (const name of allTeams) {
    const obj = {
      nameTR: name,
      display: name,        // will be overridden by team map if provided
      rk: ppg.map[name]?.rk ?? null,
      ppg: ppg.map[name]?.value ?? NaN,
      oppg: oppg.map[name]?.value ?? NaN,
      poss: poss.map[name]?.value ?? NaN,
      offEff: offEff.map[name]?.value ?? NaN,
      defEff: defEff.map[name]?.value ?? NaN,
      offReb: offReb.map[name]?.value ?? NaN,
      defReb: defReb.map[name]?.value ?? NaN,
      tov: tov.map[name]?.value ?? NaN,
      efg: efg.map[name]?.value ?? NaN
    };
    result[name] = obj;
  }
  return result;
}

// ===============================
// TEAM MAP (TR <-> ESPN <-> Display)
// ===============================
async function loadTeamMap() {
  const csv = await fetchCsv(TEAM_MAP_URL);
  const rows = parseCsv(csv);
  const header = rows[0].map(h => h.trim().toLowerCase());
  const data = rows.slice(1);

  const idxTR = header.indexOf("teamranking");
  const idxESPN = header.indexOf("espn");
  const idxDisp = header.indexOf("display");

  if (idxTR === -1 || idxESPN === -1) {
    console.warn("TEAM_MAP: expected 'TeamRanking' and 'ESPN' headers");
  }

  const map = [];
  for (const row of data) {
    const tr = row[idxTR]?.trim();
    const espn = row[idxESPN]?.trim();
    const disp = idxDisp >= 0 ? row[idxDisp]?.trim() : (tr || espn);
    if (!tr || !espn) continue;
    map.push({ tr, espn, display: disp || tr });
  }
  return map;
}

// ===============================
// LEAGUE PPP
// ===============================
function computeLeaguePPP(teams) {
  let sum = 0, cnt = 0;
  for (const t of Object.values(teams)) {
    if (t.ppg > 0 && t.poss > 0) {
      sum += t.ppg / t.poss;
      cnt += 1;
    }
  }
  if (!cnt) return 1.05;
  return sum / cnt;
}

// ===============================
// HYBRID PPP MODEL
// ===============================
function pppFromPPG(ppg, poss) {
  if (!ppg || !poss) return leaguePPP;
  return ppg / poss;
}

function pppFromEff(eff) {
  if (!eff) return leaguePPP;
  return eff / 100.0;
}

// expected offensive PPP vs a given defense
function hybridOffPPP(team, opp) {
  // Offensive side
  const ppp_ppg_off = pppFromPPG(team.ppg, team.poss);
  const ppp_eff_off = pppFromEff(team.offEff);

  // Defensive side (opponent)
  const oppAllowedPPP_ppg = pppFromPPG(opp.oppg, opp.poss);
  const oppAllowedPPP_eff = pppFromEff(opp.defEff);
  // Convert "points allowed" into "offense facing easier/harder than league"
  const oppDefPPP_ppg = 2 * leaguePPP - oppAllowedPPP_ppg;
  const oppDefPPP_eff = 2 * leaguePPP - oppAllowedPPP_eff;

  const ppp_off_ppg = (ppg_ppg_off + oppDefPPP_ppg) / 2;
  const ppp_off_eff = (ppp_eff_off + oppDefPPP_eff) / 2;

  return EFF_WEIGHT * ppp_off_eff + PPG_WEIGHT * ppp_off_ppg;
}

function projectGameHybrid(home, away) {
  const pace = (home.poss + away.poss) / 2; // possessions

  const homePPP = hybridOffPPP(home, away);
  const awayPPP = hybridOffPPP(away, home);

  let homePts = pace * homePPP + HOME_EDGE_POINTS;
  let awayPts = pace * awayPPP;

  const total = homePts + awayPts;
  const spreadHome = homePts - awayPts; // positive = home favored

  return { homePts, awayPts, total, spreadHome };
}

// ===============================
// GAME CONFIDENCE / PLAYS
// ===============================
function decideTotalsPlay(modelTotal, bookTotal, edgeThresh = 4) {
  if (!bookTotal || !Number.isFinite(modelTotal)) return "NO BET";
  const diff = modelTotal - bookTotal;
  if (Math.abs(diff) < edgeThresh) return "NO BET";
  return diff > 0 ? "Over" : "Under";
}

function decideSpreadPlay(modelSpreadHome, bookSpreadHome, edgeThresh = 3) {
  if (bookSpreadHome === null || bookSpreadHome === undefined) return "NO BET";
  const diff = modelSpreadHome - bookSpreadHome; // how much more/less home should be favored
  if (Math.abs(diff) < edgeThresh) return "NO BET";
  return diff > 0 ? "Home" : "Away";
}

function computeConfidence(edge) {
  const e = Math.min(Math.abs(edge), MAX_EDGE_FOR_CONF);
  return (e / MAX_EDGE_FOR_CONF) * 10.0;
}

// ===============================
// LOAD DAILY GAMES
// ===============================
async function loadGames() {
  const csv = await fetchCsv(CBB_GAMES_URL);
  const rows = parseCsv(csv);
  const header = rows[0].map(h => h.trim().toLowerCase());
  const data = rows.slice(1);

  const idxDate  = header.indexOf("date");
  const idxTime  = header.indexOf("time");
  const idxAway  = header.indexOf("away");
  const idxHome  = header.indexOf("home");
  const idxSpr   = header.indexOf("bookspreadhome");
  const idxTotal = header.indexOf("booktotal");

  const list = [];
  for (const row of data) {
    const awayNameESPN = row[idxAway]?.trim();
    const homeNameESPN = row[idxHome]?.trim();
    if (!awayNameESPN || !homeNameESPN) continue;

    const awayTR = espmToTR[awayNameESPN];
    const homeTR = espmToTR[homeNameESPN];

    const game = {
      date: row[idxDate],
      time: row[idxTime],
      awayNameESPN,
      homeNameESPN,
      awayTR,
      homeTR,
      bookSpreadHome: toNum(row[idxSpr]),
      bookTotal: toNum(row[idxTotal]),
      // these will be filled once we have projections
      proj: null,
      error: null
    };

    if (!awayTR || !homeTR || !teamsByTR[awayTR] || !teamsByTR[homeTR]) {
      game.error = `Model error: no stats found for "${!awayTR ? awayNameESPN : homeNameESPN}"`;
    } else {
      const home = teamsByTR[homeTR];
      const away = teamsByTR[awayTR];
      const proj = projectGameHybrid(home, away);
      const spreadPlay = decideSpreadPlay(proj.spreadHome, game.bookSpreadHome);
      const totalsPlay = decideTotalsPlay(proj.total, game.bookTotal);
      const edgeSpread = Math.abs(proj.spreadHome - game.bookSpreadHome);
      const edgeTotal = Math.abs(proj.total - game.bookTotal);
      const conf = computeConfidence(Math.max(edgeSpread, edgeTotal));

      game.proj = {
        homeScore: proj.homePts,
        awayScore: proj.awayPts,
        total: proj.total,
        spreadHome: proj.spreadHome,
        spreadPlay,
        totalsPlay,
        confidence: conf
      };
    }

    // mark if top 25
    const homeObj = game.homeTR ? teamsByTR[game.homeTR] : null;
    const awayObj = game.awayTR ? teamsByTR[game.awayTR] : null;
    game.isTop25 = !!(
      (homeObj && homeObj.rk && homeObj.rk <= 25) ||
      (awayObj && awayObj.rk && awayObj.rk <= 25)
    );

    list.push(game);
  }

  games = list;
  renderGames();
}

// ===============================
// RENDER: DAILY GAMES
// ===============================
function renderGames() {
  const container = document.getElementById("games-list");
  const countSpan = document.getElementById("games-count");
  if (!container) return;

  const filterSel = document.getElementById("games-filter");
  const searchInput = document.getElementById("games-search");

  const filterVal = filterSel ? filterSel.value : "all";
  const searchVal = (searchInput?.value || "").toLowerCase();

  let filtered = games.slice();

  if (filterVal === "top25") {
    filtered = filtered.filter(g => g.isTop25);
  }

  if (searchVal) {
    filtered = filtered.filter(g => {
      const s = `${g.awayNameESPN} ${g.homeNameESPN}`.toLowerCase();
      return s.includes(searchVal);
    });
  }

  // sort by time as string (already in order usually)
  filtered.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  container.innerHTML = "";
  for (const g of filtered) {
    const card = document.createElement("div");
    card.className = "game-card";

    const titleLine = `${g.time || ""}  ${g.awayNameESPN} @ ${g.homeNameESPN}`;

    const titleEl = document.createElement("div");
    titleEl.className = "game-title";
    titleEl.textContent = titleLine;
    card.appendChild(titleEl);

    if (g.error) {
      const err = document.createElement("div");
      err.className = "game-error";
      err.textContent = g.error;
      card.appendChild(err);
    } else if (g.proj) {
      const p = g.proj;
      const awayTR = g.awayTR;
      const homeTR = g.homeTR;
      const awayDisp = awayTR && teamsByTR[awayTR]?.display || g.awayNameESPN;
      const homeDisp = homeTR && teamsByTR[homeTR]?.display || g.homeNameESPN;

      const modelScore = document.createElement("div");
      modelScore.textContent =
        `Model Score: ${awayDisp} ${p.awayScore.toFixed(1)} – ${homeDisp} ${p.homeScore.toFixed(1)}`;
      card.appendChild(modelScore);

      const bookLine = document.createElement("div");
      const bs = Number.isFinite(g.bookSpreadHome) ? g.bookSpreadHome.toFixed(1) : "N/A";
      const bt = Number.isFinite(g.bookTotal) ? g.bookTotal.toFixed(1) : "N/A";
      bookLine.textContent = `Book Line / Total: ${bs} / ${bt}`;
      card.appendChild(bookLine);

      const modelLine = document.createElement("div");
      modelLine.textContent =
        `Model Line / Total: ${p.spreadHome.toFixed(1)} / ${p.total.toFixed(1)}`;
      card.appendChild(modelLine);

      const playLine = document.createElement("div");
      playLine.textContent =
        `Spread Play: ${p.spreadPlay}   Total Play: ${p.totalsPlay}`;
      card.appendChild(playLine);

      const confLine = document.createElement("div");
      confLine.textContent = `Confidence: ${p.confidence.toFixed(1)} / 10`;
      card.appendChild(confLine);
    }

    container.appendChild(card);
  }

  if (countSpan) {
    countSpan.textContent = `Loaded ${filtered.length} games`;
  }
}

// ===============================
// MANUAL MODEL
// ===============================
function populateManualTeamInputs() {
  const teams = Object.values(teamsByDisplay);
  teams.sort((a, b) => a.display.localeCompare(b.display));

  const awaySel = document.getElementById("manual-away-team");
  const homeSel = document.getElementById("manual-home-team");
  if (!awaySel || !homeSel) return;

  // If they're <select>, populate options; if they're <input list>, we don't need this.
  if (awaySel.tagName === "SELECT") {
    awaySel.innerHTML = "";
    homeSel.innerHTML = "";
    for (const t of teams) {
      const optA = document.createElement("option");
      optA.value = t.display;
      optA.textContent = t.display;
      awaySel.appendChild(optA);

      const optH = document.createElement("option");
      optH.value = t.display;
      optH.textContent = t.display;
      homeSel.appendChild(optH);
    }
  } else {
    // For <input> with datalist you can skip or keep this for datalist.
  }
}

function findTeamByDisplayOrTR(name) {
  if (!name) return null;
  const key = name.trim();
  if (teamsByDisplay[key]) return teamsByDisplay[key];
  if (teamsByTR[key]) return teamsByTR[key];
  // fuzzy: try case-insensitive
  const lower = key.toLowerCase();
  for (const t of Object.values(teamsByDisplay)) {
    if (t.display.toLowerCase() === lower) return t;
  }
  for (const t of Object.values(teamsByTR)) {
    if (t.nameTR.toLowerCase() === lower) return t;
  }
  return null;
}

function runManualProjection() {
  const awayInput = document.getElementById("manual-away-team");
  const homeInput = document.getElementById("manual-home-team");
  const spreadInput = document.getElementById("manual-home-spread");
  const totalInput = document.getElementById("manual-total");
  const resultDiv = document.getElementById("manual-result");

  if (!awayInput || !homeInput || !resultDiv) return;

  const awayName = awayInput.value;
  const homeName = homeInput.value;
  const bookSpreadHome = toNum(spreadInput?.value);
  const bookTotal = toNum(totalInput?.value);

  const away = findTeamByDisplayOrTR(awayName);
  const home = findTeamByDisplayOrTR(homeName);

  if (!away || !home) {
    resultDiv.innerHTML = `<div class="game-error">Could not find stats for one or both teams.</div>`;
    return;
  }

  const proj = projectGameHybrid(home, away);
  const spreadPlay = decideSpreadPlay(proj.spreadHome, bookSpreadHome);
  const totalsPlay = decideTotalsPlay(proj.total, bookTotal);
  const edgeSpread = Number.isFinite(bookSpreadHome)
    ? Math.abs(proj.spreadHome - bookSpreadHome)
    : 0;
  const edgeTotal = Number.isFinite(bookTotal)
    ? Math.abs(proj.total - bookTotal)
    : 0;
  const conf = computeConfidence(Math.max(edgeSpread, edgeTotal));

  const html = `
    <div class="manual-card">
      <div class="game-title">🏀 GAME SUMMARY: ${away.display} @ ${home.display}</div>
      <div>Projected Score | ${away.display}: ${proj.awayPts.toFixed(1)} ┊ ${home.display}: ${proj.homePts.toFixed(1)}</div>
      <div>Projected Winner | ${proj.homePts > proj.awayPts ? home.display : away.display} by ${(Math.abs(proj.homePts - proj.awayPts)).toFixed(1)} pts</div>
      <div>Win Probability | (approx) ${ (50 + (proj.spreadHome * 3)).toFixed(1)}% for ${proj.homePts > proj.awayPts ? home.display : away.display}</div>
      <div>Totals | Model: ${proj.total.toFixed(1)} ┊ Book: ${Number.isFinite(bookTotal) ? bookTotal.toFixed(1) : "N/A"}</div>
      <div>Spread (Home) | Model: ${proj.spreadHome.toFixed(1)} ┊ Book: ${Number.isFinite(bookSpreadHome) ? bookSpreadHome.toFixed(1) : "N/A"}</div>
      <div>Totals Play | ${totalsPlay}</div>
      <div>Spread Play | ${spreadPlay}</div>
      <div>Confidence | ${conf.toFixed(1)} / 10</div>
    </div>
  `;
  resultDiv.innerHTML = html;
}

// ===============================
// INIT
// ===============================
async function init() {
  try {
    // Load core stats + mapping
    teamsByTR = await loadAllTeamStats();
    leaguePPP = computeLeaguePPP(teamsByTR);

    const mappings = await loadTeamMap();
    espmToTR = {};
    teamsByDisplay = {};

    for (const m of mappings) {
      const trName = m.tr;
      const espnName = m.espn;
      const disp = m.display || trName;

      espmToTR[espnName] = trName;
      if (teamsByTR[trName]) {
        teamsByTR[trName].display = disp;
        teamsByDisplay[disp] = teamsByTR[trName];
      }
    }

    // Fallback: any TR team not in mapping, map display to TR name
    for (const [trName, t] of Object.entries(teamsByTR)) {
      if (!t.display) t.display = trName;
      if (!teamsByDisplay[t.display]) {
        teamsByDisplay[t.display] = t;
      }
    }

    populateManualTeamInputs();

    // Hook manual run button
    const runBtn = document.getElementById("manual-run-btn");
    if (runBtn) {
      runBtn.addEventListener("click", (e) => {
        e.preventDefault();
        runManualProjection();
      });
    }

    // Hook filters / search / reload
    const filterSel = document.getElementById("games-filter");
    const searchInput = document.getElementById("games-search");
    const reloadBtn = document.getElementById("reload-games-btn");

    if (filterSel) filterSel.addEventListener("change", renderGames);
    if (searchInput) searchInput.addEventListener("input", renderGames);
    if (reloadBtn) reloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      loadGames();
    });

    await loadGames();

  } catch (err) {
    console.error(err);
    const container = document.getElementById("games-list") || document.getElementById("manual-result");
    if (container) {
      container.innerHTML = `<div class="game-error">Data load error:\n${err.message}</div>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
