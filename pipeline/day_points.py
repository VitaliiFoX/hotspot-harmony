"""Hotspots of every country for the globe's day view, small enough to ship with the API.

The day view shows one sensor per day, as the raw record does: MODIS before 2012-02-01, VIIRS S-NPP from then
on, with the config's filters already applied. Of each hotspot it keeps what the day view reads: the coordinates
as integers of 1e-4 degree (`lat_e4`, `lon_e4`, about 11 m, the precision the API already rounds to), the UTC time
and the country. That is about 4 bytes a hotspot instead of 11 in data/points/.

Input: the global zips that pipeline.ingest downloads in world mode, data/raw/zips/<archive>_<year>_all_countries.zip.
One zip at a time is extracted to a temporary folder, read and removed, so the 50 GB of CSV never sit on disk.
Output: data/day_points/sensor=<id>/year=<yyyy>/data_0.parquet, sorted by time, and data/day_points/manifest.json.
A year already built is kept; --force builds it again.

Usage:  uv run python -m pipeline.day_points [--config config/world.yaml] [--force]
"""

import argparse
import datetime as dt
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

import duckdb

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, Config, load_config
from pipeline.harmonize import RAW_SWITCH
from pipeline.normalize import point_rows

SCALE = 10_000  # coordinates are stored as round(degrees * SCALE)
ZIP_NAME = re.compile(r"^(?P<archive>.+)_(?P<year>[0-9]{4})_all_countries\.zip$")
SWITCH_YEAR = int(RAW_SWITCH[:4])


def day_view_sensors(cfg: Config) -> dict[str, tuple[str, str]]:
    """archive folder -> (sensor id, SQL condition on acq_datetime_utc) for the two sensors the day view shows."""
    archive = {s.id: s.archive for s in cfg.sensors}
    return {
        archive["modis"]: ("modis", f"acq_datetime_utc < timestamp '{RAW_SWITCH}'"),
        archive["viirs_snpp"]: ("viirs_snpp", f"acq_datetime_utc >= timestamp '{RAW_SWITCH}'"),
    }


def build_year(
    con: duckdb.DuckDBPyConnection,
    zip_path: Path,
    archive: str,
    year: int,
    sensor_id: str,
    when: str,
    cfg: Config,
    target: Path,
) -> int:
    """Write the day view's hotspots of one global zip to `target`. Returns how many were kept."""
    drop = ", ".join(f"'{c}'" for c in cfg.drop_confidence) or "''"
    keep = ", ".join(str(t) for t in cfg.keep_types)
    tmp = Path(tempfile.mkdtemp(prefix="day_points_", dir=zip_path.parent.parent))
    try:
        with zipfile.ZipFile(zip_path) as z:
            members = [m for m in z.namelist() if m.startswith(f"{archive}/{year}/") and m.endswith(".csv")]
            for m in members:
                with z.open(m) as src, open(tmp / Path(m).name, "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
        files = sorted(tmp.glob("*.csv"))
        if not files:
            return 0
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        con.execute(f"""
            copy (
                select cast(round(lat * {SCALE}) as integer) as lat_e4,
                       cast(round(lon * {SCALE}) as integer) as lon_e4,
                       acq_datetime_utc,
                       country
                from ({point_rows(files, sensor_id)})
                where {when} and confidence_class not in ({drop}) and type in ({keep})
                order by acq_datetime_utc, lat_e4, lon_e4
            ) to '{part.as_posix()}' (format parquet, compression zstd, compression_level 19)
        """)
        part.replace(target)
        return con.execute(f"select count(*) from read_parquet('{target.as_posix()}')").fetchone()[0]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build(data: Path, cfg: Config, force: bool = False) -> dict:
    """Build every year whose zip is in data/raw/zips/ and not built yet; write and return the manifest."""
    con = duckdb.connect()
    out = data / "day_points"
    sensors = day_view_sensors(cfg)
    for zip_path in sorted((data / "raw" / "zips").glob("*_all_countries.zip")):
        m = ZIP_NAME.match(zip_path.name)
        if not m or m["archive"] not in sensors:
            continue  # NOAA-20 is not on the globe
        archive, year = m["archive"], int(m["year"])
        sensor_id, when = sensors[archive]
        if (sensor_id == "modis" and year > SWITCH_YEAR) or (sensor_id == "viirs_snpp" and year < SWITCH_YEAR):
            continue  # a year the other sensor covers
        target = out / f"sensor={sensor_id}" / f"year={year}" / "data_0.parquet"
        if target.exists() and not force:
            continue
        n = build_year(con, zip_path, archive, year, sensor_id, when, cfg, target)
        print(f"day_points: {zip_path.name:<36} -> {n:>11,} hotspots ({target.stat().st_size / 1e6:6.1f} MB)")

    rows: dict[str, dict[str, int]] = {}
    for f in sorted(out.glob("sensor=*/year=*/data_0.parquet")):
        sensor_id, year = f.parent.parent.name.split("=")[1], f.parent.name.split("=")[1]
        (n,) = con.execute(f"select count(*) from read_parquet('{f.as_posix()}')").fetchone()
        rows.setdefault(sensor_id, {})[year] = n
    manifest = {
        "built_at_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), global yearly archives",
        "columns": {
            "lat_e4": f"latitude x {SCALE}",
            "lon_e4": f"longitude x {SCALE}",
            "acq_datetime_utc": "UTC",
            "country": "as in the FIRMS file name",
        },  # fmt: skip
        "coordinate_scale": SCALE,
        "switch_to_viirs_snpp": RAW_SWITCH,
        "drop_confidence": list(cfg.drop_confidence),
        "keep_types": list(cfg.keep_types),
        "rows": rows,
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--force", action="store_true", help="build years that are already built again")
    args = ap.parse_args()
    manifest = build(args.data, load_config(args.config), args.force)
    total = sum(n for years in manifest["rows"].values() for n in years.values())
    size = sum(f.stat().st_size for f in (args.data / "day_points").glob("sensor=*/year=*/data_0.parquet"))
    print(f"day_points: {total:,} hotspots in {size / 1e9:.2f} GB -> {args.data / 'day_points'}")


if __name__ == "__main__":
    main()
