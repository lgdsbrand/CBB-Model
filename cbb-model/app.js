/* ======= CONFIG: paste your URLs (already set) ======= */
const TR_URLS = {
  OFF_EFF:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv",
  DEF_EFF:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv",
  OFF_REB:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv",
  DEF_REB:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv",
  TOV_POSS:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv",
  OFF_EFG:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv",
};

// KenPom: headers may be on row 2 (header=1), must include Team, AdjO, AdjD, AdjT (or ORtg/DRtg/Tempo aliases).
const KENPOM_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv";

/* ======= Model Params ======= */
const LEAGUE_AVG_ADJ = 105.0; // per 100 poss
const HOME_EDGE_POINTS = 3.0;
const TOTAL_EDGE_TH = 2.0;
const SPREAD_EDGE_TH = 1.5;
const N_SIMS = 1000;
const POSS_SD = 3.5; // tight for mobile
const PPP_SD = 0.04;

const W_EFG = 0.40;
const W_TOV = 0.25;
const W_REB = 0.20;

const TEAM_COL_INDEX = 1; // B (0-based)
const VAL25_INDEX = 2; // C
const VAL24_INDEX = 7; // H

/* ======= Elements ======= */
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

/* ======= App State ======= */
let KP = null; // [{Team, AdjO, AdjD, AdjT}]
let TR = null; // merged array by _team_key
let LG = null; // league averages
let savedGames = []; // persisted to localStorage

/* ======= CSV Parser (handles quotes/newlines) ======= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || c === "\r") {
        if (cur !== "" || row.length > 0) {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        }
      } else {
        cur += c;
      }
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0);
}

/* ======= Fetch helpers ======= */
async function fetchCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  const txt = await res.text();
  return parseCSV(txt);
}

/* ======= KenPom loader (robust) ======= */
function normalizeKPHeader(cols) {
  return cols.map((c) => String(c || "").trim());
}

// Accept space variants: "Adj T" -> "AdjT"
function aliasKPNames(cols) {
  const mapped = cols.slice().map((c) => c.replace(/\s+/g, ""));
  const iOR = mapped.indexOf("ORtg");
  if (iOR !== -1 && !mapped.includes("AdjO")) mapped[iOR] = "AdjO";
  const iDR = mapped.indexOf("DRtg");
  if (iDR !== -1 && !mapped.includes("AdjD")) mapped[iDR] = "AdjD";
  const iT = mapped.indexOf("Tempo");
  if (iT !== -1 && !mapped.includes("AdjT")) mapped[iT] = "AdjT";
  return mapped;
}

function indexOfCol(h, name) {
  return h.findIndex((x) => x === name);
}

// STRONG number coercion (strips everything except digits, sign, and dot)
function coerceNum(x) {
  const s = String(x ?? "")
    .replace(/[^0-9.+-]/g, "")
    .replace(/^([+-])$/, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function rowHasKP(cols) {
  const req = ["Team", "AdjO", "AdjD", "AdjT"];
  return req.every((r) => cols.includes(r));
}

function buildKP(rows) {
  // Try first row as header
  let header = normalizeKPHeader(rows[0] || []);
  header = aliasKPNames(header);
  let startIdx = 1;

  // If not found, try second row as header (header=1)
  if (!rowHasKP(header) && rows.length > 1) {
    let header2 = normalizeKPHeader(rows[1] || []);
    header2 = aliasKPNames(header2);
    if (rowHasKP(header2)) {
      header = header2;
      startIdx = 2;
    } else {
      // Try promote first data row as header
      const promote = normalizeKPHeader(rows[0] || []);
      const p2 = aliasKPNames(promote);
      if (rowHasKP(p2)) {
        header = p2;
        startIdx = 1;
      }
    }
  }

  if (!rowHasKP(header)) {
    throw new Error(
      `KenPom CSV missing required columns. Found: ${JSON.stringify(header)}`
    );
  }

  const iTeam = indexOfCol(header, "Team");
  const iAdjO = indexOfCol(header, "AdjO");
  const iAdjD = indexOfCol(header, "AdjD");
  const iAdjT = indexOfCol(header, "AdjT");

  const out = [];
  for (let r = startIdx; r < rows.length; r++) {
    const row = rows[r];
    const Team = row[iTeam];
    if (!Team) continue;
    const AdjO = coerceNum(row[iAdjO]);
    const AdjD = coerceNum(row[iAdjD]);
    const AdjT = coerceNum(row[iAdjT]);
    if (Number.isFinite(AdjO) && Number.isFinite(AdjD) && Number.isFinite(AdjT)) {
      out.push({ Team, AdjO, AdjD, AdjT });
    }
  }
  return out;
}

/* ======= TeamRankings loader (6 urls, B/C/H) ======= */
function percentify(v) {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return NaN;
  return n > 1 ? n / 100 : n;
}

function blend25_24(v25, v24, w25, w24) {
  const a = Number(v25), b = Number(v24);
  const A = Number.isFinite(a) ? a : NaN;
  const B = Number.isFinite(b) ? b : NaN;
  if (Number.isNaN(A) && Number.isNaN(B)) return NaN;
  if (Number.isNaN(A)) return w24 * B;
  if (Number.isNaN(B)) return w25 * A;
  return w25 * A + w24 * B;
}

function teamKey(t) {
  return String(t || "").toLowerCase().trim();
}

async function loadTR(urls, w25, w24) {
  const frames = {};
  for (const [key, url] of Object.entries(urls)) {
    if (!url) continue;
    const rows = await fetchCSV(url);
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const team = row[TEAM_COL_INDEX];
      const v25 = row[VAL25_INDEX];
      const v24 = row[VAL24_INDEX];
      if (!team) continue;
      let a = v25, b = v24;
      if (["OFF_REB", "DEF_REB", "OFF_EFG"].includes(key)) {
        a = percentify(a);
        b = percentify(b);
      } else {
        a = Number(a); b = Number(b);
      }
      const blended = blend25_24(a, b, w25, w24);
      out.push({ Team: team, [key]: blended, _team_key: teamKey(team) });
    }
    frames[key] = out;
  }

  // Merge by _team_key
  const byKey = new Map();
  for (const key of Object.keys(frames)) {
    for (const row of frames[key]) {
      if (!byKey.has(row._team_key)) {
        byKey.set(row._team_key, { _team_key: row._team_key, Team: row.Team });
      }
      byKey.get(row._team_key)[key] = row[key];
    }
  }

  const merged = Array.from(byKey.values());
  const numMean = (arr) => {
    const xs = arr.map(Number).filter((x) => Number.isFinite(x));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };

  const lg = {
    OFF_EFF: numMean(merged.map((r) => r.OFF_EFF)) || 105,
    DEF_EFF: numMean(merged.map((r) => r.DEF_EFF)) || 105,
    OFF_REB: numMean(merged.map((r) => r.OFF_REB)) || 0.30,
    DEF_REB: numMean(merged.map((r) => r.DEF_REB)) || 0.70,
    TOV_POSS: numMean(merged.map((r) => r.TOV_POSS)) || 0.18,
    OFF_EFG: numMean(merged.map((r) => r.OFF_EFG)) || 0.51,
  };

  return { merged, lg };
}

/* ======= Deterministic params + TR multipliers ======= */
function findKP(team) {
  const k = teamKey(team);
  return KP.find((r) => teamKey(r.Team) === k) ||
         KP.find((r) => teamKey(r.Team).includes(k));
}

function findTR(team) {
  const k = teamKey(team);
  return TR.find((r) => r._team_key === k) ||
         TR.find((r) => teamKey(r.Team).includes(k));
}

function baseParams(away, home) {
  const A = findKP(away);
  const H = findKP(home);
  if (!A || !H) throw new Error("Team not found in KenPom.");

  const poss = 0.5 * (A.AdjT + H.AdjT);
  const BASE_PPP = LEAGUE_AVG_ADJ / 100.0;

  let pppA = BASE_PPP * (A.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / H.AdjD);
  let pppH = BASE_PPP * (H.AdjO / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / A.AdjD);

  if (TR && LG) {
    const rA = findTR(away);
    const rH = findTR(home);

    const getv = (r, name, defv) =>
      r && Number.isFinite(Number(r[name])) ? Number(r[name]) : defv;

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

    const damp = 0.5; // keep KP as anchor
    pppA *= Math.pow(off_mult_A, damp) * Math.pow(def_mult_H, damp);
    pppH *= Math.pow(off_mult_H, damp) * Math.pow(def_mult_A, damp);
  }

  return { poss, pppA, pppH };
}

/* ======= Web Worker for Monte Carlo ======= */
const workerCode = `
self.onmessage = (e) => {
  const { poss, pppA, pppH, homeEdge, nSims, possSD, pppSD } = e.data;
  function randn(mean, sd) {
    const u = Math.random(), v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2*Math.PI*v);
    return mean + sd * z;
  }
  const simA = new Float64Array(nSims);
  const simH = new Float64Array(nSims);
  let homeWins = 0;

  for (let i=0;i<nSims;i++){
    const p   = Math.max(50, randn(poss, possSD));
    const aPP = randn(pppA, pppSD);
    const hPP = randn(pppH, pppSD);
    const a   = aPP * p;
    const h   = hPP * p + homeEdge;
    simA[i] = a;
    simH[i] = h;
    if (h > a) homeWins++;
  }

  function mean(arr){ let s=0; for (let i=0;i<arr.length;i++) s+=arr[i]; return s/arr.length; }
  function quantile(arr, q){
    const a = Array.from(arr).sort((x,y)=>x-y);
    const idx = Math.max(0, Math.min(a.length-1, Math.floor(q*(a.length-1))));
    return a[idx];
  }

  const mA = mean(simA), mH = mean(simH);
  const qA25 = quantile(simA, 0.25), qA75 = quantile(simA, 0.75);
  const qH25 = quantile(simH, 0.25), qH75 = quantile(simH, 0.75);
  const homeWinPct = homeWins / nSims;

  self.postMessage({ mA, mH, qA25, qA75, qH25, qH75, homeWinPct });
};
`;
const workerURL = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));

/* ======= Render helpers ======= */
function badge(text, kind) {
  const cls = kind === "green" ? "badge green" : kind === "red" ? "badge red" : "badge gray";
  return `<span class="${cls}">${text}</span>`;
}
function confFromEdge(edge, hi=6.0) {
  const e = Math.min(Math.abs(edge)/hi, 1.0);
  return Math.round(1 + 9*e); // 1..10
}
function fmt1(x){ return Number(x).toFixed(1); }

/* ======= Saved games ======= */
function loadSaved() {
  try {
    const raw = localStorage.getItem("cbb_saved");
    savedGames = raw ? JSON.parse(raw) : [];
  } catch { savedGames = []; }
  renderSaved();
}
function persistSaved() {
  localStorage.setItem("cbb_saved", JSON.stringify(savedGames));
  renderSaved();
}
function renderSaved() {
  if (!savedGames.length) {
    savedWrap.innerHTML = `<p class="muted">No games saved yet.</p>`;
    return;
  }
  const cols = [
    "Away","Home","Book Spread (Home)","Book Total",
    "Model Away Pts","Model Home Pts","Model Total","Model Spread (Home)",
    "Total Edge","Spread Edge","Totals Play","Spread Play",
    "Home Win %","Away Win %","Confidence (1-10)"
  ];
  let thead = `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  let rows = savedGames.map(g => `<tr>${cols.map(c => `<td>${g[c] ?? ""}</td>`).join("")}</tr>`).join("");
  savedWrap.innerHTML = `<div class="tableWrap"><table>${thead}<tbody>${rows}</tbody></table></div>`;
}
function toCSV(arr) {
  if (!arr.length) return "";
  const cols = Object.keys(arr[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;
  const head = cols.map(esc).join(",");
  const body = arr.map(r => cols.map(c => esc(r[c])).join(",")).join("\n");
  return head + "\n" + body;
}

/* ======= Main run ======= */
async function init() {
  try {
    statusEl.textContent = "Loading KenPom…";
    const kpRows = await fetchCSV(KENPOM_URL);
    KP = buildKP(kpRows);

    statusEl.textContent = "Loading TeamRankings (6 tabs)…";
    const { merged, lg } = await loadTR(TR_URLS, 0.5, 0.5);
    TR = merged;
    LG = lg;

    const teams = KP.map((r) => r.Team).sort((a, b) => a.localeCompare(b));
    awaySel.innerHTML = teams.map((t) => `<option>${t}</option>`).join("");
    homeSel.innerHTML = teams.map((t) => `<option>${t}</option>`).join("");
    awaySel.disabled = false;
    homeSel.disabled = false;
    runBtn.disabled = false;
    saveBtn.disabled = true;
    statusEl.textContent = "Ready.";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Load error. See console.";
    alert("Data load error:\n" + e.message);
  }
  loadSaved();
}

runBtn.addEventListener("click", () => {
  try {
    const away = awaySel.value;
    const home = homeSel.value;
    const bookSpread = Number(spreadInput.value);
    const bookTotal = Number(totalInput.value);
    if (!away || !home || !Number.isFinite(bookSpread) || !Number.isFinite(bookTotal)) {
      alert("Please select teams and enter numeric spread/total.");
      return;
    }
    if (teamKey(away) === teamKey(home)) {
      alert("Select two different teams.");
      return;
    }

    const { poss, pppA, pppH } = baseParams(away, home);
    const detAway = pppA * poss;
    const detHome = pppH * poss + HOME_EDGE_POINTS;

    resultBody.innerHTML = `
      <p><strong>Prediction:</strong> ${detHome >= detAway
        ? `${home} ${Math.round(detHome)} – ${away} ${Math.round(detAway)}`
        : `${away} ${Math.round(detAway)} – ${home} ${Math.round(detHome)}`
      }</p>
      <p><strong>Projected Winner:</strong> ${detHome >= detAway ? home : away}</p>
      <p><span class="badge gray">Running 1000-sim Monte Carlo…</span></p>
    `;
    resultsSec.classList.remove("hidden");
    saveBtn.disabled = true;

    // Monte Carlo in worker
    const worker = new Worker(workerURL);
    worker.postMessage({
      poss, pppA, pppH,
      homeEdge: HOME_EDGE_POINTS,
      nSims: N_SIMS,
      possSD: POSS_SD,
      pppSD: PPP_SD
    });

    worker.onmessage = (ev) => {
      const { mA, mH, qA25, qA75, qH25, qH75, homeWinPct } = ev.data;
      const modelTotal = mA + mH;
      const modelSpreadHome = mH - mA;

      const totalEdge = modelTotal - Number(totalInput.value);
      const bookHomeEdge = -Number(spreadInput.value); // convert book's "home -x" to model sign
      const spreadEdge = modelSpreadHome - bookHomeEdge;

      let totalPlay = "NO BET";
      if (totalEdge >= TOTAL_EDGE_TH) totalPlay = `OVER ${Number(totalInput.value).toFixed(1)}`;
      else if (totalEdge <= -TOTAL_EDGE_TH) totalPlay = `UNDER ${Number(totalInput.value).toFixed(1)}`;

      let spreadPlay = "NO BET";
      if (spreadEdge >= SPREAD_EDGE_TH) {
        spreadPlay = `${homeSel.value} ${Number(spreadInput.value).toFixed(1)}`;
      } else if (spreadEdge <= -SPREAD_EDGE_TH) {
        const opp = -Number(spreadInput.value);
        spreadPlay = `${awaySel.value} ${opp.toFixed(1)}`;
      }

      const conf = confFromEdge(Math.max(Math.abs(totalEdge), Math.abs(spreadEdge)));
      const winner = mH >= mA ? homeSel.value : awaySel.value;
      const line = mH >= mA
        ? `${homeSel.value} ${Math.round(mH)} – ${awaySel.value} ${Math.round(mA)}`
        : `${awaySel.value} ${Math.round(mA)} – ${homeSel.value} ${Math.round(mH)}`;

      resultBody.innerHTML = `
        <p><strong>Prediction:</strong> ${line}</p>
        <p><strong>Projected Winner:</strong> ${winner}</p>
        <p><strong>Win Probability:</strong> ${homeSel.value} ${(homeWinPct*100).toFixed(0)}%  –  ${awaySel.value} ${((1-homeWinPct)*100).toFixed(0)}%</p>
        <p><strong>Model Spread:</strong> ${mH >= mA ? homeSel.value : awaySel.value} ${(mH - mA >= 0 ? "+" : "") + fmt1(mH - mA)}</p>
        <p><strong>Book Spread (Home):</strong> ${Number(spreadInput.value) >= 0 ? "+" : ""}${Number(spreadInput.value).toFixed(1)}</p>
        <p><strong>Total Points (Model):</strong> ${fmt1(modelTotal)}  &nbsp; <strong>Book Total:</strong> ${Number(totalInput.value).toFixed(1)}</p>
        <p><strong>Totals Play:</strong> ${totalPlay}  &nbsp; <strong>Spread Play:</strong> ${spreadPlay}</p>
        <p><strong>Likely Ranges (25–75%):</strong> ${awaySel.value} ${fmt1(qA25)}–${fmt1(qA75)}  |  ${homeSel.value} ${fmt1(qH25)}–${fmt1(qH75)}</p>
        <div><strong>Prediction Confidence:</strong> ${badge(conf + " / 10", conf >= 7 ? "green" : conf >= 4 ? "gray" : "red")}</div>
      `;
      saveBtn.disabled = false;

      // Save current result
      saveBtn.onclick = () => {
        const row = {
          Away: awaySel.value,
          Home: homeSel.value,
          "Book Spread (Home)": (Number(spreadInput.value) >= 0 ? "+" : "") + Number(spreadInput.value).toFixed(1),
          "Book Total": Number(totalInput.value).toFixed(1),
          "Model Away Pts": fmt1(mA),
          "Model Home Pts": fmt1(mH),
          "Model Total": fmt1(modelTotal),
          "Model Spread (Home)": fmt1(modelSpreadHome),
          "Total Edge": fmt1(totalEdge),
          "Spread Edge": fmt1(spreadEdge),
          "Totals Play": totalPlay,
          "Spread Play": spreadPlay,
          "Home Win %": (homeWinPct*100).toFixed(1),
          "Away Win %": ((1-homeWinPct)*100).toFixed(1),
          "Confidence (1-10)": conf
        };
        savedGames.push(row);
        persistSaved();
      };

      worker.terminate();
    };
  } catch (e) {
    console.error(e);
    alert("Run error:\n" + e.message);
  }
});

downloadBtn.addEventListener("click", () => {
  if (!savedGames.length) return;
  const csv = toCSV(savedGames);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cbb_saved_${new Date().toISOString().slice(0,16).replace("T","_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
undoBtn.addEventListener("click", () => {
  if (!savedGames.length) return;
  savedGames.pop();
  persistSaved();
});
clearBtn.addEventListener("click", () => {
  if (!savedGames.length) return;
  if (confirm("Clear all saved games?")) {
    savedGames = [];
    persistSaved();
  }
});

/* ======= Kick it off ======= */
init();
