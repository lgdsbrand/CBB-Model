/* app.js - Manual-entry CBB model with CSV column-letter mapping
   - Edit DATA_SHEETS below to point to your CSV URLs or local paths (/mnt/data/...)
   - Set teamCol and other column letters for each CSV.
   - Paste this file into your project and wire the HTML inputs described below.
*/

/* ===========================
   CONFIG: specify each CSV + column letters
   - teamCol: letter for team name (usually "B")
   - seasonCol: main season value column (e.g. "C")
   - l3Col, homeCol, awayCol: optional; set to "" if not present
   - For efficiency/rebound/tov/efg files, set teamCol and seasonCol
   - Replace the URLs with your local path if using Colab/Notebook (e.g. "/mnt/data/ppg.csv")
*/
const DATA_SHEETS = {
  // PPG (season + last3 + home/away splits)
  PPG: {
    url: "/mnt/data/ppg.csv",      // <-- replace with your local path or published CSV URL
    teamCol: "B",
    seasonCol: "C",
    l3Col: "H",       // set to "" if not present
    homeCol: "J",     // set to "" if not present
    awayCol: "K"      // set to "" if not present
  },
  // OPP PPG (opponent points allowed; same column mapping pattern)
  OPPG: {
    url: "/mnt/data/oppg.csv",
    teamCol: "B",
    seasonCol: "C",
    l3Col: "H",
    homeCol: "J",
    awayCol: "K"
  },
  // Possessions
  POSS: {
    url: "/mnt/data/poss.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  // Offensive Efficiency
  OFF_EFF: {
    url: "/mnt/data/off_eff.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  // Defensive Efficiency
  DEF_EFF: {
    url: "/mnt/data/def_eff.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  OFF_REB: {
    url: "/mnt/data/off_reb.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  DEF_REB: {
    url: "/mnt/data/def_reb.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  TOV: {
    url: "/mnt/data/tov.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  EFG: {
    url: "/mnt/data/efg.csv",
    teamCol: "B",
    seasonCol: "C"
  },
  // Team name mapping (optional) - if you have a mapping file that maps TR name -> display name
  TEAM_MAP: {
    url: "/mnt/data/team_map.csv",
    // expected: columns with headers TeamRanking (or Team), ESPN, Display; loader will detect by header
    teamCol: "B"
  }
};

/* ===========================
   MODEL PARAMETERS
*/
const EFF_WEIGHT = 0.5;    // efficiency weight
const PPG_WEIGHT = 0.5;    // averaged-PPG weight
const HOME_EDGE_POINTS = 3; 
const MAX_EDGE_FOR_CONF = 12;

/* ===========================
   GLOBAL STATE
*/
let teamsByTR = {};
let teamsByDisplay = {};
let savedGames = [];

/* ===========================
   Helpers: column letter -> index; CSV fetch & parse
*/
function colLetterToIndex(letter) {
  if (!letter || typeof letter !== "string") return -1;
  const s = letter.trim().toUpperCase();
  let index = 0;
  for (let i = 0; i < s.length; i++) {
    index = index * 26 + (s.charCodeAt(i) - 64);
  }
  return index - 1; // zero-based
}

async function fetchCsvText(url) {
  // support local paths (when served by your environment) or remote published CSVs
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.text();
}

function parseCsvRobust(text) {
  // Simple CSV parse that handles typical publish-to-web CSVs.
  // Assumes no embedded newlines inside fields.
  const rows = text.trim().split(/\r?\n/).map(r => {
    // Respect quoted fields with commas - minimal handling
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      if (ch === '"' ) {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols.map(c => c.trim());
  });
  return rows;
}

function toNum(v) {
  if (v === undefined || v === null) return NaN;
  const s = String(v).replace(/[\$,%]/g, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/* ===========================
   Generic CSV loader by column letters
   returns map teamName -> object with the requested numeric fields
*/
async function loadSheetByCols(sheetConfig) {
  if (!sheetConfig || !sheetConfig.url) return {};
  const text = await fetchCsvText(sheetConfig.url);
  const rows = parseCsvRobust(text);
  if (!rows.length) return {};

  // find header row if present (we'll try to detect header by checking if first row contains non-numeric text in teamCol)
  const teamColIndex = colLetterToIndex(sheetConfig.teamCol || "B");
  let startRow = 1; // default skip header
  // if first row at teamCol looks numeric or empty, we will still treat it as header if many cells are non-numeric
  // We'll assume published CSVs include a header; this can be changed if needed.

  const map = {};
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const teamName = (row[teamColIndex] || "").trim();
    if (!teamName) continue;
    const obj = { __rawRow: row.slice() };
    // store configured columns as numbers or raw strings
    if (sheetConfig.seasonCol) obj.season = toNum(row[colLetterToIndex(sheetConfig.seasonCol)]);
    if (sheetConfig.l3Col) obj.l3 = toNum(row[colLetterToIndex(sheetConfig.l3Col)]);
    if (sheetConfig.homeCol) obj.home = toNum(row[colLetterToIndex(sheetConfig.homeCol)]);
    if (sheetConfig.awayCol) obj.away = toNum(row[colLetterToIndex(sheetConfig.awayCol)]);
    // also keep raw text for debugging
    obj._teamRaw = teamName;
    map[teamName] = obj;
  }
  return map;
}

/* ===========================
   Load all configured sheets and merge into teamsByTR
*/
async function loadAllDataFromConfigs() {
  setStatus("Loading CSVs...");
  // load concurrently
  const loadPromises = [];
  for (const k of Object.keys(DATA_SHEETS)) {
    loadPromises.push(loadSheetByCols(DATA_SHEETS[k]).then(m => ({ k, m })));
  }
  const results = await Promise.all(loadPromises);

  // temporary maps by key
  const loaded = {};
  results.forEach(r => { loaded[r.k] = r.m; });

  // build union set of team names from PPG/OPPG/POSS
  const allNames = new Set([
    ...Object.keys(loaded.PPG || {}),
    ...Object.keys(loaded.OPPG || {}),
    ...Object.keys(loaded.POSS || {}),
    ...Object.keys(loaded.OFF_EFF || {}),
    ...Object.keys(loaded.DEF_EFF || {})
  ]);

  const out = {};
  allNames.forEach(name => {
    const ppgRow = (loaded.PPG || {})[name] || {};
    const oppgRow = (loaded.OPPG || {})[name] || {};
    const possRow = (loaded.POSS || {})[name] || {};
    const offEffRow = (loaded.OFF_EFF || {})[name] || {};
    const defEffRow = (loaded.DEF_EFF || {})[name] || {};
    const offRebRow = (loaded.OFF_REB || {})[name] || {};
    const defRebRow = (loaded.DEF_REB || {})[name] || {};
    const tovRow = (loaded.TOV || {})[name] || {};
    const efgRow = (loaded.EFG || {})[name] || {};

    out[name] = {
      nameTR: name,
      display: name,
      // PPG fields (season / l3 / home / away)
      ppg: Number.isFinite(ppgRow.season) ? ppgRow.season : NaN,
      ppg_l3: Number.isFinite(ppgRow.l3) ? ppgRow.l3 : NaN,
      ppg_home: Number.isFinite(ppgRow.home) ? ppgRow.home : NaN,
      ppg_away: Number.isFinite(ppgRow.away) ? ppgRow.away : NaN,
      // Opponent PPG (oppg)
      oppg: Number.isFinite(oppgRow.season) ? oppgRow.season : NaN,
      oppg_l3: Number.isFinite(oppgRow.l3) ? oppgRow.l3 : NaN,
      oppg_home: Number.isFinite(oppgRow.home) ? oppgRow.home : NaN,
      oppg_away: Number.isFinite(oppgRow.away) ? oppgRow.away : NaN,
      // Possessions & efficiencies
      poss: Number.isFinite(possRow.season) ? possRow.season : NaN,
      offEff: Number.isFinite(offEffRow.season) ? offEffRow.season : NaN,
      defEff: Number.isFinite(defEffRow.season) ? defEffRow.season : NaN,
      offReb: Number.isFinite(offRebRow.season) ? offRebRow.season : NaN,
      defReb: Number.isFinite(defRebRow.season) ? defRebRow.season : NaN,
      tov: Number.isFinite(tovRow.season) ? tovRow.season : NaN,
      efg: Number.isFinite(efgRow.season) ? efgRow.season : NaN
    };
  });

  teamsByTR = out;
  teamsByDisplay = {};
  Object.values(teamsByTR).forEach(t => { teamsByDisplay[t.display] = t; });

  setStatus("CSV data loaded.");
}

/* ===========================
   compute averaged PPG (team season / L3 / home-away vs opponent oppg equivalents)
*/
function mean(arr) {
  const vals = (arr || []).filter(v => Number.isFinite(v));
  if (!vals.length) return NaN;
  return vals.reduce((a,b) => a+b, 0) / vals.length;
}

function computeTeamAvgPPG_forMatch(team, opp, isHome) {
  // team-side candidates
  const teamVals = [
    Number.isFinite(team.ppg) ? team.ppg : NaN,
    Number.isFinite(team.ppg_l3) ? team.ppg_l3 : NaN,
    isHome && Number.isFinite(team.ppg_home) ? team.ppg_home : (!isHome && Number.isFinite(team.ppg_away) ? team.ppg_away : NaN)
  ].filter(v => Number.isFinite(v));

  const oppVals = [
    Number.isFinite(opp.oppg) ? opp.oppg : NaN,
    Number.isFinite(opp.oppg_l3) ? opp.oppg_l3 : NaN,
    isHome && Number.isFinite(opp.oppg_away) ? opp.oppg_away : (!isHome && Number.isFinite(opp.oppg_home) ? opp.oppg_home : NaN)
  ].filter(v => Number.isFinite(v));

  const teamAvg = teamVals.length ? mean(teamVals) : NaN;
  const oppAvg  = oppVals.length ? mean(oppVals) : NaN;

  if (!Number.isFinite(teamAvg) && !Number.isFinite(oppAvg)) return NaN;
  if (!Number.isFinite(teamAvg)) return oppAvg;
  if (!Number.isFinite(oppAvg)) return teamAvg;
  return (teamAvg + oppAvg) / 2;
}

function pppFromPPG_usingMatch(team, opp, isHome) {
  const avgPPG = computeTeamAvgPPG_forMatch(team, opp, isHome);
  const pace = Number.isFinite(team.poss) && Number.isFinite(opp.poss) ? (team.poss + opp.poss) / 2 : 70;
  if (!Number.isFinite(avgPPG) || !Number.isFinite(pace) || pace <= 0) return NaN;
  return avgPPG / pace;
}

function pppFromEff(eff) {
  if (!Number.isFinite(eff)) return NaN;
  return eff / 100.0;
}

/* matchup nudges (small) */
function matchupNudges(team, opp) {
  let delta = 0;
  if (Number.isFinite(team.offReb) && Number.isFinite(opp.defReb)) delta += 0.0015 * (team.offReb - opp.defReb);
  if (Number.isFinite(team.efg) && Number.isFinite(opp.efg)) delta += 0.001 * (team.efg - opp.efg);
  if (Number.isFinite(team.tov) && Number.isFinite(opp.tov)) delta += 0.0015 * (opp.tov - team.tov);
  return delta;
}

function hybridOffPPP(team, opp, isHome) {
  const ppp_ppg = pppFromPPG_usingMatch(team, opp, isHome);
  const ppp_eff = pppFromEff(team.offEff);
  let base;
  if (Number.isFinite(ppp_ppg) && Number.isFinite(ppp_eff)) base = PPG_WEIGHT * ppp_ppg + EFF_WEIGHT * ppp_eff;
  else if (Number.isFinite(ppp_ppg)) base = ppp_ppg;
  else if (Number.isFinite(ppp_eff)) base = ppp_eff;
  else base = NaN;
  const delta = matchupNudges(team, opp);
  return Number.isFinite(base) ? base + delta : NaN;
}

function projectGameHybrid(home, away) {
  const pace = Number.isFinite(home.poss) && Number.isFinite(away.poss) ? (home.poss + away.poss) / 2 : 70;
  const homePPP = hybridOffPPP(home, away, true);
  const awayPPP = hybridOffPPP(away, home, false);
  const homePts = Number.isFinite(homePPP) ? (pace * homePPP + HOME_EDGE_POINTS) : NaN;
  const awayPts = Number.isFinite(awayPPP) ? (pace * awayPPP) : NaN;
  const total = Number.isFinite(homePts) && Number.isFinite(awayPts) ? homePts + awayPts : NaN;
  const spreadHome = Number.isFinite(homePts) && Number.isFinite(awayPts) ? homePts - awayPts : NaN;
  return { homePts, awayPts, total, spreadHome };
}

/* ===========================
   parseMatchup helper - cleans ranks and splits teams
*/
function parseMatchup(raw) {
  if (!raw) return { away: "", home: "", matchup: "", location: "" };
  let s = String(raw).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
  const locMatch = s.match(/\s*\(([^)]+)\)\s*$/);
  let locationText = "";
  if (locMatch) { locationText = locMatch[1].trim(); s = s.replace(/\s*\([^)]+\)\s*$/, "").trim(); }
  s = s.replace(/(\s+(?:vs|v|at)\s+|@|[\u2013\u2014-])/ig, " vs ");
  s = s.replace(/(^|\s)\d{1,3}[.)]?\s+(?=[A-Za-z\(\[])/g, "$1");
  s = s.trim();
  const parts = s.split(/\s+vs\s+/i).map(p => p.trim()).filter(Boolean);
  let away = "", home = "", matchup = s;
  if (parts.length >= 2) { away = parts[0]; home = parts.slice(1).join(" vs "); matchup = `${away} vs ${home}`; }
  else {
    const alt = s.split(/\s*\/\s*|\s*,\s*/).map(p => p.trim()).filter(Boolean);
    if (alt.length >= 2) { away = alt[0]; home = alt[1]; matchup = `${away} vs ${home}`; }
    else {
      const words = s.split(/\s+/);
      if (words.length >= 2) { const mid = Math.ceil(words.length/2); away = words.slice(0,mid).join(" "); home = words.slice(mid).join(" "); matchup = `${away} vs ${home}`; }
      else { away = s; home = ""; matchup = s; }
    }
  }
  away = away.replace(/^[^\w]+|[^\w]+$/g, "").trim();
  home = home.replace(/^[^\w]+|[^\w]+$/g, "").trim();
  return { away, home, matchup, location: locationText };
}

/* ===========================
   UI helpers / Saved games
   (expects HTML inputs with IDs described below)
*/
function setStatus(msg) { const el = document.getElementById("status-text"); if (el) el.textContent = msg; }

function loadSavedGames() {
  try { const raw = localStorage.getItem("cbb_saved_games"); savedGames = raw ? JSON.parse(raw) : []; } catch(e){ savedGames = []; }
  renderSavedGames();
}
function persistSavedGames() {
  try { localStorage.setItem("cbb_saved_games", JSON.stringify(savedGames)); } catch(e){ console.warn(e); }
  renderSavedGames();
}
function saveGameRow(row) { savedGames.push(row); persistSavedGames(); }
function renderSavedGames() {
  const container = document.getElementById("saved-games-list");
  if (!container) return;
  if (!savedGames.length) { container.innerHTML = "<div>No saved games</div>"; return; }
  const rows = savedGames.map((g,i) => `<tr><td>${i+1}</td><td>${g.away} @ ${g.home}</td><td>${g.awayScore}–${g.homeScore}</td><td>${g.modelSpreadHome}/${g.bookSpreadHome}</td><td>${g.modelTotal}/${g.bookTotal}</td><td>${g.spreadPlay}</td><td>${g.totalsPlay}</td><td>${g.confidence}</td></tr>`).join("");
  container.innerHTML = `<table class="saved-table"><thead><tr><th>#</th><th>Matchup</th><th>ModelScore</th><th>Spread M/B</th><th>Total M/B</th><th>SpreadPlay</th><th>TotalPlay</th><th>Conf</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function downloadSavedGamesCSV() {
  if (!savedGames.length) return;
  const header = ["Away","Home","AwayScore","HomeScore","ModelSpreadHome","BookSpreadHome","ModelTotal","BookTotal","SpreadPlay","TotalsPlay","Confidence"];
  const rows = savedGames.map(g => [g.away,g.home,g.awayScore,g.homeScore,g.modelSpreadHome,g.bookSpreadHome,g.modelTotal,g.bookTotal,g.spreadPlay,g.totalsPlay,g.confidence]);
  const csv = [header.join(","), ...rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "cbb_saved_games.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ===========================
   Manual UI: populate datalist and run projection
   Expected HTML elements (IDs):
   - manual-away-team (input)
   - manual-home-team (input)
   - teamList (datalist for autocomplete)
   - manual-home-spread (text)
   - manual-total (text)
   - manual-run-btn (button)
   - manual-result (div)
   - saved-games-list, download-csv-btn, undo-last-btn, clear-all-btn
*/
function populateManualTeamInputs() {
  const dl = document.getElementById("teamList");
  if (!dl) return;
  const teams = Object.values(teamsByDisplay).sort((a,b) => a.display.localeCompare(b.display));
  dl.innerHTML = teams.map(t => `<option value="${t.display}"></option>`).join("");
}

function findTeamByDisplayOrTR(name) {
  if (!name) return null;
  const key = name.trim();
  if (teamsByDisplay[key]) return teamsByDisplay[key];
  if (teamsByTR[key]) return teamsByTR[key];
  const lower = key.toLowerCase();
  for (const t of Object.values(teamsByDisplay)) if (t.display.toLowerCase() === lower) return t;
  for (const t of Object.values(teamsByTR)) if (t.nameTR.toLowerCase() === lower) return t;
  return null;
}

function buildStatsComparisonHTML(a,b,labelA,labelB) {
  const stats = [{key:"ppg",label:"PPG",hb:true},{key:"oppg",label:"PPGa",hb:false},{key:"offReb",label:"OReb%",hb:true},{key:"defReb",label:"DReb%",hb:true},{key:"tov",label:"TOV%",hb:false}];
  let html = `<table class="stats-table"><thead><tr><th>Stat</th><th>${labelA}</th><th>${labelB}</th></tr></thead><tbody>`;
  for (const s of stats) {
    const va = a[s.key], vb = b[s.key];
    let aClass="", bClass="";
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      if (s.hb) { if (va>vb) aClass="stat-better"; else if (vb>va) bClass="stat-better"; }
      else { if (va<vb) aClass="stat-better"; else if (vb<va) bClass="stat-better"; }
    }
    html += `<tr><td>${s.label}</td><td class="${aClass}">${Number.isFinite(va)?va.toFixed(1):"–"}</td><td class="${bClass}">${Number.isFinite(vb)?vb.toFixed(1):"–"}</td></tr>`;
  }
  html += `</tbody></table>`; return html;
}

function runManualProjectionAndRender() {
  const awayInput = document.getElementById("manual-away-team");
  const homeInput = document.getElementById("manual-home-team");
  const spreadInput = document.getElementById("manual-home-spread");
  const totalInput = document.getElementById("manual-total");
  const resultDiv = document.getElementById("manual-result");
  if (!awayInput || !homeInput || !resultDiv) return;

  const awayName = awayInput.value.trim();
  const homeName = homeInput.value.trim();
  const bookSpreadHome = toNum(spreadInput && spreadInput.value);
  const bookTotal = toNum(totalInput && totalInput.value);

  const away = findTeamByDisplayOrTR(awayName);
  const home = findTeamByDisplayOrTR(homeName);

  if (!away || !home) { resultDiv.innerHTML = `<div class="game-error">Could not find stats for one or both teams.</div>`; return; }

  const proj = projectGameHybrid(home, away);
  const spreadPlay = decideSpreadPlay(proj.spreadHome, bookSpreadHome);
  const totalsPlay = decideTotalsPlay(proj.total, bookTotal);
  const edgeSpread = Number.isFinite(bookSpreadHome)?Math.abs(proj.spreadHome - bookSpreadHome):0;
  const edgeTotal = Number.isFinite(bookTotal)?Math.abs(proj.total - bookTotal):0;
  const conf = computeConfidence(Math.max(edgeSpread, edgeTotal));

  const statsHTML = buildStatsComparisonHTML(away, home, away.display, home.display);

  resultDiv.innerHTML = `
    <div class="manual-card">
      <div class="game-title">${away.display} @ ${home.display}</div>
      <div>Projected Score | ${away.display}: ${proj.awayPts.toFixed(1)} ┊ ${home.display}: ${proj.homePts.toFixed(1)}</div>
      <div>Spread (Home) | Model: ${proj.spreadHome.toFixed(1)} ┊ Book: ${Number.isFinite(bookSpreadHome)?bookSpreadHome.toFixed(1):"N/A"}</div>
      <div>Totals | Model: ${proj.total.toFixed(1)} ┊ Book: ${Number.isFinite(bookTotal)?bookTotal.toFixed(1):"N/A"}</div>
      <div>Spread Play | ${spreadPlay}</div>
      <div>Totals Play | ${totalsPlay}</div>
      <div>Confidence | ${conf.toFixed(1)} / 10</div>
      <div style="margin-top:8px;">
        <button id="manual-save-btn" class="btn-save">Save Game</button>
        <button class="stats-toggle">Stats Comparison</button>
      </div>
      <div class="stats-panel hidden">${statsHTML}</div>
    </div>
  `;

  const saveBtn = document.getElementById("manual-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const savedRow = {
      away: away.display, home: home.display,
      awayScore: proj.awayPts.toFixed(1), homeScore: proj.homePts.toFixed(1),
      modelSpreadHome: proj.spreadHome.toFixed(1), bookSpreadHome: Number.isFinite(bookSpreadHome)?bookSpreadHome.toFixed(1):"",
      modelTotal: proj.total.toFixed(1), bookTotal: Number.isFinite(bookTotal)?bookTotal.toFixed(1):"",
      spreadPlay, totalsPlay, confidence: conf.toFixed(1)
    };
    saveGameRow(savedRow);
    saveBtn.textContent = "Saved ✓"; setTimeout(()=>saveBtn.textContent="Save Game",1200);
  });

  const statsToggle = resultDiv.querySelector(".stats-toggle");
  if (statsToggle) statsToggle.addEventListener("click", () => {
    const panel = resultDiv.querySelector(".stats-panel");
    if (panel) panel.classList.toggle("hidden");
  });
}

/* ===========================
   INIT
*/
async function init() {
  try {
    setStatus("Loading CSVs...");
    await loadAllDataFromConfigs();
    populateManualTeamInputs();
    // wire buttons
    const runBtn = document.getElementById("manual-run-btn");
    if (runBtn) runBtn.addEventListener("click", (e) => { e.preventDefault(); runManualProjectionAndRender(); });
    const dl = document.getElementById("download-csv-btn"), undo = document.getElementById("undo-last-btn"), clearBtn = document.getElementById("clear-all-btn");
    if (dl) dl.addEventListener("click", downloadSavedGamesCSV);
    if (undo) undo.addEventListener("click", () => { savedGames.pop(); persistSavedGames(); });
    if (clearBtn) clearBtn.addEventListener("click", () => { savedGames = []; persistSavedGames(); });
    loadSavedGames();
    setStatus("Ready.");
  } catch (err) {
    console.error("Init error:", err);
    setStatus("Error loading data: " + (err && err.message ? err.message : err));
    const r = document.getElementById("manual-result");
    if (r) r.innerHTML = `<div class="game-error">Init error: ${err && err.message ? err.message : err}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
