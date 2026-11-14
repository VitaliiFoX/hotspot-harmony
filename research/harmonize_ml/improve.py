"""PROTOTYPE - cheap, explainable improvements to the detection-weight method, measured one at a time.

    gap days    days when S-NPP delivered next to nothing while MODIS was busy are sensor gaps, not
                fire: leave them out of the fit and of the comparison
    season      a factor that follows the day of the year smoothly instead of jumping by calendar month
    ml weight   a boosted model for the weight instead of FRP bins
    blend       the mean of the two weights

Run:  research/harmonize_ml/run.sh improve        (or: uv run python research/harmonize_ml/improve.py for the non-ML rows)
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import run as R  # noqa: E402

KEYS = R.KEYS


def gap_days(v: pd.DataFrame, m: pd.DataFrame, min_modis: int = 100, max_ratio: float = 0.6) -> pd.DatetimeIndex:
    """Days when VIIRS reports under 0.6 cell-days per MODIS cell-day (it normally reports about 2.2)."""
    daily = pd.concat([m.groupby("local_date").size().rename("modis"), v.groupby("local_date").size().rename("viirs")], axis=1)
    daily = daily.fillna(0)
    return pd.DatetimeIndex(daily.index[(daily.modis >= min_modis) & (daily.viirs < max_ratio * daily.modis)])


def smooth_season(doy_truth, doy_pred, w_pred, h: int) -> np.ndarray:
    """truth / prediction by day of year, pooled over +-h days with a triangular window, wrapping at New Year."""
    num = np.bincount(doy_truth, minlength=367)[1:].astype(float)
    den = np.bincount(doy_pred, weights=w_pred, minlength=367)[1:]
    kernel = np.concatenate([np.arange(1, h + 2), np.arange(h, 0, -1)]).astype(float)
    pad = lambda a: np.concatenate([a[-h:], a, a[:h]])  # noqa: E731
    n, d = np.convolve(pad(num), kernel, "valid"), np.convolve(pad(den), kernel, "valid")
    r = np.where(d > 0, n / np.where(d > 0, d, 1), 1.0)
    return np.concatenate([[1.0], r])  # index by doy 1..366


def predict(spec: dict, tr, te, mtr):
    """Weights for the test rows. spec: weight = bins | lgbm ; season = month | <h days> ; target, feats for lgbm."""
    if spec["weight"] == "bins":
        p = tr.groupby("b")[spec.get("target", "m1")].mean()
        ptr, pte = tr.b.map(p).to_numpy(), te.b.map(p).fillna(p.mean()).to_numpy()
    else:
        obj = "binary" if spec["target"].startswith("m") else "poisson"
        ptr, pte = R.fit_predict(spec["weight"], obj, tr[spec["feats"]], tr[spec["target"]], te[spec["feats"]])
    k = len(mtr) / ptr.sum()
    wtr, wte = ptr * k, pte * k
    if spec["season"] == "month":
        r = mtr.groupby("m").size() / pd.Series(wtr).groupby(tr.m.to_numpy()).sum()
        return wte * te.m.map(r).fillna(1.0).to_numpy()
    r = smooth_season(mtr.doy.to_numpy(), tr.doy.to_numpy(), wtr, spec["season"])
    keep_total = len(mtr) / (wtr * r[tr.doy.to_numpy()]).sum()  # smoothing must not shift the overall level
    return wte * r[te.doy.to_numpy()] * keep_total


def loyo(spec: dict, v, m) -> pd.DataFrame:
    parts = []
    for year in sorted(v.y.unique()):
        te = v[v.y == year]
        parts.append(te[KEYS].assign(w=predict(spec, v[v.y != year], te, m[m.y != year])))
    return pd.concat(parts)


def main() -> None:
    v, _, m, _ = R.load()
    for d in (v, m):
        d["local_date"] = pd.to_datetime(d.local_date)
    m["doy"] = m.local_date.dt.dayofyear
    gaps = gap_days(v, m)
    print(f"sensor gap days ({len(gaps)}): " + ", ".join(f"{d:%Y-%m-%d}" for d in gaps))
    print(f"MODIS cell-days on them: {int(m.local_date.isin(gaps).sum())} of {len(m)}\n")
    years = sorted(v.y.unique())
    truth_all = m.groupby(KEYS).size().rename("truth").reset_index()
    vg, mg = v[~v.local_date.isin(gaps)], m[~m.local_date.isin(gaps)]
    truth = mg.groupby(KEYS).size().rename("truth").reset_index()

    base = dict(weight="bins", season="month")
    specs = {
        "A1 pipeline method, gap days left out": base,
        "A2 + season by day of year, +-10 d": dict(weight="bins", season=10),
        "A3 + season by day of year, +-15 d": dict(weight="bins", season=15),
        "A4 + season by day of year, +-20 d": dict(weight="bins", season=20),
        "A5 + season by day of year, +-30 d": dict(weight="bins", season=30),
    }
    if "--ml" in sys.argv:
        specs.update({
            "M1 lgbm P(seen), cell features, month": dict(weight="lgbm", target="m1", feats=R.POINT_PLUS, season="month"),
            "M2 lgbm P(seen), cell features, +-15 d": dict(weight="lgbm", target="m1", feats=R.POINT_PLUS, season=15),
            "M3 lgbm share r=3, + place and season, month": dict(weight="lgbm", target="share3", feats=R.POINT_GEO, season="month"),
            "M4 lgbm share r=3, + place and season, +-15 d": dict(weight="lgbm", target="share3", feats=R.POINT_GEO, season=15),
            "M5 lgbm share r=1, cell features, +-15 d": dict(weight="lgbm", target="share1", feats=R.POINT_PLUS, season=15),
        })  # fmt: skip
    if "--final" in sys.argv:
        final(v, m, vg, mg, truth, years, gaps)
        return
    preds = {"A0 pipeline method, all days": loyo(base, v, m)}
    tabs = {"A0 pipeline method, all days": R.table(preds["A0 pipeline method, all days"], truth_all, years)}
    for name, spec in specs.items():
        preds[name] = loyo(spec, vg, mg)
        tabs[name] = R.table(preds[name], truth, years)
        R.log(f"done: {name}")
    best_a = min((k for k in tabs if k[:2] in ("A2", "A3", "A4", "A5")), key=lambda k: R.scores(tabs[k])["country_month"])
    if "--ml" in sys.argv:
        best_m = min((k for k in tabs if k.startswith("M")), key=lambda k: R.scores(tabs[k])["country_month"])
        for tag, (a, b) in {"B1": (best_a, best_m), "B2": ("A3 + season by day of year, +-15 d", "M4 lgbm share r=3, + place and season, +-15 d")}.items():
            name = f"{tag} mean of {a[:2]} and {b[:2]}"
            tabs[name] = R.table(R.blend(preds[a], preds[b]), truth, years)
    ref = "A1 pipeline method, gap days left out"
    rows = [{"model": n, **R.scores(d), **(R.versus(d, tabs[ref]) if n not in (ref, "A0 pipeline method, all days") else {})}
            for n, d in tabs.items()]  # fmt: skip
    df = pd.DataFrame(rows)
    df.to_csv(R.OUT / "results_improve.csv", index=False)
    for col in ("bias", "country_year", "country_month", "tile_year", "tile_month", "d_country_month", "d_tile_month"):
        df[col] = (df[col] * 100).round(2)
    pd.set_option("display.width", 260, "display.max_colwidth", 50)
    print(df.drop(columns=["d_tile_month_90"]).to_string(index=False))


def final(v, m, vg, mg, truth, years, gaps) -> None:
    """Everything that helped, together: three boosting libraries on the weight, the cell-day model, blends."""
    cache = R.OUT / "oof"
    cache.mkdir(exist_ok=True)

    def cached(tag: str, make):
        path = cache / f"final_{tag}.parquet"
        if not path.exists():
            make().groupby(KEYS).w.sum().reset_index().to_parquet(path)
            R.log(f"done: {tag}")
        return pd.read_parquet(path)

    _, c, _, _ = R.load()
    c["local_date"] = pd.to_datetime(c.local_date)
    cg = c[~c.local_date.isin(gaps)]
    folds = [([y for y in years if y != t], [t]) for t in years]
    point = lambda lib: dict(weight=lib, target="share1", feats=R.POINT_PLUS, season=15)  # noqa: E731
    cell = lambda lib: pd.concat([R.cell_model(dict(lib=lib, feats=R.CELL_GEO), cg, truth, tr, te) for tr, te in folds])  # noqa: E731
    preds = {
        "A1 pipeline method, gap days left out": cached("A1", lambda: loyo(dict(weight="bins", season="month"), vg, mg)),
        "A3 bins + season by day of year": cached("A3", lambda: loyo(dict(weight="bins", season=15), vg, mg)),
        "M5 lgbm weight": cached("M5_lgbm", lambda: loyo(point("lgbm"), vg, mg)),
        "M6 xgboost weight": cached("M6_xgb", lambda: loyo(point("xgb"), vg, mg)),
        "M7 catboost weight": cached("M7_catboost", lambda: loyo(point("catboost"), vg, mg)),
        "C4 lgbm cell-day model": cached("C4_lgbm", lambda: cell("lgbm")),
        "C7 xgboost cell-day model": cached("C7_xgb", lambda: cell("xgb")),
    }
    mean = lambda *names: pd.concat([preds[n].assign(w=preds[n].w / len(names)) for n in names])  # noqa: E731
    preds["E1 mean of the three weight models"] = mean("M5 lgbm weight", "M6 xgboost weight", "M7 catboost weight")
    preds["E2 mean of the two cell-day models"] = mean("C4 lgbm cell-day model", "C7 xgboost cell-day model")
    preds["F1 A3 + M5 + C4"] = mean("A3 bins + season by day of year", "M5 lgbm weight", "C4 lgbm cell-day model")
    preds["F2 E1 + E2"] = R.blend(preds["E1 mean of the three weight models"], preds["E2 mean of the two cell-day models"])
    preds["F3 A3 + E1 + E2"] = pd.concat([preds[n].assign(w=preds[n].w / 3) for n in
                                          ("A3 bins + season by day of year", "E1 mean of the three weight models", "E2 mean of the two cell-day models")])
    preds["F4 A3 + C4 (no boosted weight)"] = mean("A3 bins + season by day of year", "C4 lgbm cell-day model")
    ref = "A1 pipeline method, gap days left out"
    tabs = {n: R.table(p, truth, years) for n, p in preds.items()}
    df = pd.DataFrame([{"model": n, **R.scores(d), **(R.versus(d, tabs[ref]) if n != ref else {})} for n, d in tabs.items()])
    df.to_csv(R.OUT / "results_final.csv", index=False)
    for col in ("bias", "country_year", "country_month", "tile_year", "tile_month", "d_country_month", "d_tile_month"):
        df[col] = (df[col] * 100).round(2)
    pd.set_option("display.width", 260, "display.max_colwidth", 50)
    print(df.drop(columns=["d_tile_month_90"]).to_string(index=False))


if __name__ == "__main__":
    main()
