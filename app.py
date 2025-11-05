import streamlit as st
import pandas as pd
import numpy as np

# -----------------------------
# CONFIG & SETUP
# -----------------------------
LEAGUE_AVG_ADJ   = 105.0
HOME_EDGE_POINTS = 2.2
ALPHA_SHRINK     = 0.12
TOTAL_EDGE_TH    = 2.0
SPREAD_EDGE_TH   = 1.5
N_SIMS           = 8000
POINT_SD         = 7.0

# -----------------------------
# Load KenPom-like CSV
# -----------------------------
import streamlit as st
import pandas as pd
from pathlib import Path

@st.cache_data(ttl=600)  # cache for 10 minutes; adjust as you like
def load_data():
    # 1) Prefer live Google Sheets URL from secrets
    url = st.secrets.get("https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv", "").strip()
    if url:
        df_raw = pd.read_csv(url)  # Google publishes with the header on the first row
    else:
        # 2) Fallback to local file in repo (header row is Row 2 -> header=1)
        for p in ["Ken.csv", "data/Ken.csv"]:
            if Path(p).exists():
                df_raw = pd.read_csv(p, encoding="utf-8-sig", header=1)
                break
        else:
            st.error("No CSV found and no KENPOM_CSV_URL set in secrets.")
            st.stop()

    df_raw.columns = [c.strip() for c in df_raw.columns]

    # Expect these names based on your sheet
    required = ["Team", "ORtg", "DRtg", "AdjT"]
    if not set(required).issubset(df_raw.columns):
        st.error(f"Missing columns. Found: {df_raw.columns.tolist()}")
        st.stop()

    df = df_raw[["Team","ORtg","DRtg","AdjT"]].copy()
    df.columns = ["Team","AdjO","AdjD","AdjT"]

    for c in ["AdjO","AdjD","AdjT"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    return df.dropna()

df = load_data()
teams = sorted(df["Team"].unique())

# Optional: manual refresh button
if st.sidebar.button("🔄 Refresh data"):
    load_data.clear()   # clears the cache
    st.experimental_rerun()

df = load_data()
teams = sorted(df["Team"].unique())

# -----------------------------
# FUNCTIONS
# -----------------------------
def lookup(team):
    row = df[df["Team"].str.lower() == team.lower()]
    if row.empty:
        row = df[df["Team"].str.lower().str.contains(team.lower(), na=False)]
    if row.empty:
        st.error(f"Team '{team}' not found.")
        st.stop()
    r = row.iloc[0]
    return float(r["AdjO"]), float(r["AdjD"]), float(r["AdjT"])

def project_scores(away, home):
    AdjO_A, AdjD_A, AdjT_A = lookup(away)
    AdjO_H, AdjD_H, AdjT_H = lookup(home)
    poss = 0.5 * (AdjT_A + AdjT_H)
    poss = 68 + (poss - 68) * 0.5
    off_A = ((AdjO_A + AdjD_H)/2 - LEAGUE_AVG_ADJ)*(1-ALPHA_SHRINK)+LEAGUE_AVG_ADJ
    off_H = ((AdjO_H + AdjD_A)/2 - LEAGUE_AVG_ADJ)*(1-ALPHA_SHRINK)+LEAGUE_AVG_ADJ
    score_A = off_A * poss / 100.0
    score_H = off_H * poss / 100.0 + HOME_EDGE_POINTS
    return score_A, score_H

def win_probability(score_A, score_H):
    sim_A = np.random.normal(score_A, POINT_SD, N_SIMS)
    sim_H = np.random.normal(score_H, POINT_SD, N_SIMS)
    return float((sim_H > sim_A).mean())

def confidence(edge, hi_edge=6.0):
    e = min(abs(edge)/hi_edge, 1.0)
    return int(round(1 + 9*e))

def stacked_summary(away, home, book_home_spread, book_total):
    score_A, score_H = project_scores(away, home)
    model_total = score_A + score_H
    model_spread_home = score_H - score_A
    home_win = win_probability(score_A, score_H)
    away_win = 1 - home_win

    # totals
    total_edge = model_total - book_total
    if total_edge >= TOTAL_EDGE_TH:
        total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH:
        total_play = f"UNDER {book_total:.1f}"
    else:
        total_play = "NO BET"

    # spread
    book_home_edge = -book_home_spread
    spread_edge = model_spread_home - book_home_edge
    if spread_edge >= SPREAD_EDGE_TH:
        spread_play = f"{home} {book_home_spread:+.1f}"
    elif spread_edge <= -SPREAD_EDGE_TH:
        spread_play = f"{away} {-book_home_spread:+.1f}"
    else:
        spread_play = "NO BET"

    big_edge = max(abs(total_edge), abs(spread_edge))
    conf = confidence(big_edge)

    winner = home if score_H > score_A else away
    margin = abs(score_H - score_A)

    st.markdown(f"### 🏀 GAME SUMMARY: {away} @ {home}")
    st.text(f"Projected Score       | {away[:12]:>12}: {score_A:5.2f}  | {home[:12]:>12}: {score_H:5.2f}")
    st.text(f"Projected Winner      | {winner}")
    st.text(f"Win Probability       | {away[:12]:>12}: {away_win*100:4.1f}%  | {home[:12]:>12}: {home_win*100:4.1f}%")
    st.text(f"Totals                | Model: {model_total:5.1f}  | Book: {book_total:5.1f}  | Edge: {total_edge:+4.1f}  | Play: {total_play}")
    st.text(f"Spread (Home)         | Model: {model_spread_home:+4.1f}  | Book: {book_home_spread:+5.1f} | Edge: {spread_edge:+4.1f} | Play: {spread_play}")
    st.text(f"Confidence            | {conf} / 10")

# -----------------------------
# STREAMLIT UI
# -----------------------------
st.title("🏀 College Basketball Projection Model")

col1, col2 = st.columns(2)
away_team = col1.selectbox("Select Away Team", teams, index=0)
home_team = col2.selectbox("Select Home Team", teams, index=1)

book_spread = st.text_input("Enter Home Spread (negative if home favored):", "-5.0")
book_total  = st.text_input("Enter Book Total:", "145.0")

if st.button("Run Projection"):
    try:
        book_spread_val = float(book_spread)
        book_total_val = float(book_total)
        stacked_summary(away_team, home_team, book_spread_val, book_total_val)
    except Exception as e:
        st.error(f"Error: {e}")
