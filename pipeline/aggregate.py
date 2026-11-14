"""Step 3 + 4 - filter points and count them per grid cell, month and sensor.

Output data/agg/cell_month.parquet:
    cell_id, cell_lat, cell_lon, country, year, month, sensor, n_hotspots, frp_sum
A row exists only where at least one hotspot passed the filters; a missing row means zero.
Months are UTC calendar months.

Usage:  uv run python -m pipeline.aggregate
"""

import argparse
import math
from pathlib import Path

import duckdb

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, Config, load_config


def cell_of(lat: float, lon: float, cell_deg: float) -> tuple[int, float, float]:
    """Grid cell of a point: (cell_id, centre latitude, centre longitude). Mirrors the SQL below."""
    ncols = round(360 / cell_deg)
    iy = math.floor((lat + 90) / cell_deg)
    ix = min(math.floor((lon + 180) / cell_deg), ncols - 1)
    return iy * ncols + ix, (iy + 0.5) * cell_deg - 90, (ix + 0.5) * cell_deg - 180


def aggregate(con: duckdb.DuckDBPyConnection, points: Path, out: Path, cfg: Config) -> int:
    d = cfg.cell_deg
    ncols = round(360 / d)
    drop = ", ".join(f"'{c}'" for c in cfg.drop_confidence) or "''"
    keep = ", ".join(str(t) for t in cfg.keep_types)
    out.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""
        copy (
            with p as (
                select *,
                       cast(floor((lat + 90) / {d}) as bigint) as iy,
                       least(cast(floor((lon + 180) / {d}) as bigint), {ncols - 1}) as ix
                from read_parquet('{points.as_posix()}/**/*.parquet', hive_partitioning = true)
                where confidence_class not in ({drop}) and type in ({keep})
            )
            select iy * {ncols} + ix as cell_id,
                   (iy + 0.5) * {d} - 90 as cell_lat,
                   (ix + 0.5) * {d} - 180 as cell_lon,
                   country,
                   cast(year(acq_datetime_utc) as integer) as year,
                   cast(month(acq_datetime_utc) as integer) as month,
                   sensor,
                   count(*) as n_hotspots,
                   round(sum(frp), 1) as frp_sum
            from p
            group by all
            order by country, sensor, year, month, cell_id
        ) to '{out.as_posix()}' (format parquet, compression zstd)
    """)
    return con.execute(f"select count(*) from read_parquet('{out.as_posix()}')").fetchall()[0][0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    args = ap.parse_args()

    cfg = load_config(args.config)
    con = duckdb.connect()
    out = args.data / "agg" / "cell_month.parquet"
    rows = aggregate(con, args.data / "points", out, cfg)
    print(f"aggregate: {rows:,} cell-month-sensor rows at {cfg.cell_deg} deg -> {out}")
    summary = con.execute(f"""
        select country, sensor, min(year) as first_year, max(year) as last_year, sum(n_hotspots) as hotspots
        from read_parquet('{out.as_posix()}') group by all order by all
    """).fetchall()
    for country, sensor, y0, y1, n in summary:
        print(f"  {country:<12} {sensor:<13} {y0}-{y1}  {n:>10,} hotspots")


if __name__ == "__main__":
    main()
