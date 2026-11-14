"""Step 2 - bring MODIS and VIIRS CSV files to one point schema in data/points/ (Parquet).

Schema (one row per hotspot detection):
    lat, lon, acq_datetime_utc, satellite, confidence_raw, confidence_class (low|nominal|high),
    frp, daynight, type, source (sp|nrt), country
plus the partition columns `sensor` (modis|viirs_snpp|viirs_noaa20) and `year`.

Usage:  uv run python -m pipeline.normalize [--country Ukraine]
"""

import argparse
import shutil
from pathlib import Path

import duckdb

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, load_config

# MODIS reports confidence as 0-100, VIIRS as a letter. One expression handles both.
CONFIDENCE_CLASS = """
case when try_cast(confidence as integer) is not null then
         case when try_cast(confidence as integer) < 30 then 'low'
              when try_cast(confidence as integer) < 80 then 'nominal'
              else 'high' end
     else case lower(confidence) when 'l' then 'low' when 'n' then 'nominal' when 'h' then 'high' end
end"""

# keep text columns as text: acq_time is HHMM with leading zeros, satellite 'N' is not a boolean
CSV_TYPES = "{'acq_time': 'VARCHAR', 'confidence': 'VARCHAR', 'satellite': 'VARCHAR', 'version': 'VARCHAR'}"


def normalize_sensor(con: duckdb.DuckDBPyConnection, files: list[Path], sensor_id: str, points: Path) -> int:
    """Write the CSV files of one sensor as points/sensor=<id>/year=<yyyy>/*.parquet. Returns the row count."""
    out = points / f"sensor={sensor_id}"
    if out.exists():
        shutil.rmtree(out)  # no stale partitions from an earlier run
    points.mkdir(parents=True, exist_ok=True)
    file_list = ", ".join(f"'{f.as_posix()}'" for f in files)
    hhmm = "lpad(acq_time, 4, '0')"
    con.execute(f"""
        copy (
            select latitude as lat,
                   longitude as lon,
                   cast(acq_date as timestamp)
                       + to_minutes(cast(substr({hhmm}, 1, 2) as integer) * 60 + cast(substr({hhmm}, 3, 2) as integer))
                       as acq_datetime_utc,
                   satellite,
                   confidence as confidence_raw,
                   {CONFIDENCE_CLASS} as confidence_class,
                   frp,
                   daynight,
                   cast(type as integer) as type,
                   'sp' as source,
                   regexp_extract(filename, '_[0-9]{{4}}_(.+)\\.csv$', 1) as country,
                   '{sensor_id}' as sensor,
                   year(acq_date) as year
            from read_csv([{file_list}], union_by_name = true, filename = true, types = {CSV_TYPES})
        ) to '{points.as_posix()}'
          (format parquet, partition_by (sensor, year), overwrite_or_ignore true, compression zstd)
    """)
    glob = f"{out.as_posix()}/**/*.parquet"
    return con.execute(f"select count(*) from read_parquet('{glob}')").fetchall()[0][0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--country", action="append", help="limit to this country (repeatable); default: all in config")
    args = ap.parse_args()

    cfg = load_config(args.config)
    countries = cfg.region_names(args.country)
    con = duckdb.connect()
    for sensor in cfg.sensors:
        folder = args.data / "raw" / sensor.archive
        files = sorted(f for c in countries for f in folder.glob(f"{sensor.archive}_*_{c}.csv"))
        if not files:
            print(f"warning: no raw files for {sensor.id} ({', '.join(countries)}) - run pipeline.ingest first")
            continue
        rows = normalize_sensor(con, files, sensor.id, args.data / "points")
        print(f"normalize: {sensor.id:<13} {len(files):>3} files -> {rows:>10,} points")


if __name__ == "__main__":
    main()
