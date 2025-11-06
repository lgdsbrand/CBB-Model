import streamlit as st
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import string

# =========================================================
#                  PASTE YOUR URLS HERE
# =========================================================
# Each CSV must have:
#   B = Team, C = 2025 value, H = 2024 value
TR_URLS = {
    "OFF_EFF": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv",    # Offensive Efficiency (per 100 poss)
    "DEF_EFF": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv",    # Defensive Efficiency (per 100 poss)
    "OFF_REB": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv",    # Offensive Rebounding %
    "DEF_REB": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv",    # Defensive Rebounding %
    "TOV_POSS": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv",   # Turnovers per possession (offense) -- higher is worse
    "OFF_EFG": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv",    # Offensive eFG% (0-1 or 0-100)
    # "DEF_EFG": "",   # (Optional) If you have a defensive eFG% CSV, put it here and add to build/merge below
}

# Optional: KenPom CSV (Publish-to-Web link). If left blank, we use sidebar override or local Ken.csv.
KENPOM_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv"  # e.g. "https://docs.google.com/spreadsheets/d/.../export?format=csv"

# =========================================================
#                    MODEL CONFIG
# =========================================================
LEAGUE_AVG_ADJ   = 105.0   # per 100 possessions baseline
HOME_EDGE_POINTS = 3.2     # home-court bump (points)
ALPHA_SHRINK     = 0.12    # shrink PPP toward 1.00 (early season)

TOTAL_EDGE_TH    = 2.0     # O/U play threshold (points)
SPREAD_EDGE_TH   = 1.5     # spread play threshold (points)

# Monte Carlo (separate variance sources)
N_SIMS           = 8000
POSS_SD          = 4.5     # SD of game possessions
PPP_SD           = 0.055   # SD of points-per-possession

# Four-factor-ish weights for multipliers (we're omitting FT rate)
W_EFG = 0.40
W_TOV = 0.25
W_REB = 0.20

# Blend weight between seasons (C=2025, H=2024)
W_2025 = 0.50
W_2024 = 0.50

# =========================================================
#              GENERAL HELPERS / UTILITIES
# =========================================================
def col_letter_to_index(letter: str) -> int:
    """Convert Excel/Sheets column letters to 0-based index."""
    if not letter:
        return None
    s = letter.strip().upper()
    val = 0
    for ch in s:
        if ch not in string.ascii_uppercase:
            return None
        val = val * 26 + (ord(ch) - ord('A') + 1)
    return val - 1

TEAM_COL_LETTER = "B"
COL_2025_LETTER = "C"
COL_2024_LETTER = "H"

TEAM_IDX  = col_letter_to_index(TEAM_COL_LETTER)
IDX_2025  = col_letter_to_index(COL_2025_LETTER)
IDX_2024  = col_letter_to_index(COL_2024_LETTER)

def _read_tr_csv(url: str) -> pd.DataFrame:
    df = pd.read_csv(url)
    # Pick the columns we need by index
    keep = []
    for idx in [TEAM_IDX, IDX_2025, IDX_2024]:
        if idx is not None and 0 <= idx < df.shape[1]:
            keep.append(idx)
        else:
            raise ValueError(f"CSV does not have required column at index {idx}. Check letters B/C/H.")
    out = df.iloc[:, keep].copy()
    out.columns = ["Team", "v2025", "v2024"]
    return out

def _coerce_percent(s: pd.Series) -> pd.Series:
    """Turn '52.3' into 0.523; leave '0.523' as is."""
    s = pd.to_numeric(s, errors="coerce")
    if s.dropna().mean() > 1.0:
        s = s / 100.0
    return s

def _blend_two_cols(v25: pd.Series, v24: pd.Series, w25=W_2025, w24=W_2024) -> pd.Series:
    v25 = pd.to_numeric(v25, errors="coerce")
    v24 = pd.to_numeric(v24, errors="coerce")
    return (w25 * v25) + (w24 * v24)

# =========================================================
#                  KENPOM LOADER
# =========================================================
@st.cache_data(ttl=600)
def load_kp(url_override: str = "") -> pd.DataFrame:
    """
    KenPom-like efficiencies:
    Priority: 1) KENPOM_URL (above), 2) url_override (sidebar), 3) local Ken.csv or data/Ken.csv (header=1)
    Needs columns: Team, ORtg/AdjO, DRtg/AdjD, AdjT/Tempo
    Returns: Team, AdjO, AdjD, AdjT
    """
    url = KENPOM_URL.strip() or url_override.strip()
    if url:
        df_raw = pd.read_csv(url)
    else:
        # Local fallback
        df_raw = None
        for p in ["Ken.csv", "data/Ken.csv"]:
            if Path(p).exists():
                df_raw = pd.read_csv(p, encoding="utf-8-sig", header=1)
                break
        if df_raw is None:
            raise FileNotFoundError(
                "KenPom CSV not found. Set KENPOM_URL at top, paste a URL in sidebar, "
                "or add Ken.csv (or data/Ken.csv) with headers on row 2."
            )

    df_raw.columns = [c.strip() for c in df_raw.columns]
    # Map aliases
    rename = {}
    if "ORtg" in df_raw.columns and "AdjO" not in df_raw.columns: rename["ORtg"] = "AdjO"
    if "DRtg" in df_raw.columns and "AdjD" not in df_raw.columns: rename["DRtg"] = "AdjD"
    if "Tempo" in df_raw.columns and "AdjT" not in df_raw.columns: rename["Tempo"] = "AdjT"
    if rename: df_raw = df_raw.rename(columns=rename)

    required = {"Team","AdjO","AdjD","AdjT"}
    if not required.issubset(df_raw.columns):
        raise ValueError(f"KenPom missing columns {required}. Found: {list(df_raw.columns)}")

    df = df_raw[["Team","AdjO","AdjD","AdjT"]].copy()
    for c in ["AdjO","AdjD","AdjT"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna()

# =========================================================
#          TEAMRANKINGS: 6 URLS -> MERGED DATAFRAME
# =========================================================
@st.cache_data(ttl=600)
def load_tr_six(urls: dict) -> pd.DataFrame:
    """
    Loads six CSVs (same structure B=Team, C=2025, H=2024) and blends into a single table:
      Team, OFF_EFF, DEF_EFF, OFF_REB, DEF_REB, TOV_POSS, OFF_EFG [, DEF_EFG]
    Values auto-converted to fractions for % where appropriate (REB%, eFG%).
    """
    frames = {}
    for key, u in urls.items():
        if not u:
            continue
        df = _read_tr_csv(u)
        # Detect percent-y stats: REB% and EFG% -> normalize to 0..1
        if key in ["OFF_REB","DEF_REB","OFF_EFG","DEF_EFG"]:
            df["v2025"] = _coerce_percent(df["v2025"])
            df["v2024"] = _coerce_percent(df["v2024"])

        # Blend 2025 & 2024
        df[key] = _blend_two_cols(df["v2025"], df["v2024"])
        frames[key] = df[["Team", key]].copy()
        frames[key]["_team_key"] = frames[key]["Team"].astype(str).str.lower()

    if not frames:
        # No TR data provided; return empty shell
        cols = ["Team","OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]
        return pd.DataFrame(columns=cols)

    # Merge on _team_key across all present frames
    merged = None
    for key, f in frames.items():
        if merged is None:
            merged = f
        else:
            merged = pd.merge(merged, f, on=["_team_key"], how="outer", suffixes=("", f"_{key.lower()}"))

    # Reconstruct a single Team col (prefer first non-null Team)
    if "Team_x" in merged.columns or "Team_y" in merged.columns:
        candidates = [c for c in merged.columns if c.startswith("Team")]
        merged["Team"] = None
        for c in candidates:
            merged["Team"] = merged["Team"].combine_first(merged[c])
        merged.drop(columns=candidates, inplace=True)
    # else: already has "Team" from the first frame

    # Ensure all expected stat columns exist
    for c in ["OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]:
        if c not in merged.columns:
            merged[c] = np.nan

    merged = merged[["_team_key","Team","OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]].copy()

    # League averages (used for multipliers fallback)
    lg_avgs = {
        "OFF_EFF": float(pd.to_numeric(merged["OFF_EFF"], errors="coerce").dropna().mean()) if "OFF_EFF" in merged else 105.0,
        "DEF_EFF": float(pd.to_numeric(merged["DEF_EFF"], errors="coerce").dropna().mean()) if "DEF_EFF" in merged else 105.0,
        "OFF_REB": float(pd.to_numeric(merged["OFF_REB"], errors="coerce").dropna().mean()) if "OFF_REB" in merged else 0.30,
        "DEF_REB": float(pd.to_numeric(merged["DEF_REB"], errors="coerce").dropna().mean()) if "DEF_REB" in merged else 0.70,
        "TOV_POSS": float(pd.to_numeric(merged["TOV_POSS"], errors="coerce").dropna().mean()) if "TOV_POSS" in merged else 0.18,
        "OFF_EFG": float(pd.to_numeric(merged["OFF_EFG"], errors="coerce").dropna().mean()) if "OFF_EFG" in merged else 0.51,
    }
    # Fill obvious fallbacks if NaN
    for k, v in lg_avgs.items():
        if not np.isfinite(v):
            if k in ["OFF_EFF","DEF_EFF"]: lg_avgs[k] = 105.0
            elif k == "TOV_POSS": lg_avgs[k] = 0.18
            elif k == "OFF_REB": lg_avgs[k] = 0.30
            elif k == "DEF_REB": lg_avgs[k] = 0.70
            else: lg_avgs[k] = 0.51

    return merged, lg_avgs

def _lookup_row(df, team):
    row = df[df["_team_key"] == team.lower()]
    if row.empty:
        row = df[df["Team"].astype(str).str.lower().str.contains(team.lower(), na=False)]
    if row.empty:
        return None
    return row.iloc[0]

# =========================================================
#              BASELINES & MONTE CARLO
# =========================================================
def lookup_kp(df_kp, team):
    row = df_kp[df_kp["Team"].str.lower() == team.lower()]
    if row.empty:
        row = df_kp[df_kp["Team"].str.lower().str.contains(team.lower(), na=False)]
    if row.empty:
        raise ValueError(f"Team '{team}' not found in KenPom data.")
    return row.iloc[0]

def _base_params(df_kp, df_tr, lg_avgs, away, home):
    A = lookup_kp(df_kp, away)
    H = lookup_kp(df_kp, home)

    poss = 0.5 * (A["AdjT"] + H["AdjT"])
    poss = 68 + (poss - 68) * 0.5

    # KenPom baseline PPP (vs opponent)
    off_A = ((A["AdjO"] + H["AdjD"]) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ
    off_H = ((H["AdjO"] + A["AdjD"]) / 2 - LEAGUE_AVG_ADJ) * (1 - ALPHA_SHRINK) + LEAGUE_AVG_ADJ
    ppp_A = off_A / 100.0
    ppp_H = off_H / 100.0

    # ---- TeamRankings multipliers (optional) ----
    if df_tr is not None and not isinstance(df_tr, tuple):
        # support (df, lg) if wrong unpacking happens
        pass

    if isinstance(df_tr, tuple):   # (df, lg)
        df_tr, lg_avgs = df_tr

    off_mult_A, def_mult_A = 1.0, 1.0
    off_mult_H, def_mult_H = 1.0, 1.0
    if df_tr is not None:
        rA = _lookup_row(df_tr, away)
        rH = _lookup_row(df_tr, home)

        # Pull with fallbacks if missing
        def get(r, name, default):
            if r is None: return default
            v = r.get(name, np.nan)
            v = float(v) if np.isfinite(v) else default
            return v

        # Offensive side uses OFF_EFF, OFF_EFG, OFF_REB, TOV_POSS
        A_OFF_EFF = get(rA, "OFF_EFF", lg_avgs["OFF_EFF"])
        A_OFF_EFG = get(rA, "OFF_EFG", lg_avgs["OFF_EFG"])
        A_OFF_REB = get(rA, "OFF_REB", lg_avgs["OFF_REB"])
        A_TOV     = get(rA, "TOV_POSS", lg_avgs["TOV_POSS"])

        H_DEF_EFF = get(rH, "DEF_EFF", lg_avgs["DEF_EFF"])
        H_DEF_REB = get(rH, "DEF_REB", lg_avgs["DEF_REB"])
        # If you add DEF_EFG to TR_URLS, you can pull it here. For now we proxy with DEF_EFF.

        # Build multipliers (offense × opponent defense)
        # Efficiency anchors (sqrt to keep from overpowering four-factors)
        eff_anchor_A = max(A_OFF_EFF, 1e-6) / max(lg_avgs["OFF_EFF"], 1e-6)
        eff_anchor_H = max(lg_avgs["DEF_EFF"], 1e-6) / max(H_DEF_EFF, 1e-6)

        off_mult_A = (eff_anchor_A ** 0.5) \
                   * ((A_OFF_EFG / max(lg_avgs["OFF_EFG"],1e-6)) ** W_EFG) \
                   * (((1.0 - A_TOV) / max(1e-6, 1.0 - lg_avgs["TOV_POSS"])) ** W_TOV) \
                   * ((A_OFF_REB / max(lg_avgs["OFF_REB"],1e-6)) ** W_REB)

        def_mult_H = (eff_anchor_H ** 0.5) \
                   * ((H_DEF_REB / max(lg_avgs["DEF_REB"],1e-6)) ** W_REB)
        # Note: if you add DEF_EFG, include a term like (lg_avg_DEF_EFG / H_DEF_EFG) ** W_EFG

        # Mirror for home offense vs away defense
        H_OFF_EFF = get(rH, "OFF_EFF", lg_avgs["OFF_EFF"])
        H_OFF_EFG = get(rH, "OFF_EFG", lg_avgs["OFF_EFG"])
        H_OFF_REB = get(rH, "OFF_REB", lg_avgs["OFF_REB"])
        H_TOV     = get(rH, "TOV_POSS", lg_avgs["TOV_POSS"])

        A_DEF_EFF = get(rA, "DEF_EFF", lg_avgs["DEF_EFF"])
        A_DEF_REB = get(rA, "DEF_REB", lg_avgs["DEF_REB"])

        eff_anchor_Hoff = max(H_OFF_EFF, 1e-6) / max(lg_avgs["OFF_EFF"], 1e-6)
        eff_anchor_Adef = max(lg_avgs["DEF_EFF"], 1e-6) / max(A_DEF_EFF, 1e-6)

        off_mult_H = (eff_anchor_Hoff ** 0.5) \
                   * ((H_OFF_EFG / max(lg_avgs["OFF_EFG"],1e-6)) ** W_EFG) \
                   * (((1.0 - H_TOV) / max(1e-6, 1.0 - lg_avgs["TOV_POSS"])) ** W_TOV) \
                   * ((H_OFF_REB / max(lg_avgs["OFF_REB"],1e-6)) ** W_REB)

        def_mult_A = (eff_anchor_Adef ** 0.5) \
                   * ((A_DEF_REB / max(lg_avgs["DEF_REB"],1e-6)) ** W_REB)

    # Apply multipliers to PPP
    ppp_A_mod = ppp_A * off_mult_A * def_mult_H
    ppp_H_mod = ppp_H * off_mult_H * def_mult_A

    return poss, ppp_A_mod, ppp_H_mod

def mc_distribution(df_kp, df_tr, lg_avgs, away, home, n_sims=N_SIMS):
    poss, ppp_A, ppp_H = _base_params(df_kp, df_tr, lg_avgs, away, home)
    sim_poss = np.maximum(50, np.random.normal(poss, POSS_SD, n_sims))
    sim_pppA = np.random.normal(ppp_A, PPP_SD, n_sims)
    sim_pppH = np.random.normal(ppp_H, PPP_SD, n_sims)
    sim_A = sim_pppA * sim_poss
    sim_H = sim_pppH * sim_poss + HOME_EDGE_POINTS
    return sim_A, sim_H

def confidence_from_edge(edge, hi_edge=6.0):
    e = min(abs(edge) / hi_edge, 1.0)
    return int(round(1 + 9 * e))  # 1..10

# =========================================================
#           SAVE-ROW + STACKED CARD OUTPUT
# =========================================================
def compute_projection_row(df_kp, df_tr_pair, away, home, book_home_spread, book_total):
    df_tr, lg_avgs = df_tr_pair if isinstance(df_tr_pair, tuple) else (None, None)
    sim_A, sim_H = mc_distribution(df_kp, df_tr, lg_avgs, away, home)
    score_A = float(sim_A.mean())
    score_H = float(sim_H.mean())
    model_total = score_A + score_H
    model_spread_home = score_H - score_A
    home_win = float((sim_H > sim_A).mean())
    away_win = 1.0 - home_win

    total_edge = model_total - book_total
    book_home_edge = -book_home_spread
    spread_edge = model_spread_home - book_home_edge

    total_play = "NO BET"
    if total_edge >= TOTAL_EDGE_TH: total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH: total_play = f"UNDER {book_total:.1f}"

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

def stacked_summary(df_kp, df_tr_pair, away, home, book_home_spread, book_total):
    df_tr, lg_avgs = df_tr_pair if isinstance(df_tr_pair, tuple) else (None, None)
    sim_A, sim_H = mc_distribution(df_kp, df_tr, lg_avgs, away, home)
    score_A = float(sim_A.mean()); score_H = float(sim_H.mean())
    total   = score_A + score_H
    spreadH = score_H - score_A
    qA_lo, qA_hi = np.percentile(sim_A, [25, 75])
    qH_lo, qH_hi = np.percentile(sim_H, [25, 75])
    home_win = float((sim_H > sim_A).mean()); away_win = 1.0 - home_win

    total_edge = total - book_total
    book_home_edge = -book_home_spread
    spread_edge = spreadH - book_home_edge
    total_play = "NO BET"
    if total_edge >= TOTAL_EDGE_TH: total_play = f"OVER {book_total:.1f}"
    elif total_edge <= -TOTAL_EDGE_TH: total_play = f"UNDER {book_total:.1f}"
    if spread_edge >= SPREAD_EDGE_TH:
        spread_play = f"{home} {book_home_spread:+.1f}"
    elif spread_edge <= -SPREAD_EDGE_TH:
        spread_play = f"{away} {-book_home_spread:+.1f}"
    else:
        spread_play = "NO BET"

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

# =========================================================
#                           UI
# =========================================================
st.title("🏀 CBB Projection — KenPom + TeamRankings (6 URLs in code)")

with st.sidebar:
    kp_url_override = st.text_input("KenPom CSV URL (optional override)", value="")
    st.caption("If blank, the script will use KENPOM_URL (top of file) or local Ken.csv.")
    st.markdown("---")
    st.write(f"Blend Weights – 2025: **{W_2025:.2f}**, 2024: **{W_2024:.2f}**")
    st.write(f"Possession SD: **{POSS_SD}** | PPP SD: **{PPP_SD}** | Sims: **{N_SIMS}**")
    if st.button("🔄 Refresh data"):
        load_kp.clear(); load_tr_six.clear()
        st.experimental_rerun()

# Load KenPom
try:
    df_kp = load_kp(kp_url_override)
except Exception as e:
    st.error(f"KenPom load error: {e}")
    st.stop()

# Load TeamRankings (six URLs you pasted at top)
try:
    df_tr_raw, lg_avgs = load_tr_six(TR_URLS)
except Exception as e:
    st.warning(f"TR load warning (model will run without TR multipliers): {e}")
    df_tr_raw, lg_avgs = None, None

# Session storage for saved table
if "saved_rows" not in st.session_state:
    st.session_state.saved_rows = []

teams = sorted(df_kp["Team"].unique())
col1, col2 = st.columns(2)
away_team = col1.selectbox("Away Team", teams, index=0)
home_team = col2.selectbox("Home Team", teams, index=1)

book_spread = st.text_input("Home Spread (negative if home favored):", "-5.0")
book_total  = st.text_input("Book Total:", "145.0")

c1, c2 = st.columns(2)
run  = c1.button("Run Projection")
save = c2.button("Save to Table")

if run or save:
    try:
        book_spread_val = float(book_spread)
        book_total_val  = float(book_total)

        # Stacked card
        stacked_summary(df_kp, (df_tr_raw, lg_avgs), away_team, home_team, book_spread_val, book_total_val)

        # Save row if requested
        if save:
            row = compute_projection_row(df_kp, (df_tr_raw, lg_avgs), away_team, home_team, book_spread_val, book_total_val)
            st.session_state.saved_rows.append(row)
            st.success("Saved to table ✅")
    except Exception as e:
        st.error(f"Error: {e}")

# Saved table
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
