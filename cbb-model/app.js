/* =========================================================
   CBB Projection Model — KenPom core + TeamRankings tweaks
   Deterministic (no Monte Carlo)
   ========================================================= */

/* ---------- URLs ---------- */

// TeamRankings metrics (your links)
const TR_URLS = {
  OFF_EFF:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv",
  DEF_EFF:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv",
  OFF_REB:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv",
  DEF_REB:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv",
  TOV_POSS:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv",
  OFF_EFG:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv",
};

// KenPom publish-to-web (stats tab)
const KENPOM_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv";

// Team mapping (KenPom vs TeamRankings)
// Headers: Kenpom, TeamRanking
const TEAM_LIST_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1061863749&single=true&output=csv";

/* ---------- KenPom fixed column letters & header row ---------- */

const KENPOM_COLS = {
  headerRow: 2, // header is on row 2; data start row 3
  team: "B",    // Team
  adjo: "F",    // ORtg / AdjO
  adjd: "H",    // DRtg / AdjD
  adjt: "J",    // AdjT / Tempo
};

/* ---------- Model knobs ---------- */

const LEAGUE_AVG_ADJ   = 105.0;   // baseline offensive rating
const LGE_TEMPO       = 69.5;    // baseline tempo
const HOME_EDGE_POINTS = 3.5;    // home-court advantage in points

// slight tempo / total stretch (can tune later)
const PACE_STRETCH  = 0.25;     // bigger effect for fast/slow teams
const TOTAL_STRETCH = 0.10;

// TeamRankings feature weights (offense-side tweaks)
const W_EFG = 0.55;
const W_TOV = 0.30;
const W_REB = 0.25;

// TeamRankings sheet columns (0-based indexes)
const TEAM_COL_INDEX = 1; // B
const VAL25_INDEX    = 2; // C (2025)
const VAL24_INDEX    = 7; // H (2024)

// PPP clamp so nothing explodes (you can widen these later if needed)
const MIN_PPP = 0.75;
const MAX_PPP = 1.40;

const BASE_PPP = LEAGUE_AVG_ADJ / 100.0;

/* ---------- DOM ---------- */

const awayInput  = document.getElementById("awayTeamInput");
const homeInput  = document.getElementById("homeTeamInput");
const teamList   = document.getElementById("teamList");

const spreadInput = document.getElementById("bookSpread");
const totalInput  = document.getElementById("bookTotal");

const runBtn   = document.getElementById("runBtn");
const saveBtn  = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

const resultsSec = document.getElementById("results");
const resultBody = document.getElementById("resultBody");

const savedWrap   = document.getElementById("savedTableWrap");
const downloadBtn = document.getElementById("downloadBtn");
const undoBtn     = document.getElementById("undoBtn");
const clearBtn    = document.getElementById("clearBtn");

/* ---------- State ---------- */

let KP = null;            // [{Team,AdjO,AdjD,AdjT}]
let TR = null;            // TeamRankings merged
let LG = null;            // league averages for TR

let savedGames = [];

// TR name -> canonical KenPom name
let TR2CANON = new Map();
// set of canonical names from mapping sheet
let CANON_SET = new Set();

/* =========================================================
   CSV parsing & helpers
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
  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`Fetch failed: ${url}`);
  return parseCSV(await r.text());
}

const teamKey = s => String(s||"").trim().toLowerCase();
const fmt1    = x => Number(x).toFixed(1);

function percentify(v){
  if(v==null||v==="") return NaN;
  const n=Number(String(v).trim());
  return Number.isFinite(n) ? (n>1?n/100:n) : NaN;
}

function coerceNum(x){
  const s=String(x??"").replace(/[^0-9.+-]/g,"");
  const n=parseFloat(s);
  return Number.isFinite(n)?n:NaN;
}

function colLetterToIdx(letter){
  const s=String(letter).trim().toUpperCase();
  let idx=0;
  for(let i=0;i<s.length;i++){
    idx = idx*26 + (s.charCodeAt(i)-64);
  }
  return idx-1;
}

function badge(text,color){
  const cls = color==="green" ? "green" :
              color==="red"   ? "red"   : "gray";
  return `<span class="badge ${cls}">${text}</span>`;
}

function populateTeamDatalist(teams){
  if(!teamList) return;
  teamList.innerHTML = teams.map(t=>`<option value="${t}"></option>`).join("");
}

function resolveTeam(inputValue, teams){
  if(!inputValue) return "";
  const v = inputValue.trim().toLowerCase();

  let hit = teams.find(t=>t.toLowerCase()===v);
  if(hit) return hit;

  const starts = teams.filter(t=>t.toLowerCase().startsWith(v));
  if(starts.length===1) return starts[0];

  const contains = teams.filter(t=>t.toLowerCase().includes(v));
  if(contains.length===1) return contains[0];

  return "";
}

/* =========================================================
   Team aliases: TR name -> KenPom canonical
   ========================================================= */

async function loadAliases(url){
  const rows = await fetchCSV(url);
  if(!rows || rows.length<2) return;

  const hdr = rows[0].map(x=>String(x||"").toLowerCase().trim());
  const iCanon = hdr.indexOf("kenpom");
  const iTR    = hdr.indexOf("teamranking");

  for(let r=1;r<rows.length;r++){
    const canon = (rows[r][iCanon]||"").trim();
    const tr    = (rows[r][iTR]||"").trim();
    if(!canon) continue;
    CANON_SET.add(canon);
    if(tr) TR2CANON.set(teamKey(tr), canon);
  }
}

/* =========================================================
   KenPom loader (fixed letters)
   ========================================================= */

function buildKP_fixedLetters(rows){
  const hRow    = Math.max(0,(KENPOM_COLS.headerRow||2)-1);
  const startIx = hRow+1;

  const iTeam = colLetterToIdx(KENPOM_COLS.team);
  const iAdjO = colLetterToIdx(KENPOM_COLS.adjo);
  const iAdjD = colLetterToIdx(KENPOM_COLS.adjd);
  const iAdjT = colLetterToIdx(KENPOM_COLS.adjt);
  const maxIx = Math.max(iTeam,iAdjO,iAdjD,iAdjT);

  const out=[];
  for(let r=startIx;r<rows.length;r++){
    const row=rows[r]; if(!row || row.length<=maxIx) continue;
    if(row[0] && /rk/i.test(String(row[0]))) continue;

    const rawTeam = row[iTeam]?.trim();
    if(!rawTeam) continue;

    const Team = rawTeam;
    const AdjO = coerceNum(row[iAdjO]);
    const AdjD = coerceNum(row[iAdjD]);
    const AdjT = coerceNum(row[iAdjT]);

    if([AdjO,AdjD,AdjT].every(Number.isFinite)){
      out.push({Team,AdjO,AdjD,AdjT});
    }
  }
  if(!out.length) throw new Error("KenPom parsed 0 rows.");
  return out;
}

/* =========================================================
   TeamRankings loader (TR name -> canonical)
   ========================================================= */

function blend25_24(v25,v24,w25,w24){
  const a=Number(v25), b=Number(v24);
  const A=Number.isFinite(a)?a:NaN;
  const B=Number.isFinite(b)?b:NaN;
  if(Number.isNaN(A)&&Number.isNaN(B)) return NaN;
  if(Number.isNaN(A)) return w24*B;
  if(Number.isNaN(B)) return w25*A;
  return w25*A+w24*B;
}

async function loadTR(urls,w25,w24){
  const frames={};

  for(const [key,url] of Object.entries(urls)){
    if(!url) continue;
    const rows=await fetchCSV(url);
    const out=[];
    for(let r=0;r<rows.length;r++){
      const row=rows[r]; if(!row) continue;
      const rawTeam = row[TEAM_COL_INDEX];
      if(!rawTeam) continue;

      const canon = TR2CANON.get(teamKey(rawTeam)) || rawTeam;
      let v25=row[VAL25_INDEX], v24=row[VAL24_INDEX];

      if(["OFF_REB","DEF_REB","OFF_EFG"].includes(key)){
        v25 = percentify(v25);
        v24 = percentify(v24);
      }else{
        v25 = Number(v25);
        v24 = Number(v24);
      }

      out.push({
        Team: canon,
        [key]: blend25_24(v25,v24,w25,w24),
        _team_key: teamKey(canon)
      });
    }
    frames[key]=out;
  }

  const byKey = new Map();
  for(const key of Object.keys(frames)){
    for(const row of frames[key]){
      if(!byKey.has(row._team_key)){
        byKey.set(row._team_key,{_team_key:row._team_key,Team:row.Team});
      }
      byKey.get(row._team_key)[key] = row[key];
    }
  }

  const merged = Array.from(byKey.values());

  const mean = arr => {
    const xs = arr.map(Number).filter(Number.isFinite);
    return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : NaN;
  };

  const lg = {
    OFF_EFF: mean(merged.map(r=>r.OFF_EFF)) || 105,
    DEF_EFF: mean(merged.map(r=>r.DEF_EFF)) || 105,
    OFF_REB: mean(merged.map(r=>r.OFF_REB)) || 0.30,
    DEF_REB: mean(merged.map(r=>r.DEF_REB)) || 0.70,
    TOV_POSS:mean(merged.map(r=>r.TOV_POSS))|| 0.18,
    OFF_EFG: mean(merged.map(r=>r.OFF_EFG)) || 0.51,
  };

  return {merged, lg};
}

/* =========================================================
   safeKPFor — KenPom only (no TR fallback)
   ========================================================= */

function safeKPFor(name){
  const key = teamKey(name);

  let kp = KP.find(r=>teamKey(r.Team)===key);
  if(!kp){
    // try contains match as backup
    kp = KP.find(r=>teamKey(r.Team).includes(key));
  }
  if(!kp) throw new Error(`Missing KenPom row for "${name}".`);

  return {
    Team: kp.Team,
    AdjO: kp.AdjO,
    AdjD: kp.AdjD,
    AdjT: kp.AdjT
  };
}

/* =========================================================
   baseParams — KenPom-style core + TR tweaks
   ========================================================= */

function baseParams(away, home){
  const A = safeKPFor(away);  // away team KP
  const H = safeKPFor(home);  // home team KP

  // --- Possessions (tempo-based) ---
  let poss = 0.5 * (A.AdjT + H.AdjT);
  if(!Number.isFinite(poss) || poss <= 0) poss = LGE_TEMPO;

  // Slight tempo stretch: very fast/slow games get a bit more/less
  const tempo_dev = ((A.AdjT + H.AdjT)/2 - LGE_TEMPO) / LGE_TEMPO;
  poss *= (1 + PACE_STRETCH * tempo_dev);

  // --- Optional TR tweaks to offense/defense before EM ---
  let AdjO_A = A.AdjO, AdjD_A = A.AdjD;
  let AdjO_H = H.AdjO, AdjD_H = H.AdjD;

  if(TR && LG){
    const rA = TR.find(r=>r._team_key===teamKey(away)) ||
               TR.find(r=>teamKey(r.Team).includes(teamKey(away)));
    const rH = TR.find(r=>r._team_key===teamKey(home)) ||
               TR.find(r=>teamKey(r.Team).includes(teamKey(home)));

    const getv = (r,n,d) => (r && Number.isFinite(Number(r[n])) ? Number(r[n]) : d);

    if(rA){
      const OFF_EFF_A = getv(rA,"OFF_EFF",LG.OFF_EFF);
      const OFF_EFG_A = getv(rA,"OFF_EFG",LG.OFF_EFG);
      const OFF_REB_A = getv(rA,"OFF_REB",LG.OFF_REB);
      const TOV_A     = getv(rA,"TOV_POSS",LG.TOV_POSS);

      const off_mult_A =
        Math.pow(OFF_EFF_A / Math.max(LG.OFF_EFF,1e-6), 0.6) *
        Math.pow(OFF_EFG_A / Math.max(LG.OFF_EFG,1e-6), W_EFG) *
        Math.pow((1 - TOV_A) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
        Math.pow(OFF_REB_A / Math.max(LG.OFF_REB,1e-6), W_REB);

      const clamp = x => Math.max(0.85, Math.min(1.15, x));
      AdjO_A *= clamp(off_mult_A);
    }

    if(rH){
      const OFF_EFF_H = getv(rH,"OFF_EFF",LG.OFF_EFF);
      const OFF_EFG_H = getv(rH,"OFF_EFG",LG.OFF_EFG);
      const OFF_REB_H = getv(rH,"OFF_REB",LG.OFF_REB);
      const TOV_H     = getv(rH,"TOV_POSS",LG.TOV_POSS);

      const off_mult_H =
        Math.pow(OFF_EFF_H / Math.max(LG.OFF_EFF,1e-6), 0.6) *
        Math.pow(OFF_EFG_H / Math.max(LG.OFF_EFG,1e-6), W_EFG) *
        Math.pow((1 - TOV_H) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
        Math.pow(OFF_REB_H / Math.max(LG.OFF_REB,1e-6), W_REB);

      const clamp = x => Math.max(0.85, Math.min(1.15, x));
      AdjO_H *= clamp(off_mult_H);
    }
  }

  // --- EM for each team (per 100) ---
  const emA = AdjO_A - AdjD_A;
  const emH = AdjO_H - AdjD_H;

  // margin per game from EM gap + HCA
  const emGap  = emH - emA;                       // positive if home stronger
  const margin = (emGap * (poss / 100)) + HOME_EDGE_POINTS;

  // --- Total points from offensive ratings ---
  const avgOff = 0.5 * (AdjO_A + AdjO_H);
  let totalPts = avgOff * (poss / 100);

  // light stretch for high/low scoring matchups
  const stretch = 1 + TOTAL_STRETCH * ((avgOff - LEAGUE_AVG_ADJ) / LEAGUE_AVG_ADJ);
  totalPts *= stretch;

  if(!Number.isFinite(totalPts) || totalPts <= 0){
    totalPts = LEAGUE_AVG_ADJ * (poss / 100);
  }

  // --- Split into team scores: H & A ---
  let ptsHome = (totalPts + margin) / 2;
  let ptsAway = (totalPts - margin) / 2;

  // keep scores reasonable (no < 40 blowouts in this first pass)
  if(ptsAway < 40){
    const diff = 40 - ptsAway;
    ptsAway = 40;
    ptsHome += diff;
  }
  if(ptsHome < 40){
    const diff = 40 - ptsHome;
    ptsHome = 40;
    ptsAway += diff;
  }

  // PPP for the rest of the app
  let pppH = ptsHome / poss;
  let pppA = ptsAway / poss;

  pppH = Math.min(MAX_PPP, Math.max(MIN_PPP, pppH));
  pppA = Math.min(MAX_PPP, Math.max(MIN_PPP, pppA));

  return { poss, pppA, pppH };
}

/* =========================================================
   Saved games table
   ========================================================= */

function loadSaved(){
  try{
    savedGames = JSON.parse(localStorage.getItem("cbb_saved") || "[]");
  }catch{ savedGames=[]; }
  renderSaved();
}

function persistSaved(){
  localStorage.setItem("cbb_saved", JSON.stringify(savedGames));
  renderSaved();
}

function renderSaved(){
  if(!savedGames.length){
    savedWrap.innerHTML = `<p class="muted">No games saved yet.</p>`;
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
  const body = savedGames.map(r=>
    `<tr>${cols.map(c=>`<td>${r[c] ?? ""}</td>`).join("")}</tr>`
  ).join("");

  savedWrap.innerHTML = `<div class="tableWrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}

function toCSV(arr){
  if(!arr.length) return "";
  const cols = Object.keys(arr[0]);
  const esc = v => `"${String(v??"").replaceAll('"','""')}"`;
  const header = cols.map(esc).join(",") + "\n";
  const rows = arr.map(r=> cols.map(c=>esc(r[c])).join(",")).join("\n");
  return header + rows;
}

/* =========================================================
   Init + Run
   ========================================================= */

async function init(){
  try{
    statusEl.textContent = "Loading team aliases…";
    await loadAliases(TEAM_LIST_URL);

    statusEl.textContent = "Loading KenPom…";
    const kpRows = await fetchCSV(KENPOM_URL);
    KP = buildKP_fixedLetters(kpRows);

    statusEl.textContent = "Loading TeamRankings…";
    const {merged, lg} = await loadTR(TR_URLS, 0.5, 0.5); // 50/50 blend 2025 + 2024
    TR = merged;
    LG = lg;

    // team list: all KenPom names + mapped names
    const kpTeams = KP.map(r=>r.Team);
    const trTeams = TR.map(r=>r.Team);
    const allTeams = Array.from(new Set([...kpTeams, ...trTeams, ...Array.from(CANON_SET)]))
      .sort((a,b)=>a.localeCompare(b));

    populateTeamDatalist(allTeams);

    if(awayInput) awayInput.value = allTeams[0] || "";
    if(homeInput) homeInput.value = allTeams[1] || "";

    runBtn.disabled = false;
    saveBtn.disabled = true;
    statusEl.textContent = "Ready.";
  }catch(e){
    console.error(e);
    statusEl.textContent = "Data load error — see console.";
    alert("Data load error:\n" + e.message);
  }

  loadSaved();
}

runBtn.addEventListener("click", () => {
  try{
    const kpTeams = KP.map(r=>r.Team);

    const away = resolveTeam(awayInput.value, kpTeams);
    const home = resolveTeam(homeInput.value, kpTeams);

    if(!away || !home){
      alert("Pick valid teams (type to search, then tap a suggestion).");
      return;
    }
    if(teamKey(away) === teamKey(home)){
      alert("Please choose two different teams.");
      return;
    }

    const hasBookSpread = (spreadInput.value ?? "").trim() !== "";
    const hasBookTotal  = (totalInput.value ?? "").trim() !== "";

    const bookSpread = hasBookSpread ? Number(spreadInput.value) : null;
    const bookTotal  = hasBookTotal  ? Number(totalInput.value)  : null;

    const { poss, pppA, pppH } = baseParams(away, home);

    const detA = pppA * poss;
    const detH = pppH * poss + 0; // HCA already in margin

    const modelTotal      = detA + detH;
    const modelSpreadHome = detH - detA;

    const winner = detH >= detA ? home : away;
    const line   = detH >= detA
      ? `${home} ${Math.round(detH)} – ${away} ${Math.round(detA)}`
      : `${away} ${Math.round(detA)} – ${home} ${Math.round(detH)}`;

    let edgesHTML = "";
    let savePayload = {};

    if(hasBookSpread || hasBookTotal){
      let totalEdge = null;
      let spreadEdge = null;
      let totalPlay = "NO BET";
      let spreadPlay = "NO BET";

      if(hasBookTotal && Number.isFinite(bookTotal)){
        totalEdge = modelTotal - bookTotal;
        if(totalEdge >= 2.0)      totalPlay = `OVER ${bookTotal.toFixed(1)}`;
        else if(totalEdge <= -2.0) totalPlay = `UNDER ${bookTotal.toFixed(1)}`;
        else                      totalPlay = "NO BET";
      }

      if(hasBookSpread && Number.isFinite(bookSpread)){
        // book spread: home negative if favored
        const bookHomeEdge = -bookSpread;
        spreadEdge = modelSpreadHome - bookHomeEdge;

        if(spreadEdge >= 1.5)       spreadPlay = `${home} ${bookSpread.toFixed(1)}`;
        else if(spreadEdge <= -1.5) spreadPlay = `${away} ${(-bookSpread).toFixed(1)}`;
        else                        spreadPlay = "NO BET";
      }

      const mag = Math.max(Math.abs(spreadEdge ?? 0), Math.abs(totalEdge ?? 0));
      const conf = Math.round(1 + 9 * Math.min(Math.abs(mag)/8.0, 1)); // up to ~8-pt edge

      edgesHTML = `
        ${hasBookTotal  ? `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)} &nbsp; <strong>Book:</strong> ${bookTotal.toFixed(1)}</p>` : `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>`}
        ${hasBookSpread ? `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)} &nbsp; <strong>Book (Home):</strong> ${(bookSpread>=0?"+":"")+bookSpread.toFixed(1)}</p>` : `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>`}
        ${hasBookTotal  ? `<p><strong>Totals Play:</strong> ${totalPlay}</p>` : ``}
        ${hasBookSpread ? `<p><strong>Spread Play:</strong> ${spreadPlay}</p>` : ``}
        <div><strong>Prediction Confidence:</strong> ${badge((hasBookTotal||hasBookSpread)?`${conf} / 10`:"Model-only","gray")}</div>
      `;

      savePayload = {
        "Book Spread (Home)": hasBookSpread ? (bookSpread>=0?"+":"")+bookSpread.toFixed(1) : "",
        "Book Total": hasBookTotal ? bookTotal.toFixed(1) : "",
        "Total Edge": hasBookTotal ? fmt1(totalEdge) : "",
        "Spread Edge": hasBookSpread ? fmt1(spreadEdge) : "",
        "Totals Play": hasBookTotal ? totalPlay : "",
        "Spread Play": hasBookSpread ? spreadPlay : "",
        "Confidence (1-10)": (hasBookTotal||hasBookSpread)? conf : ""
      };
    } else {
      edgesHTML = `
        <p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>
        <p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>
        <div><strong>Prediction Confidence:</strong> ${badge("Model-only","gray")}</div>
      `;
    }

    resultsSec.classList.remove("hidden");
    resultBody.innerHTML = `
      <p><strong>Prediction (model):</strong> ${line}</p>
      <p><strong>Projected Winner:</strong> ${winner}</p>
      ${edgesHTML}
    `;

    saveBtn.disabled = false;
    saveBtn.onclick = () => {
      savedGames.push({
        Away: away,
        Home: home,
        "Book Spread (Home)": savePayload["Book Spread (Home)"] ?? "",
        "Book Total":          savePayload["Book Total"] ?? "",
        "Model Away Pts": fmt1(detA),
        "Model Home Pts": fmt1(detH),
        "Model Total":    fmt1(modelTotal),
        "Model Spread (Home)": fmt1(modelSpreadHome),
        "Total Edge": savePayload["Total Edge"] ?? "",
        "Spread Edge": savePayload["Spread Edge"] ?? "",
        "Totals Play": savePayload["Totals Play"] ?? "",
        "Spread Play": savePayload["Spread Play"] ?? "",
        "Confidence (1-10)": savePayload["Confidence (1-10)"] ?? ""
      });
      persistSaved();
    };

  }catch(e){
    console.error(e);
    alert("Run error:\n" + e.message);
  }
});

downloadBtn.addEventListener("click",()=>{
  if(!savedGames.length) return;
  const csv = toCSV(savedGames);
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cbb_saved_${new Date().toISOString().slice(0,16).replace("T","_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

undoBtn.addEventListener("click",()=>{
  if(!savedGames.length) return;
  savedGames.pop();
  persistSaved();
});

clearBtn.addEventListener("click",()=>{
  if(!savedGames.length) return;
  if(confirm("Clear all saved games?")){
    savedGames = [];
    persistSaved();
  }
});

/* kick it off */
init();
