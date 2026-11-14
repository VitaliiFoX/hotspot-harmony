"""Read-only queries over the Parquet files built by the pipeline."""

import io
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry

from pipeline.config import load_config
from pipeline.harmonize import RECORD, sensor_used

UNIT = "MODIS-equivalent fire cell-days"
ATTRIBUTION = "NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)"
CSV_LIMIT = 500_000
CSV_COLUMNS = [
    "lat", "lon", "acq_datetime_utc", "sensor", "satellite", "confidence_class", "frp", "daynight", "type", "country",
]  # fmt: skip


class BadGeometry(ValueError):
    """The request geometry cannot be used (HTTP 400)."""


class OutsideCoverage(ValueError):
    """The geometry does not touch any country we have data for (HTTP 422)."""


def parse_geometry(geojson: dict) -> BaseGeometry:
    try:
        geom = shape(geojson)
    except Exception as e:  # shapely raises several unrelated types on malformed input
        raise BadGeometry(f"geometry is not valid GeoJSON: {e}") from None
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise BadGeometry(f"geometry must be a Polygon or MultiPolygon, got {geom.geom_type}")
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if geom.is_empty or geom.area == 0:
        raise BadGeometry("geometry is empty")
    return geom


def ym(text: str) -> int:
    """'2024-08' -> 202408."""
    try:
        year, month = text.split("-")[:2]
        value = int(year) * 100 + int(month)
    except ValueError:
        raise BadGeometry(f"dates must look like YYYY-MM, got {text!r}") from None
    if not 1 <= value % 100 <= 12:
        raise BadGeometry(f"month out of range in {text!r}")
    return value


def month_range(start: int, end: int) -> list[tuple[int, int]]:
    out, (y, m) = [], divmod(start, 100)
    while y * 100 + m <= end:
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


class Store:
    def __init__(self, data: Path, config: Path):
        self.cfg = load_config(config)
        self.data = Path(data)
        agg = self.data / "agg"
        self.h = pd.read_parquet(agg / "harmonized.parquet")
        self.h["ym"] = self.h.year * 100 + self.h.month
        report_path = agg / "harmonization_report.json"
        self.report = json.loads(report_path.read_text()) if report_path.exists() else {"countries": {}}
        self.cells = self.h.drop_duplicates(["country", "cell_id"])[["country", "cell_id", "cell_lat", "cell_lon"]]
        spans = self.h.groupby("country").ym.agg(["min", "max"])
        self.countries = [
            {
                "name": r.name,
                "bbox": list(r.bbox),
                "start": f"{spans.loc[r.name, 'min'] // 100}-{spans.loc[r.name, 'min'] % 100:02d}",
                "end": f"{spans.loc[r.name, 'max'] // 100}-{spans.loc[r.name, 'max'] % 100:02d}",
                "calibration": self.report["countries"].get(r.name, {}).get("calibration", "unknown"),
            }
            for r in self.cfg.regions
            if r.name in spans.index
        ]

    # ---- meta -----------------------------------------------------------------------------------
    def meta(self) -> dict:
        return {
            "unit": UNIT,
            "unit_short": "fire cell-days",
            "attribution": ATTRIBUTION,
            "grid": {"cell_deg": self.cfg.cell_deg},
            "series": {
                "start": min(c["start"] for c in self.countries),
                "end": max(c["end"] for c in self.countries),
            },
            "countries": self.countries,
            "record": RECORD,
            "report": self.report,
        }

    # ---- area selection -------------------------------------------------------------------------
    def countries_touching(self, geom: BaseGeometry) -> list[dict]:
        hit = [c for c in self.countries if box(*c["bbox"]).intersects(geom)]
        if not hit:
            names = ", ".join(c["name"] for c in self.countries)
            raise OutsideCoverage(f"The area is outside the countries with data. Available: {names}.")
        return hit

    def cells_in(self, geom: BaseGeometry, countries: list[str]) -> pd.DataFrame:
        """Cells whose centre is inside the area; for an area smaller than a cell, the cells it touches."""
        c = self.cells[self.cells.country.isin(countries)]
        inside = c[shapely.contains_xy(geom, c.cell_lon.to_numpy(), c.cell_lat.to_numpy())]
        if len(inside):
            return inside
        half = self.cfg.cell_deg / 2
        w, s, e, n = geom.bounds
        near = c[c.cell_lon.between(w - half, e + half) & c.cell_lat.between(s - half, n + half)]
        touch = [
            box(lon - half, lat - half, lon + half, lat + half).intersects(geom)
            for lon, lat in zip(near.cell_lon, near.cell_lat, strict=True)
        ]
        return near[np.array(touch, dtype=bool)] if len(near) else near

    # ---- uncertainty ----------------------------------------------------------------------------
    def interval_table(self, countries: list[str]) -> list[dict]:
        entries = self.report.get("countries", {})
        for name in [*countries, *entries]:
            table = entries.get(name, {}).get("interval_by_size")
            if table:
                return table
        return []

    @staticmethod
    def interval(value: float, sensor: str, table: list[dict]) -> tuple[float, float]:
        """90% range of a harmonized value. Months measured by the reference sensor carry no model error."""
        if sensor == "modis" or value <= 0:
            return value, value
        for row in table:
            if value > row["from"] and (row["to"] is None or value <= row["to"]):
                return round(value * row["lo"], 1), round(value * row["hi"], 1)
        return value, value

    # ---- calendar -------------------------------------------------------------------------------
    def calendar(self, geojson: dict, start: str | None = None, end: str | None = None) -> dict:
        geom = parse_geometry(geojson)
        hit = self.countries_touching(geom)
        names = [c["name"] for c in hit]
        cells = self.cells_in(geom, names)
        first = min(ym(c["start"]) for c in hit)
        last = max(ym(c["end"]) for c in hit)
        lo_ym = max(ym(start), first) if start else first
        hi_ym = min(ym(end), last) if end else last
        if lo_ym > hi_ym:
            raise BadGeometry("the date range is empty or outside the record")

        rows = self.h[self.h.country.isin(names) & self.h.cell_id.isin(cells.cell_id)]
        sums = rows.groupby("ym")[["n_harmonized", "n_raw"]].sum()
        full = pd.DataFrame(month_range(first, last), columns=["year", "month"])
        full["ym"] = full.year * 100 + full.month
        full = full.join(sums, on="ym").fillna({"n_harmonized": 0.0, "n_raw": 0.0})
        full["sensor_used"] = sensor_used(full.year, full.month)
        table = self.interval_table(names)

        def month_row(r) -> dict:
            value = round(float(r.n_harmonized), 1)
            lo, hi = self.interval(value, r.sensor_used, table)
            return {"year": int(r.year), "month": int(r.month), "n_harmonized": value, "n_raw": int(r.n_raw),
                    "sensor_used": r.sensor_used, "lo": lo, "hi": hi}  # fmt: skip

        sel = full[(full.ym >= lo_ym) & (full.ym <= hi_ym)]
        months = [month_row(r) for r in sel.itertuples()]

        # what is normal for each calendar month: every year of the record for this area
        clim = full.groupby("month").n_harmonized
        climatology = [
            {"month": int(m), "median": round(float(g.median()), 1), "p25": round(float(g.quantile(0.25)), 1),
             "p75": round(float(g.quantile(0.75)), 1), "years": int(len(g))}
            for m, g in clim
        ]  # fmt: skip

        anomaly = None
        if months:
            latest = months[-1]
            others = full[(full.month == latest["month"]) & (full.year != latest["year"])].n_harmonized
            if len(others) >= 5:
                median = float(others.median())
                value = latest["n_harmonized"]
                below = (others < value).sum() + 0.5 * (others == value).sum()
                anomaly = {
                    "year": latest["year"], "month": latest["month"], "value": value, "median": round(median, 1),
                    "ratio": round(value / median, 2) if median > 0 else None,
                    "percentile": int(round(100 * below / len(others))),
                    "lo": latest["lo"], "hi": latest["hi"], "years_compared": int(len(others)),
                }  # fmt: skip

        # the months that stand out most against what is normal for that calendar month
        med = full.groupby("month").n_harmonized.transform("median")
        cand = sel.assign(median=med[sel.index], excess=sel.n_harmonized - med[sel.index])
        cand = cand[cand.n_harmonized >= 10].nlargest(5, "excess")
        top_months = [
            {"year": int(r.year), "month": int(r.month), "value": round(float(r.n_harmonized), 1),
             "median": round(float(r.median), 1),
             "ratio": round(float(r.n_harmonized / r.median), 2) if r.median > 0 else None}
            for r in cand.itertuples()
        ]  # fmt: skip

        yearly = [
            {"year": int(y), "n_harmonized": round(float(g.n_harmonized.sum()), 1), "n_raw": int(g.n_raw.sum()),
             "complete": bool(len(g) == 12)}
            for y, g in sel.groupby("year")
        ]  # fmt: skip
        return {
            "cells_used": int(len(cells)),
            "countries": names,
            "unit": UNIT,
            "months": months,
            "climatology": climatology,
            "anomaly": anomaly,
            "top_months": top_months,
            "yearly": yearly,
        }

    # ---- export ---------------------------------------------------------------------------------
    def hotspots_csv(self, geojson: dict, start: str, end: str) -> tuple[list[str], bool]:
        """Raw detections inside the area as CSV chunks, and whether the 500,000-row cap cut the result."""
        geom = parse_geometry(geojson)
        names = [c["name"] for c in self.countries_touching(geom)]
        try:
            d0, d1 = pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)
        except ValueError:
            raise BadGeometry("dates must look like YYYY-MM-DD") from None
        if d0 >= d1:
            raise BadGeometry("the date range is empty")
        w, s, e, n = geom.bounds
        country_list = ", ".join("'" + c.replace("'", "''") + "'" for c in names)
        con = duckdb.connect()
        result = con.execute(
            f"""
            select {", ".join(CSV_COLUMNS)}
            from read_parquet('{(self.data / "points").as_posix()}/**/*.parquet', hive_partitioning = true)
            where year between {d0.year} and {d1.year}
              and acq_datetime_utc >= ? and acq_datetime_utc < ?
              and lon between ? and ? and lat between ? and ?
              and country in ({country_list})
            order by acq_datetime_utc
            """,
            [d0.to_pydatetime(), d1.to_pydatetime(), w, e, s, n],
        )
        chunks, total, truncated = [",".join(CSV_COLUMNS) + "\n"], 0, False
        while True:
            df = result.fetch_df_chunk(50)  # 50 vectors of 2048 rows
            if df.empty:
                break
            df = df[shapely.contains_xy(geom, df.lon.to_numpy(), df.lat.to_numpy())]
            if total + len(df) > CSV_LIMIT:
                df, truncated = df.iloc[: CSV_LIMIT - total], True
            if len(df):
                buf = io.StringIO()
                df.to_csv(buf, index=False, header=False, date_format="%Y-%m-%dT%H:%M:%SZ")
                chunks.append(buf.getvalue())
                total += len(df)
            if truncated:
                break
        return chunks, truncated
