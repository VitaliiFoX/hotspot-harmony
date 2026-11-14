"""Step 5 - put MODIS and VIIRS on one scale: MODIS-equivalent fire cell-days.

Every VIIRS fire cell-day gets a weight: the answer to "would MODIS (Terra + Aqua) have reported this?"

    weight = k * share(what the cell-day looked like) * r(day of year)

    share  how much of a MODIS fire cell-day this VIIRS cell-day stands for. Each MODIS cell-day is one
           unit, split equally among the VIIRS cell-days within +-1 cell the same local day; a boosted
           regression model learns that share from fire power, day or night, number and confidence of
           the detections, and pixel size. The model is used only where it earns its place: per country
           it must beat a plain table by fire power on held-out years, otherwise the table is used.
    k      one scale so that totals match (MODIS also sees fires at hours when VIIRS is not overhead)
    r      what is left of the seasonal difference, following the day of the year smoothly

Days when a VIIRS sensor delivered next to nothing while MODIS was busy are sensor gaps, not quiet
days: they are left out of the fit, and in the record that day is taken from MODIS.

All three are fitted on years when both sensors flew and MODIS orbits were stable. NOAA-20 is tied to
S-NPP with one factor (same instrument design, same orbit). The months before Aqua use Terra alone,
scaled by calendar month. Summing weights over any area and period gives a number that means the
same thing in 2003 and in 2025.

Which sensor speaks for which period:
    until 2002-07-03          MODIS Terra x terra_to_modis[month]
    2002-07-04 .. 2021-12-31  MODIS Terra + Aqua, weight 1 (the reference)
    from 2022-01-01           VIIRS NOAA-20 x n20_to_snpp x weight above

Output:
    data/agg/harmonized.parquet   country, cell_id, cell_lat, cell_lon, year, month,
                                  n_harmonized, n_raw, sensor_used
    data/agg/calibration.json     fitted parameters per country

Usage:  uv run python -m pipeline.harmonize
"""

import argparse
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, load_config

FIT = ("2012-02-01", "2021-12-31")  # S-NPP flying and MODIS orbits not yet drifting
TERRA_FIT = ("2003-01-01", "2011-12-31")  # both MODIS flying: used to scale the Terra-only start
AQUA_START = "2002-07-04"  # first Aqua detections in the archive
VIIRS_FROM = "2022-01-01"  # the record switches from MODIS to VIIRS NOAA-20 here
RAW_SWITCH = "2012-02-01"  # the raw record: MODIS before this date, VIIRS S-NPP as delivered from it on
N20_START = "2018-04-01"
FRP_EDGES = [0, 1, 2, 4, 8, 16, 32, 64]  # MW, summed over a VIIRS cell-day
MIN_FIT_CELLDAYS = 5000  # below this a country borrows the pooled calibration
SEASON_HALF_WINDOW = 15  # days: the season factor pools +-15 days around each day of the year
GAP_MIN_MODIS = 100  # a day counts as a sensor gap when MODIS has at least this many cell-days...
GAP_MAX_RATIO = 0.6  # ...and VIIRS has under 0.6 per MODIS cell-day (it normally has about 2)
WEIGHTS_MARGIN = 0.002  # the boosted model must beat the table by 0.2 points of monthly error to be used
WEIGHT_FEATURES = ["lfrp", "lfrp_max", "has_day", "n_det", "n_day", "n_night", "n_high", "scan", "track"]
BOOSTING = dict(
    loss="poisson", max_iter=400, learning_rate=0.05, max_leaf_nodes=63, min_samples_leaf=100, random_state=0
)

RECORD = [
    {"sensor": "modis_terra", "label": "MODIS Terra only, scaled", "from": "2000-11", "to": "2002-06"},
    {"sensor": "modis", "label": "MODIS Terra + Aqua (reference)", "from": "2002-07", "to": "2021-12"},
    {"sensor": "viirs_noaa20", "label": "VIIRS NOAA-20, harmonized", "from": "2022-01", "to": None},
]


def load_cell_days(con: duckdb.DuckDBPyConnection, cell_day: Path, country: str) -> pd.DataFrame:
    """Cell-days of one country, with `matched`: did MODIS report fire within +-1 cell that local day?"""
    con.execute(
        f"create or replace temp table cd as select * from read_parquet('{cell_day.as_posix()}') where country = ?",
        [country],
    )
    con.execute("""
        create or replace temp table modis_nb as
        select distinct local_date, gx + dx as gx, gy + dy as gy
        from cd, (select unnest([-1, 0, 1]) as dx), (select unnest([-1, 0, 1]) as dy)
        where stream = 'modis'
    """)
    # count-preserving target: every MODIS cell-day is one unit, split equally among the cell-days of a VIIRS
    # sensor within +-1 cell that day. Summed over a sensor, shares equal the MODIS cell-days it explains.
    con.execute("""
        create or replace temp table share as
        with pairs as (
            select v.stream, m.local_date, m.gx as mx, m.gy as my, v.gx, v.gy
            from cd m, (select unnest([-1, 0, 1]) as dx), (select unnest([-1, 0, 1]) as dy), cd v
            where m.stream = 'modis' and v.stream like 'viirs%'
              and v.local_date = m.local_date and v.gx = m.gx + dx and v.gy = m.gy + dy
        )
        select stream, local_date, gx, gy, sum(1.0 / n_explaining) as share
        from (select *, count(*) over (partition by stream, local_date, mx, my) as n_explaining from pairs)
        group by all
    """)
    df = con.execute("""
        select cd.*,
               (stream like 'viirs%' and exists (
                   select 1 from modis_nb n where n.local_date = cd.local_date and n.gx = cd.gx and n.gy = cd.gy
               ))::integer as matched,
               coalesce(share.share, 0.0) as share
        from cd left join share using (stream, local_date, gx, gy)
        -- a fixed row order: the boosted model samples rows, so an arbitrary order would change it run to run
        order by stream, local_date, gx, gy
    """).df()
    return prepare(df)


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["local_date"] = pd.to_datetime(df.local_date)
    df["y"] = df.local_date.dt.year
    df["m"] = df.local_date.dt.month
    df["doy"] = df.local_date.dt.day_of_year
    df["b"] = np.digitize(df.frp, FRP_EDGES) + 10 * df.has_day  # FRP bin, day and night kept apart
    df["lfrp"] = np.log1p(df.frp.clip(lower=0))
    df["lfrp_max"] = np.log1p(df.frp_max.clip(lower=0))
    df["tx"] = np.floor(df.lon).astype(int)
    df["ty"] = np.floor(df.lat).astype(int)
    return df


def gap_days(df: pd.DataFrame, stream: str) -> pd.DatetimeIndex:
    """Days when `stream` (a VIIRS sensor) was not really observing: MODIS is busy and the sensor is nearly silent.

    Only looked for inside the sensor's own lifetime, so the years before its launch are not gaps.
    """
    own = df[df.stream == stream]
    if own.empty:
        return pd.DatetimeIndex([])
    modis = df[(df.stream == "modis") & df.local_date.between(own.local_date.min(), own.local_date.max())]
    counts = [modis.groupby("local_date").size().rename("modis"), own.groupby("local_date").size().rename("own")]
    daily = pd.concat(counts, axis=1, sort=True).fillna(0)
    return pd.DatetimeIndex(daily.index[(daily.modis >= GAP_MIN_MODIS) & (daily.own < GAP_MAX_RATIO * daily.modis)])


def season_factor(
    doy_truth: np.ndarray, doy_pred: np.ndarray, w_pred: np.ndarray, half: int = SEASON_HALF_WINDOW
) -> np.ndarray:
    """truth / prediction by day of year, pooled over +-`half` days with a triangular window that wraps at New Year.

    Returns an array indexed by day of year (1..366; index 0 unused). Days with nothing to learn from get 1.
    """
    num = np.bincount(doy_truth, minlength=367)[1:].astype(float)
    den = np.bincount(doy_pred, weights=w_pred, minlength=367)[1:]
    window = np.concatenate([np.arange(1, half + 2), np.arange(half, 0, -1)]).astype(float)
    num, den = (np.convolve(np.concatenate([a[-half:], a, a[:half]]), window, "valid") for a in (num, den))
    r = np.divide(num, den, out=np.ones_like(num), where=den > 0)
    return np.concatenate([[1.0], r])


def base_share(par: dict, cells: pd.DataFrame) -> np.ndarray:
    """The unscaled share of a MODIS cell-day each VIIRS cell-day stands for: boosted model, or the table by FRP bin."""
    if par.get("model") is not None:
        return np.clip(par["model"].predict(cells[WEIGHT_FEATURES]), 0, None)
    return cells.b.map(par["p"]).fillna(par["p"].mean()).to_numpy()


def fit_viirs(viirs: pd.DataFrame, modis: pd.DataFrame, weights: str = "boosted") -> dict:
    """viirs: VIIRS cell-days of the fit period (features, share, matched). modis: MODIS cell-days of that period."""
    par = {"p": viirs.groupby("b").matched.mean(), "model": None}  # p also feeds the detection curve in the report
    if weights == "boosted":
        from sklearn.ensemble import HistGradientBoostingRegressor

        par["model"] = HistGradientBoostingRegressor(**BOOSTING).fit(viirs[WEIGHT_FEATURES], viirs.share)
    base = base_share(par, viirs)
    par["k"] = float(len(modis) / base.sum())
    doy = viirs.doy.to_numpy()
    r = season_factor(modis.doy.to_numpy(), doy, base * par["k"])
    par["r"] = r * len(modis) / (base * par["k"] * r[doy]).sum()  # smoothing must not shift the overall level
    return par


def held_out_month_error(viirs: pd.DataFrame, modis: pd.DataFrame, weights: str, groups: int = 3) -> float:
    """Country x month error when each third of the years is predicted by a fit on the other two thirds."""
    years = sorted(viirs.y.unique())
    folds = []
    for held_out in (years[i::groups] for i in range(groups)):
        par = fit_viirs(viirs[~viirs.y.isin(held_out)], modis[~modis.y.isin(held_out)], weights)
        test = viirs[viirs.y.isin(held_out)]
        folds.append(test.assign(w=viirs_weights(par, test)))
    pred = pd.concat(folds).groupby(["y", "m"]).w.sum()
    truth = modis.groupby(["y", "m"]).size()
    pred, truth = pred.align(truth, fill_value=0.0)
    return float((pred - truth).abs().sum() / truth.sum())


def choose_weights(viirs: pd.DataFrame, modis: pd.DataFrame) -> tuple[str, dict]:
    """The boosted model only if it beats the table by fire power by a clear margin on held-out years.

    It helps in some countries and hurts in others (measured: better in Ukraine, worse in Argentina),
    so it has to earn its place each time; on a near tie the simpler table wins.
    """
    errors = {w: round(held_out_month_error(viirs, modis, w), 4) for w in ("bins", "boosted")}
    choice = "boosted" if errors["boosted"] < errors["bins"] - WEIGHTS_MARGIN else "bins"
    return choice, errors


def viirs_weights(par: dict, cells: pd.DataFrame) -> pd.Series:
    """MODIS-equivalent weight of each VIIRS cell-day in `cells`."""
    return pd.Series(base_share(par, cells) * par["k"] * par["r"][cells.doy.to_numpy()], index=cells.index)


def fit_terra(terra: pd.DataFrame, modis: pd.DataFrame) -> pd.Series:
    """Calendar-month factor from Terra-only cell-days to Terra + Aqua cell-days."""
    return (modis.groupby("m").size() / terra.groupby("m").size()).replace([np.inf, -np.inf], np.nan).dropna()


def fit_n20(df: pd.DataFrame, w: pd.Series) -> tuple[float | None, list[str]]:
    """One factor NOAA-20 -> S-NPP from months when both worked normally.

    Months where the two raw counts differ by more than 20% are sensor gaps (e.g. S-NPP in Jul-Aug 2022),
    not fire: they are left out of the fit and reported.
    """
    both = df[(df.local_date >= N20_START) & df.stream.isin(["viirs_snpp", "viirs_noaa20"])]
    if both.empty:
        return None, []
    ym = both.local_date.dt.to_period("M")
    n = both.groupby([ym, "stream"]).size().unstack(fill_value=0)
    ws = w[both.index].groupby([ym, both.stream]).sum().unstack(fill_value=0.0)
    if not {"viirs_snpp", "viirs_noaa20"} <= set(n.columns):
        return None, []
    busy = (n.viirs_snpp >= 30) & (n.viirs_noaa20 >= 30)
    ratio = n.viirs_snpp / n.viirs_noaa20.where(n.viirs_noaa20 > 0)
    ok = busy & ratio.between(0.8, 1.25)
    if ok.sum() < 6:
        return None, []
    factor = float(ws.viirs_snpp[ok].sum() / ws.viirs_noaa20[ok].sum())
    return factor, [str(p) for p in n.index[busy & ~ok]]


def calibrate(frames: list[pd.DataFrame], weights: str = "auto") -> dict | None:
    """Fit every parameter on the given cell-days. None when there is too little overlap to trust it."""
    # gaps are found per country: a sensor outage is the same day everywhere, but "MODIS is busy" is not
    gaps = {
        stream: pd.DatetimeIndex(sorted(set().union(*(gap_days(f, stream) for f in frames))))
        for stream in ("viirs_snpp", "viirs_noaa20")
    }
    frames = [f.assign(snpp_gap=f.local_date.isin(gap_days(f, "viirs_snpp"))) for f in frames]
    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    fit = df.local_date.between(*FIT) & ~df.snpp_gap
    viirs, modis = df[fit & (df.stream == "viirs_snpp")], df[fit & (df.stream == "modis")]
    if len(viirs) < MIN_FIT_CELLDAYS or len(modis) < MIN_FIT_CELLDAYS / 2:
        return None
    choice = {}
    if weights == "auto":
        weights, choice = choose_weights(viirs, modis)
    par = fit_viirs(viirs, modis, weights)
    par["weights"], par["weights_held_out_month_error"] = weights, choice
    par["gap_days"] = gaps
    is_viirs = df.stream.isin(["viirs_snpp", "viirs_noaa20"])
    w = viirs_weights(par, df[is_viirs])
    par["n20_to_snpp"], par["sensor_gap_months"] = fit_n20(df, w)
    tf = df.local_date.between(*TERRA_FIT)
    par["terra"] = fit_terra(df[tf & (df.stream == "modis_terra")], df[tf & (df.stream == "modis")])
    par["n_fit"] = int(len(viirs))
    return par


def apply(df: pd.DataFrame, par: dict) -> pd.DataFrame:
    """Add `weight`, `in_series` (belongs to the harmonized record) and `in_raw` (belongs to the raw record)."""
    df = df.copy()
    s, d = df.stream, df.local_date
    df["weight"] = np.nan
    v = s.isin(["viirs_snpp", "viirs_noaa20"])
    df.loc[v, "weight"] = viirs_weights(par, df[v])
    df.loc[s == "viirs_noaa20", "weight"] *= par["n20_to_snpp"] or 1.0
    df.loc[s == "modis_terra", "weight"] = df.m[s == "modis_terra"].map(par["terra"]).fillna(1.0)
    df.loc[s == "modis", "weight"] = 1.0
    # a day NOAA-20 did not really observe is taken from MODIS instead of being read as a quiet day
    n20_gap = d.isin(gap_days(df, "viirs_noaa20"))
    df["in_series"] = (
        ((s == "modis_terra") & (d < AQUA_START))
        | ((s == "modis") & (d >= AQUA_START) & ((d < VIIRS_FROM) | n20_gap))
        | ((s == "viirs_noaa20") & (d >= VIIRS_FROM) & ~n20_gap)
    )
    df["in_raw"] = (
        ((s == "modis") & (d < RAW_SWITCH))
        | ((s == "viirs_snpp") & (d >= RAW_SWITCH))
    )
    return df


def sensor_used(year: pd.Series, month: pd.Series) -> pd.Series:
    ym = year * 100 + month
    names = np.select([ym <= 200206, ym <= 202112], ["modis_terra", "modis"], "viirs_noaa20")
    return pd.Series(names, index=year.index)


def monthly_cells(df: pd.DataFrame, cell_deg: float) -> pd.DataFrame:
    """Weighted cell-days -> one row per 0.25 deg cell and month."""
    d = df[df.in_series | df.in_raw]
    g = (
        d.assign(h=d.weight.where(d.in_series, 0.0), r=d.in_raw.astype(int))
        .groupby(["country", "cell_id", "y", "m"])
        .agg(n_harmonized=("h", "sum"), n_raw=("r", "sum"))
        .reset_index()
        .rename(columns={"y": "year", "m": "month"})
    )
    ncols = round(360 / cell_deg)
    g["cell_lat"] = (g.cell_id // ncols + 0.5) * cell_deg - 90
    g["cell_lon"] = (g.cell_id % ncols + 0.5) * cell_deg - 180
    g["n_harmonized"] = g.n_harmonized.round(3)
    g["sensor_used"] = sensor_used(g.year, g.month)
    cols = ["country", "cell_id", "cell_lat", "cell_lon", "year", "month", "n_harmonized", "n_raw", "sensor_used"]
    return g[cols]


def params_to_json(par: dict, source: str) -> dict:
    return {
        "source": source,  # own | pooled
        "fit_period": list(FIT),
        "fit_viirs_celldays": par["n_fit"],
        "weights": par["weights"],  # boosted (scikit-learn HistGradientBoostingRegressor, Poisson) | bins (table)
        "weights_held_out_month_error": par["weights_held_out_month_error"],  # what the choice was based on
        "weight_features": WEIGHT_FEATURES if par["weights"] == "boosted" else ["frp bin", "has_day"],
        "k": round(par["k"], 4),
        "detection_curve": [
            {
                "has_day": int(b // 10),
                "frp_from_mw": FRP_EDGES[b % 10 - 1],
                "frp_to_mw": FRP_EDGES[b % 10] if b % 10 < len(FRP_EDGES) else None,
                "p": round(float(p), 4),
            }
            for b, p in par["p"].items()
        ],
        "season_factor_by_day_of_year": [round(float(v), 4) for v in par["r"][1:]],
        "season_half_window_days": SEASON_HALF_WINDOW,
        "sensor_gap_days": {s: [f"{d:%Y-%m-%d}" for d in days] for s, days in par["gap_days"].items()},
        "n20_to_snpp": None if par["n20_to_snpp"] is None else round(par["n20_to_snpp"], 4),
        "sensor_gap_months": par["sensor_gap_months"],
        "terra_to_modis": {int(m): round(float(v), 4) for m, v in par["terra"].items()},
    }


def harmonize_all(
    con: duckdb.DuckDBPyConnection, cell_day: Path, countries: list[str], weights: str = "auto"
) -> dict[str, tuple]:
    """country -> (cell-days with weights, parameters, 'own' | 'pooled'). Countries without data are skipped."""
    frames = {c: load_cell_days(con, cell_day, c) for c in countries}
    frames = {c: f for c, f in frames.items() if len(f)}
    own = {c: calibrate([f], weights) for c, f in frames.items()}
    good = [frames[c] for c, p in own.items() if p is not None]
    # the pooled calibration costs a fit on every country at once: only when some country needs to borrow it
    need_pooled = any(p is None or p["n20_to_snpp"] is None for p in own.values())
    pooled = calibrate(good, weights) if good and need_pooled else None
    out = {}
    for c, f in frames.items():
        par, source = (own[c], "own") if own[c] is not None else (pooled, "pooled")
        if par is None:
            print(f"warning: {c}: no country has enough MODIS/VIIRS overlap to calibrate - skipped")
            continue
        if par["n20_to_snpp"] is None and pooled is not None:
            par = {**par, "n20_to_snpp": pooled["n20_to_snpp"]}
        out[c] = (apply(f, par), par, source)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument(
        "--weights",
        choices=["auto", "boosted", "bins"],
        default="auto",
        help="detection weight: boosted model, table by fire power, or (auto) the model only where it wins held-out",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    con = duckdb.connect()
    agg = args.data / "agg"
    results = harmonize_all(con, agg / "cell_day.parquet", cfg.region_names(), args.weights)
    if not results:
        raise SystemExit("harmonize: nothing to do - run pipeline.aggregate first")

    table = pd.concat([monthly_cells(df, cfg.cell_deg) for df, _, _ in results.values()], ignore_index=True)
    con.register("harmonized_df", table)
    con.execute(f"copy harmonized_df to '{(agg / 'harmonized.parquet').as_posix()}' (format parquet, compression zstd)")
    calib = {c: params_to_json(par, source) for c, (_, par, source) in results.items()}
    (agg / "calibration.json").write_text(json.dumps(calib, indent=2))

    for c, (df, par, source) in results.items():
        s = df[df.in_series]
        print(
            f"harmonize: {c:<12} calibration {source:<6} weights {par['weights']:<7} k={par['k']:.3f} "
            f"n20_to_snpp={par['n20_to_snpp'] or 1:.3f}  "
            f"{s.local_date.min():%Y-%m} .. {s.local_date.max():%Y-%m}  {s.weight.sum():>12,.0f} harmonized cell-days"
        )
        if par["sensor_gap_months"]:
            print(f"           sensor gap months left out of the NOAA-20 fit: {', '.join(par['sensor_gap_months'])}")
    print(f"harmonize: {len(table):,} cell-month rows -> {agg / 'harmonized.parquet'}")


if __name__ == "__main__":
    main()
