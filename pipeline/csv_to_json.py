"""Convert FIRMS hotspot CSV files (MODIS or VIIRS, archive or Area API) to clean JSON.

Each CSV becomes one file with a `meta` block (what, where, when, field descriptions) and a list of
hotspots in one schema, whatever the sensor: readable names, ISO timestamps, units in the key names.

Usage:
    uv run python -m pipeline.csv_to_json data/raw/modis/modis_2024_Ukraine.csv
    uv run python -m pipeline.csv_to_json --country Ukraine --year 2024              # all sensors
    uv run python -m pipeline.csv_to_json --country Ukraine --year 2024 --format geojson
    uv run python -m pipeline.csv_to_json some.csv --format ndjson --gzip -o out/

Formats: json (default; one hotspot per line inside a readable document), geojson (FeatureCollection
for maps), ndjson (one JSON object per line, for streaming large files).
"""

import argparse
import csv
import datetime as dt
import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, load_config

ATTRIBUTION = "NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/"

# FIRMS `satellite` value -> (our sensor id, readable satellite name)
SATELLITES = {
    "TERRA": ("modis", "Terra"),
    "AQUA": ("modis", "Aqua"),
    "T": ("modis", "Terra"),
    "A": ("modis", "Aqua"),
    "N": ("viirs_snpp", "Suomi NPP"),
    "N20": ("viirs_noaa20", "NOAA-20"),
    "N21": ("viirs_noaa21", "NOAA-21"),
}
TYPE_LABELS = {0: "vegetation_fire", 1: "volcano", 2: "static_land_source", 3: "offshore"}
VIIRS_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}

FIELDS = {
    "lat": "latitude of the pixel centre, degrees north",
    "lon": "longitude of the pixel centre, degrees east",
    "time_utc": "satellite overpass time, ISO 8601, UTC",
    "sensor": "modis | viirs_snpp | viirs_noaa20 | viirs_noaa21",
    "satellite": "Terra, Aqua, Suomi NPP, NOAA-20 or NOAA-21",
    "confidence_class": "low | nominal | high (MODIS: <30 low, 30-79 nominal, >=80 high)",
    "confidence_raw": "as delivered: 0-100 for MODIS, l/n/h for VIIRS",
    "frp_mw": "fire radiative power of the pixel, megawatts",
    "daynight": "day | night",
    "type": "0 vegetation fire, 1 volcano, 2 other static land source, 3 offshore; null in near-real-time data",
    "type_label": "the same as text",
    "brightness_k": "brightness temperature of the fire channel, kelvin (MODIS band 21/22, VIIRS I-4)",
    "brightness_bg_k": "brightness temperature of the long-wave channel, kelvin (MODIS band 31, VIIRS I-5)",
    "scan_km": "pixel size across the swath, km (grows towards the swath edge)",
    "track_km": "pixel size along the track, km",
    "source": "sp (standard processing, science quality) | nrt (near real-time, provisional)",
}


def _num(value: str | None, cast=float):
    """'' / None / garbage -> None, otherwise a number."""
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def confidence_class(raw: str) -> str | None:
    """Same rule as pipeline.normalize: numeric MODIS scale or VIIRS letter -> low | nominal | high."""
    raw = (raw or "").strip().lower()
    if raw in VIIRS_CONFIDENCE:
        return VIIRS_CONFIDENCE[raw]
    number = _num(raw, int)
    if number is None:
        return None
    return "low" if number < 30 else "nominal" if number < 80 else "high"


def convert_row(row: dict) -> dict:
    """One FIRMS CSV row (either schema) -> one hotspot in the common schema."""
    is_viirs = "bright_ti4" in row
    sat_raw = (row.get("satellite") or "").strip()
    sensor, satellite = SATELLITES.get(sat_raw.upper(), ("viirs_unknown" if is_viirs else "modis", sat_raw or None))
    hhmm = (row.get("acq_time") or "0").strip().replace(":", "").zfill(4)
    time_utc = f"{row['acq_date'].strip()}T{hhmm[:2]}:{hhmm[2:]}:00Z"
    conf_raw = (row.get("confidence") or "").strip()
    type_code = _num(row.get("type"), int)
    version = (row.get("version") or "").strip()
    return {
        "lat": _num(row["latitude"]),
        "lon": _num(row["longitude"]),
        "time_utc": time_utc,
        "sensor": sensor,
        "satellite": satellite,
        "confidence_class": confidence_class(conf_raw),
        "confidence_raw": _num(conf_raw, int) if not is_viirs and _num(conf_raw, int) is not None else conf_raw or None,
        "frp_mw": _num(row.get("frp")),
        "daynight": {"D": "day", "N": "night"}.get((row.get("daynight") or "").strip().upper()),
        "type": type_code,
        "type_label": TYPE_LABELS.get(type_code),
        "brightness_k": _num(row.get("bright_ti4") if is_viirs else row.get("brightness")),
        "brightness_bg_k": _num(row.get("bright_ti5") if is_viirs else row.get("bright_t31")),
        "scan_km": _num(row.get("scan")),
        "track_km": _num(row.get("track")),
        "source": "nrt" if "RT" in version.upper() else "sp",
    }


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [convert_row(row) for row in csv.DictReader(f) if row.get("latitude") and row.get("acq_date")]


def build_meta(path: Path, hotspots: list[dict]) -> dict:
    name = re.search(r"_(\d{4})_(.+)\.csv$", path.name)  # archive files: <sensor>_<year>_<Country>.csv
    lats = [h["lat"] for h in hotspots if h["lat"] is not None]
    lons = [h["lon"] for h in hotspots if h["lon"] is not None]
    times = [h["time_utc"] for h in hotspots]
    return {
        "source_file": path.name,
        "country": name.group(2) if name else None,
        "year": int(name.group(1)) if name else None,
        "count": len(hotspots),
        "sensors": dict(sorted(Counter(h["sensor"] for h in hotspots).items())),
        "time_range_utc": [min(times), max(times)] if times else None,
        "bbox": [min(lons), min(lats), max(lons), max(lats)] if lats else None,  # west, south, east, north
        "by_confidence": dict(Counter(h["confidence_class"] or "unknown" for h in hotspots).most_common()),
        "by_type": dict(Counter(h["type_label"] or "unknown" for h in hotspots).most_common()),
        "converted_at_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": ATTRIBUTION,
        "fields": FIELDS,
    }


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(", ", ": "))


def write(meta: dict, hotspots: list[dict], out, fmt: str) -> None:
    """Write to an open text file. One hotspot per line in every format, so files stay readable and diffable."""
    if fmt == "ndjson":
        for h in hotspots:
            out.write(json.dumps(h, ensure_ascii=False, separators=(",", ":")) + "\n")
        return
    meta_text = json.dumps(meta, ensure_ascii=False, indent=2).replace("\n", "\n  ")
    if fmt == "geojson":
        meta = {k: v for k, v in meta.items() if k != "bbox"}
        meta_text = json.dumps(meta, ensure_ascii=False, indent=2).replace("\n", "\n  ")
        rows = [
            _line({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [h["lon"], h["lat"]]},
                "properties": {k: v for k, v in h.items() if k not in ("lat", "lon")},
            })
            for h in hotspots
        ]  # fmt: skip
        head = f'{{\n  "type": "FeatureCollection",\n  "meta": {meta_text},\n  "features": [\n'
    else:
        rows = [_line(h) for h in hotspots]
        head = f'{{\n  "meta": {meta_text},\n  "hotspots": [\n'
    out.write(head)
    out.write(",\n".join("    " + r for r in rows))
    out.write("\n  ]\n}\n")


def convert_file(path: Path, out_dir: Path, fmt: str = "json", gz: bool = False) -> tuple[Path, int]:
    hotspots = read_csv(path)
    meta = build_meta(path, hotspots)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{path.stem}.{fmt}{'.gz' if gz else ''}"
    opener = gzip.open if gz else open
    with opener(dest, "wt", encoding="utf-8") as out:
        write(meta, hotspots, out, fmt)
    return dest, len(hotspots)


def select_raw_files(
    data: Path, config: Path, countries: list[str], years: list[int], sensors: list[str]
) -> list[Path]:
    """Files in data/raw matching --country / --year / --sensor."""
    cfg = load_config(config)
    chosen = [s for s in cfg.sensors if not sensors or s.id in sensors]
    files = []
    for country in cfg.region_names(countries):
        for s in chosen:
            for f in sorted((data / "raw" / s.archive).glob(f"{s.archive}_*_{country}.csv")):
                year = int(re.search(r"_(\d{4})_", f.name).group(1))
                if not years or year in years:
                    files.append(f)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*", type=Path, help="CSV files to convert")
    ap.add_argument("--country", action="append", default=[], help="pick downloaded files of this country (repeatable)")
    ap.add_argument("--year", action="append", default=[], type=int, help="...of this year (repeatable)")
    ap.add_argument("--sensor", action="append", default=[], help="...of this sensor: modis, viirs_snpp, viirs_noaa20")
    ap.add_argument("--format", choices=["json", "geojson", "ndjson"], default="json")
    ap.add_argument("--gzip", action="store_true", help="write .gz (about 10x smaller)")
    ap.add_argument("-o", "--out", type=Path, help="output folder (default: data/json)")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    args = ap.parse_args()

    files = list(args.files)
    if args.country:
        files += select_raw_files(args.data, args.config, args.country, args.year, args.sensor)
    if not files:
        ap.error("nothing to convert: pass CSV files, or --country (with --year / --sensor to narrow it down)")
    missing = [str(f) for f in files if not f.is_file()]
    if missing:
        ap.error(f"not found: {', '.join(missing)}")

    out_dir = args.out or args.data / "json"
    total = 0
    for f in files:
        dest, n = convert_file(f, out_dir, args.format, args.gzip)
        total += n
        print(f"{n:>9,} hotspots  {dest.stat().st_size / 1e6:7.1f} MB  {dest}")
    print(f"csv_to_json: {len(files)} files, {total:,} hotspots -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
