/* =========================================================
   CBB Model — TeamRankings only (no KenPom)
   - Uses PPG, OPPG, Possessions to build ORtg/DRtg
   - Uses extra TR stats (OFF_EFF, DEF_EFF, REB, TOV, EFG)
   - Team name mapping (TR <-> ESPN)
   - Two modes: Manual + ESPN Daily Games (from Sheet CSV)
   ========================================================= */

/* ---------- URLs ---------- */

/*
  Fill these with your real TeamRankings publish-to-web CSV links.

  Each CSV should have (at minimum):
    B = Team name
    C = current season value

  Example:
    TR_PPG_URL  = "https://docs.google.com/...&gid=XXXXX&single=true&output=csv";
*/
const TR_PPG_URL   = "YOUR_TR_PPG_CSV_URL_HERE";
const TR_OPPG_URL  = "YOUR_TR_OPPG_CSV_URL_HERE";
const TR_POSS_URL  = "YOUR_TR_POSS_CSV_URL_HERE";

const TR_OFF_EFF_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv";
const TR_DEF_EFF_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv";
const TR_OFF_REB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv";
const TR_DEF_REB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv";
const TR_TOV_URL     = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv";
const TR_EFG_URL     = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv";

/*
  Team mapping CSV (TR names + ESPN names):
  Expected header (case-insensitive):
    TeamRanking, ESPN, Display   (Display is optional but nice)

  Example row:
    TeamRanking: "UCONN"
    ESPN:        "Connecticut Huskies"
    Display:     "Connecticut"
*/
const TEAM_MAP_URL = "YOUR_TEAM_NAME_MAP_CSV_URL_HERE";

/*
  Daily games CSV built by Apps Script from ESPN scoreboard.
  Tab header (case-insensitive) expected:
    Date, Time, Away, Home, BookSpreadHome, BookTotal, BookName, EspnId
*/
const CBB_GAMES_URL = "YOUR_CBB_GAMES_CSV_URL_HERE";

/* ---------- TR column layout ---------- */

/*
  For all TR CSVs we assume:
    column B (index 1) = Team
    column C (index 2) = main stat value
*/
const TEAM_COL_INDEX = 1;  // B
const STAT_COL_INDEX = 2;  // C

/* ---------- Model knobs ---------- */

const HOME_EDGE_POINTS = 3.5;
const BASE_PPP         = 1.05;  // baseline points per possession
const MIN_PPP          = 0.75;
const MAX_PPP          = 1.40;

// how much extra stats nudge offense
const W_EFG = 0.55;
const W_TOV = 0.25;
const W_REB = 0.20;

/* ---------- DOM ---------- */

const awayInput      = document.getElementById("awayTeamInput");
const homeInput      = document.getElementById("homeTeamInput");
const teamList       = document.getElementById("teamList");
const spreadInput    = document.getElementById("bookSpread");
const totalInput     = document.getElementById("bookTotal");
const runBtn         = document.getElementById("runBtn");
const saveBtn        = document.getElementById("saveBtn");
const statusEl       = document.getElementById("status");
const resultsSec     = document.getElementById("results");
const resultBody     = document.getElementById("resultBody");
const savedWrap      = document.getElementById("savedTableWrap");
const downloadBtn    = document.getElementById("downloadBtn");
const undoBtn        = document.getElementById("undoBtn");
const clearBtn       = document.getElementById("clearBtn");

// mode toggle
const btnManual     = document.getElementById("btnManual");
const btnEspn       = document.getElementById("btnEspn");
const manualSection = document.getElementById("manualSection");
const espnSection   = document.getElementById("espnSection");
const reloadEspnBtn = document.getElementById("reloadEspnBtn");
const dailyCards    = document.getElementById("dailyCards");

/* ---------- State ---------- */

// canonical team stats
// { key, Team, PPG, OPPG, Poss, ORtg, DRtg, OFF_EFF, DEF_EFF, OFF_REB, DEF_REB, TOV, EFG }
let TEAMS = [];
let LGE_ORtg = 105;
let LGE_DRtg = 105;
let LG_OFF_EFG = 0.51;
let LG_OFF_REB = 0.30;
let LG_TOV     = 0.18;

// name mapping
// canonicalKey -> {display, trName, espnName}
let CANON_META = new Map();
// TR name -> canonicalKey
let TR2CANON   = new Map();
// ESPN name -> canonicalKey
let ESPN2CANON = new Map();

let savedGames = [];

/* =========================================================
   Helpers
   ========================================================= */

function parseCSV(text){
  const rows=[]; let row=[]; let cur=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){
        if(text[i+1]==='"'){cur+='"';i++;} else inQ=false;
      } else cur+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ row.push(cur); cur=""; }
      else if(c==='\n'||c==='\r'){
        if(cur!==""||row.length){ row.push(cur); rows.push(row); row=[]; cur=""; }
      }else cur+=c;
    }
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.length);
}

async function fetchCSV(url){
  if(!url) throw new Error("Missing CSV URL");
  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`Fetch failed (${r.status}) for ${url}`);
  return parseCSV(await r.text());
}

const teamKey = s => String(s||"").trim().toLowerCase();
const fmt1    = x => Number(x).toFixed(1);

function badge(text,color){
  const cls = color==="green" ? "green" :
              color==="red"   ? "red"   : "gray";
  return `<span class="badge ${cls}">${text}</span>`;
}

function populateTeamDatalist(teams){
  if(!teamList) return;
  teamList.innerHTML = teams.map(t=>`<option value="${t}"></option>`).join("");
}

function resolveTeamInput(inputValue, allTeams){
  if(!inputValue) return "";
  const v = inputValue.trim().toLowerCase();

  let hit = allTeams.find(t=>t.toLowerCase()===v);
  if(hit) return hit;

  const starts = allTeams.filter(t=>t.toLowerCase().startsWith(v));
  if(starts.length===1) return starts[0];

  const contains = allTeams.filter(t=>t.toLowerCase().includes(v));
  if(contains.length===1) return contains[0];

  return inputValue; // fallback: let safeTeamFor try fuzzy match
}

/* =========================================================
   Team name mapping (TR <-> ESPN -> canonical)
   ========================================================= */

async function loadTeamMap(){
  const rows = await fetchCSV(TEAM_MAP_URL);
  if(!rows || rows.length < 2) return;

  const hdr = rows[0].map(x=>String(x||"").toLowerCase().trim());
  const iTR  = hdr.indexOf("teamranking");
  const iES  = hdr.indexOf("espn");
  const iDis = hdr.indexOf("display"); // optional

  for(let r=1;r<rows.length;r++){
    const row = rows[r];
    if(!row) continue;
    const trName  = iTR  >= 0 ? (row[iTR]  || "").trim() : "";
    const espName = iES  >= 0 ? (row[iES]  || "").trim() : "";
    const dispRaw = iDis >= 0 ? (row[iDis] || "").trim() : "";

    if(!trName && !espName && !dispRaw) continue;

    const display = dispRaw || trName || espName;
    const canonKey = teamKey(display);

    CANON_META.set(canonKey, {
      display,
      trName,
      espnName
    });

    if(trName){
      TR2CANON.set(teamKey(trName), canonKey);
    }
    if(espName){
      ESPN2CANON.set(teamKey(espName), canonKey);
    }
  }
}

/* =========================================================
   TR loader: PPG, OPPG, Poss + extra stats
   ========================================================= */

async function loadTRAll(){
  // Load simple stat maps: key = canonicalKey, value = number
  async function loadStatToCanonMap(url){
    if(!url) return new Map();
    const rows = await fetchCSV(url);
    const m = new Map();

    for(let r=1;r<rows.length;r++){
      const row = rows[r];
      if(!row) continue;
      const rawTeam = (row[TEAM_COL_INDEX] || "").trim();
      if(!rawTeam) continue;

      const trKey  = teamKey(rawTeam);
      const canonKey = TR2CANON.get(trKey) || trKey;

      const val = Number(row[STAT_COL_INDEX]);
      if(!Number.isFinite(val)) continue;

      m.set(canonKey, val);
      if(!CANON_META.has(canonKey)){
        CANON_META.set(canonKey, { display: rawTeam, trName: rawTeam, espnName: "" });
      }
    }
    return m;
  }

  const ppgMap    = await loadStatToCanonMap(TR_PPG_URL);
  const oppgMap   = await loadStatToCanonMap(TR_OPPG_URL);
  const possMap   = await loadStatToCanonMap(TR_POSS_URL);
  const offEffMap = await loadStatToCanonMap(TR_OFF_EFF_URL);
  const defEffMap = await loadStatToCanonMap(TR_DEF_EFF_URL);
  const offRebMap = await loadStatToCanonMap(TR_OFF_REB_URL);
  const defRebMap = await loadStatToCanonMap(TR_DEF_REB_URL);
  const tovMap    = await loadStatToCanonMap(TR_TOV_URL);
  const efgMap    = await loadStatToCanonMap(TR_EFG_URL);

  const keys = new Set([
    ...ppgMap.keys(),
    ...oppgMap.keys(),
    ...possMap.keys()
  ]);

  const teams = [];
  for(const canonKey of keys){
    const meta  = CANON_META.get(canonKey) || {display: canonKey};
    const PPG   = ppgMap.get(canonKey);
    const OPPG  = oppgMap.get(canonKey);
    const Poss  = possMap.get(canonKey);

    if(!Number.isFinite(PPG) || !Number.isFinite(OPPG) || !Number.isFinite(Poss)) continue;

    const ORtg = (PPG  / Poss) * 100;
    const DRtg = (OPPG / Poss) * 100;

    teams.push({
      key: canonKey,
      Team: meta.display,
      PPG,
      OPPG,
      Poss,
      ORtg,
      DRtg,
      OFF_EFF: offEffMap.get(canonKey),
      DEF_EFF: defEffMap.get(canonKey),
      OFF_REB: offRebMap.get(canonKey),
      DEF_REB: defRebMap.get(canonKey),
      TOV:     tovMap.get(canonKey),
      EFG:     efgMap.get(canonKey)
    });
  }

  if(!teams.length) throw new Error("No TR teams parsed (PPG/OPPG/Poss).");

  // League averages
  const mean = arr => arr.length
    ? arr.reduce((a,b)=>a+b,0)/arr.length
    : NaN;

  LGE_ORtg   = mean(teams.map(t=>t.ORtg)) || 105;
  LGE_DRtg   = mean(teams.map(t=>t.DRtg)) || 105;
  LG_OFF_EFG = mean(teams.map(t=>Number.isFinite(t.EFG)?t.EFG:NaN).filter(Number.isFinite)) || 0.51;
  LG_OFF_REB = mean(teams.map(t=>Number.isFinite(t.OFF_REB)?t.OFF_REB:NaN).filter(Number.isFinite)) || 0.30;
  LG_TOV     = mean(teams.map(t=>Number.isFinite(t.TOV)?t.TOV:NaN).filter(Number.isFinite)) || 0.18;

  TEAMS = teams;
}

/* =========================================================
   Team lookup + baseParams
   ========================================================= */

function safeTeamFor(name){
  if(!name) throw new Error("Empty team name");
  const v = name.trim().toLowerCase();

  // direct canonical key
  let row = TEAMS.find(t=>t.key === v);
  if(row) return row;

  // exact display
  row = TEAMS.find(t=>t.Team.toLowerCase() === v);
  if(row) return row;

  // startsWith
  row = TEAMS.find(t=>t.Team.toLowerCase().startsWith(v));
  if(row) return row;

  // contains
  row = TEAMS.find(t=>t.Team.toLowerCase().includes(v));
  if(row) return row;

  throw new Error(`No stats found for team "${name}"`);
}

function baseParams(awayName, homeName){
  const A = safeTeamFor(awayName); // away
  const H = safeTeamFor(homeName); // home

  // possessions = average of both teams
  let poss = 0.5 * (A.Poss + H.Poss);
  if(!Number.isFinite(poss) || poss <= 0) poss = 70;

  // Offense multipliers using TR shooting / rebounding / turnovers
  function offenseMultiplier(t){
    const efg = Number.isFinite(t.EFG)     ? t.EFG     : LG_OFF_EFG;
    const reb = Number.isFinite(t.OFF_REB) ? t.OFF_REB : LG_OFF_REB;
    const tov = Number.isFinite(t.TOV)     ? t.TOV     : LG_TOV;

    const partEFG = Math.pow(efg / Math.max(LG_OFF_EFG,1e-6), W_EFG);
    const partREB = Math.pow(reb / Math.max(LG_OFF_REB,1e-6), W_REB);
    const partTOV = Math.pow((1 - tov) / Math.max(1e-6, 1 - LG_TOV), W_TOV);

    let mult = partEFG * partREB * partTOV;
    mult = Math.max(0.85, Math.min(1.15, mult)); // keep sane
    return mult;
  }

  const offMultA = offenseMultiplier(A);
  const offMultH = offenseMultiplier(H);

  const ORtg_A = A.ORtg * offMultA;
  const ORtg_H = H.ORtg * offMultH;
  const DRtg_A = A.DRtg;
  const DRtg_H = H.DRtg;

  // matchup-adjusted PPP
  let pppA = BASE_PPP *
             (ORtg_A / LGE_ORtg) *
             (LGE_DRtg / DRtg_H);

  let pppH = BASE_PPP *
             (ORtg_H / LGE_ORtg) *
             (LGE_DRtg / DRtg_A);

  // clamp
  pppA = Math.min(MAX_PPP, Math.max(MIN_PPP, pppA));
  pppH = Math.min(MAX_PPP, Math.max(MIN_PPP, pppH));

  return { poss, pppA, pppH };
}

/* =========================================================
   Saved games: manual mode
   ========================================================= */

function loadSaved(){
  try{
    savedGames = JSON.parse(localStorage.getItem("cbb_saved_tr_only") || "[]");
  }catch{ savedGames = []; }
  renderSaved();
}

function persistSaved(){
  localStorage.setItem("cbb_saved_tr_only", JSON.stringify(savedGames));
  renderSaved();
}

function renderSaved(){
  if(!savedGames.length){
    if(savedWrap) savedWrap.innerHTML = `<p class="muted">No games saved yet.</p>`;
    return;
  }
  const cols = [
    "Away","Home",
    "Book Spread (Home)","Book Total",
    "Model Away Pts","Model Home Pts","Model Total",
    "Model Spread (Home)",
    "Total Edge","Spread Edge",
    "Totals Play","Spread Play",
    "Confidence (1-10)"
  ];

  const head = `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  const body = savedGames.map(r =>
    `<tr>${cols.map(c=>`<td>${r[c] ?? ""}</td>`).join("")}</tr>`
  ).join("");

  if(savedWrap){
    savedWrap.innerHTML = `<div class="tableWrap"><table>${head}<tbody>${body}</tbody></table></div>`;
  }
}

function toCSV(arr){
  if(!arr.length) return "";
  const cols = Object.keys(arr[0]);
  const esc  = v => `"${String(v??"").replaceAll('"','""')}"`;
  const header = cols.map(esc).join(",") + "\n";
  const rows   = arr.map(r => cols.map(c=>esc(r[c])).join(",")).join("\n");
  return header + rows;
}

/* =========================================================
   ESPN daily games (from Sheet CSV)
   ========================================================= */

async function loadCbbGamesFromCsv(){
  const rows = await fetchCSV(CBB_GAMES_URL);
  if(!rows || rows.length < 2) return [];

  const hdr = rows[0].map(x=>String(x||"").toLowerCase().trim());
  const iDate   = hdr.indexOf("date");
  const iTime   = hdr.indexOf("time");
  const iAway   = hdr.indexOf("away");
  const iHome   = hdr.indexOf("home");
  const iSpread = hdr.indexOf("bookspreadhome");
  const iTotal  = hdr.indexOf("booktotal");
  const iBook   = hdr.indexOf("bookname");

  const games = [];
  for(let r=1;r<rows.length;r++){
    const row = rows[r];
    if(!row) continue;

    const dateStr = iDate >=0 ? (row[iDate] || "") : "";
    const timeStr = iTime >=0 ? (row[iTime] || "") : "";
    const awayRaw = iAway >=0 ? (row[iAway] || "") : "";
    const homeRaw = iHome >=0 ? (row[iHome] || "") : "";
    const spreadStr = iSpread >=0 ? (row[iSpread] || "") : "";
    const totalStr  = iTotal  >=0 ? (row[iTotal]  || "") : "";
    const bookName  = iBook   >=0 ? (row[iBook]   || "") : "";

    if(!awayRaw || !homeRaw) continue;

    const awayKey = teamKey(awayRaw);
    const homeKey = teamKey(homeRaw);

    const awayCanonKey = ESPN2CANON.get(awayKey) || awayKey;
    const homeCanonKey = ESPN2CANON.get(homeKey) || homeKey;

    const awayDisplay = CANON_META.get(awayCanonKey)?.display || awayRaw;
    const homeDisplay = CANON_META.get(homeCanonKey)?.display || homeRaw;

    games.push({
      dateStr,
      timeStr,
      awayName: awayDisplay,
      homeName: homeDisplay,
      bookSpread: spreadStr !== "" ? Number(spreadStr) : null,
      bookTotal:  totalStr  !== "" ? Number(totalStr)  : null,
      bookName
    });
  }

  return games;
}

function renderDailyCardsFromCsv(games){
  if(!dailyCards) return;
  if(!games.length){
    dailyCards.innerHTML = `<p class="muted">No games found for today in the sheet.</p>`;
    return;
  }

  const cardsHtml = games.map(g => {
    let projectionHtml = "";
    try{
      const { poss, pppA, pppH } = baseParams(g.awayName, g.homeName);
      const detA = pppA * poss;
      const detH = pppH * poss;
      const modelTotal      = detA + detH;
      const modelSpreadHome = detH - detA;
      const winner = detH >= detA ? g.homeName : g.awayName;

      let totalEdge = null;
      let spreadEdge = null;
      let totalPlay  = "NO BET";
      let spreadPlay = "NO BET";

      if(g.bookTotal != null){
        totalEdge = modelTotal - g.bookTotal;
        if(totalEdge >= 2.0)       totalPlay = `OVER ${g.bookTotal.toFixed(1)}`;
        else if(totalEdge <= -2.0) totalPlay = `UNDER ${g.bookTotal.toFixed(1)}`;
      }

      if(g.bookSpread != null){
        const bookHomeEdge = -g.bookSpread;
        spreadEdge = modelSpreadHome - bookHomeEdge;
        if(spreadEdge >= 1.5)       spreadPlay = `${g.homeName} ${g.bookSpread.toFixed(1)}`;
        else if(spreadEdge <= -1.5) spreadPlay = `${g.awayName} ${(-g.bookSpread).toFixed(1)}`;
      }

      projectionHtml = `
        <p><strong>Model Score:</strong> ${g.homeName} ${Math.round(detH)} – ${g.awayName} ${Math.round(detA)}</p>
        <p><strong>Projected Winner:</strong> ${winner}</p>
        <p><strong>Model Total:</strong> ${fmt1(modelTotal)}${g.bookTotal != null ? ` &nbsp; <strong>Book:</strong> ${g.bookTotal.toFixed(1)}` : ""}</p>
        <p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}${g.bookSpread != null ? ` &nbsp; <strong>Book (Home):</strong> ${(g.bookSpread>=0?"+":"")+g.bookSpread.toFixed(1)}` : ""}</p>
        ${g.bookTotal != null ? `<p><strong>Totals Play:</strong> ${totalPlay}</p>` : ""}
        ${g.bookSpread != null ? `<p><strong>Spread Play:</strong> ${spreadPlay}</p>` : ""}
      `;
    }catch(e){
      projectionHtml = `<p class="error">Model error: ${e.message}</p>`;
    }

    const lineInfo = (g.bookSpread != null || g.bookTotal != null)
      ? `<p><strong>Book Line:</strong> ${g.bookSpread != null ? `Spread: ${(g.bookSpread>=0?"+":"")+g.bookSpread.toFixed(1)} ` : ""}${g.bookTotal != null ? `/ Total: ${g.bookTotal.toFixed(1)}` : ""} ${g.bookName ? `(${g.bookName})` : ""}</p>`
      : `<p class="muted">No odds in sheet for this game.</p>`;

    return `
      <div class="game-card">
        <div class="card-header">
          <div class="tip-time">${g.timeStr || ""}</div>
          <div class="matchup">${g.awayName} @ ${g.homeName}</div>
        </div>
        <div class="card-body">
          ${lineInfo}
          ${projectionHtml}
        </div>
      </div>
    `;
  }).join("");

  dailyCards.innerHTML = cardsHtml;
}

/* =========================================================
   Mode toggle + init + manual run
   ========================================================= */

function showManual(){
  btnManual?.classList.add("active");
  btnEspn?.classList.remove("active");
  manualSection?.classList.remove("hidden");
  espnSection?.classList.add("hidden");
}

function showEspn(){
  btnManual?.classList.remove("active");
  btnEspn?.classList.add("active");
  manualSection?.classList.add("hidden");
  espnSection?.classList.remove("hidden");
}

async function init(){
  try{
    if(statusEl) statusEl.textContent = "Loading team mappings...";
    await loadTeamMap();

    if(statusEl) statusEl.textContent = "Loading TeamRankings stats...";
    await loadTRAll();

    const allTeams = TEAMS.map(t=>t.Team).sort((a,b)=>a.localeCompare(b));
    populateTeamDatalist(allTeams);

    if(awayInput) awayInput.value = allTeams[0] || "";
    if(homeInput) homeInput.value = allTeams[1] || "";

    runBtn && (runBtn.disabled = false);
    saveBtn && (saveBtn.disabled = true);
    if(statusEl) statusEl.textContent = "Ready.";
  }catch(e){
    console.error(e);
    if(statusEl) statusEl.textContent = "Data load error.";
    alert("Data load error:\n" + e.message);
  }

  loadSaved();
}

if(btnManual && btnEspn){
  btnManual.addEventListener("click", showManual);
  btnEspn.addEventListener("click", showEspn);
}

if(reloadEspnBtn){
  reloadEspnBtn.addEventListener("click", async () => {
    try{
      if(statusEl) statusEl.textContent = "Loading today's games from sheet...";
      const games = await loadCbbGamesFromCsv();
      renderDailyCardsFromCsv(games);
      if(statusEl) statusEl.textContent = `Loaded ${games.length} games.`;
    }catch(e){
      console.error(e);
      if(statusEl) statusEl.textContent = "Error loading daily games.";
      alert("Error loading daily games:\n" + e.message);
    }
  });
}

if(runBtn){
  runBtn.addEventListener("click", () => {
    try{
      const allTeams = TEAMS.map(t=>t.Team);
      const awayName = resolveTeamInput(awayInput.value, allTeams);
      const homeName = resolveTeamInput(homeInput.value, allTeams);

      if(!awayName || !homeName){
        alert("Please choose valid teams.");
        return;
      }
      if(awayName.trim().toLowerCase() === homeName.trim().toLowerCase()){
        alert("Please pick two different teams.");
        return;
      }

      const hasBookSpread = (spreadInput.value ?? "").trim() !== "";
      const hasBookTotal  = (totalInput.value ?? "").trim() !== "";
      const bookSpread = hasBookSpread ? Number(spreadInput.value) : null;
      const bookTotal  = hasBookTotal  ? Number(totalInput.value)  : null;

      const { poss, pppA, pppH } = baseParams(awayName, homeName);
      const detA = pppA * poss;
      const detH = pppH * poss;

      const modelTotal      = detA + detH;
      const modelSpreadHome = detH - detA;

      const winner = detH >= detA ? homeName : awayName;
      const line   = detH >= detA
        ? `${homeName} ${Math.round(detH)} – ${awayName} ${Math.round(detA)}`
        : `${awayName} ${Math.round(detA)} – ${homeName} ${Math.round(detH)}`;

      let edgesHTML = "";
      let savePayload = {};

      if(hasBookSpread || hasBookTotal){
        let totalEdge = null;
        let spreadEdge = null;
        let totalPlay = "NO BET";
        let spreadPlay = "NO BET";

        if(hasBookTotal && Number.isFinite(bookTotal)){
          totalEdge = modelTotal - bookTotal;
          if(totalEdge >= 2.0)       totalPlay = `OVER ${bookTotal.toFixed(1)}`;
          else if(totalEdge <= -2.0) totalPlay = `UNDER ${bookTotal.toFixed(1)}`;
        }

        if(hasBookSpread && Number.isFinite(bookSpread)){
          const bookHomeEdge = -bookSpread;
          spreadEdge = modelSpreadHome - bookHomeEdge;
          if(spreadEdge >= 1.5)       spreadPlay = `${homeName} ${bookSpread.toFixed(1)}`;
          else if(spreadEdge <= -1.5) spreadPlay = `${awayName} ${(-bookSpread).toFixed(1)}`;
        }

        const mag = Math.max(Math.abs(spreadEdge ?? 0), Math.abs(totalEdge ?? 0));
        const conf = Math.round(1 + 9 * Math.min(Math.abs(mag)/8.0, 1));

        edgesHTML = `
          ${hasBookTotal  ? `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)} &nbsp; <strong>Book:</strong> ${bookTotal.toFixed(1)}</p>` : `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>`}
          ${hasBookSpread ? `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)} &nbsp; <strong>Book (Home):</strong> ${(bookSpread>=0?"+":"")+bookSpread.toFixed(1)}</p>` : `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>`}
          ${hasBookTotal  ? `<p><strong>Totals Play:</strong> ${totalPlay}</p>` : ``}
          ${hasBookSpread ? `<p><strong>Spread Play:</strong> ${spreadPlay}</p>` : ``}
          <div><strong>Prediction Confidence:</strong> ${badge((hasBookTotal||hasBookSpread)?`${conf} / 10`:"Model-only","gray")}</div>
        `;

        savePayload = {
          "Book Spread (Home)": hasBookSpread ? (bookSpread>=0?"+":"")+bookSpread.toFixed(1) : "",
          "Book Total":         hasBookTotal ? bookTotal.toFixed(1) : "",
          "Total Edge":         hasBookTotal ? fmt1(totalEdge) : "",
          "Spread Edge":        hasBookSpread ? fmt1(spreadEdge) : "",
          "Totals Play":        hasBookTotal ? totalPlay : "",
          "Spread Play":        hasBookSpread ? spreadPlay : "",
          "Confidence (1-10)":  (hasBookTotal||hasBookSpread)? conf : ""
        };
      }else{
        edgesHTML = `
          <p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>
          <p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>
          <div><strong>Prediction Confidence:</strong> ${badge("Model-only","gray")}</div>
        `;
      }

      resultsSec?.classList.remove("hidden");
      if(resultBody){
        resultBody.innerHTML = `
          <p><strong>Prediction (model):</strong> ${line}</p>
          <p><strong>Projected Winner:</strong> ${winner}</p>
          ${edgesHTML}
        `;
      }

      if(saveBtn){
        saveBtn.disabled = false;
        saveBtn.onclick = () => {
          savedGames.push({
            Away: awayName,
            Home: homeName,
            "Book Spread (Home)": savePayload["Book Spread (Home)"] ?? "",
            "Book Total":          savePayload["Book Total"] ?? "",
            "Model Away Pts": fmt1(detA),
            "Model Home Pts": fmt1(detH),
            "Model Total":    fmt1(modelTotal),
            "Model Spread (Home)": fmt1(modelSpreadHome),
            "Total Edge":     savePayload["Total Edge"] ?? "",
            "Spread Edge":    savePayload["Spread Edge"] ?? "",
            "Totals Play":    savePayload["Totals Play"] ?? "",
            "Spread Play":    savePayload["Spread Play"] ?? "",
            "Confidence (1-10)": savePayload["Confidence (1-10)"] ?? ""
          });
          persistSaved();
        };
      }

    }catch(e){
      console.error(e);
      alert("Run error:\n" + e.message);
    }
  });
}

if(downloadBtn){
  downloadBtn.addEventListener("click", () => {
    if(!savedGames.length) return;
    const csv = toCSV(savedGames);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `cbb_saved_${new Date().toISOString().slice(0,16).replace("T","_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

if(undoBtn){
  undoBtn.addEventListener("click", () => {
    if(!savedGames.length) return;
    savedGames.pop();
    persistSaved();
  });
}

if(clearBtn){
  clearBtn.addEventListener("click", () => {
    if(!savedGames.length) return;
    if(confirm("Clear all saved games?")){
      savedGames = [];
      persistSaved();
    }
  });
}

// kick it off
init();
showManual();
