"""The API is tested through HTTP only, on a hand-made record small enough to work out on paper.

Cells (centre lat, lon):  A (0.5, 0.5)   B (0.5, 1.5)   C (5.5, 5.5)
The test area covers A and B. The raw series takes MODIS before 2012-02 and VIIRS S-NPP from then on.
"""

import csv
import io

import duckdb
import pytest
from fastapi.testclient import TestClient

from api.main import create_app

CONFIG = """
regions:
  - name: Testland
    bbox: [0, 0, 10, 10]
sensors:
  modis: {archive: modis, first_year: 2000}
  viirs_snpp: {archive: viirs-snpp, first_year: 2012}
  viirs_noaa20: {archive: viirs-jpss1, first_year: 2018}
grid:
  cell_deg: 1.0
filters:
  drop_confidence: [low]
  keep_types: [0]
"""

A, B, C = (0.5, 0.5), (0.5, 1.5), (5.5, 5.5)
CELL_MONTHS = [  # cell, year, month, sensor, hotspots
    (A, 2010, 8, "modis", 10),
    (A, 2011, 8, "modis", 20),
    (B, 2011, 8, "modis", 2),
    (A, 2012, 1, "modis", 7),
    (A, 2012, 1, "viirs_snpp", 9),  # January 2012 still comes from MODIS
    (A, 2012, 8, "modis", 5),  # from 2012-02 MODIS is ignored
    (A, 2012, 8, "viirs_snpp", 40),
    (A, 2013, 8, "modis", 15),
    (A, 2013, 8, "viirs_snpp", 60),
    (B, 2013, 8, "viirs_snpp", 4),
    (C, 2013, 8, "viirs_snpp", 1000),  # outside the test area
    (A, 2013, 9, "viirs_noaa20", 99),  # NOAA-20 is not part of the raw series
]
HARMONIZED = [(A, 2010, 8, 30.5), (A, 2013, 8, 60.0)]
POINTS = [  # lat, lon, time, sensor
    (0.4, 0.6, "2013-08-05 12:30:00", "viirs_snpp"),  # in the area, in the dates
    (0.6, 1.2, "2013-08-20 01:05:00", "modis"),  # in the area, in the dates
    (0.5, 0.5, "2013-09-02 12:00:00", "viirs_snpp"),  # in the area, after the dates
    (5.5, 5.5, "2013-08-06 12:00:00", "viirs_snpp"),  # outside the area
]


def box(west, south, east, north):
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}


AREA = box(0, 0, 2, 1)


def build_data(root, harmonized=False):
    con = duckdb.connect()
    (root / "agg").mkdir(parents=True)
    rows = ", ".join(f"({lat}, {lon}, 'Testland', {y}, {m}, '{s}', {n})" for (lat, lon), y, m, s, n in CELL_MONTHS)
    con.execute(f"""
        copy (select 0 as cell_id, * , 0.0 as frp_sum
              from (values {rows}) t(cell_lat, cell_lon, country, year, month, sensor, n_hotspots))
        to '{root}/agg/cell_month.parquet' (format parquet)
    """)
    if harmonized:
        rows = ", ".join(f"({lat}, {lon}, 'Testland', {y}, {m}, {v})" for (lat, lon), y, m, v in HARMONIZED)
        con.execute(f"""
            copy (select * from (values {rows}) t(cell_lat, cell_lon, country, year, month, n_harmonized))
            to '{root}/agg/harmonized.parquet' (format parquet)
        """)
    for i, (lat, lon, t, sensor) in enumerate(POINTS):
        folder = root / "points" / f"sensor={sensor}" / f"year={t[:4]}"
        folder.mkdir(parents=True, exist_ok=True)
        con.execute(f"""
            copy (select {lat} as lat, {lon} as lon, timestamp '{t}' as acq_datetime_utc, 'X' as satellite,
                         '50' as confidence_raw, 'nominal' as confidence_class, 1.5 as frp, 'D' as daynight,
                         0 as type, 'sp' as source, 'Testland' as country)
            to '{folder}/p{i}.parquet' (format parquet)
        """)
    config = root / "regions.yaml"
    config.write_text(CONFIG)
    return config


@pytest.fixture
def client(tmp_path):
    config = build_data(tmp_path)
    return TestClient(create_app(data_dir=tmp_path, config_path=config))


@pytest.fixture
def client_harmonized(tmp_path):
    config = build_data(tmp_path, harmonized=True)
    return TestClient(create_app(data_dir=tmp_path, config_path=config))


def calendar(client, **body):
    return client.post("/api/calendar", json={"geometry": AREA, **body})


def test_calendar_sums_the_cells_inside_the_area_month_by_month(client):
    r = calendar(client, start="2010-01", end="2013-12")
    assert r.status_code == 200
    body = r.json()
    assert body["series"] == "raw"
    assert body["cells_used"] == 2
    months = {(m["year"], m["month"]): m for m in body["months"]}
    assert len(months) == 37  # clipped to the record: 2010-08 .. 2013-08, empty months included
    assert months[(2010, 8)]["value"] == 10
    assert months[(2011, 8)]["value"] == 22  # A + B
    assert months[(2012, 8)]["value"] == 40
    assert months[(2013, 8)]["value"] == 64  # C is outside the area
    assert months[(2011, 3)]["value"] == 0


def test_raw_series_switches_from_modis_to_viirs_in_february_2012(client):
    months = {(m["year"], m["month"]): m for m in calendar(client).json()["months"]}
    assert (months[(2012, 1)]["value"], months[(2012, 1)]["sensor"]) == (7, "modis")
    assert (months[(2012, 2)]["value"], months[(2012, 2)]["sensor"]) == (0, "viirs_snpp")


def test_climatology_describes_each_calendar_month_across_the_whole_record(client):
    clim = {c["month"]: c for c in calendar(client, start="2013-01", end="2013-08").json()["climatology"]}
    assert len(clim) == 12
    # August values over the record: 10, 22, 40, 64
    assert clim[8] == {"month": 8, "median": 31.0, "p25": 19.0, "p75": 46.0, "years": 4}
    assert (clim[1]["median"], clim[1]["years"]) == (0.0, 3)  # January exists in 2011, 2012, 2013
    assert clim[9]["years"] == 3  # the record ends in August 2013


def test_anomaly_compares_the_last_selected_month_with_its_history(client):
    assert calendar(client, start="2012-01", end="2013-08").json()["anomaly"] == {
        "year": 2013, "month": 8, "value": 64.0, "median": 31.0, "ratio": 2.06, "percentile": 75,
    }  # fmt: skip
    quiet = calendar(client, start="2012-01", end="2012-03").json()["anomaly"]
    assert (quiet["value"], quiet["median"], quiet["ratio"]) == (0.0, 0.0, None)  # no ratio against zero


def test_yearly_totals_flag_years_that_are_not_fully_covered(client):
    assert calendar(client).json()["yearly"] == [
        {"year": 2010, "value": 10.0, "complete": False},  # the record starts in August
        {"year": 2011, "value": 22.0, "complete": True},
        {"year": 2012, "value": 47.0, "complete": True},
        {"year": 2013, "value": 64.0, "complete": False},
    ]


def test_harmonized_series_is_served_when_the_pipeline_has_written_it(client_harmonized):
    body = calendar(client_harmonized).json()
    assert body["series"] == "harmonized"  # the default once it exists
    months = {(m["year"], m["month"]): m for m in body["months"]}
    assert (months[(2010, 8)]["value"], months[(2010, 8)]["sensor"]) == (30.5, None)
    assert calendar(client_harmonized, series="raw").json()["series"] == "raw"


def test_asking_for_a_missing_harmonized_series_is_an_error(client):
    r = calendar(client, series="harmonized")
    assert r.status_code == 404
    assert "harmonized" in r.json()["detail"]


def test_area_outside_every_region_is_rejected_with_the_list_of_regions(client):
    r = client.post("/api/calendar", json={"geometry": box(50, 50, 51, 51)})
    assert r.status_code == 422
    assert "Testland" in r.json()["detail"]


def test_area_partly_outside_the_regions_is_answered_with_a_warning(client):
    inside = calendar(client).json()
    partly = client.post("/api/calendar", json={"geometry": box(-1, 0, 2, 1)}).json()
    assert inside["warnings"] == []
    assert len(partly["warnings"]) == 1 and "Testland" in partly["warnings"][0]
    assert partly["cells_used"] == 2


def test_area_with_no_burning_cell_says_what_that_can_mean(client):
    body = client.post("/api/calendar", json={"geometry": box(8, 8, 9, 9)}).json()
    assert body["cells_used"] == 0
    assert all(m["value"] == 0 for m in body["months"])
    assert len(body["warnings"]) == 1 and "bounding box" in body["warnings"][0]


@pytest.mark.parametrize(
    "body",
    [
        {"geometry": {"type": "Point", "coordinates": [1, 1]}},
        {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]}},
        {"geometry": AREA, "start": "2013-05", "end": "2012-05"},
        {"geometry": AREA, "start": "2030-01", "end": "2030-06"},
    ],
)
def test_bad_requests_are_rejected(client, body):
    assert client.post("/api/calendar", json=body).status_code == 400


def test_meta_describes_what_the_api_can_answer(client):
    meta = client.get("/api/meta").json()
    assert meta["regions"] == [{"name": "Testland", "bbox": [0, 0, 10, 10]}]
    assert meta["series"] == ["raw"]
    assert (meta["first_month"], meta["last_month"]) == ("2010-08", "2013-08")
    assert meta["raw_sensor_switch"] == "2012-02"


def test_csv_export_returns_the_hotspots_inside_the_area_and_dates(client):
    r = client.post("/api/hotspots.csv", json={"geometry": AREA, "start": "2013-08-01", "end": "2013-08-31"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["x-truncated"] == "false"
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [(row["lat"], row["lon"], row["sensor"]) for row in rows] == [
        ("0.4", "0.6", "viirs_snpp"),
        ("0.6", "1.2", "modis"),
    ]
    assert rows[0]["acq_datetime_utc"] == "2013-08-05T12:30:00Z"
    assert set(rows[0]) == {
        "lat", "lon", "acq_datetime_utc", "sensor", "satellite", "confidence_class", "frp", "daynight", "type",
        "country",
    }  # fmt: skip


def test_csv_export_stops_at_the_row_limit_and_says_so(tmp_path):
    config = build_data(tmp_path)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config, csv_limit=1))
    r = client.post("/api/hotspots.csv", json={"geometry": AREA, "start": "2013-08-01", "end": "2013-08-31"})
    assert r.headers["x-truncated"] == "true"
    assert len(list(csv.DictReader(io.StringIO(r.text)))) == 1


def test_api_without_data_explains_how_to_build_it(tmp_path):
    config = tmp_path / "regions.yaml"
    config.write_text(CONFIG)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config))
    assert client.get("/api/health").json() == {"status": "ok", "data": False}
    r = calendar(client)
    assert r.status_code == 503 and "make data" in r.json()["detail"]
