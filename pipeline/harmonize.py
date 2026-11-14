"""Step 5 - put MODIS and VIIRS on one scale: MODIS-equivalent fire cell-days.

Every VIIRS fire cell-day gets a weight: the answer to "would MODIS (Terra + Aqua) have reported this?"

    weight = k * p(FRP bin, day/night) * r(calendar month)

    p   share of VIIRS cell-days of that fire power that MODIS also saw within +-1 cell the same local day
    k   one scale so that totals match (MODIS also sees fires at hours when VIIRS is not overhead)
    r   what is left of the seasonal difference after p

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
NAIVE_SWITCH = "2012-02-01"  # the uncorrected splice people usually make: MODIS, then VIIRS as delivered
N20_START = "2018-04-01"
FRP_EDGES = [0, 1, 2, 4, 8, 16, 32, 64]  # MW, summed over a VIIRS cell-day
MIN_FIT_CELLDAYS = 5000  # below this a country borrows the pooled calibration

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
    df = con.execute("""
        select cd.*,
               (stream like 'viirs%' and exists (
                   select 1 from modis_nb n where n.local_date = cd.local_date and n.gx = cd.gx and n.gy = cd.gy
               ))::integer as matched
        from cd
    """).df()
    return prepare(df)


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["local_date"] = pd.to_datetime(df.local_date)
    df["y"] = df.local_date.dt.year
    df["m"] = df.local_date.dt.month
    df["b"] = np.digitize(df.frp, FRP_EDGES) + 10 * df.has_day  # FRP bin, day and night kept apart
    df["tx"] = np.floor(df.lon).astype(int)
    df["ty"] = np.floor(df.lat).astype(int)
    return df


def fit_viirs(viirs: pd.DataFrame, modis: pd.DataFrame) -> dict:
    """viirs: VIIRS cell-days with b, m, matched. modis: MODIS cell-days of the same period with m."""
    p = viirs.groupby("b").matched.mean()
    k = len(modis) / viirs.b.map(p).sum()
    base = viirs.b.map(p) * k
    r = (modis.groupby("m").size() / base.groupby(viirs.m).sum()).replace([np.inf, -np.inf], np.nan).dropna()
    return {"p": p, "k": float(k), "r": r}


def viirs_weights(par: dict, b: pd.Series, m: pd.Series) -> pd.Series:
    return b.map(par["p"]).fillna(par["p"].mean()) * par["k"] * m.map(par["r"]).fillna(1.0)


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


def calibrate(frames: list[pd.DataFrame]) -> dict | None:
    """Fit every parameter on the given cell-days. None when there is too little overlap to trust it."""
    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    fit = df.local_date.between(*FIT)
    viirs, modis = df[fit & (df.stream == "viirs_snpp")], df[fit & (df.stream == "modis")]
    if len(viirs) < MIN_FIT_CELLDAYS or len(modis) < MIN_FIT_CELLDAYS / 2:
        return None
    par = fit_viirs(viirs, modis)
    is_viirs = df.stream.isin(["viirs_snpp", "viirs_noaa20"])
    w = viirs_weights(par, df.b[is_viirs], df.m[is_viirs])
    par["n20_to_snpp"], par["sensor_gap_months"] = fit_n20(df, w)
    tf = df.local_date.between(*TERRA_FIT)
    par["terra"] = fit_terra(df[tf & (df.stream == "modis_terra")], df[tf & (df.stream == "modis")])
    par["n_fit"] = int(len(viirs))
    return par


def apply(df: pd.DataFrame, par: dict) -> pd.DataFrame:
    """Add `weight`, `in_series` (belongs to the harmonized record) and `in_naive` (uncorrected splice)."""
    df = df.copy()
    s, d = df.stream, df.local_date
    df["weight"] = np.nan
    v = s.isin(["viirs_snpp", "viirs_noaa20"])
    df.loc[v, "weight"] = viirs_weights(par, df.b[v], df.m[v])
    df.loc[s == "viirs_noaa20", "weight"] *= par["n20_to_snpp"] or 1.0
    df.loc[s == "modis_terra", "weight"] = df.m[s == "modis_terra"].map(par["terra"]).fillna(1.0)
    df.loc[s == "modis", "weight"] = 1.0
    df["in_series"] = (
        ((s == "modis_terra") & (d < AQUA_START))
        | ((s == "modis") & (d >= AQUA_START) & (d < VIIRS_FROM))
        | ((s == "viirs_noaa20") & (d >= VIIRS_FROM))
    )
    df["in_naive"] = (
        ((s == "modis") & (d < NAIVE_SWITCH))
        | ((s == "viirs_snpp") & (d >= NAIVE_SWITCH) & (d < VIIRS_FROM))
        | ((s == "viirs_noaa20") & (d >= VIIRS_FROM))
    )
    return df


def sensor_used(year: pd.Series, month: pd.Series) -> pd.Series:
    ym = year * 100 + month
    names = np.select([ym <= 200206, ym <= 202112], ["modis_terra", "modis"], "viirs_noaa20")
    return pd.Series(names, index=year.index)


def monthly_cells(df: pd.DataFrame, cell_deg: float) -> pd.DataFrame:
    """Weighted cell-days -> one row per 0.25 deg cell and month."""
    d = df[df.in_series | df.in_naive]
    g = (
        d.assign(h=d.weight.where(d.in_series, 0.0), r=d.in_naive.astype(int))
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
        "month_factor": {int(m): round(float(v), 4) for m, v in par["r"].items()},
        "n20_to_snpp": None if par["n20_to_snpp"] is None else round(par["n20_to_snpp"], 4),
        "sensor_gap_months": par["sensor_gap_months"],
        "terra_to_modis": {int(m): round(float(v), 4) for m, v in par["terra"].items()},
    }


def harmonize_all(con: duckdb.DuckDBPyConnection, cell_day: Path, countries: list[str]) -> dict[str, tuple]:
    """country -> (cell-days with weights, parameters, 'own' | 'pooled'). Countries without data are skipped."""
    frames = {c: load_cell_days(con, cell_day, c) for c in countries}
    frames = {c: f for c, f in frames.items() if len(f)}
    own = {c: calibrate([f]) for c, f in frames.items()}
    good = [frames[c] for c, p in own.items() if p is not None]
    pooled = calibrate(good) if good else None
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
    args = ap.parse_args()

    cfg = load_config(args.config)
    con = duckdb.connect()
    agg = args.data / "agg"
    results = harmonize_all(con, agg / "cell_day.parquet", cfg.region_names())
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
            f"harmonize: {c:<12} calibration {source:<6} k={par['k']:.3f} n20_to_snpp={par['n20_to_snpp'] or 1:.3f}  "
            f"{s.local_date.min():%Y-%m} .. {s.local_date.max():%Y-%m}  {s.weight.sum():>12,.0f} harmonized cell-days"
        )
        if par["sensor_gap_months"]:
            print(f"           sensor gap months left out of the NOAA-20 fit: {', '.join(par['sensor_gap_months'])}")
    print(f"harmonize: {len(table):,} cell-month rows -> {agg / 'harmonized.parquet'}")


if __name__ == "__main__":
    main()
