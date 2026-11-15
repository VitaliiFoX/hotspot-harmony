"""Measure how much of each configured region's box falls inside its Natural Earth border.

Posts each country's border from web/public/countries.geojson and its bounding box from
config/regions.yaml to Store.calendar(..., series="harmonized") -- the same code behind
POST /api/calendar -- and prints the harmonized totals, cell counts, and border share.

Usage:
    uv run python scripts/border_share.py [--data-dir data/demo]
"""

import argparse
import json
import os
from pathlib import Path

from shapely.geometry import box

from api.store import Store
from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, load_config

ROOT = Path(__file__).resolve().parent.parent
BORDERS = ROOT / "web" / "public" / "countries.geojson"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("HH_DATA_DIR") or DEFAULT_DATA),
        help="directory holding agg/harmonized.parquet (default: HH_DATA_DIR or data/)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("HH_CONFIG") or DEFAULT_CONFIG),
        help="regions config file (default: HH_CONFIG or config/regions.yaml)",
    )
    args = parser.parse_args()

    cfg = load_config(args.config)
    store = Store(args.data_dir, cfg, 500_000)
    collection = json.loads(BORDERS.read_text(encoding="utf-8"))
    by_name = {f["properties"]["name"]: f["geometry"] for f in collection["features"]}
    if collection.get("source"):
        print(f"Border source: {collection['source']}")

    for region in cfg.regions:
        border = by_name.get(region.name)
        if border is None:
            print(f"{region.name}: border not found in {BORDERS.relative_to(ROOT)}")
            continue
        box_cal = store.calendar(box(*region.bbox).__geo_interface__, None, None, "harmonized")
        border_cal = store.calendar(border, None, None, "harmonized")
        box_total = sum(y["value"] for y in box_cal["yearly"])
        border_total = sum(y["value"] for y in border_cal["yearly"])
        share = (border_total / box_total * 100) if box_total else 0.0
        print(
            f"{region.name}: {share:.1f}% "
            f"(border {border_total:,.1f} over {border_cal['cells_used']} cells "
            f"vs box {box_total:,.1f} over {box_cal['cells_used']} cells)"
        )


if __name__ == "__main__":
    main()
