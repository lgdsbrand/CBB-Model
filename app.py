# app.py
import streamlit as st
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

# =========================
# CONFIG & MODEL SETTINGS
# =========================
LEAGUE_AVG_ADJ   = 105.0   # per 100 possessions baseline
HOME_EDGE_POINTS = 3.0     # home-court bump (points)
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
@st.cache_data(ttl=600)  # cache for 10 minutes; hit Refresh to clear
def load_data(csv_url_from_sidebar: str = "") -> pd.DataFrame:
    """
    Tries 1) Secrets URL, 2) Sidebar URL, 3) Local CSV.
    Returns dataframe with columns: Team, AdjO, AdjD, AdjT (numeric).
    """
    # 1) Secrets URL (Google Sheets 'Publish to web' CSV)
    url = st.secrets.get("https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv", "").strip() if "KENPOM_CSV_URL" in st.secrets else ""
    if url:
        df_raw = pd.read_csv(url)
    else:
        # 2) Sidebar URL override
        if csv_url_from_sidebar:
            df_raw = pd.read_csv(csv_url_from_sidebar)
        else:
            # 3) Local CSV fallback in repo (header row is Row 2 -> header=1)
            df_raw = None
            for p in ["Ken.csv", "data/Ken.csv"]:
                if Path(p).exists():
                    df_raw = pd.read_csv(p, encoding="utf-8-sig", header=1)
                    break
            if df_raw is None:
                raise FileNotFoundError(
                    "CSV not found. Provide KENPOM_CSV_URL in secrets, paste a CSV URL in the sidebar, "
                    "or add Ken.csv (or data/Ken.csv) to the repo."
                )

    # Normalize headers and map common names
    df_raw.columns = [c.strip() for c in df_raw.columns]
    rename_map = {}
    if "ORtg" in df_raw.columns and "AdjO" not in df_raw.columns:
        rename_map["ORtg"] = "AdjO"
    if "DRtg" in df_raw.columns and "AdjD" not in df_raw.columns:
        rename_map["DRtg"] = "AdjD"
    if "Tempo" in df_raw.columns and "AdjT" not in df_raw.columns:
        rename_map["Tempo"] = "AdjT"
    if rename_map:
        df_raw = df_raw.rename(columns=rename_map)

    required = {"Team", "AdjO", "AdjD", "AdjT"}
    if not required.issubset(df_raw.columns):
        raise ValueError(f"Missing required columns {required}. Found: {list(df_raw.columns)}")

    df = df_raw[["Team", "AdjO", "AdjD", "AdjT"]].copy()
    for c in ["AdjO", "AdjD", "AdjT"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["Team", "AdjO", "AdjD", "AdjT"])
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
    """Deterministic baseline (for reference only)."""
    AdjO_A, AdjD_A, AdjT_A = lookup(df, away)
    AdjO_H, AdjD_H, AdjT_H = lookup(df, home)

    poss = 0.5 * (AdjT_A + AdjT_H)
    poss = 68 + (poss - 68) * 0.5  # damp toward 68

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
    e = min(abs(edge) / hi_edge, 1.0)
    return int(round(1 + 9 * e))  # 1..10

# =========================
# SAVE-ROW HELPER
# =========================
def compute_projection_row(df, away, home, book_home_spread, book_total):
    base_A, base_H = project_scores(df, away, home)
    sim_A, sim_H = mc_distribution(df, away, home)
    score_A = float(sim_A.mean())
    score_H = float(sim_H.mean())
    model_total = score_A + score_H
    model_spread_home = score_H - score_A  # + means home by X
    home_win = float((sim_H > sim_A).mean())
    away_win = 1.0 - home_win

    total_edge = model_total - book_total
    book_home_edge = -book_home_spread
    spread_edge = model_spread_home - book_home_edge

    if total_edge >= TOTAL_EDGE_TH:
        total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH:
        total_play = f"UNDER {book_total:.1f}"
    else:
        total_play = "NO BET"

    if spread_edge >= SPREAD_EDGE_TH:
        spread_play = f"{home} {book_home_spread:+.1f}"
    elif spread_edge <= -SPREAD_EDGE_TH:
        spread_play = f"{away} {-book_home_spread:+.1f}"
    else:
        spread_play = "NO BET"

    conf = confidence_from_edge(max(abs(total_edge), abs(spread_edge)))

    return {
        "Away": away,
        "Home": home,
        "Book Spread (Home)": f"{book_home_spread:+.1f}",
        "Book Total": round(book_total, 1),
        "Model Away Pts": round(score_A, 1),
        "Model Home Pts": round(score_H, 1),
        "Model Total": round(model_total, 1),
        "Model Spread (Home)": round(model_spread_home, 1),
        "Total Edge": round(total_edge, 1),
        "Spread Edge": round(spread_edge, 1),
        "Totals Play": total_play,
        "Spread Play": spread_play,
        "Home Win %": round(home_win * 100, 1),
        "Away Win %": round(away_win * 100, 1),
        "Confidence (1-10)": conf,
    }

# =========================
# STACKED CARD OUTPUT
# =========================
def stacked_summary(df, away, home, book_home_spread, book_total):
    # Baseline & MC
    base_A, base_H = project_scores(df, away, home)
    sim_A, sim_H = mc_distribution(df, away, home)

    score_A = float(sim_A.mean())
    score_H = float(sim_H.mean())
    total   = score_A + score_H
    spreadH = score_H - score_A  # + means home by X

    # Ranges (25–75%)
    qA_lo, qA_hi = np.percentile(sim_A, [25, 75])
    qH_lo, qH_hi = np.percentile(sim_H, [25, 75])

    # Win probabilities
    home_win = float((sim_H > sim_A).mean())
    away_win = 1.0 - home_win

    # Plays
    total_edge = total - book_total
    total_play = "NO BET"
    if total_edge >= TOTAL_EDGE_TH:
        total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH:
        total_play = f"UNDER {book_total:.1f}"

    book_home_edge = -book_home_spread
    spread_edge = spreadH - book_home_edge
    if spread_edge >= SPREAD_EDGE_TH:
        spread_play = f"{home} {book_home_spread:+.1f}"
    elif spread_edge <= -SPREAD_EDGE_TH:
        spread_play = f"{away} {-book_home_spread:+.1f}"
    else:
        spread_play = "NO BET"

    # Winner / margin
    if score_H >= score_A:
        winner = home
        win_line = f"{home} {int(round(score_H))} – {away} {int(round(score_A))}"
        model_spread_txt = f"{home} {spreadH:+.1f}"
    else:
        winner = away
        win_line = f"{away} {int(round(score_A))} – {home} {int(round(score_H))}"
        model_spread_txt = f"{away} {-spreadH:+.1f}"

    conf = confidence_from_edge(max(abs(total_edge), abs(spread_edge)))
    conf_pct = conf / 10.0

    # Stacked card (no horizontal scroll)
    st.subheader(f"{away} @ {home}")
    st.markdown(
        f"""
**Prediction:** {win_line}  
**Projected Winner:** {winner}  
**Win Probability:** {home} {home_win*100:.0f}%  –  {away} {away_win*100:.0f}%  
**Model Spread:** {model_spread_txt}  
**Book Spread (Home):** {book_home_spread:+.1f}  
**Total Points (Model):** {total:.1f}  
**Book Total:** {book_total:.1f}  
**Totals Play:** {total_play}  
**Spread Play:** {spread_play}  
**Likely Ranges (25–75%):** {away} {qA_lo:.1f}–{qA_hi:.1f}  |  {home} {qH_lo:.1f}–{qH_hi:.1f}
"""
    )
    st.markdown("**Prediction Confidence:**")
    st.progress(conf_pct)

# =========================
# STREAMLIT UI
# =========================
st.title("🏀 College Basketball Projection Model")

# Sidebar: data source + refresh + show settings
with st.sidebar:
    st.markdown("### Data Source")
    csv_url_input = st.text_input(
        "CSV URL (optional)",
        placeholder="Paste Google Sheets 'Publish to web' CSV link"
    )
    if st.button("🔄 Refresh data"):
        load_data.clear()
        st.experimental_rerun()
    st.markdown("---")
    st.markdown("### Model Settings")
    st.write(f"Possession SD: **{POSS_SD}**")
    st.write(f"PPP SD: **{PPP_SD}**")
    st.write(f"Simulations: **{N_SIMS}**")

# Load data
try:
    df = load_data(csv_url_input.strip())
except Exception as e:
    st.error(f"Data load error: {e}")
    st.stop()

# Session storage for saved table
if "saved_rows" not in st.session_state:
    st.session_state.saved_rows = []

teams = sorted(df["Team"].unique())
col1, col2 = st.columns(2)
away_team = col1.selectbox("Away Team", teams, index=0)
home_team = col2.selectbox("Home Team", teams, index=1)

book_spread = st.text_input("Home Spread (negative if home favored):", "-5.0")
book_total  = st.text_input("Book Total:", "145.0")

col_run, col_save = st.columns(2)
run  = col_run.button("Run Projection")
save = col_save.button("Save to Table")

if run or save:
    try:
        book_spread_val = float(book_spread)
        book_total_val  = float(book_total)

        # Show stacked card
        stacked_summary(df, away_team, home_team, book_spread_val, book_total_val)

        # Save row if requested
        if save:
            row = compute_projection_row(df, away_team, home_team, book_spread_val, book_total_val)
            st.session_state.saved_rows.append(row)
            st.success("Saved to table ✅")
    except Exception as e:
        st.error(f"Error: {e}")

# Saved table section
st.markdown("---")
st.subheader("📋 Saved Games")

if len(st.session_state.saved_rows) == 0:
    st.info("No games saved yet. Run a projection and click **Save to Table**.")
else:
    df_saved = pd.DataFrame(st.session_state.saved_rows)
    cols_order = [
        "Away","Home",
        "Book Spread (Home)","Book Total",
        "Model Away Pts","Model Home Pts","Model Total","Model Spread (Home)",
        "Total Edge","Spread Edge",
        "Totals Play","Spread Play",
        "Home Win %","Away Win %","Confidence (1-10)"
    ]
    df_saved = df_saved.reindex(columns=cols_order)
    st.dataframe(df_saved, use_container_width=True)

    csv_bytes = df_saved.to_csv(index=False).encode("utf-8")
    fname = f"cbb_saved_games_{datetime.now().strftime('%Y-%m-%d_%H%M')}.csv"
    st.download_button("⬇️ Download CSV", data=csv_bytes, file_name=fname, mime="text/csv")

    ca, cb = st.columns(2)
    if ca.button("↩️ Undo last"):
        st.session_state.saved_rows.pop()
        st.experimental_rerun()
    if cb.button("🗑️ Clear all"):
        st.session_state.saved_rows = []
        st.experimental_rerun()
