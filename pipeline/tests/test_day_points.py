import json
import zipfile

import duckdb
import pytest

from pipeline.config import Config, Region, Sensor
from pipeline.day_points import build

MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_t31,frp,daynight,type\n"
)
VIIRS_HEADER = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight,type\n"
)
CFG = Config(
    regions=(Region("World", (-180.0, -90.0, 180.0, 90.0)),),
    sensors=(
        Sensor("modis", "modis", 2000),
        Sensor("viirs_snpp", "viirs-snpp", 2012),
        Sensor("viirs_noaa20", "viirs-jpss1", 2018),
    ),
    cell_deg=0.25,
    drop_confidence=("low",),
    keep_types=(0,),
    world=True,
)


@pytest.fixture
def zips(tmp_path):
    """Write a FIRMS-style global zip: <archive>/<year>/<archive>_<year>_<Country>.csv members."""

    def write(archive: str, year: int, header: str, countries: dict[str, list[str]]):
        folder = tmp_path / "raw" / "zips"
        folder.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(folder / f"{archive}_{year}_all_countries.zip", "w") as z:
            for country, rows in countries.items():
                z.writestr(f"{archive}/{year}/{archive}_{year}_{country}.csv", header + "\n".join(rows) + "\n")

    return write


def read(tmp_path):
    return (
        duckdb.connect()
        .execute(
            f"select * from read_parquet('{tmp_path}/day_points/**/*.parquet', hive_partitioning = true) "
            "order by acq_datetime_utc"
        )
        .df()
    )


def write_2012(zips):
    zips("modis", 2012, MODIS_HEADER, {
        "Ukraine": [
            "50.12344,30.56786,310.0,1.0,1.0,2012-01-31,2359,Terra,MODIS,80,6.1NRT,290.0,12.0,D,0",  # kept
            "50.2,30.6,310.0,1.0,1.0,2012-02-01,0000,Aqua,MODIS,90,6.1NRT,290.0,12.0,N,0",  # S-NPP's month
            "50.3,30.7,310.0,1.0,1.0,2012-01-15,1000,Terra,MODIS,29,6.1NRT,290.0,12.0,D,0",  # low confidence
            "50.4,30.8,310.0,1.0,1.0,2012-01-16,1000,Terra,MODIS,85,6.1NRT,290.0,12.0,D,2",  # not vegetation
        ],
        "Brazil": [
            "-10.12344,-50.98766,310.0,1.0,1.0,2012-01-10,0135,Aqua,MODIS,30,6.1NRT,290.0,12.0,N,0",  # kept
        ],
    })  # fmt: skip
    zips("viirs-snpp", 2012, VIIRS_HEADER, {
        "Brazil": [
            "-10.5,-51.5,330.0,0.4,0.4,2012-01-25,0400,N,VIIRS,h,2,280.0,5.0,N,0",  # MODIS's month
            "-10.25,-51.25,330.0,0.4,0.4,2012-02-01,0005,N,VIIRS,n,2,280.0,5.0,N,0",  # kept
            "-10.26,-51.26,330.0,0.4,0.4,2012-02-02,1700,N,VIIRS,l,2,280.0,5.0,D,0",  # low confidence
        ],
    })  # fmt: skip
    zips("modis", 2013, MODIS_HEADER, {
        "Ukraine": ["50.5,30.9,310.0,1.0,1.0,2013-07-01,1000,Terra,MODIS,85,6.1NRT,290.0,12.0,D,0"],  # S-NPP's year
    })  # fmt: skip


def test_keeps_the_day_views_sensor_and_filters_as_scaled_integers(tmp_path, zips):
    write_2012(zips)
    build(tmp_path, CFG)
    df = read(tmp_path)

    assert list(df.sensor) == ["modis", "modis", "viirs_snpp"]
    assert [str(t) for t in df.acq_datetime_utc] == [
        "2012-01-10 01:35:00",
        "2012-01-31 23:59:00",
        "2012-02-01 00:05:00",
    ]
    assert list(df.lat_e4) == [-101234, 501234, -102500]  # degrees x 10 000, rounded
    assert list(df.lon_e4) == [-509877, 305679, -512500]
    assert list(df.country) == ["Brazil", "Ukraine", "Brazil"]
    assert set(df.year) == {2012}
    assert str(df.lat_e4.dtype) == "int32"


def test_manifest_counts_rows_and_records_the_filters(tmp_path, zips):
    write_2012(zips)
    manifest = build(tmp_path, CFG)

    assert manifest["rows"] == {"modis": {"2012": 2}, "viirs_snpp": {"2012": 1}}
    assert manifest["coordinate_scale"] == 10000
    assert manifest["drop_confidence"] == ["low"] and manifest["keep_types"] == [0]
    assert manifest["switch_to_viirs_snpp"] == "2012-02-01"
    assert json.loads((tmp_path / "day_points" / "manifest.json").read_text()) == manifest


def test_a_built_year_is_kept_without_its_zip(tmp_path, zips):
    write_2012(zips)
    build(tmp_path, CFG)
    for z in (tmp_path / "raw" / "zips").glob("*.zip"):
        z.unlink()

    manifest = build(tmp_path, CFG)

    assert manifest["rows"] == {"modis": {"2012": 2}, "viirs_snpp": {"2012": 1}}
    assert not list((tmp_path / "raw").glob("unzipped_*"))  # no extracted CSV left behind
