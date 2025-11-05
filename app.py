# app.py
import streamlit as st
import pandas as pd
import numpy as np
from pathlib import Path

# =========================
# CONFIG & MODEL SETTINGS
# =========================
LEAGUE_AVG_ADJ   = 105.0   # per 100 possessions baseline
HOME_EDGE_POINTS = 2.2     # simple home-court bump (points)
ALPHA_SHRINK     = 0.12    # slight shrink of PPP toward 1.00 early season

# Betting recommendation thresholds
TOTAL_EDGE_TH    = 2.0     # fire O/U if model total differs by >= 2.0
SPREAD_EDGE_TH   = 1.5     # fire spread if edge vs line >= 1.5

# Monte Carlo controls (separate variance sources)
N_SIMS           = 8000    # number of simulations
POSS_SD          = 4.5     # SD of possessions (per game)
PPP_SD           = 0.055   # SD of points-per-possession

# =========================
# DATA LOADER (Options 1–3)
# =========================
@st.cache_data(ttl=600)  # cache for 10 minutes; click Refresh to clear
def load_data():
    """
    Tries 1) Secrets URL, 2) Sidebar URL, 3) Local CSV fallback.
    - Secrets URL: Streamlit Cloud -> Settings -> Secrets -> KENPOM_CSV_URL
      (Google Sheets 'Publish to web' CSV link)
    - Sidebar URL: Paste a CSV URL at runtime
    - Local CSV: Ken.csv or data/Ken.csv in repo (header row = Row 2 -> header=1)
    Returns dataframe with columns: Team, AdjO, AdjD, AdjT
    """
    # 1) Secrets URL (live Google Sheets)
    url = st.secrets.get("https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv", "").strip() if "KENPOM_CSV_URL" in st.secrets else ""
    if url:
        df_raw = pd.read_csv(url)
    else:
        # 2) Sidebar URL override
        url_from_ui = st.session_state.get("_csv_url_ui", "").strip()
        if url_from_ui:
            df_raw = pd.read_csv(url_from_ui)
        else:
            # 3) Local CSV fallback in repo
            df_raw = None
            for p in ["Ken.csv", "data/Ken.csv"]:
                if Path(p).exists():
                    # Your local CSV headers are on Row 2, so header=1
                    df_raw = pd.read_csv(p, encoding="utf-8-sig", header=1)
                    break
            if df_raw is None:
                raise FileNotFoundError(
                    "CSV not found. Provide KENPOM_CSV_URL in secrets, paste a URL in the sidebar, "
                    "or add Ken.csv to repo root (or data/Ken.csv)."
                )

    # Normalize headers
    df_raw.columns = [c.strip() for c in df_raw.columns]

    # Accept common aliases (your sheet uses Team, ORtg, DRtg, AdjT)
    rename_map = {}
    if "ORtg" in df_raw.columns and "AdjO" not in df_raw.columns:
        rename_map["ORtg"] = "AdjO"
    if "DRtg" in df_raw.columns and "AdjD" not in df_raw.columns:
        rename_map["DRtg"] = "AdjD"
    if "Tempo" in df_raw.columns and "AdjT" not in df_raw.columns:
        rename_map["Tempo"] = "AdjT"
    if rename_map:
        df_raw = df_raw.rename(columns=rename_map)

    required = {"Team","AdjO","AdjD","AdjT"}
    if not required.issubset(df_raw.columns):
        raise ValueError(f"Missing required columns {required}. Found: {list(df_raw.columns)}")

    df = df_raw[["Team","AdjO","AdjD","AdjT"]].copy()
    for c in ["AdjO","AdjD","AdjT"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["Team","AdjO","AdjD","AdjT"])
    return df

# =========================
# MODEL HELPERS
# =========================
def lookup(df, team):
    row = df[df["Team"].str.lower() == team.lower()]
    if row.empty:
        row = df[df["Team"].str.lower().str.contains(team.lower(), na=False)]
    if row.empty:
        raise ValueError(f"Team '{team}' not found.")
    r = row.iloc[0]
    return float(r["AdjO"]), float(r["AdjD"]), float(r["AdjT"])

def project_scores(df, away, home):
    """Deterministic baseline (for display/reference)."""
    AdjO_A, AdjD_A, AdjT_A = lookup(df, away)
    AdjO_H, AdjD_H, AdjT_H = lookup(df, home)

    poss = 0.5 * (AdjT_A + AdjT_H)
    poss = 68 + (poss - 68) * 0.5  # damp toward 68 to avoid extremes

    off_A = ((AdjO_A + AdjD_H) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ
    off_H = ((AdjO_H + AdjD_A) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ

    score_A = off_A * poss / 100.0
    score_H = off_H * poss / 100.0 + HOME_EDGE_POINTS
    return score_A, score_H

def _base_params(df, away, home):
    AdjO_A, AdjD_A, AdjT_A = lookup(df, away)
    AdjO_H, AdjD_H, AdjT_H = lookup(df, home)

    poss = 0.5 * (AdjT_A + AdjT_H)
    poss = 68 + (poss - 68) * 0.5

    off_A = ((AdjO_A + AdjD_H) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ
    off_H = ((AdjO_H + AdjD_A) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ

    ppp_A = off_A / 100.0
    ppp_H = off_H / 100.0
    return poss, ppp_A, ppp_H

def mc_distribution(df, away, home, n_sims=N_SIMS):
    """Monte Carlo using separate variance for possessions and PPP."""
    poss, ppp_A, ppp_H = _base_params(df, away, home)

    sim_poss = np.maximum(50, np.random.normal(poss, POSS_SD, n_sims))
    sim_pppA = np.random.normal(ppp_A, PPP_SD, n_sims)
    sim_pppH = np.random.normal(ppp_H, PPP_SD, n_sims)

    sim_A = sim_pppA * sim_poss
    sim_H = sim_pppH * sim_poss + HOME_EDGE_POINTS
    return sim_A, sim_H

def confidence_from_edge(edge, hi_edge=6.0):
    """Simple 1–10 confidence based on the bigger of spread/total edges."""
    e = min(abs(edge) / hi_edge, 1.0)
    return int(round(1 + 9*e))  # 1..10

def stacked_summary(df, away, home, book_home_spread, book_total):
    # Baseline (for reference)
    base_A, base_H = project_scores(df, away, home)

    # Monte Carlo (separate variance)
    sim_A, sim_H = mc_distribution(df, away, home)
    score_A = float(sim_A.mean())
    score_H = float(sim_H.mean())
    model_total = score_A + score_H
    model_spread_home = score_H - score_A  # + means home by X
    home_win = float((sim_H > sim_A).mean())
    away_win = 1.0 - home_win

    # Ranges (25–75%)
    qA = np.percentile(sim_A, [25, 75])
    qH = np.percentile(sim_H, [25, 75])
    qT = np.percentile(sim_A + sim_H, [25, 75])

    # Totals play
    total_edge = model_total - book_total
    if total_edge >= TOTAL_EDGE_TH:
        total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH:
        total_play = f"UNDER {book_total:.1f}"
    else:
        total_play = "NO BET"

    # Spread play (book input is HOME spread; negative = home favored)
    book_home_edge = -book_home_spread  # convert to "home by +X"
    spread_edge = model_spread_home - book_home_edge
    if spread_edge >= SPREAD_EDGE_TH:
        spread_play = f"{home} {book_home_spread:+.1f}"
    elif spread_edge <= -SPREAD_EDGE_TH:
        spread_play = f"{away} {-book_home_spread:+.1f}"
    else:
        spread_play = "NO BET"

    big_edge = max(abs(total_edge), abs(spread_edge))
    conf = confidence_from_edge(big_edge)

    # Winner / margin (from MC means)
    if score_H > score_A:
        winner = home
        margin = score_H - score_A
    else:
        winner = away
        margin = score_A - score_H

    # Pretty, stacked print (monospace block)
    lines = []
    lines.append(f"--- GAME SUMMARY: {away} @ {home} ---")
    lines.append(f"Projected Score        | {away[:12]:>12}: {score_A:5.2f}  | {home[:12]:>12}: {score_H:5.2f}")
    lines.append(f"Likely Ranges (25–75%) | {away[:12]:>12}: {qA[0]:5.1f}–{qA[1]:5.1f} | {home[:12]:>12}: {qH[0]:5.1f}–{qH[1]:5.1f}")
    lines.append(f"Projected Winner       | {winner} by {margin:.1f}")
    lines.append(f"Win Probability        | {away[:12]:>12}: {away_win*100:4.1f}%  | {home[:12]:>12}: {home_win*100:4.1f}%")
    lines.append(f"Totals                 | Model: {model_total:5.1f}  | Book: {book_total:5.1f}  | Edge: {total_edge:+4.1f}  | Play: {total_play}")
    lines.append(f"Spread (Home)          | Model: {model_spread_home:+4.1f}  | Book: {book_home_spread:+5.1f} | Edge: {spread_edge:+4.1f} | Play: {spread_play}")
    lines.append(f"Confidence             | {conf} / 10")

    st.markdown("### 🏀 College Basketball Projection Model")
    st.code("\n".join(lines))

# =========================
# STREAMLIT UI
# =========================
# Sidebar helpers (CSV URL + Refresh)
with st.sidebar:
    st.markdown("### Data Source")
    url_override = st.text_input("CSV URL (optional)", placeholder="Paste Google Sheets 'Publish to web' CSV link")
    if url_override:
        st.session_state["_csv_url_ui"] = url_override
    if st.button("🔄 Refresh data"):
        load_data.clear()
        st.experimental_rerun()

# Load data
try:
    df = load_data()
except Exception as e:
    st.error(f"Data load error: {e}")
    st.stop()

teams = sorted(df["Team"].unique())
col1, col2 = st.columns(2)
away_team = col1.selectbox("Away Team", teams, index=0)
home_team = col2.selectbox("Home Team", teams, index=1)

book_spread = st.text_input("Home Spread (negative if home favored):", "-5.0")
book_total  = st.text_input("Book Total:", "145.0")

if st.button("Run Projection"):
    try:
        book_spread_val = float(book_spread)
        book_total_val  = float(book_total)
        stacked_summary(df, away_team, home_team, book_spread_val, book_total_val)
    except Exception as e:
        st.error(f"Error: {e}")

# Optional: show current settings in sidebar
with st.sidebar:
    st.markdown("### Model Settings")
    st.write(f"Possession SD: **{POSS_SD}**")
    st.write(f"PPP SD: **{PPP_SD}**")
    st.write(f"Simulations: **{N_SIMS}**")
