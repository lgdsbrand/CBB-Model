/* =========================================================
   CBB Projection Model — Deterministic (no Monte Carlo)
   KenPom (fixed letters) + TeamRankings (6 CSVs)
   Team mapping CSV (TR → KenPom canonical names)
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

// KenPom publish-to-web
const KENPOM_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv";

// Team list (TR name → KenPom name). Headers: Kenpom, TeamRanking
const TEAM_LIST_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1061863749&single=true&output=csv";

/* ---------- KenPom fixed column letters & header row ---------- */
const KENPOM_COLS = {
  headerRow: 2, // header at row 2; data begins row 3
  team: "B",    // Team
  adjo: "F",    // ORtg / AdjO
  adjd: "H",    // DRtg / AdjD
  adjt: "J",    // AdjT / Tempo
};

/* ---------- Model knobs (separation-friendly) ---------- */
const LEAGUE_AVG_ADJ = 105.0;   // per 100 poss
const HOME_EDGE_POINTS = 4.0;
const LGE_TEMPO = 69.5;

// stretch & booster
const PACE_STRETCH  = 0.40;
const TOTAL_STRETCH = 0.10;
const BOOSTER_K     = 0.0060;

// AdjEM → spread correction & skew
const EM_TO_SPREAD_K   = 1.05;
const EM_SPREAD_WEIGHT = 1.00;

// PPP clamps
const MIN_PPP = 0.78;
const MAX_PPP = 1.38;

// TR feature weights
const W_EFG = 0.55;
const W_TOV = 0.30;
const W_REB = 0.25;

// Fallback strictness
const STRICT_KP = false;            // set true if you want to require KP for both teams
const ALLOW_TR_FALLBACK = true;
const ALLOW_LEAGUE_FALLBACK = false;

/* ---------- TeamRankings sheet column mapping (0-based indexes) ---------- */
const TEAM_COL_INDEX = 1; // column B
const VAL25_INDEX    = 2; // column C (2025)
const VAL24_INDEX    = 7; // column H (2024)

/* ---------- DOM ---------- */
const awayInput = document.getElementById("awayTeamInput");
const homeInput = document.getElementById("homeTeamInput");
const teamList  = document.getElementById("teamList");

const spreadInput = document.getElementById("bookSpread");
const totalInput  = document.getElementById("bookTotal");
const runBtn      = document.getElementById("runBtn");
const saveBtn     = document.getElementById("saveBtn");
const statusEl    = document.getElementById("status");
const resultsSec  = document.getElementById("results");
const resultBody  = document.getElementById("resultBody");
const savedWrap   = document.getElementById("savedTableWrap");
const downloadBtn = document.getElementById("downloadBtn");
const undoBtn     = document.getElementById("undoBtn");
const clearBtn    = document.getElementById("clearBtn");

/* ---------- State ---------- */
let KP = null;            // [{Team,AdjO,AdjD,AdjT}]
let TR = null, LG = null; // TR merged + league averages
let savedGames = [];

// Aliases: TR name -> Canonical (KenPom) name
let TR2CANON = new Map();
let CANON_SET = new Set();

/* =========================================================
   CSV fetch + parser
   ========================================================= */
function parseCSV(text){
  const rows=[]; let row=[]; let cur=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; }
      else cur+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ row.push(cur); cur=""; }
      else if(c==='\n'||c==='\r'){ if(cur!==""||row.length){ row.push(cur); rows.push(row); row=[]; cur=""; } }
      else cur+=c;
    }
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.length);
}
async function fetchCSV(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`Fetch failed: ${url}`);
  return parseCSV(await r.text());
}

/* =========================================================
   Helpers
   ========================================================= */
const teamKey = s => String(s||"").trim().toLowerCase();
const fmt1 = x => Number(x).toFixed(1);
function percentify(v){ if(v==null||v==="") return NaN; const n=Number(String(v).trim()); return Number.isFinite(n)?(n>1?n/100:n):NaN; }
function coerceNum(x){ const s=String(x??"").replace(/[^0-9.+-]/g,""); const n=parseFloat(s); return Number.isFinite(n)?n:NaN; }
function colLetterToIdx(letter){
  const s=String(letter).trim().toUpperCase();
  let idx=0; for(let i=0;i<s.length;i++){ idx=idx*26 + (s.charCodeAt(i)-64); }
  return idx-1;
}
function badge(t,k){ return `<span class="badge ${k==="green"?"green":k==="red"?"red":"gray"}">${t}</span>`; }
function populateTeamDatalist(teams){ if(teamList) teamList.innerHTML = teams.map(t=>`<option value="${t}"></option>`).join(""); }
function resolveTeam(inputValue, teams){
  if(!inputValue) return "";
  const v=inputValue.trim().toLowerCase();
  let hit=teams.find(t=>t.toLowerCase()===v); if(hit) return hit;
  const starts=teams.filter(t=>t.toLowerCase().startsWith(v)); if(starts.length===1) return starts[0];
  const contains=teams.filter(t=>t.toLowerCase().includes(v)); if(contains.length===1) return contains[0];
  return "";
}

/* =========================================================
   Load team aliases (TR -> KP canonical)
   Sheet headers: Kenpom, TeamRanking
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
  const hRow = Math.max(0,(KENPOM_COLS.headerRow||2)-1);
  const startIdx = hRow+1;

  const iTeam = colLetterToIdx(KENPOM_COLS.team);
  const iAdjO = colLetterToIdx(KENPOM_COLS.adjo);
  const iAdjD = colLetterToIdx(KENPOM_COLS.adjd);
  const iAdjT = colLetterToIdx(KENPOM_COLS.adjt);
  const maxIdx = Math.max(iTeam,iAdjO,iAdjD,iAdjT);

  const out=[];
  for(let r=startIdx;r<rows.length;r++){
    const row=rows[r]; if(!row || row.length<=maxIdx) continue;
    if(row[0] && /rk/i.test(String(row[0]))) continue;
    const rawTeam = row[iTeam]?.trim(); if(!rawTeam) continue;
    const Team = rawTeam; // KenPom name is our canonical
    const AdjO=coerceNum(row[iAdjO]), AdjD=coerceNum(row[iAdjD]), AdjT=coerceNum(row[iAdjT]);
    if([AdjO,AdjD,AdjT].every(Number.isFinite)) out.push({Team,AdjO,AdjD,AdjT});
  }
  if(!out.length) throw new Error("KenPom parsed 0 rows.");
  return out;
}

/* =========================================================
   TeamRankings loader: map TR team -> canonical (KenPom)
   blend 2025/2024 from columns C/H
   ========================================================= */
function blend25_24(v25,v24,w25,w24){
  const a=Number(v25), b=Number(v24);
  const A=Number.isFinite(a)?a:NaN, B=Number.isFinite(b)?b:NaN;
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
      const canon = TR2CANON.get(teamKey(rawTeam)) || rawTeam; // map to KP name if present
      let v25=row[VAL25_INDEX], v24=row[VAL24_INDEX];
      if(["OFF_REB","DEF_REB","OFF_EFG"].includes(key)){ v25=percentify(v25); v24=percentify(v24); }
      else { v25=Number(v25); v24=Number(v24); }
      out.push({Team:canon, [key]:blend25_24(v25,v24,w25,w24), _team_key:teamKey(canon)});
    }
    frames[key]=out;
  }
  const byKey=new Map();
  for(const key of Object.keys(frames)){
    for(const row of frames[key]){
      if(!byKey.has(row._team_key)) byKey.set(row._team_key,{_team_key:row._team_key,Team:row.Team});
      byKey.get(row._team_key)[key]=row[key];
    }
  }
  const merged=Array.from(byKey.values());
  const mean=arr=>{const xs=arr.map(Number).filter(Number.isFinite); return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;};
  const lg={
    OFF_EFF:mean(merged.map(r=>r.OFF_EFF))||105,
    DEF_EFF:mean(merged.map(r=>r.DEF_EFF))||105,
    OFF_REB:mean(merged.map(r=>r.OFF_REB))||0.30,
    DEF_REB:mean(merged.map(r=>r.DEF_REB))||0.70,
    TOV_POSS:mean(merged.map(r=>r.TOV_POSS))||0.18,
    OFF_EFG:mean(merged.map(r=>r.OFF_EFG))||0.51,
  };
  return {merged, lg};
}

/* =========================================================
   safeKPFor (with fallback switches)
   ========================================================= */
function safeKPFor(name){
  const key = teamKey(name);
  const kp = KP?.find(r => teamKey(r.Team)===key) || KP?.find(r => teamKey(r.Team).includes(key)) || null;
  const tr = TR?.find(r => r._team_key===key)     || TR?.find(r => teamKey(r.Team).includes(key)) || null;

  let AdjO=NaN, AdjD=NaN, AdjT=NaN, srcO="none", srcD="none", srcT="none";

  if (kp && Number.isFinite(kp.AdjO)) { AdjO=kp.AdjO; srcO="KP"; }
  else if (ALLOW_TR_FALLBACK && tr && Number.isFinite(tr.OFF_EFF)) { AdjO=tr.OFF_EFF; srcO="TR"; }
  else if (ALLOW_LEAGUE_FALLBACK) { AdjO=LEAGUE_AVG_ADJ; srcO="LGE"; }

  if (kp && Number.isFinite(kp.AdjD)) { AdjD=kp.AdjD; srcD="KP"; }
  else if (ALLOW_TR_FALLBACK && tr && Number.isFinite(tr.DEF_EFF)) { AdjD=tr.DEF_EFF; srcD="TR"; }
  else if (ALLOW_LEAGUE_FALLBACK) { AdjD=LEAGUE_AVG_ADJ; srcD="LGE"; }

  if (kp && Number.isFinite(kp.AdjT)) { AdjT=kp.AdjT; srcT="KP"; }
  else if (ALLOW_LEAGUE_FALLBACK) { AdjT=LGE_TEMPO; srcT="LGE"; }

  const miss = !(srcO==="KP" && srcD==="KP" && srcT==="KP");
  if (STRICT_KP && miss) {
    throw new Error(`Missing KenPom for "${name}" (O:${srcO}, D:${srcD}, T:${srcT}).`);
  }
  if (![AdjO,AdjD,AdjT].every(Number.isFinite)) {
    throw new Error(`Insufficient data for "${name}" (O:${srcO}, D:${srcD}, T:${srcT}).`);
  }
  return { Team: kp?.Team || tr?.Team || name, AdjO, AdjD, AdjT };
}

/* =========================================================
   Deterministic baseParams with separation knobs
   ========================================================= */
const BASE_PPP = LEAGUE_AVG_ADJ/100.0;

function baseParams(away,home){
  const A=safeKPFor(away), H=safeKPFor(home);

  // possessions from tempo + pace stretch
  let poss = 0.5*(A.AdjT+H.AdjT);
  const tempo_dev = ((A.AdjT+H.AdjT)/2 - LGE_TEMPO)/LGE_TEMPO;
  poss *= 1 + PACE_STRETCH * tempo_dev;

  // kenpom-anchored PPP
  let pppA = BASE_PPP * (A.AdjO/LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ/H.AdjD);
  let pppH = BASE_PPP * (H.AdjO/LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ/A.AdjD);

  // totals stretch
  const avgOff=(A.AdjO+H.AdjO)/2, avgDef=(A.AdjD+H.AdjD)/2;
  const total_factor =
    Math.pow(Math.max(avgOff,1e-6)/LEAGUE_AVG_ADJ,0.5) *
    Math.pow(LEAGUE_AVG_ADJ/Math.max(avgDef,1e-6),0.5);
  const tStretch = 1 + TOTAL_STRETCH*(total_factor-1);
  pppA*=tStretch; pppH*=tStretch;

  // strength-gap booster
  const emA=A.AdjO-A.AdjD, emH=H.AdjO-H.AdjD, gap=emH-emA;
  pppH*=Math.exp(BOOSTER_K*gap); pppA*=Math.exp(-BOOSTER_K*gap);

  // TR tweaks if available
  if(TR && LG){
    const rA = TR.find(r=>r._team_key===teamKey(away)) || TR.find(r=>teamKey(r.Team).includes(teamKey(away)));
    const rH = TR.find(r=>r._team_key===teamKey(home)) || TR.find(r=>teamKey(r.Team).includes(teamKey(home)));
    const getv=(r,n,d)=> (r && Number.isFinite(Number(r[n]))?Number(r[n]):d);

    const A_OFF_EFF=getv(rA,"OFF_EFF",LG.OFF_EFF);
    const A_OFF_EFG=getv(rA,"OFF_EFG",LG.OFF_EFG);
    const A_OFF_REB=getv(rA,"OFF_REB",LG.OFF_REB);
    const A_TOV    =getv(rA,"TOV_POSS",LG.TOV_POSS);
    const H_DEF_EFF=getv(rH,"DEF_EFF",LG.DEF_EFF);
    const H_DEF_REB=getv(rH,"DEF_REB",LG.DEF_REB);

    const H_OFF_EFF=getv(rH,"OFF_EFF",LG.OFF_EFF);
    const H_OFF_EFG=getv(rH,"OFF_EFG",LG.OFF_EFG);
    const H_OFF_REB=getv(rH,"OFF_REB",LG.OFF_REB);
    const H_TOV    =getv(rH,"TOV_POSS",LG.TOV_POSS);
    const A_DEF_EFF=getv(rA,"DEF_EFF",LG.DEF_EFF);
    const A_DEF_REB=getv(rA,"DEF_REB",LG.DEF_REB);

    const eff_anchor_A  = Math.max(A_OFF_EFF,1e-6)/Math.max(LG.OFF_EFF,1e-6);
    const eff_anchor_Hd = Math.max(LG.DEF_EFF,1e-6)/Math.max(H_DEF_EFF,1e-6);
    const eff_anchor_Ho = Math.max(H_OFF_EFF,1e-6)/Math.max(LG.OFF_EFF,1e-6);
    const eff_anchor_Ad = Math.max(LG.DEF_EFF,1e-6)/Math.max(A_DEF_EFF,1e-6);

    const off_mult_A = Math.pow(eff_anchor_A,0.75) *
      Math.pow(A_OFF_EFG/Math.max(LG.OFF_EFG,1e-6), W_EFG) *
      Math.pow((1-A_TOV)/Math.max(1e-6,1-LG.TOV_POSS), W_TOV) *
      Math.pow(A_OFF_REB/Math.max(LG.OFF_REB,1e-6), W_REB);

    const def_mult_H = Math.pow(eff_anchor_Hd,0.75) *
      Math.pow(H_DEF_REB/Math.max(LG.DEF_REB,1e-6), W_REB);

    const off_mult_H = Math.pow(eff_anchor_Ho,0.75) *
      Math.pow(H_OFF_EFG/Math.max(LG.OFF_EFG,1e-6), W_EFG) *
      Math.pow((1-H_TOV)/Math.max(1e-6,1-LG.TOV_POSS), W_TOV) *
      Math.pow(H_OFF_REB/Math.max(LG.OFF_REB,1e-6), W_REB);

    const def_mult_A = Math.pow(eff_anchor_Ad,0.75) *
      Math.pow(A_DEF_REB/Math.max(LG.DEF_REB,1e-6), W_REB);

    pppA*=off_mult_A*def_mult_H;
    pppH*=off_mult_H*def_mult_A;
  }

  function baseParams(away, home){
  const A = safeKPFor(away);
  const H = safeKPFor(home);

  // --- possessions from tempo + small pace stretch ---
  let poss = 0.5 * (A.AdjT + H.AdjT);
  const tempo_dev = ((A.AdjT + H.AdjT) / 2 - LGE_TEMPO) / LGE_TEMPO;
  poss *= 1 + PACE_STRETCH * tempo_dev;
  if (!Number.isFinite(poss) || poss <= 0) poss = LGE_TEMPO;

  // --- base PPP from KenPom only ---
  let pppA = BASE_PPP * (A.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / H.AdjD);
  let pppH = BASE_PPP * (H.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / A.AdjD);

  // --- TR tweaks if we have them (same logic as before) ---
  if (TR && LG) {
    const rA = TR.find(r => r._team_key === teamKey(away)) || TR.find(r => teamKey(r.Team).includes(teamKey(away)));
    const rH = TR.find(r => r._team_key === teamKey(home)) || TR.find(r => teamKey(r.Team).includes(teamKey(home)));

    const getv = (r, n, d) => (r && Number.isFinite(Number(r[n])) ? Number(r[n]) : d);

    const A_OFF_EFF = getv(rA, "OFF_EFF", LG.OFF_EFF);
    const A_OFF_EFG = getv(rA, "OFF_EFG", LG.OFF_EFG);
    const A_OFF_REB = getv(rA, "OFF_REB", LG.OFF_REB);
    const A_TOV     = getv(rA, "TOV_POSS", LG.TOV_POSS);

    const H_DEF_EFF = getv(rH, "DEF_EFF", LG.DEF_EFF);
    const H_DEF_REB = getv(rH, "DEF_REB", LG.DEF_REB);

    const H_OFF_EFF = getv(rH, "OFF_EFF", LG.OFF_EFF);
    const H_OFF_EFG = getv(rH, "OFF_EFG", LG.OFF_EFG);
    const H_OFF_REB = getv(rH, "OFF_REB", LG.OFF_REB);
    const H_TOV     = getv(rH, "TOV_POSS", LG.TOV_POSS);

    const A_DEF_EFF = getv(rA, "DEF_EFF", LG.DEF_EFF);
    const A_DEF_REB = getv(rA, "DEF_REB", LG.DEF_REB);

    const eff_anchor_A  = Math.max(A_OFF_EFF, 1e-6) / Math.max(LG.OFF_EFF, 1e-6);
    const eff_anchor_Hd = Math.max(LG.DEF_EFF, 1e-6) / Math.max(H_DEF_EFF, 1e-6);
    const eff_anchor_Ho = Math.max(H_OFF_EFF, 1e-6) / Math.max(LG.OFF_EFF, 1e-6);
    const eff_anchor_Ad = Math.max(LG.DEF_EFF, 1e-6) / Math.max(A_DEF_EFF, 1e-6);

    const off_mult_A =
      Math.pow(eff_anchor_A, 0.75) *
      Math.pow(A_OFF_EFG / Math.max(LG.OFF_EFG, 1e-6), W_EFG) *
      Math.pow((1 - A_TOV) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
      Math.pow(A_OFF_REB / Math.max(LG.OFF_REB, 1e-6), W_REB);

    const def_mult_H =
      Math.pow(eff_anchor_Hd, 0.75) *
      Math.pow(H_DEF_REB / Math.max(LG.DEF_REB, 1e-6), W_REB);

    const off_mult_H =
      Math.pow(eff_anchor_Ho, 0.75) *
      Math.pow(H_OFF_EFG / Math.max(LG.OFF_EFG, 1e-6), W_EFG) *
      Math.pow((1 - H_TOV) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
      Math.pow(H_OFF_REB / Math.max(LG.OFF_REB, 1e-6), W_REB);

    const def_mult_A =
      Math.pow(eff_anchor_Ad, 0.75) *
      Math.pow(A_DEF_REB / Math.max(LG.DEF_REB, 1e-6), W_REB);

    pppA *= off_mult_A * def_mult_H;
    pppH *= off_mult_H * def_mult_A;
  }

  // --- small AdjEM-based bias to create spread variance ---
  const emA = A.AdjO - A.AdjD;
  const emH = H.AdjO - H.AdjD;
  const emGap = (emH - emA) / 100;  // per-100-pos gap to per-pos

  pppH *= Math.exp(BOOSTER_K * emGap);
  pppA *= Math.exp(-BOOSTER_K * emGap);

  // --- clamp PPP so nothing gets insane ---
  pppA = Math.min(MAX_PPP, Math.max(MIN_PPP, pppA));
  pppH = Math.min(MAX_PPP, Math.max(MIN_PPP, pppH));

  return { poss, pppA, pppH };
}

/* =========================================================
   Saved games table
   ========================================================= */
function loadSaved(){ try{savedGames=JSON.parse(localStorage.getItem("cbb_saved")||"[]");}catch{savedGames=[];} renderSaved(); }
function persistSaved(){ localStorage.setItem("cbb_saved",JSON.stringify(savedGames)); renderSaved(); }
function renderSaved(){
  if(!savedGames.length){ savedWrap.innerHTML=`<p class="muted">No games saved yet.</p>`; return; }
  const cols=["Away","Home","Book Spread (Home)","Book Total","Model Away Pts","Model Home Pts","Model Total","Model Spread (Home)","Total Edge","Spread Edge","Totals Play","Spread Play","Confidence (1-10)"];
  const head=`<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  const body=savedGames.map(r=>`<tr>${cols.map(c=>`<td>${r[c]??""}</td>`).join("")}</tr>`).join("");
  savedWrap.innerHTML=`<div class="tableWrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}
function toCSV(arr){ if(!arr.length) return ""; const cols=Object.keys(arr[0]); const esc=v=>`"${String(v??"").replaceAll('"','""')}"`; return cols.map(esc).join(",")+"\n"+arr.map(r=>cols.map(c=>esc(r[c])).join(",")).join("\n"); }

/* =========================================================
   Init & Run
   ========================================================= */
async function init(){
  try{
    statusEl.textContent="Loading team aliases…";
    await loadAliases(TEAM_LIST_URL);

    statusEl.textContent="Loading KenPom…";
    const kpRows=await fetchCSV(KENPOM_URL);
    KP=buildKP_fixedLetters(kpRows);

    statusEl.textContent="Loading TeamRankings…";
    const {merged,lg}=await loadTR(TR_URLS,0.5,0.5); // 50/50 blend year-to-date & last year
    TR=merged; LG=lg;

    // canonical team list (KP names + mapped TR names + any explicit canon from sheet)
    const kpTeams = KP.map(r=>r.Team);
    const trTeams = TR.map(r=>r.Team);
    const all = Array.from(new Set([...kpTeams, ...trTeams, ...Array.from(CANON_SET)]))
      .sort((a,b)=>a.localeCompare(b));

    if(teamList && awayInput && homeInput){
      populateTeamDatalist(all);
      awayInput.value = all[0] || "";
      homeInput.value = all[1] || "";
    }

    runBtn.disabled=false; saveBtn.disabled=true;
    statusEl.textContent="Ready.";
  }catch(e){
    console.error(e); statusEl.textContent="Load error. See console."; alert("Data load error:\n"+e.message);
  }
  loadSaved();
}

runBtn.addEventListener("click",()=>{
  try{
    const teamsAll = KP.map(r=>r.Team); // KP is canonical source-of-truth
    const away = resolveTeam(awayInput?.value||"", teamsAll);
    const home = resolveTeam(homeInput?.value||"", teamsAll);
    if(!away || !home) { alert("Pick valid teams (type to search, then choose a suggestion)."); return; }
    if(teamKey(away)===teamKey(home)){ alert("Select two different teams."); return; }

    const hasBookSpread = (spreadInput.value ?? "").trim() !== "";
    const hasBookTotal  = (totalInput.value  ?? "").trim() !== "";
    const bookSpread = hasBookSpread ? Number(spreadInput.value) : null;
    const bookTotal  = hasBookTotal  ? Number(totalInput.value)  : null;

    const {poss,pppA,pppH}=baseParams(away,home);
    const detA = pppA*poss;
    const detH = pppH*poss + HOME_EDGE_POINTS;

    const winner = detH>=detA? home : away;
    const line   = detH>=detA
      ? `${home} ${Math.round(detH)} – ${away} ${Math.round(detA)}`
      : `${away} ${Math.round(detA)} – ${home} ${Math.round(detH)}`;

    const modelTotal = detA+detH;
    const modelSpreadHome = detH-detA;

    let edgesHTML="", savePayload={};
    if(hasBookSpread || hasBookTotal){
      let totalEdge=null, spreadEdge=null;
      let totalPlay="—", spreadPlay="—";

      if(hasBookTotal && Number.isFinite(bookTotal)){
        totalEdge = modelTotal - bookTotal;
        if(totalEdge>=2.0) totalPlay=`OVER ${bookTotal.toFixed(1)}`;
        else if(totalEdge<=-2.0) totalPlay=`UNDER ${bookTotal.toFixed(1)}`;
        else totalPlay="NO BET";
      }
      if(hasBookSpread && Number.isFinite(bookSpread)){
        const bookHomeEdge = -bookSpread; // book line uses home negative
        spreadEdge = modelSpreadHome - bookHomeEdge;
        if(spreadEdge>=1.5)       spreadPlay=`${home} ${bookSpread.toFixed(1)}`;
        else if(spreadEdge<=-1.5) spreadPlay=`${away} ${(-bookSpread).toFixed(1)}`;
        else                      spreadPlay="NO BET";
      }
      const conf = (() => {
        const mag=Math.max(Math.abs(spreadEdge??0), Math.abs(totalEdge??0));
        return Math.round(1 + 9 * Math.min(Math.abs(mag)/6.0, 1));
      })();

      edgesHTML = `
        ${hasBookTotal  ? `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)} &nbsp; <strong>Book:</strong> ${bookTotal.toFixed(1)}</p>` : `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>`}
        ${hasBookSpread ? `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)} &nbsp; <strong>Book (Home):</strong> ${(bookSpread>=0?"+":"")+bookSpread.toFixed(1)}</p>` : `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>`}
        ${hasBookTotal  ? `<p><strong>Totals Play:</strong> ${totalPlay}</p>`:``}
        ${hasBookSpread ? `<p><strong>Spread Play:</strong> ${spreadPlay}</p>`:``}
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
      <p><strong>Prediction (model-only):</strong> ${line}</p>
      <p><strong>Projected Winner:</strong> ${winner}</p>
      ${edgesHTML}
    `;

    saveBtn.disabled=false;
    saveBtn.onclick=()=>{
      savedGames.push({
        Away:away, Home:home,
        "Model Away Pts":fmt1(detA),
        "Model Home Pts":fmt1(detH),
        "Model Total":fmt1(modelTotal),
        "Model Spread (Home)":fmt1(modelSpreadHome),
        ...savePayload
      });
      persistSaved();
    };

  }catch(e){ console.error(e); alert("Run error:\n"+e.message); }
});

downloadBtn.addEventListener("click",()=>{ if(!savedGames.length) return; const csv=toCSV(savedGames); const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`cbb_saved_${new Date().toISOString().slice(0,16).replace("T","_")}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); });
undoBtn.addEventListener("click",()=>{ if(!savedGames.length) return; savedGames.pop(); persistSaved(); });
clearBtn.addEventListener("click",()=>{ if(!savedGames.length) return; if(confirm("Clear all saved games?")){ savedGames=[]; persistSaved(); }});

/* Kick off */
init();
