# app.py
import streamlit as st
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import string

# =========================================================
#                  YOUR URLs (already filled)
# =========================================================
# All have same structure: B=Team, C=2025, H=2024
TR_URLS = {
    "OFF_EFF":  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=1940805537&single=true&output=csv",
    "DEF_EFF":  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=2137299930&single=true&output=csv",
    "OFF_REB":  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=922672560&single=true&output=csv",
    "DEF_REB":  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=312492729&single=true&output=csv",
    "TOV_POSS": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=993087389&single=true&output=csv",
    "OFF_EFG":  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=803704968&single=true&output=csv",
    # No DEF_EFG for now (by your instruction)
}

# KenPom CSV (publish-to-web link). Headers are on row 2 → header=1.
KENPOM_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVL4J6ZbqLvKsS1E32DtBijLaSdrdtermV-Xyno1jSwGHx0m59JAEbq-zVpDztR7CjX-0Ru4jUjMR/pub?gid=351220539&single=true&output=csv"

# =========================================================
#                    MODEL CONFIG
# =========================================================
LEAGUE_AVG_ADJ   = 105.0   # per-100-pos baseline
HOME_EDGE_POINTS = 3.0     # bigger HCA for CBB
ALPHA_SHRINK     = 0.0     # no shrinkage (match KenPom-style separation)

TOTAL_EDGE_TH    = 2.0     # O/U play threshold (points)
SPREAD_EDGE_TH   = 1.5     # spread play threshold (points)

# Monte Carlo (separate variance sources)
N_SIMS           = 8000
POSS_SD          = 4.5     # SD of game possessions
PPP_SD           = 0.055   # SD of points-per-possession

# Four-factor-ish weights (FT rate omitted)
W_EFG = 0.40
W_TOV = 0.25
W_REB = 0.20

# All TR CSVs share letters:
TEAM_LETTER  = "B"
VAL25_LETTER = "C"
VAL24_LETTER = "H"

# =========================================================
#              HELPERS / UTILITIES
# =========================================================
def col_letter_to_index(letter: str) -> int:
    if not letter:
        return None
    s = letter.strip().upper()
    val = 0
    for ch in s:
        if ch not in string.ascii_uppercase:
            return None
        val = val * 26 + (ord(ch) - ord('A') + 1)
    return val - 1

TEAM_IDX = col_letter_to_index(TEAM_LETTER)
IDX_25   = col_letter_to_index(VAL25_LETTER)
IDX_24   = col_letter_to_index(VAL24_LETTER)

def percentify(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    if s.dropna().mean() > 1.0:  # looks like 52.3 → 0.523
        s = s / 100.0
    return s

def blend_25_24(v25, v24, w25, w24):
    v25 = pd.to_numeric(v25, errors="coerce")
    v24 = pd.to_numeric(v24, errors="coerce")
    return w25 * v25 + w24 * v24

# =========================================================
#                  KENPOM LOADER (row 2 headers)
# =========================================================
@st.cache_data(ttl=600)
def load_kp(url_override: str = "") -> pd.DataFrame:
    """
    Loads KenPom-like CSV, tolerates headers on row 2 (header=1), and maps aliases.
    Needs final columns: Team, AdjO, AdjD, AdjT.
    """
    src = (url_override or KENPOM_URL).strip()
    if not src:
        # try local fallback
        for p in ["Ken.csv", "data/Ken.csv"]:
            if Path(p).exists():
                src = p
                break
    if not src:
        raise FileNotFoundError("KenPom CSV not set. Provide KENPOM_URL or place Ken.csv in repo.")

    # 1) try header=1 (your sheet)
    try:
        df = pd.read_csv(src, header=1)
    except Exception:
        df = pd.read_csv(src)

    def normalize(df_):
        df_.columns = [str(c).strip() for c in df_.columns]
        rename = {}
        if "ORtg" in df_.columns and "AdjO" not in df_.columns: rename["ORtg"] = "AdjO"
        if "DRtg" in df_.columns and "AdjD" not in df_.columns: rename["DRtg"] = "AdjD"
        if "Tempo" in df_.columns and "AdjT" not in df_.columns: rename["Tempo"] = "AdjT"
        if rename: df_ = df_.rename(columns=rename)
        return df_

    df = normalize(df)
    required = {"Team","AdjO","AdjD","AdjT"}
    if not required.issubset(df.columns):
        # Try manual promotion of first row to header
        df_try = pd.read_csv(src)
        if len(df_try) >= 1:
            df_try.columns = [str(x).strip() for x in df_try.iloc[0].tolist()]
            df_try = df_try.iloc[1:].reset_index(drop=True)
            df_try = normalize(df_try)
            if required.issubset(df_try.columns):
                df = df_try
            else:
                raise ValueError(f"KenPom missing columns {required}. Found: {list(df.columns)}")

    df = df[["Team","AdjO","AdjD","AdjT"]].copy()
    for c in ["AdjO","AdjD","AdjT"]:
        df[c] = (
            df[c].astype(str)
                 .str.replace("+","", regex=False)
                 .str.replace(",","", regex=False)
        )
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["Team","AdjO","AdjD","AdjT"]).reset_index(drop=True)
    return df

# =========================================================
#           TEAMRANKINGS: 6 URLS -> MERGED TABLE
# =========================================================
@st.cache_data(ttl=600)
def load_tr(urls: dict, w25: float, w24: float):
    """
    Loads six CSVs (B=Team, C=2025, H=2024), blends to:
      Team, OFF_EFF, DEF_EFF, OFF_REB, DEF_REB, TOV_POSS, OFF_EFG
    Percent-y stats (REB%, eFG%) coerced to 0..1.
    Returns (df_merged, league_averages_dict)
    """
    frames = {}
    for key, u in urls.items():
        if not u:
            continue
        df = pd.read_csv(u)
        # pick by index
        for idx in [TEAM_IDX, IDX_25, IDX_24]:
            if idx is None or idx >= df.shape[1]:
                raise ValueError(f"{key}: CSV does not contain expected columns B/C/H.")
        df = df.iloc[:, [TEAM_IDX, IDX_25, IDX_24]].copy()
        df.columns = ["Team","v2025","v2024"]

        if key in ["OFF_REB","DEF_REB","OFF_EFG"]:
            df["v2025"] = percentify(df["v2025"])
            df["v2024"] = percentify(df["v2024"])

        df[key] = blend_25_24(df["v2025"], df["v2024"], w25, w24)
        out = df[["Team", key]].copy()
        out["_team_key"] = out["Team"].astype(str).str.lower()
        frames[key] = out

    if not frames:
        cols = ["Team","OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]
        return pd.DataFrame(columns=cols), {}

    merged = None
    for key, f in frames.items():
        merged = f if merged is None else pd.merge(merged, f, on="_team_key", how="outer")

    # Rebuild single Team column
    if "Team_x" in merged.columns or "Team_y" in merged.columns:
        team_cols = [c for c in merged.columns if c.startswith("Team")]
        merged["Team"] = None
        for c in team_cols:
            merged["Team"] = merged["Team"].combine_first(merged[c])
        merged.drop(columns=team_cols, inplace=True)

    for c in ["OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]:
        if c not in merged.columns:
            merged[c] = np.nan

    merged = merged[["_team_key","Team","OFF_EFF","DEF_EFF","OFF_REB","DEF_REB","TOV_POSS","OFF_EFG"]].copy()

    # League averages for fallbacks
    lg = {
        "OFF_EFF":  float(pd.to_numeric(merged["OFF_EFF"],  errors="coerce").dropna().mean()) or 105.0,
        "DEF_EFF":  float(pd.to_numeric(merged["DEF_EFF"],  errors="coerce").dropna().mean()) or 105.0,
        "OFF_REB":  float(pd.to_numeric(merged["OFF_REB"],  errors="coerce").dropna().mean()) or 0.30,
        "DEF_REB":  float(pd.to_numeric(merged["DEF_REB"],  errors="coerce").dropna().mean()) or 0.70,
        "TOV_POSS": float(pd.to_numeric(merged["TOV_POSS"], errors="coerce").dropna().mean()) or 0.18,
        "OFF_EFG":  float(pd.to_numeric(merged["OFF_EFG"],  errors="coerce").dropna().mean()) or 0.51,
    }
    return merged, lg

def tr_lookup(df, team):
    r = df[df["_team_key"] == team.lower()]
    if r.empty:
        r = df[df["Team"].astype(str).str.lower().str.contains(team.lower(), na=False)]
    return None if r.empty else r.iloc[0]

def kp_lookup(df, team):
    r = df[df["Team"].str.lower() == team.lower()]
    if r.empty:
        r = df[df["Team"].str.lower().str.contains(team.lower(), na=False)]
    if r.empty:
        raise ValueError(f"Team '{team}' not found in KenPom data.")
    return r.iloc[0]

# =========================================================
#         MULTIPLICATIVE PPP BASELINE + MONTE CARLO
# =========================================================
def base_params(df_kp, df_tr, lg, away, home):
    A = kp_lookup(df_kp, away)
    H = kp_lookup(df_kp, home)

    # No pace damping: use raw mean of AdjT
    poss = 0.5 * (A["AdjT"] + H["AdjT"])

    BASE_PPP = LEAGUE_AVG_ADJ / 100.0

    # Multiplicative PPP vs opponent
    ppp_A = BASE_PPP * (A["AdjO"] / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / H["AdjD"])
    ppp_H = BASE_PPP * (H["AdjO"] / LEAGUE_AVG_ADJ) * (LEAGUE_AVG_ADJ / A["AdjD"])

    # Optional TeamRankings multipliers (keep moderate so KP dominates)
    if df_tr is not None and lg:
        rA = tr_lookup(df_tr, away)
        rH = tr_lookup(df_tr, home)

        def g(r, name, default):
            if r is None: return default
            v = r.get(name, np.nan)
            return float(v) if np.isfinite(v) else default

        A_OFF_EFF = g(rA, "OFF_EFF", lg["OFF_EFF"])
        A_OFF_EFG = g(rA, "OFF_EFG", lg["OFF_EFG"])
        A_OFF_REB = g(rA, "OFF_REB", lg["OFF_REB"])
        A_TOV     = g(rA, "TOV_POSS", lg["TOV_POSS"])

        H_DEF_EFF = g(rH, "DEF_EFF", lg["DEF_EFF"])
        H_DEF_REB = g(rH, "DEF_REB", lg["DEF_REB"])

        # Efficiency anchors (damped)
        eff_anchor_A  = max(A_OFF_EFF, 1e-6) / max(lg["OFF_EFF"], 1e-6)
        eff_anchor_Hd = max(lg["DEF_EFF"], 1e-6) / max(H_DEF_EFF, 1e-6)

        # Offense multipliers (A on O, H on D)
        off_mult_A = (eff_anchor_A ** 0.5) \
                   * ((A_OFF_EFG / max(lg["OFF_EFG"],1e-6)) ** W_EFG) \
                   * (((1.0 - A_TOV) / max(1e-6, 1.0 - lg["TOV_POSS"])) ** W_TOV) \
                   * ((A_OFF_REB / max(lg["OFF_REB"],1e-6)) ** W_REB)

        def_mult_H = (eff_anchor_Hd ** 0.5) \
                   * ((H_DEF_REB / max(lg["DEF_REB"],1e-6)) ** W_REB)

        # Mirror for home offense vs away defense
        H_OFF_EFF = g(rH, "OFF_EFF", lg["OFF_EFF"])
        H_OFF_EFG = g(rH, "OFF_EFG", lg["OFF_EFG"])
        H_OFF_REB = g(rH, "OFF_REB", lg["OFF_REB"])
        H_TOV     = g(rH, "TOV_POSS", lg["TOV_POSS"])

        A_DEF_EFF = g(rA, "DEF_EFF", lg["DEF_EFF"])
        A_DEF_REB = g(rA, "DEF_REB", lg["DEF_REB"])

        eff_anchor_Ho = max(H_OFF_EFF, 1e-6) / max(lg["OFF_EFF"], 1e-6)
        eff_anchor_Ad = max(lg["DEF_EFF"], 1e-6) / max(A_DEF_EFF, 1e-6)

        off_mult_H = (eff_anchor_Ho ** 0.5) \
                   * ((H_OFF_EFG / max(lg["OFF_EFG"],1e-6)) ** W_EFG) \
                   * (((1.0 - H_TOV) / max(1e-6, 1.0 - lg["TOV_POSS"])) ** W_TOV) \
                   * ((H_OFF_REB / max(lg["OFF_REB"],1e-6)) ** W_REB)

        def_mult_A = (eff_anchor_Ad ** 0.5) \
                   * ((A_DEF_REB / max(lg["DEF_REB"],1e-6)) ** W_REB)

        # Gently damp TR influence
        damp = 0.5
        ppp_A *= (off_mult_A ** damp) * (def_mult_H ** damp)
        ppp_H *= (off_mult_H ** damp) * (def_mult_A ** damp)

    return poss, ppp_A, ppp_H

def mc_distribution(df_kp, df_tr, lg, away, home, n_sims=N_SIMS):
    poss, ppp_A, ppp_H = base_params(df_kp, df_tr, lg, away, home)
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
#           STACKED CARD + SAVE TO TABLE
# =========================================================
def show_card(df_kp, df_tr, lg, away, home, book_home_spread, book_total):
    sim_A, sim_H = mc_distribution(df_kp, df_tr, lg, away, home)
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

    # Return a dict for saving
    return {
        "Away": away, "Home": home,
        "Book Spread (Home)": f"{book_home_spread:+.1f}",
        "Book Total": round(book_total, 1),
        "Model Away Pts": round(score_A, 1),
        "Model Home Pts": round(score_H, 1),
        "Model Total": round(total, 1),
        "Model Spread (Home)": round(spreadH, 1),
        "Total Edge": round(total_edge, 1),
        "Spread Edge": round(spread_edge, 1),
        "Totals Play": total_play,
        "Spread Play": spread_play,
        "Home Win %": round(home_win * 100, 1),
        "Away Win %": round(away_win * 100, 1),
        "Confidence (1-10)": conf,
    }

# =========================================================
#                           UI
# =========================================================
st.title("🏀 CBB Projection — KenPom + TeamRankings (6 URLs)")

with st.sidebar:
    st.markdown("### Data Controls")
    w25 = st.slider("Blend: 2025 weight", 0.0, 1.0, 0.50, 0.05)
    w24 = 1.0 - w25
    st.caption(f"2025={w25:.2f} | 2024={w24:.2f}")
    kp_override = st.text_input("KenPom CSV URL (optional override)", "")
    if st.button("🔄 Refresh caches"):
        load_kp.clear(); load_tr.clear()
        st.experimental_rerun()
    st.markdown("---")
    st.write(f"Poss SD: **{POSS_SD}**, PPP SD: **{PPP_SD}**, Sims: **{N_SIMS}**")

# Load data
try:
    df_kp = load_kp(kp_override)
except Exception as e:
    st.error(f"KenPom load error: {e}")
    st.stop()

try:
    df_tr, lg_avgs = load_tr(TR_URLS, w25, w24)
except Exception as e:
    st.warning(f"TeamRankings load warning (model will run without TR multipliers): {e}")
    df_tr, lg_avgs = None, {}

# Session table
if "saved_rows" not in st.session_state:
    st.session_state.saved_rows = []

teams = sorted(df_kp["Team"].unique())
c1, c2 = st.columns(2)
away = c1.selectbox("Away Team", teams, index=0)
home = c2.selectbox("Home Team", teams, index=1)

book_spread = st.text_input("Home Spread (negative if home favored):", "-5.0")
book_total  = st.text_input("Book Total:", "145.0")

b1, b2 = st.columns(2)
run  = b1.button("Run Projection")
save = b2.button("Save to Table")

if run or save:
    try:
        bs = float(book_spread); bt = float(book_total)
        row = show_card(df_kp, df_tr, lg_avgs, away, home, bs, bt)
        if save:
            st.session_state.saved_rows.append(row)
            st.success("Saved to table ✅")
    except Exception as e:
        st.error(f"Error: {e}")

st.markdown("---")
st.subheader("📋 Saved Games")
if not st.session_state.saved_rows:
    st.info("No games saved yet. Run a projection and click **Save to Table**.")
else:
    df_saved = pd.DataFrame(st.session_state.saved_rows)
    order = [
        "Away","Home","Book Spread (Home)","Book Total",
        "Model Away Pts","Model Home Pts","Model Total","Model Spread (Home)",
        "Total Edge","Spread Edge","Totals Play","Spread Play",
        "Home Win %","Away Win %","Confidence (1-10)"
    ]
    df_saved = df_saved.reindex(columns=order)
    st.dataframe(df_saved, use_container_width=True)

    csv_bytes = df_saved.to_csv(index=False).encode("utf-8")
    fname = f"cbb_saved_{datetime.now().strftime('%Y-%m-%d_%H%M')}.csv"
    st.download_button("⬇️ Download CSV", data=csv_bytes, file_name=fname, mime="text/csv")

    c3, c4 = st.columns(2)
    if c3.button("↩️ Undo last"):
        st.session_state.saved_rows.pop(); st.experimental_rerun()
    if c4.button("🗑️ Clear all"):
        st.session_state.saved_rows = []; st.experimental_rerun()
