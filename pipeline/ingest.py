"""Step 1 - download FIRMS country-year CSV archives (standard processing) into data/raw/.

Files that already exist are not downloaded again, so the step is safe to re-run.
Source: https://firms.modaps.eosdis.nasa.gov/country/ (public, no key needed).
In world mode (`world: true` in the config) the global zip of each sensor and year is downloaded into
data/raw/zips/ and its per-country CSV files are extracted next to the country downloads.

Usage:  uv run python -m pipeline.ingest [--country Ukraine] [--force] [--config config/world.yaml]
"""

import argparse
import datetime as dt
import os
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partial
from pathlib import Path

import requests

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, Config, load_config

ARCHIVE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{archive}/{year}/{archive}_{year}_{country}.csv"
WORLD_ZIP_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/zips/{archive}_{year}_all_countries.zip"
HEADERS = {"User-Agent": "hotspot-harmony/0.1"}


def archive_jobs(cfg: Config, countries: list[str], last_year: int) -> list[tuple[str, int, str]]:
    """Every (archive folder, year, country) file that could exist up to `last_year`."""
    return [
        (s.archive, year, country)
        for country in countries
        for s in cfg.sensors
        for year in range(s.first_year, last_year + 1)
    ]


def world_jobs(cfg: Config, last_year: int) -> list[tuple[str, int]]:
    """Every (archive folder, year) global zip that could exist up to `last_year`."""
    return [(s.archive, year) for s in cfg.sensors for year in range(s.first_year, last_year + 1)]


def download(url: str, dest: Path) -> str:
    """Download `url` to `dest` through a temporary file. Returns downloaded, not published or FAILED: <error>."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    error: Exception | None = None
    for _ in range(3):  # retry transient network errors
        try:
            with requests.get(url, headers=HEADERS, stream=True, timeout=60) as r:
                if r.status_code == 404:  # FIRMS has not published this year / sensor yet
                    return "not published"
                r.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                tmp.replace(dest)  # rename() fails on Windows when --force finds the file there
                return "downloaded"
        except requests.RequestException as e:
            error = e
    return f"FAILED: {error}"


def fetch(archive: str, year: int, country: str, raw: Path, force: bool) -> tuple[str, str, int]:
    name = f"{archive}_{year}_{country}.csv"
    dest = raw / archive / name
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return name, "cached", dest.stat().st_size
    status = download(ARCHIVE_URL.format(archive=archive, year=year, country=country), dest)
    return name, status, dest.stat().st_size if status == "downloaded" else 0


def extract_countries(zip_path: Path, archive: str, year: int, raw: Path, force: bool) -> int:
    """Extract the per-country CSV files of a global zip into raw/<archive>/. Returns how many were written."""
    written = 0
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            if not (member.startswith(f"{archive}/{year}/") and member.endswith(".csv")):
                continue
            dest = raw / archive / Path(member).name
            if dest.exists() and dest.stat().st_size > 0 and not force:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(".part")
            with z.open(member) as src, open(tmp, "wb") as out:
                while chunk := src.read(1 << 20):
                    out.write(chunk)
            tmp.replace(dest)  # rename() fails on Windows when --force finds the file there
            written += 1
    return written


def fetch_world(archive: str, year: int, raw: Path, force: bool, extract: bool = True) -> tuple[str, str, int]:
    name = f"{archive}_{year}_all_countries.zip"
    dest = raw / "zips" / name
    status = "cached"
    if force or not (dest.exists() and dest.stat().st_size > 0):
        status = download(WORLD_ZIP_URL.format(archive=archive, year=year), dest)
        if status != "downloaded":
            return name, status, 0
    if not extract:
        return name, status, dest.stat().st_size
    try:
        written = extract_countries(dest, archive, year, raw, force)
    except zipfile.BadZipFile as e:
        dest.unlink()  # a broken zip would otherwise be treated as cached on the next run
        return name, f"FAILED: {e}", 0
    if written and status == "cached":
        status = "extracted"
    return name, status, dest.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--country", action="append", help="limit to this country (repeatable); default: all in config")
    ap.add_argument("--force", action="store_true", help="download again even if the file exists")
    ap.add_argument(
        "--zips-only",
        action="store_true",
        help="world mode: keep the global zips without extracting them (enough for pipeline.day_points)",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    raw = args.data / "raw"
    if cfg.world:
        if args.country:
            print("note: --country is ignored in world mode; the global zips hold every country")
        task, jobs = partial(fetch_world, extract=not args.zips_only), world_jobs(cfg, dt.date.today().year)
    else:
        task, jobs = fetch, archive_jobs(cfg, cfg.region_names(args.country), dt.date.today().year)
    total = failed = 0
    with ThreadPoolExecutor(max_workers=4 if cfg.world else 6) as pool:
        futures = [pool.submit(task, *job, raw, args.force) for job in jobs]
        for fut in as_completed(futures):
            name, status, size = fut.result()
            total += size
            failed += status.startswith("FAILED")
            if status != "cached":
                print(f"{status:>14}  {size / 1e6:6.1f} MB  {name}")
    print(f"ingest: {len(jobs)} files checked, {total / 1e6:.0f} MB in {raw}, {failed} failed")

    # The country archive ends with the last fully processed year. The current year comes from the
    # FIRMS Area API, which needs a personal key. That part is not built yet.
    if os.environ.get("FIRMS_MAP_KEY"):
        print("warning: FIRMS_MAP_KEY is set, but current-year ingest via the Area API is not implemented yet")
    else:
        print("warning: FIRMS_MAP_KEY not set - current-year data skipped (archive years only)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
