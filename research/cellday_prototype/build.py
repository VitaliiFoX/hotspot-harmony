"""Harmonize MODIS and VIIRS active-fire hotspots (NASA FIRMS) into one comparable record.

Unit of the harmonized record: MODIS-equivalent fire cell-days
(one ~1 km grid cell with fire on one local solar day, as Terra+Aqua MODIS would have reported it).

Steps
  1. load FIRMS country archives, keep presumed vegetation fires (type 0), drop low confidence
  2. snap detections to a ~1 km equal-area grid and count unique cell-days per sensor stream
  3. calibrate VIIRS (S-NPP) against MODIS on years when both flew with stable orbits:
       weight = k * p(FRP bin, day/night) * r(calendar month)
     p = share of VIIRS cell-days that MODIS also saw nearby the same day
  4. bridge NOAA-20 to S-NPP, and Terra-only months (before Aqua) to Terra+Aqua
  5. validate with leave-one-year-out, then write Parquet + calibration.json

Usage:  uv run python research/cellday_prototype/build.py --raw data/raw --out data/processed --country Ukraine
"""
import argparse
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

CELL_KM = 1.0
D = CELL_KM / 111.32                      # cell height in degrees of latitude
STABLE = ("2012-02-01", "2021-12-31")     # S-NPP flying, MODIS orbits not yet drifting
TERRA_FIT = ("2003-01-01", "2011-12-31")  # both MODIS flying, used to bridge the Terra-only start
AQUA_START = "2002-07-04"                 # first Aqua detections in the archive
VIIRS_FROM = "2022-01-01"                 # harmonized record switches from MODIS to VIIRS here
FRP_EDGES = [0, 1, 2, 4, 8, 16, 32, 64]   # MW, summed over a VIIRS cell-day


def load(con: duckdb.DuckDBPyConnection, raw: Path, country: str) -> None:
    opts = "union_by_name=true, types={'acq_time':'VARCHAR','confidence':'VARCHAR','version':'VARCHAR','satellite':'VARCHAR'}"
    mins = "cast(substr(lpad(acq_time,4,'0'),1,2) as int)*60 + cast(substr(lpad(acq_time,4,'0'),3,2) as int)"
    con.execute(f"""
    create table det as
    with m as (
        select 'MODIS' sensor, satellite sat, latitude lat, longitude lon, acq_date, {mins} mins,
               case when cast(confidence as int) < 30 then 'l' when cast(confidence as int) < 80 then 'n' else 'h' end conf,
               frp, daynight, type
        from read_csv('{raw}/modis/modis_*_{country}.csv', {opts})),
    v as (
        select 'VIIRS' sensor, case satellite when 'N' then 'SNPP' else satellite end sat, latitude lat, longitude lon, acq_date, {mins} mins,
               confidence conf, frp, daynight, type
        from read_csv(['{raw}/viirs-snpp/viirs-snpp_*_{country}.csv', '{raw}/viirs-jpss1/viirs-jpss1_*_{country}.csv'], {opts}))
    select sensor, sat, lat, lon,
           cast(acq_date as timestamp) + to_minutes(mins) as t_utc,
           -- local solar date: a night overpass near 00 UTC belongs to the same burning day as the afternoon one
           cast(cast(acq_date as timestamp) + to_minutes(mins + cast(round(lon * 4) as int)) as date) as ldate,
           conf, frp, daynight, type,
           cast(floor(lat / {D}) as int) as gy,
           cast(floor(lon * cos(radians((floor(lat / {D}) + 0.5) * {D})) / {D}) as int) as gx
    from (select * from m union all select * from v);

    create view good as select * from det where type = 0 and conf <> 'l';

    -- one row per stream x local day x grid cell
    create table cd as
    select stream, ldate, gx, gy, avg(lat) lat, avg(lon) lon, sum(frp) frp, count(*) n_det,
           max((daynight = 'D')::int) has_day
    from (select 'MODIS' stream, * from good where sensor = 'MODIS'
          union all select 'TERRA', * from good where sat = 'Terra'
          union all select sat, * from good where sensor = 'VIIRS')
    group by all;

    -- did MODIS report fire within +-1 cell on the same local day?
    create table modis_nb as
    select distinct ldate, gx + dx gx, gy + dy gy
    from cd, (select unnest([-1, 0, 1]) dx), (select unnest([-1, 0, 1]) dy)
    where stream = 'MODIS';
    alter table cd add column matched int;
    update cd set matched = (exists (select 1 from modis_nb n where n.ldate = cd.ldate and n.gx = cd.gx and n.gy = cd.gy))::int;
    """)


def fit(V: pd.DataFrame, M: pd.DataFrame) -> dict:
    """V: VIIRS cell-days (b, m, matched). M: MODIS cell-day counts (m, truth)."""
    p = V.groupby("b").matched.mean()
    k = M.truth.sum() / V.b.map(p).sum()
    base = V.b.map(p) * k
    r = M.groupby("m").truth.sum() / base.groupby(V.m).sum()
    return {"p": p, "k": k, "r": r}


def weights(par: dict, b: pd.Series, m: pd.Series) -> pd.Series:
    return b.map(par["p"]).fillna(par["p"].mean()) * par["k"] * m.map(par["r"]).fillna(1.0)


def scores(pred: pd.DataFrame, truth: pd.DataFrame) -> dict:
    """WAPE = sum|pred-truth| / sum(truth), at four aggregation levels (1-degree tiles)."""
    keys = ["y", "m", "tx", "ty"]
    d = (pred.groupby(keys).w.sum().rename("pred").reset_index()
         .merge(truth.groupby(keys).truth.sum().reset_index(), on=keys, how="outer").fillna(0.0))
    def wape(by):
        g = d.groupby(by)[["pred", "truth"]].sum()
        return round(float((g.pred - g.truth).abs().sum() / g.truth.sum()), 4)
    cm = d.groupby(["y", "m"])[["pred", "truth"]].sum()
    return {
        "bias": round(float(d.pred.sum() / d.truth.sum() - 1), 4),
        "wape_country_year": wape(["y"]),
        "wape_country_month": wape(["y", "m"]),
        "wape_tile_year": wape(["y", "tx", "ty"]),
        "wape_tile_month": wape(keys),
        "r2_log_country_month": round(float(np.corrcoef(np.log1p(cm.pred), np.log1p(cm.truth))[0, 1] ** 2), 4),
        "n_months": int(len(cm)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw", type=Path)
    ap.add_argument("--out", default="data/processed", type=Path)
    ap.add_argument("--country", default="Ukraine")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    load(con, args.raw, args.country)

    cd = con.sql("select *, year(ldate) y, month(ldate) m, cast(floor(lat) as int) ty, cast(floor(lon) as int) tx from cd").df()
    cd["ldate"] = pd.to_datetime(cd.ldate)
    cd["b"] = np.digitize(cd.frp, FRP_EDGES) + 10 * cd.has_day
    stable = cd.ldate.between(*STABLE)
    is_modis, is_snpp, is_n20, is_terra = (cd.stream == s for s in ("MODIS", "SNPP", "N20", "TERRA"))
    def modis(mask):  # MODIS cell-days inside a period: the truth VIIRS is calibrated against
        return cd[is_modis & mask].assign(truth=1.0)

    # ---- 3. VIIRS -> MODIS-equivalent ------------------------------------------------------
    V, M = cd[is_snpp & stable], modis(stable)
    par = fit(V, M)
    # leave-one-year-out: every year is predicted by a model that never saw it
    folds = []
    for y in sorted(V.y.unique()):
        p_y = fit(V[V.y != y], M[M.y != y])
        te = V[V.y == y]
        folds.append(te.assign(w=weights(p_y, te.b, te.m)))
    val_loyo = scores(pd.concat(folds), M)
    val_naive = scores(V.assign(w=1.0), M)                                   # raw VIIRS cell-days, no harmonization
    val_single = scores(V.assign(w=len(M) / len(V)), M)                      # one global factor (in-sample, optimistic)

    cd["weight"] = np.nan
    viirs = is_snpp | is_n20
    cd.loc[viirs, "weight"] = weights(par, cd.b[viirs], cd.m[viirs])

    # ---- 4a. NOAA-20 -> S-NPP (same instrument design, same orbit, half an orbit apart) -----
    both = cd.ldate.between("2018-04-01", "2025-12-31")
    c_n20 = float(cd.weight[is_snpp & both].sum() / cd.weight[is_n20 & both].sum())
    cd.loc[is_n20, "weight"] *= c_n20
    # independent check: NOAA-20 was never used to fit p, k, r
    chk = cd.ldate.between("2018-04-01", STABLE[1])
    val_n20 = scores(cd[is_n20 & chk].assign(w=lambda d: d.weight), modis(chk))

    # ---- 4b. Terra-only start of the record -> Terra+Aqua ----------------------------------
    tf = cd.ldate.between(*TERRA_FIT)
    t_m = modis(tf).groupby("m").size() / cd[is_terra & tf].groupby("m").size()
    cd.loc[is_terra, "weight"] = cd.m[is_terra].map(t_m)
    folds = []
    for y in range(2003, 2012):
        tr = tf & (cd.y != y)
        t_y = modis(tr).groupby("m").size() / cd[is_terra & tr].groupby("m").size()
        te = cd[is_terra & tf & (cd.y == y)]
        folds.append(te.assign(w=te.m.map(t_y)))
    val_terra = scores(pd.concat(folds), modis(tf))
    cd.loc[is_modis, "weight"] = 1.0

    # ---- the harmonized record: which stream speaks for which period -----------------------
    cd["in_series"] = (
        (is_terra & (cd.ldate < AQUA_START))
        | (is_modis & (cd.ldate >= AQUA_START) & (cd.ldate < VIIRS_FROM))
        | (is_n20 & (cd.ldate >= VIIRS_FROM))
    )

    # ---- diagnostics ----------------------------------------------------------------------
    # MODIS orbits drift after 2021 (Terra earlier, Aqua later). Compare MODIS cell-days with the
    # VIIRS-equivalent of the same year: 1.0 = sensors agree. S-NPP until 2021, NOAA-20 after
    # (S-NPP lost two weeks of data in Jul-Aug 2022).
    since = cd[cd.ldate >= STABLE[0]]
    n_yr = since.groupby(["y", "stream"]).size().unstack()
    w_yr = since.groupby(["y", "stream"]).weight.sum().unstack()
    veq = w_yr.SNPP.where(w_yr.index < 2022, w_yr.N20)
    drift = [{"year": int(y),
              "modis_over_viirs_equiv": round(float(n_yr.MODIS[y] / veq[y]), 3),
              "terra_only_over_viirs_equiv": round(float(n_yr.TERRA[y] / veq[y]), 3)} for y in n_yr.index]

    monthly = (cd.assign(harmonized=cd.weight.where(cd.in_series, 0.0))
               .groupby(["y", "m"]).agg(harmonized=("harmonized", "sum")).reset_index())
    raw_counts = cd.groupby(["y", "m", "stream"]).size().unstack(fill_value=0).add_prefix("celldays_").reset_index()
    # a month without a single hotspot is a real zero, not a gap: emit every month of the record
    span = pd.period_range(cd.ldate.min(), cd.ldate.max(), freq="M")
    full = pd.DataFrame({"y": span.year, "m": span.month})
    monthly = full.merge(monthly, how="left").merge(raw_counts, how="left").fillna(0)
    monthly = monthly.rename(columns={"y": "year", "m": "month"})
    count_cols = [c for c in monthly.columns if c.startswith("celldays_")]
    monthly[count_cols] = monthly[count_cols].astype(int)
    monthly["harmonized"] = monthly.harmonized.round(1)

    # ---- 5. write ---------------------------------------------------------------------------
    con.execute(f"copy (select * exclude (gx, gy) from det order by t_utc) to '{args.out}/detections.parquet' (format parquet, compression zstd)")
    out = cd[["stream", "ldate", "lat", "lon", "gx", "gy", "n_det", "frp", "has_day", "weight", "in_series"]].copy()
    out["ldate"] = out.ldate.dt.date
    out = out.round({"lat": 4, "lon": 4, "frp": 1, "weight": 4}).sort_values(["ldate", "stream"])
    con.register("out_df", out)
    con.execute(f"copy out_df to '{args.out}/celldays.parquet' (format parquet, compression zstd)")
    monthly.to_csv(args.out / "monthly_country.csv", index=False)

    p_table = [{"has_day": int(b // 10), "frp_from_mw": FRP_EDGES[b % 10 - 1],
                "frp_to_mw": FRP_EDGES[b % 10] if b % 10 < len(FRP_EDGES) else None,
                "p_modis_sees_it": round(float(p), 4)} for b, p in par["p"].items()]
    meta = {
        "country": args.country,
        "unit": "MODIS-equivalent fire cell-days (Terra+Aqua, ~1 km cell, local solar day)",
        "cell_km": CELL_KM,
        "filters": {"type": "0 (presumed vegetation fire)", "confidence": "low dropped (MODIS < 30, VIIRS 'l')"},
        "record": {
            f"until {AQUA_START}": "Terra MODIS x terra_to_modis[month]",
            f"{AQUA_START} .. {VIIRS_FROM}": "Terra+Aqua MODIS, weight 1 (reference)",
            f"from {VIIRS_FROM}": "VIIRS NOAA-20 x n20_to_snpp x k x p(FRP, day/night) x month_factor[month]",
        },
        "calibration": {
            "fit_period": STABLE, "k": round(float(par["k"]), 4), "p": p_table,
            "month_factor": {int(m): round(float(v), 4) for m, v in par["r"].items()},
            "n20_to_snpp": round(c_n20, 4),
            "terra_to_modis": {int(m): round(float(v), 4) for m, v in t_m.items()},
        },
        "validation": {
            "viirs_snpp_to_modis_leave_one_year_out": val_loyo,
            "baseline_raw_viirs_celldays": val_naive,
            "baseline_single_factor_in_sample": val_single,
            "noaa20_independent_2018_2021": val_n20,
            "terra_only_bridge_leave_one_year_out": val_terra,
        },
        "modis_orbit_drift_check": drift,
        "rows": {"detections": int(con.execute("select count(*) from det").fetchall()[0][0]),
                 "celldays": int(len(cd)), "celldays_in_record": int(cd.in_series.sum())},
    }
    (args.out / "calibration.json").write_text(json.dumps(meta, indent=2))

    print(f"detections: {meta['rows']['detections']:,}   cell-days: {len(cd):,}   in harmonized record: {int(cd.in_series.sum()):,}")
    print(f"k = {par['k']:.3f}   NOAA-20 -> S-NPP = {c_n20:.3f}")
    print("\nvalidation (WAPE; lower is better)")
    print(pd.DataFrame(meta["validation"]).T.to_string())
    print("\nMODIS / VIIRS-equivalent by year (1.0 = sensors agree); Terra alone in brackets")
    print("  " + "  ".join(f"{d['year']}: {d['modis_over_viirs_equiv']:.2f} ({d['terra_only_over_viirs_equiv']:.2f})" for d in drift))
    for f in sorted(args.out.iterdir()):
        print(f"{f.stat().st_size / 1e6:8.1f} MB  {f}")


if __name__ == "__main__":
    main()
