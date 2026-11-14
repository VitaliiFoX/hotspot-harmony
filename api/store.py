"""Read the pipeline's output and answer questions about an area of interest.

Two series can be served, each as one value per cell and month:

    raw         built here from data/agg/cell_month.parquet: MODIS hotspots before RAW_SWITCH,
                VIIRS S-NPP hotspots from RAW_SWITCH on. It still contains the sensor jump.
    harmonized  read from data/agg/harmonized.parquet when the pipeline has written it.

Contract for data/agg/harmonized.parquet (one row per cell and month that has burning):
    cell_lat, cell_lon   centre of the cell, degrees
    country              region name as in config/regions.yaml
    year, month          calendar month (of the local solar day, see docs/METHOD.md)
    n_harmonized         the harmonized value
A cell belongs to an area when its centre is inside it, so any grid size works.
"""

from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from pipeline.config import Config

RAW_SWITCH = (2012, 2)  # first month the raw series takes from VIIRS S-NPP (it started on 2012-01-20)
CSV_COLUMNS = "lat, lon, acq_datetime_utc, sensor, satellite, confidence_class, frp, daynight, type, country"


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class Span:
    """An inclusive range of calendar months, held as month indexes (year * 12 + month - 1)."""

    first: int
    last: int

    @staticmethod
    def index(year: int, month: int) -> int:
        return year * 12 + month - 1

    @staticmethod
    def parse(text: str) -> int:
        return Span.index(int(text[:4]), int(text[5:7]))

    @staticmethod
    def label(index: int) -> str:
        return f"{index // 12:04d}-{index % 12 + 1:02d}"

    def months(self) -> range:
        return range(self.first, self.last + 1)


def parse_area(geometry: dict) -> BaseGeometry:
    try:
        area = shape(geometry)
    except Exception as e:  # shapely raises several unrelated types on malformed input
        raise ApiError(400, f"geometry is not valid GeoJSON: {e}") from e
    if area.geom_type not in ("Polygon", "MultiPolygon"):
        raise ApiError(400, f"geometry must be a Polygon or MultiPolygon, got {area.geom_type}")
    if area.is_empty or not area.is_valid:
        raise ApiError(400, "geometry is empty or self-intersecting")
    return area


class Store:
    def __init__(self, data_dir: Path, cfg: Config, csv_limit: int):
        self.cfg = cfg
        self.csv_limit = csv_limit
        self.points_glob = (data_dir / "points").as_posix() + "/**/*.parquet"
        self.has_points = (data_dir / "points").is_dir()
        self.con = duckdb.connect()
        self.spans: dict[str, Span] = {}
        self._load(data_dir / "agg")
        self.regions_shape = unary_union([box(*r.bbox) for r in cfg.regions])

    def _load(self, agg: Path) -> None:
        switch = Span.index(*RAW_SWITCH)
        sources = {
            "raw": (
                agg / "cell_month.parquet",
                f"""select cell_lat, cell_lon, year * 12 + month - 1 as ym, n_hotspots as value
                    from read_parquet(?)
                    where (sensor = 'modis' and year * 12 + month - 1 < {switch})
                       or (sensor = 'viirs_snpp' and year * 12 + month - 1 >= {switch})""",
            ),
            "harmonized": (
                agg / "harmonized.parquet",
                "select cell_lat, cell_lon, year * 12 + month - 1 as ym, n_harmonized as value from read_parquet(?)",
            ),
        }
        for name, (path, query) in sources.items():
            if not path.exists():
                continue
            self.con.execute(f"create table {name} as {query}", [path.as_posix()])
            first, last = self.con.execute(f"select min(ym), max(ym) from {name}").fetchone()
            if first is not None:
                self.spans[name] = Span(first, last)

    @property
    def series(self) -> list[str]:
        return list(self.spans)

    @property
    def default_series(self) -> str | None:
        return "harmonized" if "harmonized" in self.spans else next(iter(self.spans), None)

    def pick_series(self, wanted: str | None) -> str:
        if not self.spans:
            raise ApiError(503, "no data yet: run `make data` to build data/agg/cell_month.parquet")
        name = wanted or self.default_series
        if name not in self.spans:
            raise ApiError(404, f"series '{name}' is not available; available: {', '.join(self.series)}")
        return name

    def coverage_warnings(self, area: BaseGeometry) -> list[str]:
        names = ", ".join(r.name for r in self.cfg.regions)
        if not self.regions_shape.intersects(area):
            raise ApiError(422, f"the area is outside the regions that have data: {names}")
        if self.regions_shape.covers(area):
            return []
        return [f"Part of the area is outside the regions that have data ({names}); only the covered part is counted."]

    def _monthly(self, name: str, area: BaseGeometry) -> tuple[int, dict[int, float]]:
        """Number of cells inside the area and their summed value per month index."""
        cur = self.con.cursor()
        west, south, east, north = area.bounds
        cells = cur.execute(
            f"select distinct cell_lat, cell_lon from {name} "
            "where cell_lon between ? and ? and cell_lat between ? and ?",
            [west, east, south, north],
        ).fetchnumpy()
        inside = shapely.contains_xy(area, cells["cell_lon"], cells["cell_lat"])
        selected = pd.DataFrame({"cell_lat": cells["cell_lat"][inside], "cell_lon": cells["cell_lon"][inside]})
        if selected.empty:
            return 0, {}
        cur.register("selected", selected)
        rows = cur.execute(
            f"select ym, sum(value) from {name} join selected using (cell_lat, cell_lon) group by ym"
        ).fetchall()
        return len(selected), {ym: float(v) for ym, v in rows}

    def calendar(self, geometry: dict, start: str | None, end: str | None, series: str | None) -> dict:
        name = self.pick_series(series)
        area = parse_area(geometry)
        warnings = self.coverage_warnings(area)
        record = self.spans[name]
        asked = Span(Span.parse(start) if start else record.first, Span.parse(end) if end else record.last)
        if asked.first > asked.last:
            raise ApiError(400, "start is after end")
        chosen = Span(max(asked.first, record.first), min(asked.last, record.last))
        if chosen.first > chosen.last:
            raise ApiError(
                400, f"the record covers {Span.label(record.first)} to {Span.label(record.last)}; nothing to show"
            )
        cells_used, monthly = self._monthly(name, area)
        if cells_used == 0:
            warnings.append(
                "No cell with burning falls inside this area. Either it has not burned, or it lies outside the "
                "borders of the regions with data, which are checked by bounding box only."
            )

        def value(ym: int) -> float:
            return monthly.get(ym, 0.0)

        def sensor(ym: int) -> str | None:
            if name != "raw":
                return None
            return "modis" if ym < Span.index(*RAW_SWITCH) else "viirs_snpp"

        history = {m: np.array([value(ym) for ym in record.months() if ym % 12 == m]) for m in range(12)}
        climatology = [
            {
                "month": m + 1,
                "median": float(np.median(v)),
                "p25": float(np.percentile(v, 25)),
                "p75": float(np.percentile(v, 75)),
                "years": len(v),
            }
            for m, v in history.items()
            if len(v)
        ]
        last = chosen.last
        past = history[last % 12]
        median = float(np.median(past))
        anomaly = {
            "year": last // 12,
            "month": last % 12 + 1,
            "value": value(last),
            "median": median,
            "ratio": round(value(last) / median, 2) if median > 0 else None,
            "percentile": round(100 * float(np.mean(past < value(last)))),
        }
        yearly = [
            {
                "year": year,
                "value": sum(value(ym) for ym in chosen.months() if ym // 12 == year),
                "complete": chosen.first <= year * 12 and year * 12 + 11 <= chosen.last,
            }
            for year in range(chosen.first // 12, chosen.last // 12 + 1)
        ]
        return {
            "series": name,
            "cells_used": cells_used,
            "warnings": warnings,
            "months": [
                {"year": ym // 12, "month": ym % 12 + 1, "value": value(ym), "sensor": sensor(ym)}
                for ym in chosen.months()
            ],
            "climatology": climatology,
            "anomaly": anomaly,
            "yearly": yearly,
        }

    def hotspots_csv(self, geometry: dict, start: str, end: str) -> tuple[str, bool]:
        """CSV text of the hotspots inside the area between two dates (inclusive), and whether it was cut short."""
        if not self.has_points:
            raise ApiError(503, "no data yet: run `make data` to build data/points/")
        area = parse_area(geometry)
        self.coverage_warnings(area)
        first, last = pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)
        if first >= last:
            raise ApiError(400, "start is after end")
        west, south, east, north = area.bounds
        cur = self.con.cursor()
        cur.execute(
            f"""select {CSV_COLUMNS}
                from read_parquet(?, hive_partitioning = true)
                where year between ? and ? and lon between ? and ? and lat between ? and ?
                  and acq_datetime_utc >= ? and acq_datetime_utc < ?
                order by acq_datetime_utc, lat, lon""",
            [self.points_glob, first.year, last.year, west, east, south, north, first, last],
        )
        kept: list[pd.DataFrame] = []
        rows = 0
        while rows <= self.csv_limit:
            chunk = cur.fetch_df_chunk(50)
            if chunk.empty:
                break
            chunk = chunk[shapely.contains_xy(area, chunk["lon"].to_numpy(), chunk["lat"].to_numpy())]
            kept.append(chunk)
            rows += len(chunk)
        columns = [c.strip() for c in CSV_COLUMNS.split(",")]
        table = pd.concat(kept) if kept else pd.DataFrame(columns=columns)
        truncated = len(table) > self.csv_limit
        text = table.head(self.csv_limit).to_csv(index=False, date_format="%Y-%m-%dT%H:%M:%SZ")
        return text, truncated

    def meta(self) -> dict:
        span = self.spans.get(self.default_series) if self.default_series else None
        return {
            "regions": [{"name": r.name, "bbox": list(r.bbox)} for r in self.cfg.regions],
            "series": self.series,
            "default_series": self.default_series,
            "first_month": Span.label(span.first) if span else None,
            "last_month": Span.label(span.last) if span else None,
            "cell_deg": self.cfg.cell_deg,
            "raw_sensor_switch": Span.label(Span.index(*RAW_SWITCH)),
            "csv_row_limit": self.csv_limit,
        }
