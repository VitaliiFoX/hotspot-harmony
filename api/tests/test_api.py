import json

import duckdb
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.queries import Store

CONFIG = """
regions:
  - name: Testland
    bbox: [30.0, 48.0, 32.0, 50.0]
sensors:
  modis: {archive: modis, first_year: 2000}
grid:
  cell_deg: 0.25
filters:
  drop_confidence: [low]
  keep_types: [0]
"""


def square(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


@pytest.fixture
def client(tmp_path):
    (tmp_path / "agg").mkdir()
    rows = []
    for year in range(2003, 2026):
        for month in range(1, 13):
            sensor = "modis" if year < 2022 else "viirs_noaa20"
            base = 100.0 if month == 8 else 10.0
            value = base * (5 if (year, month) == (2025, 8) else 1)  # one very unusual August
            raw = int(value * (3 if year >= 2012 else 1))  # VIIRS as delivered reports ~3x more
            rows.append(("Testland", 1, 48.125, 30.125, year, month, value, raw, sensor))  # cell A
            rows.append(("Testland", 2, 49.875, 31.875, year, month, 1.0, 1, sensor))  # cell B, far away
    cols = ["country", "cell_id", "cell_lat", "cell_lon", "year", "month", "n_harmonized", "n_raw", "sensor_used"]
    pd.DataFrame(rows, columns=cols).to_parquet(tmp_path / "agg" / "harmonized.parquet")
    report = {"countries": {"Testland": {"calibration": "own", "interval_by_size": [
        {"from": 0, "to": None, "n": 50, "lo": 0.8, "hi": 1.25}]}}}  # fmt: skip
    (tmp_path / "agg" / "harmonization_report.json").write_text(json.dumps(report))
    points = tmp_path / "points" / "sensor=modis" / "year=2024"
    points.mkdir(parents=True)
    duckdb.sql(f"""
        copy (select * from (values
            (48.10, 30.10, timestamp '2024-08-10 11:00:00', 'Aqua', 'high', 12.5, 'D', 0, 'Testland'),
            (48.12, 30.12, timestamp '2024-08-20 11:00:00', 'Terra', 'nominal', 3.0, 'D', 0, 'Testland'),
            (49.90, 31.90, timestamp '2024-08-10 11:00:00', 'Aqua', 'high', 7.0, 'D', 0, 'Testland'),
            (48.10, 30.10, timestamp '2024-09-02 11:00:00', 'Aqua', 'high', 9.0, 'D', 0, 'Testland')
        ) t(lat, lon, acq_datetime_utc, satellite, confidence_class, frp, daynight, type, country))
        to '{points}/p.parquet' (format parquet)
    """)
    config = tmp_path / "regions.yaml"
    config.write_text(CONFIG)
    return TestClient(create_app(Store(tmp_path, config)))


AREA_A = square(30.0, 48.0, 30.25, 48.25)  # contains the centre of cell A only


def test_health_and_meta(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    meta = client.get("/api/meta").json()
    assert meta["series"] == {"start": "2003-01", "end": "2025-12"}
    assert meta["countries"][0] == {"name": "Testland", "bbox": [30.0, 48.0, 32.0, 50.0], "start": "2003-01",
                                    "end": "2025-12", "calibration": "own"}  # fmt: skip
    assert meta["unit"] == "MODIS-equivalent fire cell-days" and meta["grid"] == {"cell_deg": 0.25}
    assert [r["sensor"] for r in meta["record"]] == ["modis_terra", "modis", "viirs_noaa20"]
    assert "Testland" in meta["report"]["countries"]


def test_calendar_for_an_area(client):
    r = client.post("/api/calendar", json={"geometry": AREA_A, "start": "2020-01", "end": "2025-08"}).json()
    assert r["cells_used"] == 1 and r["countries"] == ["Testland"]
    assert len(r["months"]) == 5 * 12 + 8 and r["months"][0]["year"] == 2020 and r["months"][-1]["month"] == 8

    aug_2020 = next(m for m in r["months"] if (m["year"], m["month"]) == (2020, 8))
    assert aug_2020 == {"year": 2020, "month": 8, "n_harmonized": 100.0, "n_raw": 300, "sensor_used": "modis",
                        "lo": 100.0, "hi": 100.0}  # fmt: skip  # the reference sensor carries no model error
    aug_2025 = r["months"][-1]
    assert (aug_2025["n_harmonized"], aug_2025["sensor_used"]) == (500.0, "viirs_noaa20")
    assert (aug_2025["lo"], aug_2025["hi"]) == (400.0, 625.0)  # 90% range from the report

    august = next(c for c in r["climatology"] if c["month"] == 8)
    assert (august["median"], august["years"]) == (100.0, 23)
    assert r["anomaly"] == {"year": 2025, "month": 8, "value": 500.0, "median": 100.0, "ratio": 5.0,
                            "percentile": 100, "lo": 400.0, "hi": 625.0, "years_compared": 22}  # fmt: skip
    assert r["top_months"][0] == {"year": 2025, "month": 8, "value": 500.0, "median": 100.0, "ratio": 5.0}
    assert r["yearly"][0] == {"year": 2020, "n_harmonized": 210.0, "n_raw": 630, "complete": True}
    assert r["yearly"][-1]["complete"] is False


def test_calendar_defaults_to_the_whole_record_and_sums_cells(client):
    r = client.post("/api/calendar", json={"geometry": square(30.0, 48.0, 32.0, 50.0)}).json()
    assert r["cells_used"] == 2 and len(r["months"]) == 23 * 12
    assert r["months"][0]["n_harmonized"] == 11.0  # 10 from cell A + 1 from cell B


def test_area_smaller_than_a_cell_and_area_without_fires(client):
    tiny = client.post("/api/calendar", json={"geometry": square(30.20, 48.20, 30.21, 48.21)}).json()
    assert tiny["cells_used"] == 1 and tiny["months"][0]["n_harmonized"] == 10.0  # falls back to the touched cell
    empty = client.post("/api/calendar", json={"geometry": square(31.0, 49.0, 31.2, 49.2)})
    assert empty.status_code == 200 and empty.json()["cells_used"] == 0  # zero fires is an answer, not an error
    assert all(m["n_harmonized"] == 0 for m in empty.json()["months"])


def test_errors(client):
    outside = client.post("/api/calendar", json={"geometry": square(0, 0, 1, 1)})
    assert outside.status_code == 422 and "Testland" in outside.json()["detail"]
    point = client.post("/api/calendar", json={"geometry": {"type": "Point", "coordinates": [30, 48]}})
    assert point.status_code == 400 and "Polygon" in point.json()["detail"]
    garbage = client.post("/api/calendar", json={"geometry": {"type": "Polygon", "coordinates": "x"}})
    assert garbage.status_code == 400
    dates = client.post("/api/calendar", json={"geometry": AREA_A, "start": "2024-13"})
    assert dates.status_code == 400


def test_csv_export_keeps_points_inside_the_area_and_dates(client):
    r = client.post("/api/hotspots.csv", json={"geometry": AREA_A, "start": "2024-08-01", "end": "2024-08-31"})
    assert r.status_code == 200 and r.headers["x-truncated"] == "false"
    assert r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0] == "lat,lon,acq_datetime_utc,sensor,satellite,confidence_class,frp,daynight,type,country"
    assert len(lines) == 3  # two August points in cell A; the far one and the September one are out
    assert lines[1].startswith("48.1,30.1,2024-08-10T11:00:00Z,modis,Aqua,high,12.5,D,0,Testland")
