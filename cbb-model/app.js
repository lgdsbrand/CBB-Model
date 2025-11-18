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

/*
  Team mapping CSV (TR names + ESPN names):
  Expected header (case-insensitive):
    TeamRanking, ESPN, Display
*/
const TEAM_MAP_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1061863749&single=true&output=csv";

/*
  Daily games CSV from Apps Script:
  Header expected:
    Date, Time, Away, Home, BookSpreadHome, BookTotal, BookName, EspnId
*/
const CBB_GAMES_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1912820604&single=true&output=csv";

// ===============================
// MODEL PARAMETERS
// ===============================

// 50/50 blend now – you can change mid-season (e.g. EFF_WEIGHT = 0.7)
const EFF_WEIGHT = 0.5;
const PPG_WEIGHT = 0.5;

// Home court advantage
const HOME_EDGE_POINTS = 3.0;

// For confidence score
const MAX_EDGE_FOR_CONF = 12; // 10/10 at ~12 pts of edge

// ===============================
// GLOBAL STATE
// ===============================
let teamsByTR = {};       // key: TeamRanking name
let teamsByDisplay = {};  // key: display name
let espmToTR = {};        // ESPN name -> TR name
let leaguePPP = 1.05;
let games = [];           // daily games list

// ===============================
// UTILITIES
// ===============================
async function fetchCsv(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} - ${url}`);
  return await resp.text();
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  return rows.map(r => r.split(","));
}

function toNum(v) {
  if (v === undefined || v === null) return NaN;
  const cleaned = String(v).replace(/[+%]/g, "").trim();
  const x = parseFloat(cleaned);
  return Number.isFinite(x) ? x : NaN;
}

// ===============================
// LOAD TEAMRANKINGS DATA
// ===============================
async function loadTRSheet(url, valueColIndex = 2) {
  const csv = await fetchCsv(url);
  const rows = parseCsv(csv);
  const data = rows.slice(1);

  const map = {};
  for (const row of data) {
    if (!row.length) continue;
    const rk = parseInt(row[0], 10);
    const team = row[1]?.trim();
    if (!team) continue;
    const val = toNum(row[valueColIndex]);
    map[team] = { rk: Number.isFinite(rk) ? rk : null, value: val };
  }
  return map;
}

async function loadAllTeamStats() {
  // Basic scoring / pace
  const [ppg, oppg, poss] = await Promise.all([
    loadTRSheet(TR_PPG_URL),
    loadTRSheet(TR_OPPG_URL),
    loadTRSheet(TR_POSS_URL)
  ]);

  // Advanced stats
  const [offEff, defEff, offReb, defReb, tov, efg] = await Promise.all([
    loadTRSheet(TR_OFF_EFF_URL),
    loadTRSheet(TR_DEF_EFF_URL),
    loadTRSheet(TR_OFF_REB_URL),
    loadTRSheet(TR_DEF_REB_URL),
    loadTRSheet(TR_TOV_URL),
    loadTRSheet(TR_EFG_URL)
  ]);

  const allTeams = new Set([
    ...Object.keys(ppg),
    ...Object.keys(oppg),
    ...Object.keys(poss)
  ]);

  const result = {};
  for (const name of allTeams) {
    result[name] = {
      nameTR:  name,
      display: name,
      rk:      ppg[name]?.rk ?? null,
      ppg:     ppg[name]?.value ?? NaN,
      oppg:    oppg[name]?.value ?? NaN,
      poss:    poss[name]?.value ?? NaN,
      offEff:  offEff[name]?.value ?? NaN,
      defEff:  defEff[name]?.value ?? NaN,
      offReb:  offReb[name]?.value ?? NaN,
      defReb:  defReb[name]?.value ?? NaN,
      tov:     tov[name]?.value ?? NaN,
      efg:     efg[name]?.value ?? NaN
    };
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

  const idxTR   = header.indexOf("teamranking");
  const idxESPN = header.indexOf("espn");
  const idxDisp = header.indexOf("display");

  if (idxTR === -1 || idxESPN === -1) {
    console.warn("TEAM_MAP: expected 'TeamRanking' and 'ESPN' headers");
  }

  const map = [];
  for (const row of data) {
    const tr   = row[idxTR]?.trim();
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
// HYBRID PPP MODEL + MATCHUP NUDGES
// ===============================
function pppFromPPG(ppg, poss) {
  if (!ppg || !poss) return leaguePPP;
  return ppg / poss;
}

function pppFromEff(eff) {
  if (!eff) return leaguePPP;
  return eff / 100.0;
}

// Offense PPP vs specific opponent, with small nudges from rebounding, shooting, turnovers
function hybridOffPPP(team, opp) {
  // --- Base hybrid from PPG / Eff (vs opponent def) ---
  const ppp_ppg_off = pppFromPPG(team.ppg, team.poss);
  const ppp_eff_off = pppFromEff(team.offEff);

  const oppAllowedPPP_ppg = pppFromPPG(opp.oppg, opp.poss);
  const oppAllowedPPP_eff = pppFromEff(opp.defEff);

  const oppDefPPP_ppg = 2 * leaguePPP - oppAllowedPPP_ppg;
  const oppDefPPP_eff = 2 * leaguePPP - oppAllowedPPP_eff;

  const ppp_off_ppg = (ppp_ppg_off + oppDefPPP_ppg) / 2;
  const ppp_off_eff = (ppp_eff_off + oppDefPPP_eff) / 2;

  let basePPP = EFF_WEIGHT * ppp_off_eff + PPG_WEIGHT * ppp_off_ppg;

  // --- Matchup-based nudges using only team vs opponent stats ---

  let delta = 0;

  // 1) OReb% vs opponent DReb%
  if (Number.isFinite(team.offReb) && Number.isFinite(opp.defReb)) {
    const diff = team.offReb - opp.defReb;  // + if strong OReb vs weak DReb
    // 10-point diff -> ~+0.015 PPP (~1 pt over 70 poss)
    delta += 0.0015 * diff;
  }

  // 2) eFG% vs opponent eFG% (rough skill vs their own offensive talent)
  if (Number.isFinite(team.efg) && Number.isFinite(opp.efg)) {
    const diff = team.efg - opp.efg; // + if team shoots better than opp
    // 10-point diff -> ~+0.01 PPP (~0.7 pts over 70 poss)
    delta += 0.001 * diff;
  }

  // 3) TOV% – lower is better, compare to opponent's TOV%
  if (Number.isFinite(team.tov) && Number.isFinite(opp.tov)) {
    const diff = opp.tov - team.tov; // + if team turns it over less than opp
    // 10-point diff -> ~+0.015 PPP
    delta += 0.0015 * diff;
  }

  const pppFinal = basePPP + delta;
  return pppFinal;
}

function projectGameHybrid(home, away) {
  const pace = (home.poss + away.poss) / 2 || 70;

  const homePPP = hybridOffPPP(home, away);
  const awayPPP = hybridOffPPP(away, home);

  const homePts = pace * homePPP + HOME_EDGE_POINTS;
  const awayPts = pace * awayPPP;

  const total = homePts + awayPts;
  const spreadHome = homePts - awayPts; // + = home favored

  return { homePts, awayPts, total, spreadHome };
}

// ===============================
// PLAYS & CONFIDENCE
// ===============================
function decideTotalsPlay(modelTotal, bookTotal, edgeThresh = 4) {
  if (!Number.isFinite(bookTotal) || !Number.isFinite(modelTotal)) return "NO BET";
  const diff = modelTotal - bookTotal;
  if (Math.abs(diff) < edgeThresh) return "NO BET";
  return diff > 0 ? "Over" : "Under";
}

function decideSpreadPlay(modelSpreadHome, bookSpreadHome, edgeThresh = 3) {
  if (!Number.isFinite(bookSpreadHome) || !Number.isFinite(modelSpreadHome)) return "NO BET";
  const diff = modelSpreadHome - bookSpreadHome;
  if (Math.abs(diff) < edgeThresh) return "NO BET";
  return diff > 0 ? "Home" : "Away";
}

function computeConfidence(edge) {
  const e = Math.min(Math.abs(edge), MAX_EDGE_FOR_CONF);
  return (e / MAX_EDGE_FOR_CONF) * 10.0;
}

// ===============================
// STATS COMPARISON TABLE
// ===============================
function fmtStat(val, decimals = 1) {
  return Number.isFinite(val) ? val.toFixed(decimals) : "–";
}

// Build stats comparison HTML for two teams
function buildStatsComparisonHTML(teamA, teamB, labelA, labelB) {
  const stats = [
    { key: "ppg",    label: "PPG",   higherBetter: true  },
    { key: "oppg",   label: "PPGa",  higherBetter: false },
    { key: "offReb", label: "OReb%", higherBetter: true  },
    { key: "defReb", label: "DReb%", higherBetter: true  },
    { key: "tov",    label: "TOV%",  higherBetter: false },
  ];

  let html = `
    <table class="stats-table">
      <thead>
        <tr>
          <th>Stat</th>
          <th>${labelA}</th>
          <th>${labelB}</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const s of stats) {
    const va = teamA[s.key];
    const vb = teamB[s.key];
    const aVal = fmtStat(va);
    const bVal = fmtStat(vb);

    let aClass = "";
    let bClass = "";
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      if (s.higherBetter) {
        if (va > vb) aClass = "stat-better";
        else if (vb > va) bClass = "stat-better";
      } else {
        if (va < vb) aClass = "stat-better";
        else if (vb < va) bClass = "stat-better";
      }
    }

    html += `
      <tr>
        <td>${s.label}</td>
        <td class="${aClass}">${aVal}</td>
        <td class="${bClass}">${bVal}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  return html;
}

// ===============================
// DAILY GAMES
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
      bookTotal:      toNum(row[idxTotal]),
      proj: null,
      error: null,
      isTop25: false,
    };

    if (!awayTR || !homeTR || !teamsByTR[awayTR] || !teamsByTR[homeTR]) {
      game.error = `Model error: no stats found for "${!awayTR ? awayNameESPN : homeNameESPN}"`;
    } else {
      const home = teamsByTR[homeTR];
      const away = teamsByTR[awayTR];

      const proj = projectGameHybrid(home, away);

      const spreadPlay = decideSpreadPlay(proj.spreadHome, game.bookSpreadHome);
      const totalsPlay = decideTotalsPlay(proj.total, game.bookTotal);

      const edgeSpread = Number.isFinite(game.bookSpreadHome)
        ? Math.abs(proj.spreadHome - game.bookSpreadHome)
        : 0;
      const edgeTotal = Number.isFinite(game.bookTotal)
        ? Math.abs(proj.total - game.bookTotal)
        : 0;
      const conf = computeConfidence(Math.max(edgeSpread, edgeTotal));

      game.proj = {
        homeScore:  proj.homePts,
        awayScore:  proj.awayPts,
        total:      proj.total,
        spreadHome: proj.spreadHome,
        spreadPlay,
        totalsPlay,
        confidence: conf
      };

      const homeObj = teamsByTR[homeTR];
      const awayObj = teamsByTR[awayTR];
      game.isTop25 =
        (homeObj?.rk && homeObj.rk <= 25) ||
        (awayObj?.rk && awayObj.rk <= 25);
    }

    list.push(game);
  }

  games = list;
  renderGames();
}

function renderGames() {
  const container = document.getElementById("games-list");
  const countSpan = document.getElementById("games-count");
  if (!container) return;

  const filterSel  = document.getElementById("games-filter");
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

  filtered.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  container.innerHTML = "";

  filtered.forEach(g => {
    const card = document.createElement("div");
    card.className = "game-card";

    if (g.error) {
      card.innerHTML = `
        <div class="game-title">${g.time || ""}  ${g.awayNameESPN} @ ${g.homeNameESPN}</div>
        <div class="game-error">${g.error}</div>
      `;
    } else if (g.proj) {
      const p = g.proj;
      const awayTR = g.awayTR;
      const homeTR = g.homeTR;
      const awayObj = teamsByTR[awayTR];
      const homeObj = teamsByTR[homeTR];

      const awayDisp = awayObj?.display || g.awayNameESPN;
      const homeDisp = homeObj?.display || g.homeNameESPN;

      const bs = Number.isFinite(g.bookSpreadHome) ? g.bookSpreadHome.toFixed(1) : "N/A";
      const bt = Number.isFinite(g.bookTotal)      ? g.bookTotal.toFixed(1)      : "N/A";

      const statsHTML =
        awayObj && homeObj
          ? buildStatsComparisonHTML(awayObj, homeObj, awayDisp, homeDisp)
          : "";

      card.innerHTML = `
        <div class="game-title">${g.time || ""}  ${g.awayNameESPN} @ ${g.homeNameESPN}</div>
        <div>Model Score: ${awayDisp} ${p.awayScore.toFixed(1)} – ${homeDisp} ${p.homeScore.toFixed(1)}</div>
        <div>Book Line / Total: ${bs} / ${bt}</div>
        <div>Model Line / Total: ${p.spreadHome.toFixed(1)} / ${p.total.toFixed(1)}</div>
        <div>Spread Play: ${p.spreadPlay} &nbsp; | &nbsp; Total Play: ${p.totalsPlay}</div>
        <div>Confidence: ${p.confidence.toFixed(1)} / 10</div>
        <button type="button" class="stats-toggle">Stats Comparison</button>
        <div class="stats-panel hidden">
          ${statsHTML}
        </div>
      `;
    }

    container.appendChild(card);
  });

  if (countSpan) {
    countSpan.textContent = `Loaded ${filtered.length} games`;
  }
}

// ===============================
// MANUAL MODEL
// ===============================
function populateManualTeamInputs() {
  const teams = Object.values(teamsByDisplay).sort((a, b) =>
    a.display.localeCompare(b.display)
  );

  const awayEl = document.getElementById("manual-away-team");
  const homeEl = document.getElementById("manual-home-team");
  const dl = document.getElementById("teamList");

  // datalist for typeahead
  if (dl) {
    dl.innerHTML = teams
      .map(t => `<option value="${t.display}"></option>`)
      .join("");
  }

  // if using <select>, also populate options
  if (awayEl && awayEl.tagName === "SELECT") {
    awayEl.innerHTML = "";
    homeEl.innerHTML = "";
    teams.forEach(t => {
      const optA = document.createElement("option");
      optA.value = t.display;
      optA.textContent = t.display;
      awayEl.appendChild(optA);

      const optH = document.createElement("option");
      optH.value = t.display;
      optH.textContent = t.display;
      homeEl.appendChild(optH);
    });
  }
}

function findTeamByDisplayOrTR(name) {
  if (!name) return null;
  const key = name.trim();
  if (teamsByDisplay[key]) return teamsByDisplay[key];
  if (teamsByTR[key])       return teamsByTR[key];

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
  const awayInput   = document.getElementById("manual-away-team");
  const homeInput   = document.getElementById("manual-home-team");
  const spreadInput = document.getElementById("manual-home-spread");
  const totalInput  = document.getElementById("manual-total");
  const resultDiv   = document.getElementById("manual-result");

  if (!awayInput || !homeInput || !resultDiv) return;

  const awayName = awayInput.value;
  const homeName = homeInput.value;
  const bookSpreadHome = toNum(spreadInput?.value);
  const bookTotal      = toNum(totalInput?.value);

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

  const awayDisp = away.display;
  const homeDisp = home.display;

  const statsHTML = buildStatsComparisonHTML(away, home, awayDisp, homeDisp);

  const html = `
    <div class="manual-card">
      <div class="game-title">🏀 ${awayDisp} @ ${homeDisp}</div>
      <div>Projected Score | ${awayDisp}: ${proj.awayPts.toFixed(1)} ┊ ${homeDisp}: ${proj.homePts.toFixed(1)}</div>
      <div>Spread (Home) | Model: ${proj.spreadHome.toFixed(1)} ┊ Book: ${Number.isFinite(bookSpreadHome) ? bookSpreadHome.toFixed(1) : "N/A"}</div>
      <div>Totals | Model: ${proj.total.toFixed(1)} ┊ Book: ${Number.isFinite(bookTotal) ? bookTotal.toFixed(1) : "N/A"}</div>
      <div>Spread Play | ${spreadPlay}</div>
      <div>Totals Play | ${totalsPlay}</div>
      <div>Confidence | ${conf.toFixed(1)} / 10</div>
      <button type="button" class="stats-toggle">Stats Comparison</button>
      <div class="stats-panel hidden">
        ${statsHTML}
      </div>
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
      const trName   = m.tr;
      const espnName = m.espn;
      const disp     = m.display || trName;

      espmToTR[espnName] = trName;
      if (teamsByTR[trName]) {
        teamsByTR[trName].display = disp;
        teamsByDisplay[disp] = teamsByTR[trName];
      }
    }

    // fallback: ensure every TR team has a display entry
    for (const [trName, t] of Object.entries(teamsByTR)) {
      if (!t.display) t.display = trName;
      if (!teamsByDisplay[t.display]) teamsByDisplay[t.display] = t;
    }

    populateManualTeamInputs();

    // manual run button
    const runBtn = document.getElementById("manual-run-btn");
    if (runBtn) {
      runBtn.addEventListener("click", e => {
        e.preventDefault();
        runManualProjection();
      });
    }

    // event delegation for stats toggles (manual + games)
    const manualResult = document.getElementById("manual-result");
    if (manualResult) {
      manualResult.addEventListener("click", e => {
        const btn = e.target;
        if (btn.classList && btn.classList.contains("stats-toggle")) {
          const panel = manualResult.querySelector(".stats-panel");
          if (panel) panel.classList.toggle("hidden");
        }
      });
    }

    const gamesList = document.getElementById("games-list");
    if (gamesList) {
      gamesList.addEventListener("click", e => {
        const btn = e.target;
        if (btn.classList && btn.classList.contains("stats-toggle")) {
          const panel = btn.nextElementSibling;
          if (panel && panel.classList.contains("stats-panel")) {
            panel.classList.toggle("hidden");
          }
        }
      });
    }

    // filters/search/reload for games
    const filterSel  = document.getElementById("games-filter");
    const searchInput = document.getElementById("games-search");
    const reloadBtn  = document.getElementById("reload-games-btn");

    if (filterSel)   filterSel.addEventListener("change", renderGames);
    if (searchInput) searchInput.addEventListener("input", renderGames);
    if (reloadBtn) {
      reloadBtn.addEventListener("click", e => {
        e.preventDefault();
        loadGames();
      });
    }

    await loadGames();
  } catch (err) {
    console.error(err);
    const container =
      document.getElementById("games-list") ||
      document.getElementById("manual-result");
    if (container) {
      container.innerHTML = `<div class="game-error">Data load error: ${err.message}</div>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
