"""Step 5 - put MODIS and VIIRS on one scale: MODIS-equivalent fire cell-days.

Every VIIRS fire cell-day gets a weight: the answer to "would MODIS (Terra + Aqua) have reported this?"

    weight = k * share(what the cell-day looked like) * r(day of year)

    share  how much of a MODIS fire cell-day this VIIRS cell-day stands for. Each MODIS cell-day is one
           unit, split equally among the VIIRS cell-days within +-1 cell the same local day; a boosted
           regression model learns that share from fire power, day or night, number and confidence of
           the detections, and pixel size.
    k      one scale so that totals match (MODIS also sees fires at hours when VIIRS is not overhead)
    r      what is left of the seasonal difference, following the day of the year smoothly

A second, independent estimate looks at context instead of single cell-days: a boosted model predicts the
MODIS fire cell-days of a 0.25 degree cell and day from the VIIRS activity in that cell, in the cells
around it and on the days before and after. It can account for fires MODIS saw at an hour when VIIRS
was not overhead, which no single VIIRS cell-day can stand in for.

Nothing boosted is used on trust. Per country the table by fire power, the boosted weight, the context
model and the means of weight and context are scored on held-out years; the simple table stays unless
another one beats it by a clear margin (`choose_method`).

Days when a VIIRS sensor delivered next to nothing while MODIS or the other VIIRS sensor was busy are
sensor gaps, not quiet days: they are left out of the fit, and in the record that day is taken from MODIS.

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
GAP_MIN_TWIN = 50  # ...or when the other VIIRS sensor has at least this many cell-days...
GAP_MAX_TWIN_RATIO = 0.1  # ...and this one has under a tenth of them (same instrument, 50 minutes apart)
METHOD_MARGIN = 0.002  # anything boosted must beat the plain table by 0.2 points of monthly error to be used
METHODS = ("bins", "boosted", "context", "bins+context", "boosted+context")
FIT_THREADS = 8
WEIGHT_FEATURES = ["lfrp", "lfrp_max", "has_day", "n_det", "n_day", "n_night", "n_high", "scan", "track"]
CONTEXT_FEATURES = [
    "cd", "cd_day", "cd_night", "lfrp", "lfrp_max", "det", "high", "cd_weak", "cd_strong",  # the cell today
    "nb_cd", "lnb_frp",  # the eight cells around it today
    "cd_p1", "lfrp_p1", "cd_p2", "cd_n1", "lfrp_n1", "cd_n2",  # the cell one and two days before and after
    "lat", "lon", "doy_sin", "doy_cos",  # where and when in the year
]  # fmt: skip
# Squared error with a fixed number of rounds, on purpose. scikit-learn's Poisson loss ran away to 1e63 on the
# Argentina context table, and its automatic early stopping sometimes quit after 10 rounds. This setting
# matched LightGBM's Poisson model on held-out years in both countries and fits in seconds.
BOOSTING = dict(
    loss="squared_error", early_stopping=False, max_iter=150, learning_rate=0.1, max_leaf_nodes=31,
    min_samples_leaf=100, random_state=0,
)  # fmt: skip

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
    # every MODIS cell-day, repeated on the nine cells around it: plain equality joins from here on
    con.execute("""
        create or replace temp table modis_nb as
        select local_date, gx + dx as gx, gy + dy as gy, gx as mx, gy as my
        from cd, (select unnest([-1, 0, 1]) as dx), (select unnest([-1, 0, 1]) as dy)
        where stream = 'modis'
    """)
    # count-preserving target: every MODIS cell-day is one unit, split equally among the cell-days of a VIIRS
    # sensor within +-1 cell that day. Summed over a sensor, shares equal the MODIS cell-days it explains.
    con.execute("""
        create or replace temp table share as
        with pairs as (
            select v.stream, v.local_date, v.gx, v.gy, n.mx, n.my
            from cd v join modis_nb n using (local_date, gx, gy)
            where v.stream like 'viirs%'
        )
        select stream, local_date, gx, gy, sum(1.0 / n_explaining) as share
        from (select *, count(*) over (partition by stream, local_date, mx, my) as n_explaining from pairs)
        group by all
    """)
    df = con.execute("""
        select cd.*,
               (share.share is not null)::integer as matched,
               coalesce(share.share, 0.0) as share
        from cd left join share using (stream, local_date, gx, gy)
        -- a fixed row order: the boosted model samples rows, so an arbitrary order would change it run to run
        order by stream, local_date, gx, gy
    """).df()
    return prepare(df)


def load_context(con: duckdb.DuckDBPyConnection, stream: str, cell_deg: float = 0.25) -> pd.DataFrame:
    """One row per grid cell and local day with `stream` activity in or next to it. Call after `load_cell_days`.

    A row exists when the cell or one of its eight neighbours burns that day, or the cell burns the day
    before or after: the rows are chosen from VIIRS alone, never from MODIS. Columns: what `stream` saw
    in the cell today, around it today, and in the cell on the two days before and after; `modis` is the
    number of MODIS fire cell-days in that cell and day (the target).
    """
    ncols = round(360 / cell_deg)
    around = ", ".join(f"({dx}, {dy})" for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx, dy) != (0, 0))
    lag = lambda k, name: (  # noqa: E731
        f"left join vd {name} on {name}.cell_id = r.cell_id and {name}.local_date = r.local_date + {k}"
    )
    con.execute(f"""
        create or replace temp table vd as
        select cell_id, cast(local_date as date) as local_date, count(*) as cd, sum((n_day > 0)::integer) as cd_day,
               sum((n_night > 0)::integer) as cd_night, round(sum(frp), 1) as frp, max(frp_max) as frp_max,
               sum(n_det) as det, sum(n_high) as high,
               sum((frp < 2)::integer) as cd_weak, sum((frp >= 16)::integer) as cd_strong
        from cd where stream = '{stream}' group by all;
        create or replace temp table md as
        select cell_id, cast(local_date as date) as local_date, count(*) as modis
        from cd where stream = 'modis' group by all;
        create or replace temp table ctx_rows as
        select distinct v.cell_id + o.dy * {ncols} + o.dx as cell_id, v.local_date + o.k as local_date
        from vd v, (values (0, 0, -1), (0, 0, 0), (0, 0, 1)
                    union all select dx, dy, 0 from (values {around}) t(dx, dy)) o(dx, dy, k)
        -- never a day outside what the sensor delivered: the record must not grow a month it has no data for
        where v.local_date + o.k between (select min(local_date) from vd) and (select max(local_date) from vd);
        create or replace temp table nbr as
        -- sums are rounded: added up in parallel their last digits differ from run to run, and the model
        -- would then differ too
        select r.cell_id, r.local_date, sum(v.cd) as nb_cd, round(sum(v.frp), 1) as nb_frp
        from ctx_rows r, (values {around}) o(dx, dy), vd v
        where v.local_date = r.local_date and v.cell_id = r.cell_id + o.dy * {ncols} + o.dx
        group by all;
    """)
    df = con.execute(f"""
        select r.cell_id, r.local_date, coalesce(md.modis, 0) as modis,
               coalesce(v0.cd, 0) as cd, coalesce(v0.cd_day, 0) as cd_day, coalesce(v0.cd_night, 0) as cd_night,
               coalesce(v0.frp, 0) as frp, coalesce(v0.frp_max, 0) as frp_max, coalesce(v0.det, 0) as det,
               coalesce(v0.high, 0) as high, coalesce(v0.cd_weak, 0) as cd_weak, coalesce(v0.cd_strong, 0) as cd_strong,
               coalesce(nbr.nb_cd, 0) as nb_cd, coalesce(nbr.nb_frp, 0) as nb_frp,
               coalesce(p1.cd, 0) as cd_p1, coalesce(p1.frp, 0) as frp_p1, coalesce(p2.cd, 0) as cd_p2,
               coalesce(n1.cd, 0) as cd_n1, coalesce(n1.frp, 0) as frp_n1, coalesce(n2.cd, 0) as cd_n2
        from ctx_rows r
        left join md on md.cell_id = r.cell_id and md.local_date = r.local_date
        {lag(0, "v0")} {lag(-1, "p1")} {lag(-2, "p2")} {lag(1, "n1")} {lag(2, "n2")}
        left join nbr on nbr.cell_id = r.cell_id and nbr.local_date = r.local_date
        order by r.cell_id, r.local_date
    """).df()
    return prepare_context(df, cell_deg)


def prepare_context(df: pd.DataFrame, cell_deg: float = 0.25) -> pd.DataFrame:
    df = df.copy()
    ncols = round(360 / cell_deg)
    df["local_date"] = pd.to_datetime(df.local_date)
    df["y"] = df.local_date.dt.year
    df["m"] = df.local_date.dt.month
    doy = df.local_date.dt.day_of_year
    df["doy_sin"], df["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    df["lat"] = (df.cell_id // ncols + 0.5) * cell_deg - 90
    df["lon"] = (df.cell_id % ncols + 0.5) * cell_deg - 180
    df["tx"], df["ty"] = np.floor(df.lon).astype(int), np.floor(df.lat).astype(int)
    for col in ("frp", "frp_max", "nb_frp", "frp_p1", "frp_n1"):
        df["l" + col] = np.log1p(df[col].astype(float))
    return df


def boosted(features: pd.DataFrame, target: pd.Series):
    """One boosted regression model, fitted on at most FIT_THREADS threads.

    With every core the fit was slower, not faster (12 s against 9 s on 18 cores), and two fits running
    at once on the same machine brought each other to a standstill.
    """
    from sklearn.ensemble import HistGradientBoostingRegressor
    from threadpoolctl import threadpool_limits

    with threadpool_limits(limits=FIT_THREADS):
        return HistGradientBoostingRegressor(**BOOSTING).fit(features, target)


def fit_context(rows: pd.DataFrame, n_modis: int) -> dict:
    """The context model, and the scale that makes its total equal the `n_modis` MODIS cell-days of the period."""
    model = boosted(rows[CONTEXT_FEATURES], rows.modis)
    par = {"model": model, "k": 1.0}
    par["k"] = float(n_modis / context_values(par, rows).sum())
    return par


def context_values(par: dict, rows: pd.DataFrame) -> pd.Series:
    """MODIS-equivalent fire cell-days of each context row (a cell and a day)."""
    return pd.Series(np.clip(par["model"].predict(rows[CONTEXT_FEATURES]), 0, None) * par["k"], index=rows.index)


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
    """Days when `stream` (a VIIRS sensor) was not really observing: it is nearly silent while MODIS is busy,
    or while the other VIIRS sensor is.

    The second sign catches outages on days with too little fire for the first one: the two VIIRS sensors
    carry the same instrument 50 minutes apart, so one of them reporting nothing is not a quiet day.
    Only looked for inside the sensor's own lifetime, so the years before its launch are not gaps.
    """
    own = df[df.stream == stream]
    if own.empty:
        return pd.DatetimeIndex([])
    twin = "viirs_noaa20" if stream == "viirs_snpp" else "viirs_snpp"
    alive = df[df.local_date.between(own.local_date.min(), own.local_date.max())]
    counts = [alive[alive.stream == s].groupby("local_date").size().rename(s) for s in ("modis", twin)]
    daily = pd.concat([*counts, own.groupby("local_date").size().rename("own")], axis=1, sort=True).fillna(0)
    by_modis = (daily.modis >= GAP_MIN_MODIS) & (daily.own < GAP_MAX_RATIO * daily.modis)
    by_twin = (daily[twin] >= GAP_MIN_TWIN) & (daily.own < GAP_MAX_TWIN_RATIO * daily[twin])
    return pd.DatetimeIndex(daily.index[by_modis | by_twin])


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
        par["model"] = boosted(viirs[WEIGHT_FEATURES], viirs.share)
    base = base_share(par, viirs)
    par["k"] = float(len(modis) / base.sum())
    doy = viirs.doy.to_numpy()
    r = season_factor(modis.doy.to_numpy(), doy, base * par["k"])
    par["r"] = r * len(modis) / (base * par["k"] * r[doy]).sum()  # smoothing must not shift the overall level
    return par


def held_out_month_errors(
    viirs: pd.DataFrame, modis: pd.DataFrame, context: pd.DataFrame | None = None, groups: int = 3
) -> dict[str, float]:
    """Country x month error of every method when each third of the years is predicted from the other two thirds."""
    years = sorted(viirs.y.unique())
    monthly: dict[str, list[pd.Series]] = {"bins": [], "boosted": [], "context": []}
    for held_out in (years[i::groups] for i in range(groups)):
        train_v, train_m = viirs[~viirs.y.isin(held_out)], modis[~modis.y.isin(held_out)]
        test_v = viirs[viirs.y.isin(held_out)]
        for kind in ("bins", "boosted"):
            w = viirs_weights(fit_viirs(train_v, train_m, kind), test_v)
            monthly[kind].append(w.groupby([test_v.y, test_v.m]).sum())
        if context is not None:
            test_c = context[context.y.isin(held_out)]
            values = context_values(fit_context(context[~context.y.isin(held_out)], len(train_m)), test_c)
            monthly["context"].append(values.groupby([test_c.y, test_c.m]).sum())
    series = {name: pd.concat(parts) for name, parts in monthly.items() if parts}
    if "context" in series:
        for kind in ("bins", "boosted"):
            series[f"{kind}+context"] = series[kind].add(series["context"], fill_value=0.0) / 2
    truth = modis.groupby(["y", "m"]).size()
    errors = {}
    for name, pred in series.items():
        pred, t = pred.align(truth, fill_value=0.0)
        errors[name] = round(float((pred - t).abs().sum() / t.sum()), 4)
    return errors


def choose_method(errors: dict[str, float]) -> str:
    """The method with the lowest held-out error, if it beats the plain table by a clear margin; else the table.

    Boosted models help in some countries and hurt in others (the boosted weight is better in Ukraine
    and worse in Argentina), so each has to earn its place per country; on a near tie the table wins.
    """
    best = min(errors, key=errors.get)
    return best if errors[best] < errors["bins"] - METHOD_MARGIN else "bins"


def context_share(method: str) -> float:
    """How much of the record's VIIRS era comes from the context model: all, half or none."""
    return 1.0 if method == "context" else 0.5 if method.endswith("+context") else 0.0


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


def calibrate(
    frames: list[pd.DataFrame], method: str = "auto", contexts: list[pd.DataFrame] | None = None
) -> dict | None:
    """Fit every parameter on the given cell-days. None when there is too little overlap to trust it.

    `contexts` are the S-NPP context tables of the same countries, in the same order.
    """
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
    context = None
    if contexts:
        kept = [
            c[c.local_date.between(*FIT) & ~c.local_date.isin(gap_days(f, "viirs_snpp"))]
            for c, f in zip(contexts, frames, strict=True)
        ]
        context = pd.concat(kept, ignore_index=True) if len(kept) > 1 else kept[0]
    errors = {}
    if method == "auto":
        errors = held_out_month_errors(viirs, modis, context)
        method = choose_method(errors)
    par = fit_viirs(viirs, modis, "boosted" if method.startswith("boosted") else "bins")
    par["method"], par["method_held_out_month_error"] = method, errors
    par["weights"] = "boosted" if par["model"] is not None else "bins"
    par["context_share"] = context_share(method)
    par["context"] = fit_context(context, len(modis)) if par["context_share"] > 0 else None
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
    # what a cell-day adds to the record: the VIIRS era shares its place with the context model
    share = par.get("context_share", 0.0)
    df["record_weight"] = df.weight * np.where(s == "viirs_noaa20", 1.0 - share, 1.0)
    return df


def context_part(context: pd.DataFrame, df: pd.DataFrame, par: dict) -> pd.DataFrame | None:
    """What the context model adds to the record: cell, year, month and value, for the VIIRS era of NOAA-20."""
    share = par.get("context_share", 0.0)
    if share == 0 or context is None or context.empty:
        return None
    rows = context[(context.local_date >= VIIRS_FROM) & ~context.local_date.isin(gap_days(df, "viirs_noaa20"))]
    value = context_values(par["context"], rows) * (par["n20_to_snpp"] or 1.0) * share
    return value.groupby([rows.cell_id, rows.y, rows.m]).sum().rename("value").reset_index()


def sensor_used(year: pd.Series, month: pd.Series) -> pd.Series:
    ym = year * 100 + month
    names = np.select([ym <= 200206, ym <= 202112], ["modis_terra", "modis"], "viirs_noaa20")
    return pd.Series(names, index=year.index)


def monthly_cells(df: pd.DataFrame, cell_deg: float, context: pd.DataFrame | None = None) -> pd.DataFrame:
    """Weighted cell-days (and the context model's part, from `context_part`) -> one row per 0.25 deg cell and month."""
    d = df[df.in_series | df.in_raw]
    g = (
        d.assign(h=d.record_weight.where(d.in_series, 0.0), r=d.in_raw.astype(int))
        .groupby(["cell_id", "y", "m"])
        .agg(n_harmonized=("h", "sum"), n_raw=("r", "sum"))
    )
    if context is not None:
        extra = context.set_index(["cell_id", "y", "m"]).value
        g = g.reindex(g.index.union(extra.index), fill_value=0)
        g["n_harmonized"] = g.n_harmonized.add(extra, fill_value=0.0)
    g = g.reset_index().rename(columns={"y": "year", "m": "month"})
    g["country"] = df.country.iloc[0]
    g["n_raw"] = g.n_raw.astype(int)
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
        "method": par["method"],  # one of METHODS
        "method_held_out_month_error": par["method_held_out_month_error"],  # what the choice was based on
        "weights": par["weights"],  # boosted (scikit-learn HistGradientBoostingRegressor) | bins (table)
        "context_share": par["context_share"],  # part of the VIIRS era taken from the context model
        "context_k": None if par["context"] is None else round(par["context"]["k"], 4),
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
    con: duckdb.DuckDBPyConnection,
    cell_day: Path,
    countries: list[str] | None,
    method: str = "auto",
    cell_deg: float = 0.25,
) -> dict[str, tuple]:
    """country -> (cell-days with weights, parameters, 'own' | 'pooled'). Countries without data are skipped.

    `countries=None` takes every country in the cell-day file (world mode). The parameters carry the
    country's context tables under "_context" (per VIIRS stream); they are built only when the method
    can use them, because they double the memory a country takes.
    """
    if countries is None:
        rows = con.execute(
            f"select distinct country from read_parquet('{cell_day.as_posix()}') order by country"
        ).fetchall()
        countries = [r[0] for r in rows]
    with_context = method == "auto" or "context" in method
    frames, contexts = {}, {}
    for c in countries:
        f = load_cell_days(con, cell_day, c)
        if len(f):
            frames[c] = f
            streams = ("viirs_snpp", "viirs_noaa20") if with_context else ()
            contexts[c] = {stream: load_context(con, stream, cell_deg) for stream in streams}
    snpp_context = lambda c: [contexts[c]["viirs_snpp"]] if with_context else None  # noqa: E731
    own = {c: calibrate([f], method, snpp_context(c)) for c, f in frames.items()}
    good = [c for c, p in own.items() if p is not None]
    # the pooled calibration costs a fit on every country at once: only when some country needs to borrow it
    need_pooled = any(p is None or p["n20_to_snpp"] is None for p in own.values())
    pooled = None
    if good and need_pooled:
        pooled_context = [contexts[c]["viirs_snpp"] for c in good] if with_context else None
        pooled = calibrate([frames[c] for c in good], method, pooled_context)
    out = {}
    for c, f in frames.items():
        par, source = (own[c], "own") if own[c] is not None else (pooled, "pooled")
        if par is None:
            print(f"warning: {c}: no country has enough MODIS/VIIRS overlap to calibrate - skipped")
            continue
        par = {**par, "_context": contexts[c]}
        if par["n20_to_snpp"] is None and pooled is not None:
            par["n20_to_snpp"] = pooled["n20_to_snpp"]
        out[c] = (apply(f, par), par, source)
    return out


def record_table(df: pd.DataFrame, par: dict, cell_deg: float) -> pd.DataFrame:
    """The harmonized and the raw record of one country per cell and month."""
    return monthly_cells(df, cell_deg, context_part(par["_context"].get("viirs_noaa20"), df, par))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument(
        "--method",
        choices=["auto", *METHODS],
        help="how VIIRS is brought to the MODIS scale; auto scores every method on held-out years per country "
        "(default: auto, or bins in world mode)",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    con = duckdb.connect()
    agg = args.data / "agg"
    # Scoring five methods per country is affordable for a few regions, not for every country on Earth:
    # world mode keeps the plain table unless a method is asked for.
    method = args.method or ("bins" if cfg.world else "auto")
    results = harmonize_all(con, agg / "cell_day.parquet", cfg.countries(), method, cfg.cell_deg)
    if not results:
        raise SystemExit("harmonize: nothing to do - run pipeline.aggregate first")

    table = pd.concat([record_table(df, par, cfg.cell_deg) for df, par, _ in results.values()], ignore_index=True)
    con.register("harmonized_df", table)
    con.execute(f"copy harmonized_df to '{(agg / 'harmonized.parquet').as_posix()}' (format parquet, compression zstd)")
    calib = {c: params_to_json(par, source) for c, (_, par, source) in results.items()}
    (agg / "calibration.json").write_text(json.dumps(calib, indent=2))

    for c, (df, par, source) in results.items():
        s = df[df.in_series]
        total = record_table(df, par, cfg.cell_deg).n_harmonized.sum()
        print(
            f"harmonize: {c:<12} calibration {source:<6} method {par['method']:<15} k={par['k']:.3f} "
            f"n20_to_snpp={par['n20_to_snpp'] or 1:.3f}  "
            f"{s.local_date.min():%Y-%m} .. {s.local_date.max():%Y-%m}  {total:>12,.0f} harmonized cell-days"
        )
        if par["sensor_gap_months"]:
            print(f"           sensor gap months left out of the NOAA-20 fit: {', '.join(par['sensor_gap_months'])}")
    print(f"harmonize: {len(table):,} cell-month rows -> {agg / 'harmonized.parquet'}")


if __name__ == "__main__":
    main()
