import gzip
import json

from pipeline.csv_to_json import confidence_class, convert_file, convert_row

MODIS = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_t31,frp,daynight,type\n"
    "-30.7564,-67.7287,311.3,1.1,1,2024-01-01,0254,Terra,MODIS,69,61.03,289.8,12.1,N,0\n"
    "-30.1,-67.2,320.0,1.9,1.3,2024-01-02,1735,Aqua,MODIS,82,61.03,290.0,40.5,D,2\n"
)
VIIRS = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight,type\n"
    "-26.68897,-61.49561,308.59,0.42,0.38,2024-01-01,0522,N20,VIIRS,n,2,292.55,1.01,N,0\n"
    "-26.68846,-61.49954,301.68,0.36,0.58,2024-01-01,0007,N,VIIRS,l,2,291.27,1.63,N,0\n"
)
NRT = (  # Area API near-real-time rows have no `type` column
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight\n"
    "50.1,30.2,330.1,0.4,0.4,2026-11-10,1105,N21,VIIRS,h,2.0NRT,280.0,3.3,D\n"
)


def test_confidence_class_matches_the_pipeline_rule():
    assert [confidence_class(c) for c in ["29", "30", "79", "80", "l", "n", "h", "", "x"]] == [
        "low", "nominal", "nominal", "high", "low", "nominal", "high", None, None,
    ]  # fmt: skip


def test_modis_and_viirs_rows_share_one_schema(tmp_path):
    m = tmp_path / "modis_2024_Argentina.csv"
    v = tmp_path / "viirs-jpss1_2024_Argentina.csv"
    m.write_text(MODIS)
    v.write_text(VIIRS)
    docs = [json.loads(convert_file(f, tmp_path / "out")[0].read_text()) for f in (m, v)]
    modis, viirs = docs[0]["hotspots"], docs[1]["hotspots"]

    assert modis[0].keys() == viirs[0].keys()
    assert modis[0] == {
        "lat": -30.7564, "lon": -67.7287, "time_utc": "2024-01-01T02:54:00Z", "sensor": "modis",
        "satellite": "Terra", "confidence_class": "nominal", "confidence_raw": 69, "frp_mw": 12.1,
        "daynight": "night", "type": 0, "type_label": "vegetation_fire", "brightness_k": 311.3,
        "brightness_bg_k": 289.8, "scan_km": 1.1, "track_km": 1.0, "source": "sp",
    }  # fmt: skip
    assert modis[1]["type_label"] == "static_land_source" and modis[1]["daynight"] == "day"
    assert [(h["sensor"], h["satellite"], h["confidence_class"]) for h in viirs] == [
        ("viirs_noaa20", "NOAA-20", "nominal"),
        ("viirs_snpp", "Suomi NPP", "low"),
    ]
    assert viirs[1]["time_utc"] == "2024-01-01T00:07:00Z" and viirs[0]["brightness_k"] == 308.59

    meta = docs[0]["meta"]
    assert (meta["country"], meta["year"], meta["count"]) == ("Argentina", 2024, 2)
    assert meta["bbox"] == [-67.7287, -30.7564, -67.2, -30.1]
    assert meta["time_range_utc"] == ["2024-01-01T02:54:00Z", "2024-01-02T17:35:00Z"]
    assert set(modis[0]) <= set(meta["fields"])  # every key is documented


def test_near_real_time_rows_without_type():
    import csv
    import io

    h = convert_row(next(csv.DictReader(io.StringIO(NRT))))
    assert (h["sensor"], h["source"], h["type"], h["type_label"]) == ("viirs_noaa21", "nrt", None, None)


def test_geojson_ndjson_and_gzip(tmp_path):
    src = tmp_path / "any_name.csv"
    src.write_text(VIIRS)
    geo = json.loads(convert_file(src, tmp_path, "geojson")[0].read_text())
    assert geo["type"] == "FeatureCollection" and len(geo["features"]) == 2
    assert geo["features"][0]["geometry"] == {"type": "Point", "coordinates": [-61.49561, -26.68897]}
    assert "lat" not in geo["features"][0]["properties"] and geo["meta"]["country"] is None

    nd, n = convert_file(src, tmp_path, "ndjson", gz=True)
    with gzip.open(nd, "rt") as f:
        lines = [json.loads(line) for line in f]
    assert n == len(lines) == 2 and lines[0]["sensor"] == "viirs_noaa20"
