"""Step 2 - bring MODIS and VIIRS CSV files to one point schema in data/points/ (Parquet).

Schema (one row per hotspot detection):
    lat, lon, acq_datetime_utc, satellite, confidence_raw, confidence_class (low|nominal|high),
    frp, daynight, type, scan_km, track_km, local_date, source (sp|nrt), country
plus the partition columns `sensor` (modis|viirs_snpp|viirs_noaa20) and `year`.

With --from-zips (world mode) it reads the global zips of `pipeline.ingest --zips-only` instead, one zip at a time
extracted to a temporary folder and removed, so the 50 GB of world CSV never sit on disk; a year already
written is kept unless --force.

Usage:  uv run python -m pipeline.normalize [--country Ukraine] [--config config/world.yaml] [--from-zips]
"""

import argparse
import re
import shutil
import tempfile
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
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


ZIP_NAME = re.compile(r"^(?P<archive>.+)_(?P<year>[0-9]{4})_all_countries\.zip$")


@contextmanager
def zip_csvs(zip_path: Path, archive: str, year: int) -> Iterator[list[Path]]:
    """The country CSV files of one global zip, extracted to a temporary folder beside data/raw/zips, then removed."""
    tmp = Path(tempfile.mkdtemp(prefix="unzipped_", dir=zip_path.parent.parent))
    try:
        with zipfile.ZipFile(zip_path) as z:
            for m in z.namelist():
                if m.startswith(f"{archive}/{year}/") and m.endswith(".csv"):
                    with z.open(m) as src, open(tmp / Path(m).name, "wb") as out:
                        shutil.copyfileobj(src, out, 1 << 20)
        yield sorted(tmp.glob("*.csv"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def normalize_zip(con: duckdb.DuckDBPyConnection, zip_path: Path, archive: str, year: int, sensor_id: str,
                  points: Path) -> int:  # fmt: skip
    """Write one global zip as points/sensor=<id>/year=<yyyy>/data_0.parquet. Returns the row count."""
    target = points / f"sensor={sensor_id}" / f"year={year}" / "data_0.parquet"
    with zip_csvs(zip_path, archive, year) as files:
        if not files:
            return 0
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        con.execute(f"""
            copy (select * exclude (sensor, year) from ({point_rows(files, sensor_id)}))
            to '{part.as_posix()}' (format parquet, compression zstd)
        """)
        part.replace(target)
    return con.execute(f"select count(*) from read_parquet('{target.as_posix()}')").fetchone()[0]


def normalize_zips(con: duckdb.DuckDBPyConnection, data: Path, cfg_sensors, force: bool = False) -> dict[str, int]:
    """Every global zip in data/raw/zips/ not written yet -> data/points/. Returns rows written per zip name."""
    sensor_of = {s.archive: s.id for s in cfg_sensors}
    done = {}
    for zip_path in sorted((data / "raw" / "zips").glob("*_all_countries.zip")):
        m = ZIP_NAME.match(zip_path.name)
        if not m or m["archive"] not in sensor_of:
            continue
        sensor_id, year = sensor_of[m["archive"]], int(m["year"])
        if (data / "points" / f"sensor={sensor_id}" / f"year={year}" / "data_0.parquet").exists() and not force:
            continue
        done[zip_path.name] = normalize_zip(con, zip_path, m["archive"], year, sensor_id, data / "points")
        print(f"normalize: {zip_path.name:<36} -> {done[zip_path.name]:>12,} points")
    return done


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
    ap.add_argument("--from-zips", action="store_true", help="read the global zips in data/raw/zips/, one at a time")
    ap.add_argument("--force", action="store_true", help="with --from-zips: write years already written again")
    args = ap.parse_args()

    cfg = load_config(args.config)
    countries = cfg.countries(args.country)
    con = duckdb.connect()
    if args.from_zips:
        normalize_zips(con, args.data, cfg.sensors, args.force)
        return
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
