"""Read the pipeline's output and answer questions about an area of interest.

Two series can be served, each as one value per cell and month:

    harmonized  data/agg/harmonized.parquet, column n_harmonized: MODIS-equivalent fire cell-days.
    raw         the same file, column n_raw: fire cell-days of MODIS before RAW_SWITCH and of VIIRS S-NPP
                from RAW_SWITCH on, with no correction. It still contains the sensor jump.
                Before the pipeline has written harmonized.parquet, the raw series falls back to hotspot
                counts from data/agg/cell_month.parquet, in a different unit.

Contract for data/agg/harmonized.parquet (one row per cell and month that has burning):
    cell_lat, cell_lon   centre of the cell, degrees
    country              region name as in config/regions.yaml
    year, month          calendar month (of the local solar day, see docs/METHOD.md)
    n_harmonized         the harmonized value
    n_raw                fire cell-days of the raw record
    sensor_used          sensor behind the harmonized value in that month
A cell belongs to an area when its centre is inside it, so any grid size works.

The hotspots of one UTC day, and the hotspot count of each day of a month, are read from data/points with
the default filters of the config and one sensor per date, by the rule of the raw series.
Months before RECORD_FIRST are dropped: the archive starts on 2000-11-01 UTC, and a local solar day can
still fall on 31 October in the western hemisphere.
"""

import calendar as months_calendar
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
from pipeline.harmonize import RECORD

RAW_SWITCH = (2012, 2)  # first month the raw series takes from VIIRS S-NPP (it started on 2012-01-20)
RECORD_FIRST = (2000, 11)  # first full month of the FIRMS archive
UNITS = {
    "harmonized": "MODIS-equivalent fire cell-days",
    "raw": "fire cell-days",
    "raw_hotspots": "hotspots",
}
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


def parse_day(text: str) -> pd.Timestamp:
    """YYYY-MM-DD that exists on the calendar; the request pattern alone lets 2013-02-30 through."""
    try:
        return pd.Timestamp(text)
    except ValueError as e:
        raise ApiError(400, f"{text} is not a day on the calendar") from e


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
        first = Span.index(*RECORD_FIRST)
        ym = "year * 12 + month - 1"
        harmonized = agg / "harmonized.parquet"
        self.units: dict[str, str] = {}
        sources: dict[str, tuple[Path, str]] = {}
        if harmonized.exists():
            sources["raw"] = (
                harmonized,
                f"select cell_lat, cell_lon, {ym} as ym, n_raw as value, null as sensor from read_parquet(?) "
                f"where n_raw > 0 and {ym} >= {first}",
            )
            sources["harmonized"] = (
                harmonized,
                f"select cell_lat, cell_lon, {ym} as ym, n_harmonized as value, sensor_used as sensor "
                f"from read_parquet(?) where {ym} >= {first}",
            )
            self.units = {"raw": UNITS["raw"], "harmonized": UNITS["harmonized"]}
        elif (agg / "cell_month.parquet").exists():
            sources["raw"] = (
                agg / "cell_month.parquet",
                f"""select cell_lat, cell_lon, {ym} as ym, n_hotspots as value, null as sensor
                    from read_parquet(?)
                    where {ym} >= {first}
                      and ((sensor = 'modis' and {ym} < {switch}) or (sensor = 'viirs_snpp' and {ym} >= {switch}))""",
            )
            self.units = {"raw": UNITS["raw_hotspots"]}
        self.month_sensor: dict[str, dict[int, str]] = {}
        for name, (path, query) in sources.items():
            self.con.execute(f"create table {name} as {query}", [path.as_posix()])
            lo, hi = self.con.execute(f"select min(ym), max(ym) from {name}").fetchone()
            if lo is None:
                self.units.pop(name, None)
                continue
            self.spans[name] = Span(lo, hi)
            if name == "raw":
                self.month_sensor[name] = {
                    m: "modis" if m < switch else "viirs_snpp" for m in Span(lo, hi).months()
                }
            else:
                rows = self.con.execute(f"select ym, any_value(sensor) from {name} group by ym").fetchall()
                self.month_sensor[name] = dict(rows)

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
            return self.month_sensor[name].get(ym)

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
            "unit": self.units[name],
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
        first, last = parse_day(start), parse_day(end) + pd.Timedelta(days=1)
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

    def _day_source(self, first: pd.Timestamp, last: pd.Timestamp) -> tuple[str, str, list]:
        """Sensor, SQL source and parameters of the filtered hotspots from `first` up to, not including, `last`.

        Both ends must fall in one calendar month, so one sensor and one year partition cover them.
        """
        if not self.has_points:
            raise ApiError(503, "no data yet: run `make data` to build data/points/")
        month = Span.index(first.year, first.month)
        record_first, record_last = Span.index(*RECORD_FIRST), self._record_last()
        if month < record_first or (record_last is not None and month > record_last):
            end = Span.label(record_last) if record_last is not None else "today"
            raise ApiError(400, f"the record covers {Span.label(record_first)} to {end}; nothing to show")
        sensor = "modis" if month < Span.index(*RAW_SWITCH) else "viirs_snpp"
        drop = ", ".join(f"'{c}'" for c in self.cfg.drop_confidence) or "''"
        keep = ", ".join(str(t) for t in self.cfg.keep_types)
        regions = ", ".join("'" + r.name.replace("'", "''") + "'" for r in self.cfg.regions)
        country_clause = "" if getattr(self.cfg, "world", False) else f" and country in ({regions})"
        source = f"""from read_parquet(?, hive_partitioning = true)
                     where sensor = ? and year = ? and acq_datetime_utc >= ? and acq_datetime_utc < ?
                       and confidence_class not in ({drop}) and type in ({keep}){country_clause}"""
        return sensor, source, [self.points_glob, sensor, first.year, first, last]

    def _record_last(self) -> int | None:
        span = self.spans.get(self.default_series) if self.default_series else None
        return span.last if span else None

    def hotspot_days(self, month: str) -> dict:
        """Number of hotspots on each UTC day of one month, zeros included."""
        try:
            first = pd.Timestamp(f"{month}-01")
        except ValueError as e:
            raise ApiError(400, f"{month} is not a calendar month") from e
        last = first + pd.offsets.MonthBegin(1)
        sensor, source, params = self._day_source(first, last)
        query = f"select extract(day from acq_datetime_utc) as day, count(*) {source} group by day"
        rows = self.con.cursor().execute(query, params).fetchall()
        counts = {int(day): int(n) for day, n in rows}
        return {
            "month": month,
            "sensor": sensor,
            "unit": UNITS["raw_hotspots"],
            "days": [{"day": d, "value": counts.get(d, 0)} for d in range(1, first.days_in_month + 1)],
        }

    def hotspot_day(self, date: str, limit: int) -> dict:
        """Hotspots of one UTC day as [lon, lat, minute of the day, region index], earliest first, at most `limit`."""
        try:
            first = pd.Timestamp(date)
        except ValueError as e:
            raise ApiError(400, f"{date} is not a calendar day") from e
        sensor, source, params = self._day_source(first, first + pd.Timedelta(days=1))
        cur = self.con.cursor()
        (count,) = cur.execute(f"select count(*) {source}", params).fetchone()
        rows = cur.execute(
            f"""select round(lon, 4), round(lat, 4),
                       cast(hour(acq_datetime_utc) * 60 + minute(acq_datetime_utc) as integer) as minute_utc,
                       country
                {source}
                order by minute_utc, lat, lon
                limit ?""",
            [*params, limit],
        ).fetchall()
        regions = [r.name for r in self.cfg.regions]
        index = {name: i for i, name in enumerate(regions)}
        return {
            "date": date,
            "sensor": sensor,
            "unit": UNITS["raw_hotspots"],
            "count": int(count),
            "truncated": count > len(rows),
            "regions": regions,
            "hotspots": [[lon, lat, minute, index.get(country, 0)] for lon, lat, minute, country in rows],
        }

    def meta(self) -> dict:
        span = self.spans.get(self.default_series) if self.default_series else None
        last_day = None
        if span:
            year, month = span.last // 12, span.last % 12 + 1
            last_day = f"{Span.label(span.last)}-{months_calendar.monthrange(year, month)[1]:02d}"
        return {
            "regions": [{"name": r.name, "bbox": list(r.bbox)} for r in self.cfg.regions],
            "series": self.series,
            "default_series": self.default_series,
            "units": self.units,
            "harmonized_record": RECORD if "harmonized" in self.spans else None,
            "first_month": Span.label(span.first) if span else None,
            "last_month": Span.label(span.last) if span else None,
            "first_day": f"{Span.label(span.first)}-01" if span else None,
            "last_day": last_day,
            "cell_deg": self.cfg.cell_deg,
            "raw_sensor_switch": Span.label(Span.index(*RAW_SWITCH)),
            "csv_row_limit": self.csv_limit,
        }
