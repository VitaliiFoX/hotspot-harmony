"""Write web/public/countries.geojson: the country borders the globe uses to pick a country.

Source: Natural Earth 1:10m "Admin 0 - Countries", public domain, in the point-of-view edition
`ne_10m_admin_0_countries_ukr`, the one of the Natural Earth editions that keeps Crimea in Ukraine.

    uv run python scripts/build_countries.py        (or: make borders)

The 13 MB source is downloaded once to data/borders/ and cut down to what a browser can load:

    - each border is simplified with a tolerance of SIMPLIFY_DEG and snapped to a grid of GRID_DEG;
    - islands smaller than MIN_PART_DEG2 are dropped, unless they are the largest part of a country.

A side of a 0.25-degree grid cell is 28 km at the equator, so a border that is off by SIMPLIFY_DEG (about
2 km) moves a cell from one country to the other only when the cell centre is that close to the border.
Each country is simplified on its own, so slivers up to that width can open or overlap between neighbours.

Properties of a feature:
    name     the Natural Earth ADMIN name, e.g. "United States of America"
    aliases  its other Natural Earth names (NAME, NAME_LONG, NAME_EN) where they differ
    iso      ADM0_A3, the three-letter code Natural Earth gives every feature
    view     west, south, east, north of the parts worth flying to: those at least VIEW_SHARE of the
             largest part, so that France is shown in Europe and not stretched to French Guiana
"""

import json
import urllib.request
from pathlib import Path

import shapely
from shapely.geometry import MultiPolygon, mapping, shape

BORDER_VERSION = "v5.1.2"
BORDER_COMMIT = "f1890d9f152c896d250a77557a5751a93d494776"
BORDER_SOURCE = f"Natural Earth 10m _ukr {BORDER_VERSION}"
SOURCE = (
    f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{BORDER_COMMIT}/geojson/"
    "ne_10m_admin_0_countries_ukr.geojson"
)
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "borders" / "ne_10m_admin_0_countries_ukr.geojson"
OUT = ROOT / "web" / "public" / "countries.geojson"

SIMPLIFY_DEG = 0.02
GRID_DEG = 0.001
MIN_PART_DEG2 = 0.002
VIEW_SHARE = 0.2


def parts_of(geometry) -> list:
    """The polygons of a geometry, largest first."""
    polygons = [g for g in getattr(geometry, "geoms", [geometry]) if g.geom_type == "Polygon" and not g.is_empty]
    return sorted(polygons, key=lambda p: p.area, reverse=True)


def cut_down(geometry) -> MultiPolygon:
    """One country's border, light enough for the browser: simplified, snapped to the grid, tiny islands dropped."""
    # Snapping the whole country at once also joins parts that the simplification made touch, so the result is valid.
    light = parts_of(shapely.set_precision(geometry.simplify(SIMPLIFY_DEG, preserve_topology=True), GRID_DEG))
    return MultiPolygon([part for index, part in enumerate(light) if index == 0 or part.area >= MIN_PART_DEG2])


def view_of(country: MultiPolygon) -> list[float]:
    """Bounds of the parts at least VIEW_SHARE of the largest one."""
    parts = list(country.geoms)
    shown = [p for p in parts if p.area >= VIEW_SHARE * parts[0].area]
    return [round(v, 2) for v in MultiPolygon(shown).bounds]


def build(source: dict) -> dict:
    features = []
    for feature in source["features"]:
        properties = feature["properties"]
        country = cut_down(shape(feature["geometry"]))
        if country.is_empty:
            continue
        name = properties["ADMIN"]
        aliases = sorted({properties[key] for key in ("NAME", "NAME_LONG", "NAME_EN") if properties.get(key)} - {name})
        features.append({
            "type": "Feature",
            "properties": {"name": name, "aliases": aliases, "iso": properties["ADM0_A3"], "view": view_of(country)},
            "geometry": mapping(country),
        })  # fmt: skip
    features.sort(key=lambda f: f["properties"]["name"])
    return {"type": "FeatureCollection", "source": BORDER_SOURCE, "features": features}


def main() -> None:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SOURCE}")
        urllib.request.urlretrieve(SOURCE, CACHE)  # noqa: S310 - a fixed https address
    countries = build(json.loads(CACHE.read_text(encoding="utf-8")))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Tuples become lists and 30.10000001 becomes 30.1: the grid already holds three decimals.
    text = json.dumps(countries, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(text + "\n", encoding="utf-8")
    polygons = [polygon for f in countries["features"] for polygon in f["geometry"]["coordinates"]]
    points = sum(len(ring) for polygon in polygons for ring in polygon)
    print(f"{OUT.relative_to(ROOT)}: {len(countries['features'])} countries, {points} points, {len(text) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
