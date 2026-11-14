"""Step 1 - download FIRMS country-year CSV archives (standard processing) into data/raw/.

Files that already exist are not downloaded again, so the step is safe to re-run.
Source: https://firms.modaps.eosdis.nasa.gov/country/ (public, no key needed).

Usage:  uv run python -m pipeline.ingest [--country Ukraine] [--force]
"""

import argparse
import datetime as dt
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, Config, load_config

ARCHIVE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{archive}/{year}/{archive}_{year}_{country}.csv"
HEADERS = {"User-Agent": "hotspot-harmony/0.1"}


def archive_jobs(cfg: Config, countries: list[str], last_year: int) -> list[tuple[str, int, str]]:
    """Every (archive folder, year, country) file that could exist up to `last_year`."""
    return [
        (s.archive, year, country)
        for country in countries
        for s in cfg.sensors
        for year in range(s.first_year, last_year + 1)
    ]


def fetch(archive: str, year: int, country: str, raw: Path, force: bool) -> tuple[str, str, int]:
    name = f"{archive}_{year}_{country}.csv"
    dest = raw / archive / name
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return name, "cached", dest.stat().st_size
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = ARCHIVE_URL.format(archive=archive, year=year, country=country)
    error: Exception | None = None
    for _ in range(3):  # retry transient network errors
        try:
            with requests.get(url, headers=HEADERS, stream=True, timeout=60) as r:
                if r.status_code == 404:  # FIRMS has not published this year / sensor yet
                    return name, "not published", 0
                r.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                tmp.replace(dest)  # rename() fails on Windows when --force finds the file there
                return name, "downloaded", dest.stat().st_size
        except requests.RequestException as e:
            error = e
    return name, f"FAILED: {error}", 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--country", action="append", help="limit to this country (repeatable); default: all in config")
    ap.add_argument("--force", action="store_true", help="download again even if the file exists")
    args = ap.parse_args()

    cfg = load_config(args.config)
    jobs = archive_jobs(cfg, cfg.region_names(args.country), dt.date.today().year)
    total = failed = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fetch, *job, args.data / "raw", args.force) for job in jobs]
        for fut in as_completed(futures):
            name, status, size = fut.result()
            total += size
            failed += status.startswith("FAILED")
            if status != "cached":
                print(f"{status:>14}  {size / 1e6:6.1f} MB  {name}")
    print(f"ingest: {len(jobs)} files checked, {total / 1e6:.0f} MB in {args.data / 'raw'}, {failed} failed")

    # The country archive ends with the last fully processed year. The current year comes from the
    # FIRMS Area API, which needs a personal key. That part is not built yet.
    if os.environ.get("FIRMS_MAP_KEY"):
        print("warning: FIRMS_MAP_KEY is set, but current-year ingest via the Area API is not implemented yet")
    else:
        print("warning: FIRMS_MAP_KEY not set - current-year data skipped (archive years only)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
