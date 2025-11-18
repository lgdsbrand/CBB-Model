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
    TeamRanking, ESPN, Display   (Display optional)
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

// 50/50 blend PPG vs efficiency (you can adjust mid-season)
const EFF_WEIGHT = 0.5;
const PPG_WEIGHT = 0.5;

// Home court bump
const HOME_EDGE_POINTS = 3.0;

// Confidence scaling
const MAX_EDGE_FOR_CONF = 12;

// ===============================
// GLOBAL STATE
// ===============================
let teamsByTR = {};       // TR-name -> team object
let teamsByDisplay = {};  // display name -> team object
let espnToTR = {};        // ESPN name -> TR name
let leaguePPP = 1.05;
let games = [];

// ===============================
// UTILITIES
// ===============================
async function fetchCsv(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} (${url})`);
  return await resp.text();
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  return rows.map(r => r.split(","));
}

function toNum(v) {
  if (v === undefined || v === null) return NaN;
  const x = parseFloat(String(v).replace(/[+%]/g, "").trim());
  return Number.isFinite(x) ? x : NaN;
}

function setStatus(msg) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = msg;
}

// ===============================
// LOAD TEAMRANKINGS DATA
// ===============================
async function loadTRSheet(url, valueColIndex) {
  const csv = await fetchCsv(url);
  const rows = parseCsv(csv);
  const data = rows.slice(1); // skip header

  const map = {};
  for (const row of data) {
    if (!row.length) continue;
    const team = (row[1] || "").trim();
    if (!team) continue;
    const val = toNum(row[valueColIndex]);
    const rk = toNum(row[0]);
    map[team] = { rk: Number.isFinite(rk) ? rk : null, value: val };
  }
  return map;
}

async function loadAllTeamStats() {
  setStatus("Loading TeamRankings stats...");

  const [ppg, oppg, poss] = await Promise.all([
    loadTRSheet(TR_PPG_URL, 2),   // col C
    loadTRSheet(TR_OPPG_URL, 2),
    loadTRSheet(TR_POSS_URL, 2)
  ]);

  const [offEff, defEff, offReb, defReb, tov, efg] = await Promise.all([
    loadTRSheet(TR_OFF_EFF_URL, 2),
    loadTRSheet(TR_DEF_EFF_URL, 2),
    loadTRSheet(TR_OFF_REB_URL, 2),
    loadTRSheet(TR_DEF_REB_URL, 2),
    loadTRSheet(TR_TOV_URL, 2),
    loadTRSheet(TR_EFG_URL, 2)
  ]);

  const allTeams = new Set([
    ...Object.keys(ppg),
    ...Object.keys(oppg),
    ...Object.keys(poss)
  ]);

  const result = {};
  allTeams.forEach(name => {
    result[name] = {
      nameTR:  name,
      display: name,
      rk:      ppg[name] ? ppg[name].rk : null,
      ppg:     ppg[name]   ? ppg[name].value   : NaN,
      oppg:    oppg[name]  ? oppg[name].value  : NaN,
      poss:    poss[name]  ? poss[name].value  : NaN,
      offEff:  offEff[name] ? offEff[name].value : NaN,
      defEff:  defEff[name] ? defEff[name].value : NaN,
      offReb:  offReb[name] ? offReb[name].value : NaN,
      defReb:  defReb[name] ? defReb[name].value : NaN,
      tov:     tov[name]    ? tov[name].value    : NaN,
      efg:     efg[name]    ? efg[name].value    : NaN
    };
  });

  return result;
}

// ===============================
// TEAM MAP (TR <-> ESPN <-> Display)
// ===============================
async function loadTeamMap() {
  setStatus("Loading team mapping...");
  const csv = await fetchCsv(TEAM_MAP_URL);
  const rows = parseCsv(csv);
  if (!rows.length) return [];

  const header = rows[0].map(h => h.trim().toLowerCase());
  const data = rows.slice(1);

  const idxTR   = header.indexOf("teamranking");
  const idxESPN = header.indexOf("espn");
  const idxDisp = header.indexOf("display");

  if (idxTR === -1 || idxESPN === -1) {
    console.warn("Team map missing TeamRanking/ESPN headers");
    return [];
  }

  const list = [];
  data.forEach(row => {
    const tr   = (row[idxTR] || "").trim();
    const espn = (row[idxESPN] || "").trim();
    const disp = idxDisp >= 0 ? (row[idxDisp] || "").trim() : tr || espn;
    if (!tr || !espn) return;
    list.push({ tr, espn, display: disp || tr });
  });
  return list;
}

// ===============================
// LEAGUE PPP
// ===============================
function computeLeaguePPP(teams) {
  let sum = 0;
  let cnt = 0;
  Object.values(teams).forEach(t => {
    if (t.ppg > 0 && t.poss > 0) {
      sum += t.ppg / t.poss;
      cnt += 1;
    }
  });
  return cnt ? sum / cnt : 1.05;
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

function hybridOffPPP(team, opp) {
  // Base hybrid
  const ppp_ppg_off = pppFromPPG(team.ppg, team.poss);
  const ppp_eff_off = pppFromEff(team.offEff);

  const oppAllowedPPP_ppg = pppFromPPG(opp.oppg, opp.poss);
  const oppAllowedPPP_eff = pppFromEff(opp.defEff);

  const oppDefPPP_ppg = 2 * leaguePPP - oppAllowedPPP_ppg;
  const oppDefPPP_eff = 2 * leaguePPP - oppAllowedPPP_eff;

  const ppp_off_ppg = (ppp_ppg_off + oppDefPPP_ppg) / 2;
  const ppp_off_eff = (ppp_eff_off + oppDefPPP_eff) / 2;

  let basePPP = EFF_WEIGHT * ppp_off_eff + PPG_WEIGHT * ppp_off_ppg;

  // Small matchup nudges, using only team vs opponent stats
  let delta = 0;

  // OReb% vs opp DReb%
  if (Number.isFinite(team.offReb) && Number.isFinite(opp.defReb)) {
    const diff = team.offReb - opp.defReb; // + if strong OReb vs weak DReb
    delta += 0.0015 * diff; // 10 pt diff -> ~0.015 PPP
  }

  // eFG% vs opp eFG%
  if (Number.isFinite(team.efg) && Number.isFinite(opp.efg)) {
    const diff = team.efg - opp.efg;
    delta += 0.001 * diff; // 10 pt diff -> ~0.01 PPP
  }

  // TOV% (lower better)
  if (Number.isFinite(team.tov) && Number.isFinite(opp.tov)) {
    const diff = opp.tov - team.tov; // + if team turns it over less
    delta += 0.0015 * diff;
  }

  return basePPP + delta;
}

function projectGameHybrid(home, away) {
  const pace = (home.poss + away.poss) / 2 || 70;

  const homePPP = hybridOffPPP(home, away);
  const awayPPP = hybridOffPPP(away, home);

  const homePts = pace * homePPP + HOME_EDGE_POINTS;
  const awayPts = pace * awayPPP;

  const total = homePts + awayPts;
  const spreadHome = homePts - awayPts;

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
  return (e / MAX_EDGE_FOR_CONF) * 10;
}

// ===============================
// STATS COMPARISON
// ===============================
function fmtStat(val, decimals) {
  return Number.isFinite(val) ? val.toFixed(decimals) : "–";
}

function buildStatsComparisonHTML(teamA, teamB, labelA, labelB) {
  const stats = [
    { key: "ppg",    label: "PPG",   higherBetter: true  },
    { key: "oppg",   label: "PPGa",  higherBetter: false },
    { key: "offReb", label: "OReb%", higherBetter: true  },
    { key: "defReb", label: "DReb%", higherBetter: true  },
    { key: "tov",    label: "TOV%",  higherBetter: false }
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

  stats.forEach(s => {
    const va = teamA[s.key];
    const vb = teamB[s.key];

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
        <td class="${aClass}">${fmtStat(va, 1)}</td>
        <td class="${bClass}">${fmtStat(vb, 1)}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  return html;
}

// ===============================
// DAILY GAMES
// ===============================
async function loadGames() {
  setStatus("Loading ESPN daily games...");

  const csv = await fetchCsv(CBB_GAMES_URL);
  const rows = parseCsv(csv);
  if (!rows.length) return;

  const header = rows[0].map(h => h.trim().toLowerCase());
  const data = rows.slice(1);

  const idxTime  = header.indexOf("time");
  const idxAway  = header.indexOf("away");
  const idxHome  = header.indexOf("home");
  const idxSpr   = header.indexOf("bookspreadhome");
  const idxTotal = header.indexOf("booktotal");

  const list = [];

  data.forEach(row => {
    const awayNameESPN = (row[idxAway] || "").trim();
    const homeNameESPN = (row[idxHome] || "").trim();
    if (!awayNameESPN || !homeNameESPN) return;

    const awayTR = espnToTR[awayNameESPN];
    const homeTR = espnToTR[homeNameESPN];

    const game = {
      time: row[idxTime],
      awayNameESPN,
      homeNameESPN,
      awayTR,
      homeTR,
      bookSpreadHome: toNum(row[idxSpr]),
      bookTotal:      toNum(row[idxTotal]),
      proj: null,
      error: null,
      isTop25: false
    };

    if (!awayTR || !homeTR || !teamsByTR[awayTR] || !teamsByTR[homeTR]) {
      game.error = `Model error: no stats found for "${!awayTR ? awayNameESPN : homeNameESPN}"`;
    } else {
      const away = teamsByTR[awayTR];
      const home = teamsByTR[homeTR];

      const proj = projectGameHybrid(home, away);
      const spreadPlay = decideSpreadPlay(proj.spreadHome, game.bookSpreadHome);
      const totalsPlay = decideTotalsPlay(proj.total, game.bookTotal);

      const edgeSpread = Number.isFinite(game.bookSpreadHome)
        ? Math.abs(proj.spreadHome - game.bookSpreadHome) : 0;
      const edgeTotal = Number.isFinite(game.bookTotal)
        ? Math.abs(proj.total - game.bookTotal) : 0;

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

      game.isTop25 =
        (home.rk && home.rk <= 25) ||
        (away.rk && away.rk <= 25);
    }

    list.push(game);
  });

  games = list;
  renderGames();
  setStatus("Ready");
}

function renderGames() {
  const container = document.getElementById("games-list");
  const countSpan = document.getElementById("games-count");
  if (!container) return;

  const filterSel = document.getElementById("games-filter");
  const searchInput = document.getElementById("games-search");

  const filterVal = filterSel ? filterSel.value : "all";
  const searchVal = (searchInput && searchInput.value || "").toLowerCase();

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
      const away = teamsByTR[g.awayTR];
      const home = teamsByTR[g.homeTR];
      const awayDisp = away ? away.display : g.awayNameESPN;
      const homeDisp = home ? home.display : g.homeNameESPN;

      const bookSpread = Number.isFinite(g.bookSpreadHome) ? g.bookSpreadHome.toFixed(1) : "N/A";
      const bookTotal  = Number.isFinite(g.bookTotal) ? g.bookTotal.toFixed(1) : "N/A";

      const statsHTML = (away && home)
        ? buildStatsComparisonHTML(away, home, awayDisp, homeDisp)
        : "";

      card.innerHTML = `
        <div class="game-title">${g.time || ""}  ${g.awayNameESPN} @ ${g.homeNameESPN}</div>
        <div>Model Score: ${awayDisp} ${p.awayScore.toFixed(1)} – ${homeDisp} ${p.homeScore.toFixed(1)}</div>
        <div>Book Line / Total: ${bookSpread} / ${bookTotal}</div>
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

  const awayInput = document.getElementById("manual-away-team");
  const homeInput = document.getElementById("manual-home-team");
  const dl = document.getElementById("teamList");

  if (dl) {
    dl.innerHTML = teams
      .map(t => `<option value="${t.display}"></option>`)
      .join("");
  }

  // If you used <select> instead of <input list>, this will fill them too
  if (awayInput && awayInput.tagName === "SELECT") {
    awayInput.innerHTML = "";
    homeInput.innerHTML = "";
    teams.forEach(t => {
      const o1 = document.createElement("option");
      o1.value = t.display;
      o1.textContent = t.display;
      awayInput.appendChild(o1);

      const o2 = document.createElement("option");
      o2.value = t.display;
      o2.textContent = t.display;
      homeInput.appendChild(o2);
    });
  }
}

function findTeamByDisplayOrTR(name) {
  if (!name) return null;
  const key = name.trim();
  if (teamsByDisplay[key]) return teamsByDisplay[key];
  if (teamsByTR[key]) return teamsByTR[key];

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
  const bookSpreadHome = toNum(spreadInput && spreadInput.value);
  const bookTotal      = toNum(totalInput && totalInput.value);

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
    ? Math.abs(proj.spreadHome - bookSpreadHome) : 0;
  const edgeTotal = Number.isFinite(bookTotal)
    ? Math.abs(proj.total - bookTotal) : 0;
  const conf = computeConfidence(Math.max(edgeSpread, edgeTotal));

  const awayDisp = away.display;
  const homeDisp = home.display;
  const statsHTML = buildStatsComparisonHTML(away, home, awayDisp, homeDisp);

  const bookSpreadTxt = Number.isFinite(bookSpreadHome) ? bookSpreadHome.toFixed(1) : "N/A";
  const bookTotalTxt  = Number.isFinite(bookTotal) ? bookTotal.toFixed(1) : "N/A";

  resultDiv.innerHTML = `
    <div class="manual-card">
      <div class="game-title">${awayDisp} @ ${homeDisp}</div>
      <div>Projected Score | ${awayDisp}: ${proj.awayPts.toFixed(1)} ┊ ${homeDisp}: ${proj.homePts.toFixed(1)}</div>
      <div>Spread (Home) | Model: ${proj.spreadHome.toFixed(1)} ┊ Book: ${bookSpreadTxt}</div>
      <div>Totals | Model: ${proj.total.toFixed(1)} ┊ Book: ${bookTotalTxt}</div>
      <div>Spread Play | ${spreadPlay}</div>
      <div>Totals Play | ${totalsPlay}</div>
      <div>Confidence | ${conf.toFixed(1)} / 10</div>
      <button type="button" class="stats-toggle">Stats Comparison</button>
      <div class="stats-panel hidden">
        ${statsHTML}
      </div>
    </div>
  `;
}

// ===============================
// INIT
// ===============================
async function init() {
  try {
    setStatus("Loading data...");

    // 1) Load TR stats
    teamsByTR = await loadAllTeamStats();
    leaguePPP = computeLeaguePPP(teamsByTR);

    // 2) Load team mapping
    const mappings = await loadTeamMap();
    espnToTR = {};
    teamsByDisplay = {};

    mappings.forEach(m => {
      const trName   = m.tr;
      const espnName = m.espn;
      const disp     = m.display || trName;
      espnToTR[espnName] = trName;
      if (teamsByTR[trName]) {
        teamsByTR[trName].display = disp;
        teamsByDisplay[disp] = teamsByTR[trName];
      }
    });

    // fallback: ensure every TR team also exists in display map
    Object.keys(teamsByTR).forEach(trName => {
      const t = teamsByTR[trName];
      if (!t.display) t.display = trName;
      if (!teamsByDisplay[t.display]) teamsByDisplay[t.display] = t;
    });

    // 3) Populate manual inputs
    populateManualTeamInputs();

    // 4) Wire manual run button
    const runBtn = document.getElementById("manual-run-btn");
    if (runBtn) {
      runBtn.addEventListener("click", e => {
        e.preventDefault();
        runManualProjection();
      });
    }

    // 5) Stats toggle delegation (manual + games)
    const manualRes = document.getElementById("manual-result");
    if (manualRes) {
      manualRes.addEventListener("click", e => {
        const btn = e.target;
        if (btn.classList && btn.classList.contains("stats-toggle")) {
          const panel = manualRes.querySelector(".stats-panel");
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

    // 6) Filters / search / reload for games
    const filterSel   = document.getElementById("games-filter");
    const searchInput = document.getElementById("games-search");
    const reloadBtn   = document.getElementById("reload-games-btn");

    if (filterSel)   filterSel.addEventListener("change", renderGames);
    if (searchInput) searchInput.addEventListener("input", renderGames);
    if (reloadBtn) {
      reloadBtn.addEventListener("click", e => {
        e.preventDefault();
        loadGames();
      });
    }

    // 7) Load daily games
    await loadGames();
  } catch (err) {
    console.error(err);
    setStatus("Error loading data");
    const container =
      document.getElementById("games-list") ||
      document.getElementById("manual-result");
    if (container) {
      container.innerHTML = `<div class="game-error">Data load error: ${err.message}</div>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
