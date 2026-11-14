import numpy as np
import pandas as pd
import pytest

from pipeline import harmonize as hz
from pipeline.validate import compare, interval_by_size, leave_one_year_out, scores, sensor_jump


def cell_days(stream, dates, frp=5.0, has_day=1, matched=0, lat=48.1, lon=30.1, cell_id=1):
    n = len(dates)
    return pd.DataFrame({
        "country": "Testland", "stream": stream, "local_date": pd.to_datetime(dates), "gx": np.arange(n),
        "gy": 0, "lat": lat, "lon": lon, "frp": frp, "n_det": 1, "has_day": has_day, "matched": matched,
        "cell_id": cell_id,
    })  # fmt: skip


@pytest.fixture
def overlap():
    """Synthetic overlap years: weak VIIRS fires are seen by MODIS 1 time in 10, strong ones 8 in 10."""
    rng = np.random.default_rng(0)
    days = pd.date_range("2012-02-01", "2021-12-31", freq="D")
    weak = cell_days("viirs_snpp", rng.choice(days, 6000), frp=0.5, matched=(rng.random(6000) < 0.1).astype(int))
    strong = cell_days("viirs_snpp", rng.choice(days, 3000), frp=40.0, matched=(rng.random(3000) < 0.8).astype(int))
    modis = cell_days("modis", rng.choice(days, 4000))
    return hz.prepare(pd.concat([weak, strong, modis], ignore_index=True))


def test_weights_follow_fire_power_and_keep_the_total(overlap):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    par = hz.fit_viirs(viirs, modis)
    w = hz.viirs_weights(par, viirs.b, viirs.m)

    p = par["p"]
    assert p[viirs[viirs.frp < 1].b.iloc[0]] == pytest.approx(0.1, abs=0.02)
    assert p[viirs[viirs.frp > 30].b.iloc[0]] == pytest.approx(0.8, abs=0.03)
    assert w[viirs.frp > 30].mean() > 5 * w[viirs.frp < 1].mean()  # a strong fire counts several times more
    assert w.sum() == pytest.approx(len(modis), rel=1e-6)  # the harmonized total equals what MODIS reported


def test_record_takes_each_period_from_one_sensor():
    dates = ["2001-05-01", "2002-08-01", "2015-06-01", "2023-06-01"]
    df = hz.prepare(pd.concat([cell_days(s, dates) for s in ("modis", "modis_terra", "viirs_snpp", "viirs_noaa20")],
                              ignore_index=True))  # fmt: skip
    par = {"p": pd.Series({df.b.iloc[0]: 0.5}), "k": 2.0, "r": pd.Series({5: 1.0, 6: 1.0, 8: 1.0}),
           "n20_to_snpp": 0.9, "terra": pd.Series({5: 2.5})}  # fmt: skip
    out = hz.apply(df, par)
    used = out[out.in_series].sort_values("local_date")

    assert list(used.stream) == ["modis_terra", "modis", "modis", "viirs_noaa20"]
    assert list(used.weight.round(3)) == [2.5, 1.0, 1.0, 0.9]  # Terra scaled, reference = 1, NOAA-20 = 0.9*2*0.5
    raw = out[out.in_raw].sort_values("local_date")
    assert list(raw.stream) == ["modis", "modis", "viirs_snpp", "viirs_snpp"]  # the raw record

    cells = hz.monthly_cells(out, cell_deg=0.25)
    assert list(cells.sensor_used) == ["modis_terra", "modis", "modis", "viirs_noaa20"]
    assert list(cells.n_raw) == [1, 1, 1, 1] and cells.n_harmonized.sum() == pytest.approx(5.4)


def test_sensor_gap_months_are_left_out_of_the_noaa20_factor():
    months = pd.period_range("2018-04", "2021-12", freq="M")
    snpp, n20 = [], []
    for mth in months:
        days = pd.date_range(mth.start_time, periods=28, freq="D")
        gap = str(mth) == "2020-07"
        snpp.append(cell_days("viirs_snpp", list(days) * (2 if gap else 4)))  # half the usual data
        n20.append(cell_days("viirs_noaa20", list(days) * 4))
    df = hz.prepare(pd.concat(snpp + n20, ignore_index=True))
    factor, gaps = hz.fit_n20(df, pd.Series(1.0, index=df.index))
    assert gaps == ["2020-07"]
    assert factor == pytest.approx(1.0)  # without the gap month the two sensors agree exactly


def test_validation_scores_and_sensor_jump(overlap):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    loyo = compare(leave_one_year_out(viirs, modis), modis)
    s = scores(loyo)
    raw = scores(compare(viirs.assign(w=1.0), modis))
    assert abs(s["bias"]) < 0.05 < raw["bias"]  # raw VIIRS overshoots, harmonized does not
    assert s["wape_country_year"] < raw["wape_country_year"]
    assert all(row["lo"] <= 1 <= row["hi"] for row in interval_by_size(loyo))

    years = [f"{y}-06-15" for y in range(2007, 2017)]
    df = hz.prepare(pd.concat([cell_days("modis", years), cell_days("viirs_snpp", years * 3)], ignore_index=True))
    df["weight"] = np.where(df.stream == "modis", 1.0, 1 / 3)
    df["in_raw"] = ((df.stream == "modis") & (df.y < 2012)) | ((df.stream == "viirs_snpp") & (df.y >= 2012))
    df["in_series"] = df.stream == "modis"
    assert sensor_jump(df) == {"raw": {"before": 1.0, "after": 3.0, "jump_ratio": 3.0},
                        "harmonized": {"before": 1.0, "after": 1.0, "jump_ratio": 1.0}}  # fmt: skip
