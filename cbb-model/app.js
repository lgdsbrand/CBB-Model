/* =========================================================
   CBB Projection Model — KenPom (fixed letters) + TeamRankings
   app.js (client-side)
   ========================================================= */

/* ---------- TeamRankings URLs (yours) ---------- */
const TR_URLS = {
  OFF_EFF:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv",
  DEF_EFF:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv",
  OFF_REB:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv",
  DEF_REB:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv",
  TOV_POSS:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv",
  OFF_EFG:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv",
};

/* ---------- KenPom publish-to-web CSV ---------- */
const KENPOM_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv";

/* ---------- KenPom fixed column letters & header row ---------- */
// Headers on row 2; data begins row 3
const KENPOM_COLS = {
  headerRow: 2, // 1-based
  team:  "B",   // Team
  adjo:  "F",   // ORtg / AdjO
  adjd:  "H",   // DRtg / AdjD
  adjt:  "J",   // AdjT / Tempo
};

/* ---------- Model Params ---------- */
const LEAGUE_AVG_ADJ = 105.0;   // per 100 poss

// ===== Separation & variance knobs =====
const damp             = 0.9;   // 0.8–1.0; higher => TR style impacts more
const HOME_EDGE_POINTS = 3.8;   // was 3.0

// Monte Carlo variance
const PPP_SD  = 0.05;  // was 0.04
const POSS_SD = 5.0;   // was 3.5

// Tempo & totals stretch
const LGE_TEMPO     = 69.5;
const PACE_STRETCH  = 0.35; // 0.25–0.45 widens totals via tempo
const TOTAL_STRETCH = 0.08; // 0.05–0.12 widens totals via O/D strength

// Strength-gap booster
const BOOSTER_K = 0.0055;   // 0.004–0.006

// TR feature weights (slightly stronger)
const W_EFG = 0.50;
const W_TOV = 0.30;
const W_REB = 0.25;

/* ---------- TeamRankings sheet column mapping (0-based) ---------- */
const TEAM_COL_INDEX = 1; // B
const VAL25_INDEX    = 2; // C
const VAL24_INDEX    = 7; // H

/* ---------- DOM ---------- */
const awaySel = document.getElementById("awayTeam");
const homeSel = document.getElementById("homeTeam");
const spreadInput = document.getElementById("bookSpread");
const totalInput = document.getElementById("bookTotal");
const runBtn = document.getElementById("runBtn");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const resultsSec = document.getElementById("results");
const resultBody = document.getElementById("resultBody");
const savedWrap = document.getElementById("savedTableWrap");
const downloadBtn = document.getElementById("downloadBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");

/* ---------- App state ---------- */
let KP = null; // [{Team,AdjO,AdjD,AdjT}]
let TR = null, LG = null;
let savedGames = [];

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
const teamKey = t=>String(t||"").toLowerCase().trim();
const fmt1 = x=>Number(x).toFixed(1);
const badge=(t,k)=>`<span class="badge ${k==="green"?"green":k==="red"?"red":"gray"}">${t}</span>`;
function confFromEdge(edge,hi=6){ const e=Math.min(Math.abs(edge)/hi,1); return Math.round(1+9*e); }
function percentify(v){ if(v==null||v==="") return NaN; const n=Number(String(v).trim()); return Number.isFinite(n)?(n>1?n/100:n):NaN; }
function coerceNum(x){ const s=String(x??"").replace(/[^0-9.+-]/g,"").replace(/^([+-])$/,""); const n=parseFloat(s); return Number.isFinite(n)?n:NaN; }
function colLetterToIdx(letter){
  const s=String(letter).trim().toUpperCase();
  let idx=0; for(let i=0;i<s.length;i++){ idx = idx*26 + (s.charCodeAt(i)-64); } // 'A'->1
  return idx-1; // zero-based
}

/* =========================================================
   KenPom loader (fixed letters only)
   ========================================================= */
function buildKP_fixedLetters(rows){
  if(!rows || !rows.length) throw new Error("KenPom CSV is empty.");
  const hRow = Math.max(0, (KENPOM_COLS.headerRow||2)-1);
  const startIdx = hRow + 1;

  const iTeam = colLetterToIdx(KENPOM_COLS.team); // B
  const iAdjO = colLetterToIdx(KENPOM_COLS.adjo); // F
  const iAdjD = colLetterToIdx(KENPOM_COLS.adjd); // H
  const iAdjT = colLetterToIdx(KENPOM_COLS.adjt); // J
  const maxIdx = Math.max(iTeam, iAdjO, iAdjD, iAdjT);

  if([iTeam,iAdjO,iAdjD,iAdjT].some(i=>i<0)) {
    throw new Error("KenPom column letters not set correctly.");
  }

  const out=[];
  for(let r=startIdx;r<rows.length;r++){
    const row=rows[r];
    if(!row || row.length<=maxIdx) continue;                 // row too short
    if(row[0] && /rk/i.test(String(row[0]))) continue;      // repeated header line
    const Team=row[iTeam]?.trim();
    if(!Team) continue;
    const AdjO=coerceNum(row[iAdjO]);
    const AdjD=coerceNum(row[iAdjD]);
    const AdjT=coerceNum(row[iAdjT]);
    if([AdjO,AdjD,AdjT].every(Number.isFinite)) out.push({Team,AdjO,AdjD,AdjT});
  }
  if(!out.length){
    console.error("KenPom rows sample around header:",
      rows.slice(Math.max(0,hRow-1), Math.min(rows.length,hRow+5)));
    throw new Error("KenPom parsed 0 valid rows with fixed letters.");
  }
  console.log(`[KP] Parsed ${out.length} teams. First row:`, out[0]);
  return out;
}

/* =========================================================
   TeamRankings loader/merge (6 urls, B/C/H)
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
      const row=rows[r];
      const team=row[TEAM_COL_INDEX];
      const v25=row[VAL25_INDEX], v24=row[VAL24_INDEX];
      if(!team) continue;
      let a=v25,b=v24;
      if(["OFF_REB","DEF_REB","OFF_EFG"].includes(key)){ a=percentify(a); b=percentify(b); }
      else { a=Number(a); b=Number(b); }
      out.push({Team:team, [key]:blend25_24(a,b,w25,w24), _team_key:teamKey(team)});
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
   Safe KenPom fetch + deterministic params with stretch/booster
   ========================================================= */
function safeKPFor(name){
  const kname = teamKey(name);
  const k = KP?.find(r => teamKey(r.Team)===kname) || KP?.find(r => teamKey(r.Team).includes(kname)) || null;
  const t = TR?.find(r => r._team_key===kname)     || TR?.find(r => teamKey(r.Team).includes(kname)) || null;

  const adjO = Number.isFinite(k?.AdjO) ? k.AdjO
              : Number.isFinite(t?.OFF_EFF) ? t.OFF_EFF
              : LEAGUE_AVG_ADJ;

  const adjD = Number.isFinite(k?.AdjD) ? k.AdjD
              : Number.isFinite(t?.DEF_EFF) ? t.DEF_EFF
              : LEAGUE_AVG_ADJ;

  const adjT = Number.isFinite(k?.AdjT) ? k.AdjT : 69.5;

  if(!Number.isFinite(k?.AdjO) || !Number.isFinite(k?.AdjD) || !Number.isFinite(k?.AdjT)){
    console.warn(`[safeKPFor] Fallback used for "${name}"`, { haveKP: !!k, haveTR: !!t, adjO, adjD, adjT });
  }
  return { Team: k?.Team || t?.Team || name, AdjO: adjO, AdjD: adjD, AdjT: adjT };
}

// === baseParams with pace/total stretch + strength booster + TR style ===
function baseParams(away, home) {
  const A = safeKPFor(away);
  const H = safeKPFor(home);

  // --- Possessions from tempo + pace stretch (fast vs fast up, slow vs slow down)
  let poss = 0.5 * (A.AdjT + H.AdjT);
  const tempo_dev = ((A.AdjT + H.AdjT) / 2 - LGE_TEMPO) / LGE_TEMPO;
  poss *= 1 + PACE_STRETCH * tempo_dev;

  // --- KenPom-anchored PPP
  const BASE_PPP = LEAGUE_AVG_ADJ / 100.0;
  let pppA = BASE_PPP * (A.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / H.AdjD);
  let pppH = BASE_PPP * (H.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / A.AdjD);

  // --- Totals stretch (strong O + weak D => a bit higher PPP for both)
  {
    const avgOff = (A.AdjO + H.AdjO) / 2;
    const avgDef = (A.AdjD + H.AdjD) / 2;
    const total_factor =
      Math.pow(Math.max(avgOff, 1e-6) / LEAGUE_AVG_ADJ, 0.5) *
      Math.pow(LEAGUE_AVG_ADJ / Math.max(avgDef, 1e-6), 0.5);
    const tStretch = 1 + TOTAL_STRETCH * (total_factor - 1);
    pppA *= tStretch;
    pppH *= tStretch;
  }

  // --- Strength gap booster (push favorites ahead more)
  {
    const emA = A.AdjO - A.AdjD;
    const emH = H.AdjO - H.AdjD;
    const gap = emH - emA; // + if home stronger
    pppH *= Math.exp(BOOSTER_K * gap);
    pppA *= Math.exp(-BOOSTER_K * gap);
  }

  // --- TeamRankings style multipliers (eFG, TOV, REB, eff anchors)
  if (TR && LG) {
    const rA = TR.find(r => r._team_key === teamKey(away)) ||
               TR.find(r => teamKey(r.Team).includes(teamKey(away)));
    const rH = TR.find(r => r._team_key === teamKey(home)) ||
               TR.find(r => teamKey(r.Team).includes(teamKey(home)));
    const getv = (r, n, d) => (r && Number.isFinite(Number(r[n])) ? Number(r[n]) : d);

    // Away offense vs Home defense
    const A_OFF_EFF = getv(rA, "OFF_EFF",  LG.OFF_EFF);
    const A_OFF_EFG = getv(rA, "OFF_EFG",  LG.OFF_EFG);
    const A_OFF_REB = getv(rA, "OFF_REB",  LG.OFF_REB);
    const A_TOV     = getv(rA, "TOV_POSS", LG.TOV_POSS);
    const H_DEF_EFF = getv(rH, "DEF_EFF",  LG.DEF_EFF);
    const H_DEF_REB = getv(rH, "DEF_REB",  LG.DEF_REB);

    // Home offense vs Away defense
    const H_OFF_EFF = getv(rH, "OFF_EFF",  LG.OFF_EFF);
    const H_OFF_EFG = getv(rH, "OFF_EFG",  LG.OFF_EFG);
    const H_OFF_REB = getv(rH, "OFF_REB",  LG.OFF_REB);
    const H_TOV     = getv(rH, "TOV_POSS", LG.TOV_POSS);
    const A_DEF_EFF = getv(rA, "DEF_EFF",  LG.DEF_EFF);
    const A_DEF_REB = getv(rA, "DEF_REB",  LG.DEF_REB);

    const eff_anchor_A  = Math.max(A_OFF_EFF, 1e-6) / Math.max(LG.OFF_EFF, 1e-6);
    const eff_anchor_Hd = Math.max(LG.DEF_EFF, 1e-6) / Math.max(H_DEF_EFF, 1e-6);
    const eff_anchor_Ho = Math.max(H_OFF_EFF, 1e-6) / Math.max(LG.OFF_EFF, 1e-6);
    const eff_anchor_Ad = Math.max(LG.DEF_EFF, 1e-6) / Math.max(A_DEF_EFF, 1e-6);

    let off_mult_A =
      Math.pow(eff_anchor_A, 0.5) *
      Math.pow(A_OFF_EFG / Math.max(LG.OFF_EFG, 1e-6), W_EFG) *
      Math.pow((1 - A_TOV) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
      Math.pow(A_OFF_REB / Math.max(LG.OFF_REB, 1e-6), W_REB);

    let def_mult_H =
      Math.pow(eff_anchor_Hd, 0.5) *
      Math.pow(H_DEF_REB / Math.max(LG.DEF_REB, 1e-6), W_REB);

    let off_mult_H =
      Math.pow(eff_anchor_Ho, 0.5) *
      Math.pow(H_OFF_EFG / Math.max(LG.OFF_EFG, 1e-6), W_EFG) *
      Math.pow((1 - H_TOV) / Math.max(1e-6, 1 - LG.TOV_POSS), W_TOV) *
      Math.pow(H_OFF_REB / Math.max(LG.OFF_REB, 1e-6), W_REB);

    let def_mult_A =
      Math.pow(eff_anchor_Ad, 0.5) *
      Math.pow(A_DEF_REB / Math.max(LG.DEF_REB, 1e-6), W_REB);

    pppA *= Math.pow(off_mult_A, damp) * Math.pow(def_mult_H, damp);
    pppH *= Math.pow(off_mult_H, damp) * Math.pow(def_mult_A, damp);
  }

  // Guards (never return NaN)
  const clean = (x, b) => (Number.isFinite(x) ? x : b);
  return {
    poss: clean(poss, 69.5),
    pppA: clean(pppA, LEAGUE_AVG_ADJ / 100.0),
    pppH: clean(pppH, LEAGUE_AVG_ADJ / 100.0),
  };
}

/* =========================================================
   Monte Carlo (Web Worker)
   ========================================================= */
const workerCode=`
self.onmessage=e=>{
  const {poss,pppA,pppH,homeEdge,nSims,possSD,pppSD}=e.data;
  function randn(m,s){const u=Math.random(),v=Math.random();const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);return m+s*z;}
  const A=new Float64Array(nSims), H=new Float64Array(nSims); let hw=0;
  for(let i=0;i<nSims;i++){
    // allow slower games while keeping a safe floor
    const p=Math.max(40,randn(poss,possSD));
    const a=randn(pppA,pppSD)*p;
    const h=randn(pppH,pppSD)*p+homeEdge;
    A[i]=a; H[i]=h; if(h>a) hw++;
  }
  const mean=a=>{let s=0;for(let i=0;i<a.length;i++) s+=a[i]; return s/a.length;}
  const q=(a,t)=>{const b=Array.from(a).sort((x,y)=>x-y); const idx=Math.max(0,Math.min(b.length-1,Math.floor(t*(b.length-1)))); return b[idx];}
  postMessage({mA:mean(A),mH:mean(H),qA25:q(A,0.25),qA75:q(A,0.75),qH25:q(H,0.25),qH75:q(H,0.75),homeWinPct:hw/nSims});
}`;
const workerURL=URL.createObjectURL(new Blob([workerCode],{type:"text/javascript"}));

/* =========================================================
   Saved games table
   ========================================================= */
function loadSaved(){ try{savedGames=JSON.parse(localStorage.getItem("cbb_saved")||"[]");}catch{savedGames=[];} renderSaved(); }
function persistSaved(){ localStorage.setItem("cbb_saved",JSON.stringify(savedGames)); renderSaved(); }
function renderSaved(){
  if(!savedGames.length){ savedWrap.innerHTML=`<p class="muted">No games saved yet.</p>`; return; }
  const cols=["Away","Home","Book Spread (Home)","Book Total","Model Away Pts","Model Home Pts","Model Total","Model Spread (Home)","Total Edge","Spread Edge","Totals Play","Spread Play","Home Win %","Away Win %","Confidence (1-10)"];
  const head=`<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  const body=savedGames.map(r=>`<tr>${cols.map(c=>`<td>${r[c]??""}</td>`).join("")}</tr>`).join("");
  savedWrap.innerHTML=`<div class="tableWrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}
function toCSV(arr){ if(!arr.length) return ""; const cols=Object.keys(arr[0]); const esc=v=>`"${String(v??"").replaceAll('"','""')}"`; return cols.map(esc).join(",")+"\n"+arr.map(r=>cols.map(c=>esc(r[c])).join(",")).join("\n"); }

/* =========================================================
   App init + run (book lines optional; model-only by default)
   ========================================================= */
async function init(){
  try{
    statusEl.textContent="Loading KenPom…";
    const kpRows=await fetchCSV(KENPOM_URL);
    KP=buildKP_fixedLetters(kpRows);

    statusEl.textContent="Loading TeamRankings…";
    const {merged,lg}=await loadTR(TR_URLS,0.5,0.5); // 50/50 blend 2025/2024
    TR=merged; LG=lg;

    const teams=KP.map(r=>r.Team).sort((a,b)=>a.localeCompare(b));
    awaySel.innerHTML=teams.map(t=>`<option>${t}</option>`).join("");
    homeSel.innerHTML=teams.map(t=>`<option>${t}</option>`).join("");
    awaySel.disabled=false; homeSel.disabled=false; runBtn.disabled=false; saveBtn.disabled=true;

    statusEl.textContent="Ready.";
  }catch(e){
    console.error(e); statusEl.textContent="Load error. See console."; alert("Data load error:\n"+e.message);
  }
  loadSaved();
}

runBtn.addEventListener("click",()=>{
  try{
    const away=awaySel.value, home=homeSel.value;
    if(!away||!home){ alert("Please select valid teams."); return; }
    if(teamKey(away)===teamKey(home)){ alert("Select two different teams."); return; }

    // Book lines OPTIONAL (comparison only)
    const hasBookSpread = (spreadInput.value ?? "").trim() !== "";
    const hasBookTotal  = (totalInput.value ?? "").trim()  !== "";
    const bookSpread = hasBookSpread ? Number(spreadInput.value) : null;
    const bookTotal  = hasBookTotal  ? Number(totalInput.value)  : null;

    // Pure model inputs (no book influence)
    const {poss,pppA,pppH}=baseParams(away,home);

    // Guards so the sim never NaNs
    const gPoss = Number.isFinite(poss) ? poss : 69.5;
    const gA    = Number.isFinite(pppA) ? pppA : (LEAGUE_AVG_ADJ/100.0);
    const gH    = Number.isFinite(pppH) ? pppH : (LEAGUE_AVG_ADJ/100.0);

    // Deterministic preview
    const detA = gA*gPoss;
    const detH = gH*gPoss + HOME_EDGE_POINTS;

    resultBody.innerHTML=`
      <p><strong>Prediction (model-only):</strong> ${detH>=detA?`${home} ${Math.round(detH)} – ${away} ${Math.round(detA)}`:`${away} ${Math.round(detA)} – ${home} ${Math.round(detH)}`}</p>
      <p><strong>Projected Winner:</strong> ${detH>=detA?home:away}</p>
      <p><span class="badge gray">Running 1000-sim Monte Carlo…</span></p>`;
    resultsSec.classList.remove("hidden"); saveBtn.disabled=true;

    const w=new Worker(workerURL);
    w.postMessage({poss:gPoss, pppA:gA, pppH:gH, homeEdge:HOME_EDGE_POINTS, nSims:1000, possSD:POSS_SD, pppSD:PPP_SD});
    w.onmessage=(ev)=>{
      const {mA,mH,qA25,qA75,qH25,qH75,homeWinPct}=ev.data;

      const modelTotal=mA+mH;
      const modelSpreadHome=mH-mA;

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
          const bookHomeEdge = -bookSpread;
          spreadEdge = modelSpreadHome - bookHomeEdge;
          if(spreadEdge>=1.5) spreadPlay=`${home} ${bookSpread.toFixed(1)}`;
          else if(spreadEdge<=-1.5) spreadPlay=`${away} ${(-bookSpread).toFixed(1)}`;
          else spreadPlay="NO BET";
        }
        const conf = (() => {
          const mag = Math.max(Math.abs(spreadEdge ?? 0), Math.abs(totalEdge ?? 0));
          return Math.round(1 + 9 * Math.min(Math.abs(mag)/6.0, 1));
        })();

        edgesHTML = `
          ${hasBookTotal ? `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)} &nbsp; <strong>Book Total:</strong> ${bookTotal.toFixed(1)}</p>` : `<p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}</p>`}
          ${hasBookSpread ? `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)} &nbsp; <strong>Book Spread (Home):</strong> ${(bookSpread>=0?"+":"")+bookSpread.toFixed(1)}</p>` : `<p><strong>Model Spread (Home):</strong> ${(modelSpreadHome>=0?"+":"")+fmt1(modelSpreadHome)}</p>`}
          ${hasBookTotal ? `<p><strong>Totals Play:</strong> ${totalPlay}</p>` : ``}
          ${hasBookSpread ? `<p><strong>Spread Play:</strong> ${spreadPlay}</p>` : ``}
          <p><strong>Likely Ranges (25–75%):</strong> ${away} ${fmt1(qA25)}–${fmt1(qA75)} | ${home} ${fmt1(qH25)}–${fmt1(qH75)}</p>
          <div><strong>Prediction Confidence:</strong> ${badge( (hasBookTotal||hasBookSpread)?`${conf} / 10`:"Model-only", (hasBookTotal||hasBookSpread)?(conf>=7?"green":conf>=4?"gray":"red"):"gray")}</div>
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
          <p><strong>Likely Ranges (25–75%):</strong> ${away} ${fmt1(qA25)}–${fmt1(qA75)} | ${home} ${fmt1(qH25)}–${fmt1(qH75)}</p>
          <div><strong>Prediction Confidence:</strong> ${badge("Model-only","gray")}</div>
        `;
      }

      const winner=mH>=mA?home:away;
      const line=mH>=mA?`${home} ${Math.round(mH)} – ${away} ${Math.round(mA)}`:`${away} ${Math.round(mA)} – ${home} ${Math.round(mH)}`;

      resultBody.innerHTML=`
        <p><strong>Prediction (model-only):</strong> ${line}</p>
        <p><strong>Projected Winner:</strong> ${winner}</p>
        <p><strong>Win Probability:</strong> ${home} ${(homeWinPct*100).toFixed(0)}%  –  ${away} ${((1-homeWinPct)*100).toFixed(0)}%</p>
        ${edgesHTML}
      `;

      saveBtn.disabled=false;
      saveBtn.onclick=()=>{
        savedGames.push({
          Away:away, Home:home,
          "Model Away Pts":fmt1(mA),
          "Model Home Pts":fmt1(mH),
          "Model Total":fmt1(modelTotal),
          "Model Spread (Home)":fmt1(modelSpreadHome),
          ...savePayload
        });
        persistSaved();
      };

      w.terminate();
    };
  }catch(e){ console.error(e); alert("Run error:\n" + e.message); }
});

downloadBtn.addEventListener("click",()=>{ if(!savedGames.length) return; const csv=toCSV(savedGames); const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`cbb_saved_${new Date().toISOString().slice(0,16).replace("T","_")}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); });
undoBtn.addEventListener("click",()=>{ if(!savedGames.length) return; savedGames.pop(); persistSaved(); });
clearBtn.addEventListener("click",()=>{ if(!savedGames.length) return; if(confirm("Clear all saved games?")){ savedGames=[]; persistSaved(); }});

/* Kick off */
init();
