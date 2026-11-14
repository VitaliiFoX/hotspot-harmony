import duckdb
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
        "cell_id": cell_id, "frp_max": frp, "n_day": has_day, "n_night": 1 - has_day, "n_high": 0,
        "scan": 0.4, "track": 0.4, "share": np.asarray(matched, dtype=float) * np.ones(n),
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


@pytest.mark.parametrize("weights", ["bins", "boosted"])
def test_weights_follow_fire_power_and_keep_the_total(overlap, weights):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    par = hz.fit_viirs(viirs, modis, weights)
    w = hz.viirs_weights(par, viirs)
    assert (par["model"] is not None) == (weights == "boosted")

    p = par["p"]
    assert p[viirs[viirs.frp < 1].b.iloc[0]] == pytest.approx(0.1, abs=0.02)
    assert p[viirs[viirs.frp > 30].b.iloc[0]] == pytest.approx(0.8, abs=0.03)
    assert w[viirs.frp > 30].mean() > 5 * w[viirs.frp < 1].mean()  # a strong fire counts several times more
    assert w.sum() == pytest.approx(len(modis), rel=1e-6)  # the harmonized total equals what MODIS reported


def test_record_takes_each_period_from_one_sensor():
    dates = ["2001-05-01", "2002-08-01", "2015-06-01", "2023-06-01"]
    df = hz.prepare(pd.concat([cell_days(s, dates) for s in ("modis", "modis_terra", "viirs_snpp", "viirs_noaa20")],
                              ignore_index=True))  # fmt: skip
    par = {"p": pd.Series({df.b.iloc[0]: 0.5}), "k": 2.0, "r": np.ones(367),
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


def test_each_modis_cell_day_is_shared_among_the_viirs_cell_days_that_explain_it(tmp_path):
    day = "date '2015-08-01'"
    rows = [  # stream, gx, gy
        ("modis", 0, 0),          # one MODIS cell-day...
        ("viirs_snpp", 0, 0),     # ...explained by two S-NPP cell-days next to it: half each
        ("viirs_snpp", 1, 0),
        ("viirs_snpp", 10, 10),   # too far away: explains nothing
        ("viirs_noaa20", 0, 1),   # the only NOAA-20 cell-day near it: the whole unit
    ]  # fmt: skip
    rest = "48.1, 30.1, 5.0, 1, 1, 5.0, 1, 0, 0, 0.4, 0.4, 1"
    values = ", ".join(f"('Testland', '{s}', {day}, {gx}, {gy}, {rest})" for s, gx, gy in rows)
    path = tmp_path / "cell_day.parquet"
    duckdb.sql(f"""
        copy (select * from (values {values}) t(country, stream, local_date, gx, gy, lat, lon, frp, n_det, has_day,
                                                 frp_max, n_day, n_night, n_high, scan, track, cell_id))
        to '{path}' (format parquet)
    """)
    df = hz.load_cell_days(duckdb.connect(), path, "Testland").set_index(["stream", "gx", "gy"])
    assert df.share.to_dict() == {
        ("modis", 0, 0): 0.0, ("viirs_snpp", 0, 0): 0.5, ("viirs_snpp", 1, 0): 0.5,
        ("viirs_snpp", 10, 10): 0.0, ("viirs_noaa20", 0, 1): 1.0,
    }  # fmt: skip
    assert df.matched.to_dict() == {
        ("modis", 0, 0): 0, ("viirs_snpp", 0, 0): 1, ("viirs_snpp", 1, 0): 1,
        ("viirs_snpp", 10, 10): 0, ("viirs_noaa20", 0, 1): 1,
    }  # fmt: skip


def test_the_boosted_model_is_used_only_when_it_clearly_wins(overlap, monkeypatch):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    for errors, expected in (
        ({"bins": 0.070, "boosted": 0.060}, "boosted"),  # a full point better: use the model
        ({"bins": 0.070, "boosted": 0.069}, "bins"),     # within the margin: the simpler table wins
        ({"bins": 0.070, "boosted": 0.080}, "bins"),     # worse on held-out years: never
    ):  # fmt: skip
        monkeypatch.setattr(hz, "held_out_month_error", lambda v, m, weights, e=errors: e[weights])
        assert hz.choose_weights(viirs, modis) == (expected, errors)


def test_held_out_month_error_is_an_error_on_years_the_fit_did_not_see(overlap):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    error = hz.held_out_month_error(viirs, modis, "bins")
    assert 0 < error < 0.5  # random synthetic months: far from perfect, far from useless
    # a fit that sees the test years (all of them, no hold-out) cannot be scored this way by accident
    par = hz.fit_viirs(viirs, modis, "bins")
    in_sample = hz.viirs_weights(par, viirs).groupby([viirs.y, viirs.m]).sum()
    truth = modis.groupby(["y", "m"]).size()
    assert float((in_sample - truth).abs().sum() / truth.sum()) <= error + 0.02


def test_season_factor_pools_neighbouring_days_and_wraps_at_new_year():
    # truth: 4 cell-days on day 10, 2 on day 366; prediction: weight 1 on day 10, 1 on day 1
    r = hz.season_factor(np.array([10, 10, 10, 10, 366, 366]), np.array([10, 1]), np.array([1.0, 1.0]), half=1)
    assert r[10] == pytest.approx(4.0)  # window (1, 2, 1) over days 9-11: 2*4 / 2*1
    assert r[9] == r[11] == pytest.approx(4.0)  # the neighbours borrow from day 10: 1*4 / 1*1
    assert r[1] == pytest.approx(1.0)  # day 366 is next to day 1: (1*2) / (2*1)
    assert r[366] == pytest.approx(4.0)  # (2*2) / (1*1)
    assert r[200] == 1.0  # nothing to learn from: no correction


def test_season_factor_keeps_the_total(overlap):
    viirs, modis = overlap[overlap.stream == "viirs_snpp"], overlap[overlap.stream == "modis"]
    par = hz.fit_viirs(viirs, modis)
    assert len(par["r"]) == 367 and par["r"].min() > 0
    assert hz.viirs_weights(par, viirs).sum() == pytest.approx(len(modis), rel=1e-9)


def test_a_day_the_sensor_did_not_observe_is_a_gap_not_a_quiet_day():
    busy = pd.date_range("2023-07-01", periods=5, freq="D")
    modis = pd.concat([cell_days("modis", [d] * 150) for d in busy])
    n20 = pd.concat([cell_days("viirs_noaa20", [d] * (20 if d.day == 3 else 300)) for d in busy])
    early = cell_days("modis", [pd.Timestamp("2010-07-01")] * 150)  # before NOAA-20 existed: not a gap
    df = hz.prepare(pd.concat([modis, n20, early], ignore_index=True))
    assert list(hz.gap_days(df, "viirs_noaa20")) == [pd.Timestamp("2023-07-03")]
    assert len(hz.gap_days(df, "viirs_snpp")) == 0

    par = {"p": pd.Series({df.b.iloc[0]: 0.5}), "k": 1.0, "r": np.ones(367), "n20_to_snpp": 1.0,
           "terra": pd.Series({7: 2.0})}  # fmt: skip
    record = hz.apply(df, par)
    record = record[record.in_series & (record.y == 2023)]
    by_day = record.groupby(["local_date", "stream"]).weight.sum().unstack(fill_value=0.0)
    assert by_day.loc["2023-07-03"].to_dict() == {"modis": 150.0, "viirs_noaa20": 0.0}  # that day comes from MODIS
    assert by_day.loc["2023-07-02"].to_dict() == {"modis": 0.0, "viirs_noaa20": 150.0}  # 300 cell-days x 0.5


def test_a_sensor_silent_while_its_twin_is_busy_is_a_gap_even_on_a_day_with_little_fire():
    days = pd.date_range("2023-07-19", periods=4, freq="D")
    modis = pd.concat([cell_days("modis", [d] * 20) for d in days])  # far under the 100 MODIS needs to be "busy"
    snpp = pd.concat([cell_days("viirs_snpp", [d] * n) for d, n in zip(days, [60, 60, 40, 60], strict=True)])
    # day 1 normal; day 2 silent beside 60 of the twin: a gap; day 3 silent beside 40: too little to tell;
    # day 4 has 10 beside 60, a sixth and not under a tenth: a poor day, not a gap
    n20 = pd.concat([cell_days("viirs_noaa20", [d] * n) for d, n in zip(days, [60, 0, 0, 10], strict=True)])
    df = hz.prepare(pd.concat([modis, snpp, n20], ignore_index=True))
    assert list(hz.gap_days(df, "viirs_noaa20")) == [pd.Timestamp("2023-07-20")]
    assert len(hz.gap_days(df, "viirs_snpp")) == 0

    par = {"p": pd.Series({df.b.iloc[0]: 0.5}), "k": 1.0, "r": np.ones(367), "n20_to_snpp": 1.0,
           "terra": pd.Series({7: 2.0})}  # fmt: skip
    record = hz.apply(df, par)
    by_day = record[record.in_series].groupby(["local_date", "stream"]).weight.sum().unstack(fill_value=0.0)
    assert by_day.loc["2023-07-20"].to_dict() == {"modis": 20.0, "viirs_noaa20": 0.0}  # taken from MODIS
    assert pd.Timestamp("2023-07-21") not in by_day.index  # stays a quiet day: nothing in the record
    assert by_day.loc["2023-07-22"].to_dict() == {"modis": 0.0, "viirs_noaa20": 5.0}  # 10 cell-days x 0.5


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
