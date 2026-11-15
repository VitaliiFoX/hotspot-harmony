"""Step 2 - bring MODIS and VIIRS CSV files to one point schema in data/points/ (Parquet).

Schema (one row per hotspot detection):
    lat, lon, acq_datetime_utc, satellite, confidence_raw, confidence_class (low|nominal|high),
    frp, daynight, type, scan_km, track_km, local_date, source (sp|nrt), country
plus the partition columns `sensor` (modis|viirs_snpp|viirs_noaa20) and `year`.

Usage:  uv run python -m pipeline.normalize [--country Ukraine] [--config config/world.yaml]
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


def point_rows(files: list[Path], sensor_id: str) -> str:
    """SQL that reads the CSV files of one sensor as rows of the point schema, partition columns included."""
    file_list = ", ".join(f"'{f.as_posix()}'" for f in files)
    hhmm = "lpad(acq_time, 4, '0')"
    return f"""
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
                   scan as scan_km,
                   track as track_km,
                   -- local solar date: a night overpass just before 00 UTC belongs to the same burning day
                   cast(cast(acq_date as timestamp)
                        + to_minutes(cast(substr({hhmm}, 1, 2) as integer) * 60 + cast(substr({hhmm}, 3, 2) as integer)
                                     + cast(round(longitude * 4) as integer)) as date) as local_date,
                   'sp' as source,
                   regexp_extract(filename, '_[0-9]{{4}}_(.+)\\.csv$', 1) as country,
                   '{sensor_id}' as sensor,
                   year(acq_date) as year
            from read_csv([{file_list}], union_by_name = true, filename = true, types = {CSV_TYPES})"""


def normalize_sensor(con: duckdb.DuckDBPyConnection, files: list[Path], sensor_id: str, points: Path) -> int:
    """Write the CSV files of one sensor as points/sensor=<id>/year=<yyyy>/*.parquet. Returns the row count."""
    out = points / f"sensor={sensor_id}"
    if out.exists():
        shutil.rmtree(out)  # no stale partitions from an earlier run
    points.mkdir(parents=True, exist_ok=True)
    con.execute(f"""
        copy ({point_rows(files, sensor_id)}
        ) to '{points.as_posix()}'
          (format parquet, partition_by (sensor, year), overwrite_or_ignore true, compression zstd)
    """)
    glob = f"{out.as_posix()}/**/*.parquet"
    return con.execute(f"select count(*) from read_parquet('{glob}')").fetchall()[0][0]


def raw_files(folder: Path, archive: str, countries: list[str] | None) -> list[Path]:
    """CSV files of one sensor for the given countries; None means every country in the folder."""
    if countries is None:
        return sorted(folder.glob(f"{archive}_*.csv"))
    return sorted(f for c in countries for f in folder.glob(f"{archive}_*_{c}.csv"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--country", action="append", help="limit to this country (repeatable); default: all in config")
    args = ap.parse_args()

    cfg = load_config(args.config)
    countries = cfg.countries(args.country)
    con = duckdb.connect()
    for sensor in cfg.sensors:
        files = raw_files(args.data / "raw" / sensor.archive, sensor.archive, countries)
        if not files:
            which = ", ".join(countries) if countries else "all countries"
            print(f"warning: no raw files for {sensor.id} ({which}) - run pipeline.ingest first")
            continue
        rows = normalize_sensor(con, files, sensor.id, args.data / "points")
        print(f"normalize: {sensor.id:<13} {len(files):>3} files -> {rows:>10,} points")


if __name__ == "__main__":
    main()
