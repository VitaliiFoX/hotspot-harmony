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

REGIONS = """
regions:
  - name: Testland
    bbox: [0, 0, 10, 10]
"""
SECOND_REGION = """  - name: Farland
    bbox: [20, 20, 30, 30]
"""
SETTINGS = """sensors:
  modis: {archive: modis, first_year: 2000}
  viirs_snpp: {archive: viirs-snpp, first_year: 2012}
  viirs_noaa20: {archive: viirs-jpss1, first_year: 2018}
grid:
  cell_deg: 1.0
filters:
  drop_confidence: [low]
  keep_types: [0]
"""
CONFIG = REGIONS + SETTINGS
CONFIG_TWO_REGIONS = REGIONS + SECOND_REGION + SETTINGS

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
HARMONIZED = [  # cell, year, month, harmonized, raw (fire cell-days), sensor of the harmonized value
    (A, 2000, 10, 0.5, 1, "modis_terra"),  # a local day on 31 October: before the archive starts
    (A, 2010, 8, 30.5, 25, "modis"),
    (B, 2010, 8, 0.0, 3, "modis"),
    (A, 2013, 8, 60.0, 90, "modis"),
    (B, 2013, 8, 4.0, 10, "modis"),
    (C, 2013, 8, 500.0, 700, "modis"),  # outside the test area
]
POINTS = [  # lat, lon, time, sensor, confidence class, type, country
    (0.4, 0.6, "2013-08-05 12:30:00", "viirs_snpp", "nominal", 0, "Testland"),  # in the area, in the dates
    (0.6, 1.2, "2013-08-20 01:05:00", "modis", "nominal", 0, "Testland"),  # in the area, in the dates
    (0.5, 0.5, "2013-09-02 12:00:00", "viirs_snpp", "nominal", 0, "Testland"),  # in the area, after the dates
    (5.5, 5.5, "2013-08-06 12:00:00", "viirs_snpp", "nominal", 0, "Testland"),  # outside the area
    (25.123449, 21.987651, "2013-08-05 03:07:00", "viirs_snpp", "high", 0, "Farland"),  # the second region
    (6.0, 6.0, "2013-08-05 00:00:00", "viirs_snpp", "high", 0, "Testland"),  # first minute of the day
    (6.5, 6.5, "2013-08-04 23:59:00", "viirs_snpp", "nominal", 0, "Testland"),  # last minute of the day before
    (5.0, 5.0, "2013-08-05 23:59:00", "viirs_snpp", "low", 0, "Testland"),  # dropped: low confidence
    (5.0, 5.0, "2013-08-05 08:00:00", "viirs_snpp", "high", 2, "Testland"),  # dropped: not a vegetation fire
    (7.0, 7.0, "2013-08-31 23:59:00", "viirs_noaa20", "nominal", 0, "Testland"),  # NOAA-20 is never used
    (3.0, 3.0, "2011-08-10 10:00:00", "modis", "nominal", 0, "Testland"),  # before 2012-02 MODIS is used
    (3.0, 3.0, "2011-08-10 11:00:00", "viirs_snpp", "nominal", 0, "Testland"),  # and VIIRS is not
]


def box(west, south, east, north):
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}


AREA = box(0, 0, 2, 1)


def build_data(root, harmonized=False, config_text=CONFIG):
    con = duckdb.connect()
    (root / "agg").mkdir(parents=True)
    rows = ", ".join(f"({lat}, {lon}, 'Testland', {y}, {m}, '{s}', {n})" for (lat, lon), y, m, s, n in CELL_MONTHS)
    con.execute(f"""
        copy (select 0 as cell_id, * , 0.0 as frp_sum
              from (values {rows}) t(cell_lat, cell_lon, country, year, month, sensor, n_hotspots))
        to '{root}/agg/cell_month.parquet' (format parquet)
    """)
    if harmonized:
        rows = ", ".join(
            f"({lat}, {lon}, 'Testland', {y}, {m}, {h}, {r}, '{s}')" for (lat, lon), y, m, h, r, s in HARMONIZED
        )
        con.execute(f"""
            copy (select * from (values {rows})
                  t(cell_lat, cell_lon, country, year, month, n_harmonized, n_raw, sensor_used))
            to '{root}/agg/harmonized.parquet' (format parquet)
        """)
    for i, (lat, lon, t, sensor, confidence, kind, country) in enumerate(POINTS):
        folder = root / "points" / f"sensor={sensor}" / f"year={t[:4]}"
        folder.mkdir(parents=True, exist_ok=True)
        con.execute(f"""
            copy (select {lat}::double as lat, {lon}::double as lon, timestamp '{t}' as acq_datetime_utc,
                         'X' as satellite,
                         '50' as confidence_raw, '{confidence}' as confidence_class, 1.5 as frp, 'D' as daynight,
                         {kind} as type, 'sp' as source, '{country}' as country)
            to '{folder}/p{i}.parquet' (format parquet)
        """)
    config = root / "regions.yaml"
    config.write_text(config_text)
    return config


@pytest.fixture
def client(tmp_path):
    config = build_data(tmp_path)
    return TestClient(create_app(data_dir=tmp_path, config_path=config))


@pytest.fixture
def client_harmonized(tmp_path):
    config = build_data(tmp_path, harmonized=True)
    return TestClient(create_app(data_dir=tmp_path, config_path=config))


@pytest.fixture
def client_two_regions(tmp_path):
    config = build_data(tmp_path, config_text=CONFIG_TWO_REGIONS)
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


# An area drawn by hand: the triangle (0, 0), (2, 0), (0, 1.2), given as lon, lat. Its sloping side is
# lat = 1.2 - 0.6 lon, so at lon 0.5 it passes at lat 0.9, above A, and at lon 1.5 at lat 0.3, below B.
# Its bounding box is wider than the test area and holds both cells; the triangle holds A alone.
DRAWN = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [0, 1.2], [0, 0]]]}


def test_a_drawn_area_counts_the_cells_inside_its_outline_not_inside_its_bounding_box(client):
    r = client.post("/api/calendar", json={"geometry": DRAWN, "start": "2010-01", "end": "2013-12"})
    assert r.status_code == 200
    body = r.json()
    assert body["cells_used"] == 1
    months = {(m["year"], m["month"]): m["value"] for m in body["months"]}
    assert months[(2011, 8)] == 20  # A alone; the box of the same bounds gives 22
    assert months[(2013, 8)] == 60  # and 64


def test_csv_export_of_a_drawn_area_keeps_the_hotspots_inside_its_outline(client):
    r = client.post("/api/hotspots.csv", json={"geometry": DRAWN, "start": "2013-08-01", "end": "2013-08-31"})
    assert r.status_code == 200
    rows = list(csv.DictReader(io.StringIO(r.text)))
    # (0.6, 1.2) is in the bounding box but above the sloping side, which passes at lat 0.48 there.
    assert [(row["lat"], row["lon"]) for row in rows] == [("0.4", "0.6")]


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
    assert body["unit"] == "MODIS-equivalent fire cell-days"
    months = {(m["year"], m["month"]): m for m in body["months"]}
    assert (months[(2010, 8)]["value"], months[(2010, 8)]["sensor"]) == (30.5, "modis")
    assert months[(2013, 8)]["value"] == 64.0  # A + B; C is outside the area


def test_raw_series_counts_fire_cell_days_once_the_harmonized_record_exists(client_harmonized):
    body = calendar(client_harmonized, series="raw").json()
    assert body["series"] == "raw"
    assert body["unit"] == "fire cell-days"  # the same unit as the harmonized record, not hotspots
    months = {(m["year"], m["month"]): m for m in body["months"]}
    assert (months[(2010, 8)]["value"], months[(2010, 8)]["sensor"]) == (28.0, "modis")
    assert (months[(2013, 8)]["value"], months[(2013, 8)]["sensor"]) == (100.0, "viirs_snpp")


def test_without_the_harmonized_record_the_raw_series_counts_hotspots(client):
    assert calendar(client).json()["unit"] == "hotspots"


def test_the_record_starts_with_the_archive_in_november_2000(client_harmonized):
    for series in ("harmonized", "raw"):
        months = calendar(client_harmonized, series=series).json()["months"]
        assert (months[0]["year"], months[0]["month"]) == (2010, 8)
    assert client_harmonized.get("/api/meta").json()["first_month"] == "2010-08"


def test_meta_names_the_unit_and_the_sensors_of_each_series(client_harmonized):
    meta = client_harmonized.get("/api/meta").json()
    assert meta["series"] == ["raw", "harmonized"]
    assert meta["units"] == {"raw": "fire cell-days", "harmonized": "MODIS-equivalent fire cell-days"}
    assert meta["harmonized_record"] == [
        {"sensor": "modis_terra", "label": "MODIS Terra only, scaled", "from": "2000-11", "to": "2002-06"},
        {"sensor": "modis", "label": "MODIS Terra + Aqua (reference)", "from": "2002-07", "to": "2021-12"},
        {"sensor": "viirs_noaa20", "label": "VIIRS NOAA-20, harmonized", "from": "2022-01", "to": None},
    ]


def test_asking_for_a_missing_harmonized_series_is_an_error(client):
    r = calendar(client, series="harmonized")
    assert r.status_code == 404
    assert "harmonized" in r.json()["detail"]


def test_large_answers_are_compressed_and_small_ones_are_not(client):
    big = client.post("/api/calendar", json={"geometry": AREA}, headers={"Accept-Encoding": "gzip"})
    assert big.headers.get("content-encoding") == "gzip" and big.json()["cells_used"] > 0
    small = client.get("/api/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers


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
    assert meta["units"] == {"raw": "hotspots"}
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


@pytest.mark.parametrize("start, end", [("2013-02-30", "2013-03-01"), ("2013-02-01", "2013-02-29")])
def test_csv_export_rejects_a_day_that_does_not_exist(client, start, end):
    r = client.post("/api/hotspots.csv", json={"geometry": AREA, "start": start, "end": end})
    assert r.status_code == 400 and "2013-02-" in r.json()["detail"]


def test_csv_export_stops_at_the_row_limit_and_says_so(tmp_path):
    config = build_data(tmp_path)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config, csv_limit=1))
    r = client.post("/api/hotspots.csv", json={"geometry": AREA, "start": "2013-08-01", "end": "2013-08-31"})
    assert r.headers["x-truncated"] == "true"
    assert len(list(csv.DictReader(io.StringIO(r.text)))) == 1


def test_meta_gives_the_first_and_last_day_of_the_record(client):
    meta = client.get("/api/meta").json()
    assert (meta["first_day"], meta["last_day"]) == ("2010-08-01", "2013-08-31")


def test_days_of_a_month_count_the_filtered_hotspots_of_every_region(client_two_regions):
    r = client_two_regions.get("/api/hotspots/days?month=2013-08")
    assert r.status_code == 200
    body = r.json()
    assert (body["month"], body["sensor"], body["unit"]) == ("2013-08", "viirs_snpp", "hotspots")
    assert [d["day"] for d in body["days"]] == list(range(1, 32))  # every day, zeros included
    values = {d["day"]: d["value"] for d in body["days"]}
    # day 5: three VIIRS S-NPP hotspots kept, one low confidence and one non-vegetation dropped
    assert {day: v for day, v in values.items() if v} == {4: 1, 5: 3, 6: 1}
    assert values[20] == 0  # MODIS is not used after 2012-02
    assert values[31] == 0  # NOAA-20 is never used


def test_days_of_a_month_before_february_2012_come_from_modis(client):
    body = client.get("/api/hotspots/days?month=2011-08").json()
    assert body["sensor"] == "modis"
    assert {d["day"]: d["value"] for d in body["days"] if d["value"]} == {10: 1}


def test_day_lists_hotspots_by_minute_with_their_region(client_two_regions):
    r = client_two_regions.get("/api/hotspots/day?date=2013-08-05")
    assert r.status_code == 200
    assert r.json() == {
        "date": "2013-08-05",
        "sensor": "viirs_snpp",
        "unit": "hotspots",
        "count": 3,
        "truncated": False,
        "regions": ["Testland", "Farland"],
        "hotspots": [[6.0, 6.0, 0, 0], [21.9877, 25.1234, 187, 1], [0.6, 0.4, 750, 0]],
    }


def test_day_before_february_2012_comes_from_modis(client):
    body = client.get("/api/hotspots/day?date=2011-08-10").json()
    assert (body["sensor"], body["count"]) == ("modis", 1)
    assert body["hotspots"] == [[3.0, 3.0, 600, 0]]


def test_day_stops_at_the_row_limit_and_still_counts_every_hotspot(tmp_path):
    config = build_data(tmp_path, config_text=CONFIG_TWO_REGIONS)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config, day_limit=2))
    body = client.get("/api/hotspots/day?date=2013-08-05").json()
    assert (body["count"], body["truncated"]) == (3, True)
    assert body["hotspots"] == [[6.0, 6.0, 0, 0], [21.9877, 25.1234, 187, 1]]


@pytest.mark.parametrize(
    "url",
    [
        "/api/hotspots/day?date=2013-09-02",  # after the last month of the record
        "/api/hotspots/day?date=2000-10-31",  # before the archive starts
        "/api/hotspots/day?date=2013-02-30",
        "/api/hotspots/days?month=2013-09",
        "/api/hotspots/days?month=2000-10",
    ],
)
def test_days_outside_the_record_are_rejected(client, url):
    r = client.get(url)
    assert r.status_code == 400
    assert r.json()["detail"]


@pytest.mark.parametrize("url", ["/api/hotspots/day?date=2013-8-5", "/api/hotspots/days?month=2013-13"])
def test_malformed_dates_are_rejected(client, url):
    assert client.get(url).status_code == 422


def test_day_endpoints_without_data_explain_how_to_build_it(tmp_path):
    config = tmp_path / "regions.yaml"
    config.write_text(CONFIG)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config))
    for url in ("/api/hotspots/days?month=2013-08", "/api/hotspots/day?date=2013-08-05"):
        r = client.get(url)
        assert r.status_code == 503 and "make data" in r.json()["detail"]
    assert (client.get("/api/meta").json()["first_day"], client.get("/api/meta").json()["last_day"]) == (None, None)


def test_api_without_data_explains_how_to_build_it(tmp_path):
    config = tmp_path / "regions.yaml"
    config.write_text(CONFIG)
    client = TestClient(create_app(data_dir=tmp_path, config_path=config))
    assert client.get("/api/health").json() == {"status": "ok", "data": False}
    r = calendar(client)
    assert r.status_code == 503 and "make data" in r.json()["detail"]


def test_config_can_come_from_the_environment(tmp_path, monkeypatch):
    config = build_data(tmp_path)
    monkeypatch.setenv("HH_CONFIG", str(config))
    client = TestClient(create_app(data_dir=tmp_path))
    assert [r["name"] for r in client.get("/api/meta").json()["regions"]] == ["Testland"]
