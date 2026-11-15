import duckdb
import pytest

from pipeline.normalize import normalize_sensor, raw_files

MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_t31,frp,daynight,type\n"
)
VIIRS_HEADER = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight,type\n"
)


@pytest.fixture
def raw(tmp_path):
    def write(archive: str, name: str, header: str, rows: list[str]):
        folder = tmp_path / "raw" / archive
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_text(header + "\n".join(rows) + "\n")
        return path

    return write


def read_points(points):
    con = duckdb.connect()
    return con.execute(
        f"select * from read_parquet('{points}/**/*.parquet', hive_partitioning = true) order by acq_datetime_utc, lat"
    ).df()


def test_modis_csv_is_normalized(tmp_path, raw):
    f = raw("modis", "modis_2024_Ukraine.csv", MODIS_HEADER, [
        "48.461,38.7808,311.1,1.9,1.3,2024-01-01,0035,Aqua,MODIS,82,61.03,271.2,40.5,N,2",
        "48.3945,25.4734,308.6,1.1,1,2024-01-03,1129,Terra,MODIS,29,61.03,280.9,13.3,D,0",
        "48.3969,25.4876,305.8,1.1,1,2024-01-03,1129,Terra,MODIS,30,61.03,280.3,11.1,D,0",
        "48.4000,25.5000,305.8,1.1,1,2024-01-04,1130,Aqua,MODIS,79,61.03,280.3,11.1,D,0",
    ])  # fmt: skip
    rows = normalize_sensor(duckdb.connect(), [f], "modis", tmp_path / "points")
    df = read_points(tmp_path / "points")

    assert rows == 4
    assert list(df.confidence_class) == ["high", "low", "nominal", "nominal"]  # 82, 29, 30, 79
    assert list(df.confidence_raw) == ["82", "29", "30", "79"]
    assert str(df.acq_datetime_utc[0]) == "2024-01-01 00:35:00"  # acq_time is HHMM, leading zeros kept
    assert list(df.satellite) == ["Aqua", "Terra", "Terra", "Aqua"]
    assert set(df.sensor) == {"modis"} and set(df.source) == {"sp"} and set(df.country) == {"Ukraine"}
    assert list(df.type) == [2, 0, 0, 0]


def test_viirs_csv_is_normalized(tmp_path, raw):
    f = raw("viirs-snpp", "viirs-snpp_2024_United_States.csv", VIIRS_HEADER, [
        "48.45827,38.77375,329.75,0.54,0.42,2024-01-01,0007,N,VIIRS,h,2,278.66,5.23,N,0",
        "48.45614,38.77732,339.37,0.62,0.71,2024-01-01,1124,N,VIIRS,l,2,270.89,5.49,D,0",
        "48.45997,38.77596,344.04,0.62,0.71,2024-01-01,1125,N,VIIRS,n,2,271.61,7.13,D,2",
    ])  # fmt: skip
    normalize_sensor(duckdb.connect(), [f], "viirs_snpp", tmp_path / "points")
    df = read_points(tmp_path / "points")

    assert list(df.confidence_class) == ["high", "low", "nominal"]  # h, l, n
    assert list(df.satellite) == ["N", "N", "N"]  # the letter N must not be read as a boolean or null
    assert str(df.acq_datetime_utc[0]) == "2024-01-01 00:07:00"
    assert set(df.country) == {"United_States"}  # country names may contain underscores
    assert df.scan_km.tolist() == [0.54, 0.62, 0.62]
    # 00:07 UTC at 38.8 E is 02:42 local solar time, same local date; at 38.8 E a 22:00 UTC pass would be next day
    assert str(df.local_date[0])[:10] == "2024-01-01"
    assert df.frp.tolist() == [5.23, 5.49, 7.13]


def test_both_sensors_share_one_schema_and_partition_by_year(tmp_path, raw):
    m23 = raw("modis", "modis_2023_Ukraine.csv", MODIS_HEADER,
              ["48.4,25.5,305.8,1.1,1,2023-12-31,2359,Aqua,MODIS,50,61.03,280.3,11.1,N,0"])  # fmt: skip
    m24 = raw("modis", "modis_2024_Ukraine.csv", MODIS_HEADER,
              ["48.4,25.5,305.8,1.1,1,2024-01-01,0001,Aqua,MODIS,50,61.03,280.3,11.1,N,0"])  # fmt: skip
    v24 = raw("viirs-jpss1", "viirs-jpss1_2024_Ukraine.csv", VIIRS_HEADER,
              ["48.4,25.5,329.7,0.5,0.4,2024-06-01,1100,N20,VIIRS,n,2,278.6,5.2,D,0"])  # fmt: skip
    points = tmp_path / "points"
    con = duckdb.connect()
    normalize_sensor(con, [m23, m24], "modis", points)
    normalize_sensor(con, [v24], "viirs_noaa20", points)

    assert (points / "sensor=modis" / "year=2023").is_dir() and (points / "sensor=modis" / "year=2024").is_dir()
    df = read_points(points)
    assert set(df.columns) == {
        "lat", "lon", "acq_datetime_utc", "satellite", "confidence_raw", "confidence_class",
        "frp", "daynight", "type", "scan_km", "track_km", "local_date", "source", "country", "sensor", "year",
    }  # fmt: skip
    assert sorted(set(df.sensor)) == ["modis", "viirs_noaa20"]

    # a re-run with fewer files leaves no stale partition behind
    normalize_sensor(con, [m24], "modis", points)
    assert not (points / "sensor=modis" / "year=2023").exists()


def test_raw_files_for_listed_countries_or_all(tmp_path, raw):
    for country in ("Ukraine", "Brazil", "United_States"):
        raw("modis", f"modis_2024_{country}.csv", MODIS_HEADER, [])
    folder = tmp_path / "raw" / "modis"
    assert [f.name for f in raw_files(folder, "modis", ["Ukraine"])] == ["modis_2024_Ukraine.csv"]
    assert len(raw_files(folder, "modis", None)) == 3


def test_a_global_zip_is_normalized_like_its_csv_files(tmp_path, raw):
    import zipfile

    from pipeline.config import Sensor
    from pipeline.normalize import normalize_zips

    rows = [
        "48.461,38.7808,311.1,1.9,1.3,2024-01-01,0035,Aqua,MODIS,82,61.03,271.2,40.5,N,2",
        "-10.5,-51.5,305.8,1.1,1,2024-01-03,1129,Terra,MODIS,30,61.03,280.3,11.1,D,0",
    ]
    f = raw("modis", "modis_2024_Ukraine.csv", MODIS_HEADER, rows[:1])
    g = raw("modis", "modis_2024_Brazil.csv", MODIS_HEADER, rows[1:])
    normalize_sensor(duckdb.connect(), [g, f], "modis", tmp_path / "from_csv" / "points")
    world = tmp_path / "world"
    (world / "raw" / "zips").mkdir(parents=True)
    with zipfile.ZipFile(world / "raw" / "zips" / "modis_2024_all_countries.zip", "w") as z:
        z.write(f, "modis/2024/modis_2024_Ukraine.csv")
        z.write(g, "modis/2024/modis_2024_Brazil.csv")

    done = normalize_zips(duckdb.connect(), world, [Sensor("modis", "modis", 2000)])

    assert done == {"modis_2024_all_countries.zip": 2}
    assert read_points(world / "points").equals(read_points(tmp_path / "from_csv" / "points"))
    assert not list((world / "raw").glob("unzipped_*"))  # the extracted CSV files are gone
