import duckdb
import pytest

from pipeline.aggregate import aggregate, cell_of
from pipeline.config import Config

CFG = Config(regions=(), sensors=(), cell_deg=0.25, drop_confidence=("low",), keep_types=(0,))

# lat, lon, utc time, confidence_class, frp, type, sensor
POINTS = [
    (48.46, 38.78, "2024-08-10 11:00:00", "nominal", 10.0, 0, "modis"),
    (48.40, 38.80, "2024-08-31 23:59:00", "high", 5.5, 0, "modis"),       # same cell, same month
    (48.40, 38.80, "2024-09-01 00:01:00", "high", 1.0, 0, "modis"),       # same cell, next UTC month
    (48.40, 38.80, "2024-08-15 11:00:00", "low", 99.0, 0, "modis"),       # dropped: low confidence
    (48.40, 38.80, "2024-08-15 11:00:00", "high", 99.0, 2, "modis"),      # dropped: static source
    (48.40, 38.80, "2024-08-15 11:00:00", "nominal", 2.0, 0, "viirs_snpp"),  # other sensor, own row
    (48.60, 38.80, "2024-08-15 11:00:00", "nominal", 3.0, 0, "modis"),    # neighbouring cell
]  # fmt: skip


@pytest.fixture
def points(tmp_path):
    con = duckdb.connect()
    for i, (lat, lon, t, conf, frp, typ, sensor) in enumerate(POINTS):
        folder = tmp_path / "points" / f"sensor={sensor}" / f"year={t[:4]}"
        folder.mkdir(parents=True, exist_ok=True)
        con.execute(f"""
            copy (select {lat} as lat, {lon} as lon, timestamp '{t}' as acq_datetime_utc, 'X' as satellite,
                         '50' as confidence_raw, '{conf}' as confidence_class, {frp} as frp, 'D' as daynight,
                         {typ} as type, 'sp' as source, 'Ukraine' as country)
            to '{folder}/p{i}.parquet' (format parquet)
        """)
    return tmp_path / "points"


def test_cell_of_known_point():
    cell_id, lat, lon = cell_of(48.46, 38.78, 0.25)
    assert (lat, lon) == (48.375, 38.875)
    assert cell_id == 553 * 1440 + 875
    assert cell_of(-90, -180, 0.25)[0] == 0
    assert cell_of(0, 180, 0.25)[0] == 360 * 1440 + 1439  # the antimeridian stays inside the last column


def test_aggregate_counts_filters_and_months(tmp_path, points):
    out = tmp_path / "agg" / "cell_month.parquet"
    con = duckdb.connect()
    n_rows = aggregate(con, points, out, CFG)
    df = con.execute(f"select * from read_parquet('{out}') order by sensor, year, month, cell_id").df()

    assert n_rows == len(df) == 4
    assert list(df.columns) == [
        "cell_id", "cell_lat", "cell_lon", "country", "year", "month", "sensor", "n_hotspots", "frp_sum",
    ]  # fmt: skip
    home = cell_of(48.46, 38.78, 0.25)[0]
    modis = df[df.sensor == "modis"].set_index(["month", "cell_id"])
    assert modis.loc[(8, home), "n_hotspots"] == 2  # low-confidence and type-2 rows are gone
    assert modis.loc[(8, home), "frp_sum"] == 15.5
    assert modis.loc[(9, home), "n_hotspots"] == 1
    assert modis.loc[(8, cell_of(48.60, 38.80, 0.25)[0]), "n_hotspots"] == 1
    viirs = df[df.sensor == "viirs_snpp"].iloc[0]
    assert (viirs.n_hotspots, viirs.cell_lat, viirs.cell_lon) == (1, 48.375, 38.875)
    assert int(df.n_hotspots.sum()) == 5
