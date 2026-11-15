"""Is one calibration per country good enough, or should a large country be calibrated by squares?

For each country, with the plain table by fire power (the world method), every year of the fit period is
predicted from the other years in three ways and scored against MODIS on the same rows:

    country   one calibration for the whole country (what pipeline.world does)
    sq10      one calibration per 10-degree square with enough data of its own; the other squares together
    sq5       the same with 5-degree squares

Usage:  uv run python research/calibration_units/compare.py data/world/agg/cell_day.parquet Russian_Federation ...
"""

import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from pipeline import harmonize as hz
from pipeline.validate import TABLE_ONLY, compare, leave_one_year_out, scores

COLUMNS = ["wape_country_year", "wape_country_month", "wape_tile_year", "wape_tile_month"]


def by_squares(viirs: pd.DataFrame, modis: pd.DataFrame, deg: int) -> tuple[pd.DataFrame, int]:
    """Held-out predictions with one calibration per square of `deg` degrees; small squares are fitted together."""
    unit = lambda d: (np.floor(d.lat / deg).astype(int) * 1000 + np.floor(d.lon / deg).astype(int))  # noqa: E731
    uv, um = unit(viirs), unit(modis)
    nv, nm = uv.value_counts(), um.value_counts()
    own = [u for u in nv.index if nv[u] >= hz.MIN_FIT_CELLDAYS and nm.get(u, 0) >= hz.MIN_FIT_CELLDAYS / 2]
    parts = [leave_one_year_out(viirs[uv == u], modis[um == u], TABLE_ONLY)[0] for u in own]
    rest_v, rest_m = viirs[~uv.isin(own)], modis[~um.isin(own)]
    if len(rest_v) and len(rest_m):
        parts.append(leave_one_year_out(rest_v, rest_m, TABLE_ONLY)[0])
    return pd.concat(parts), len(own)


def main() -> None:
    cell_day, countries = Path(sys.argv[1]), sys.argv[2:]
    con = duckdb.connect()
    rows = []
    for c in countries:
        f = hz.load_cell_days(con, cell_day, c)
        fit = f.local_date.between(*hz.FIT) & ~f.local_date.isin(hz.gap_days(f, "viirs_snpp"))
        viirs, modis = f[fit & (f.stream == "viirs_snpp")], f[fit & (f.stream == "modis")]
        del f
        result = {"country": scores(compare(leave_one_year_out(viirs, modis, TABLE_ONLY)[0], modis))}
        units = {}
        for deg in (10, 5):
            held, units[deg] = by_squares(viirs, modis, deg)
            result[f"sq{deg}"] = scores(compare(held, modis))
        for name, s in result.items():
            rows.append({"country": c, "calibration": name, "units": units.get(int(name[2:]) if name != "country" else 0, 1),
                         "viirs_fit_celldays": len(viirs), **{k[5:]: s[k] for k in COLUMNS}})
        print(pd.DataFrame(rows[-3:]).to_string(index=False, header=len(rows) == 3), flush=True)
    pd.DataFrame(rows).to_csv(Path(__file__).with_name("results.csv"), index=False)


if __name__ == "__main__":
    main()
