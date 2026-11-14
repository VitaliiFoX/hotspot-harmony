"""PROTOTYPE - can ML beat the detection-weight harmonization? Answers with held-out numbers.

Question: predicting MODIS fire cell-days from VIIRS on years the model did not see, does any of
these beat the method in pipeline/harmonize.py (FRP bin x day/night weight, scale k, month factor)?

    point   a boosted model for the weight of each VIIRS cell-day (more features, other targets)
    cell    a boosted Poisson model on 0.25 degree cell x day, seeing the days and cells around it
    blend   averages of the above

Stages:
    loyo    leave-one-year-out over 2012-2021 with LightGBM (fast), every variant
    oot     train 2012-2018, test 2019-2021: LightGBM vs CatBoost vs XGBoost on the best variants
    twin    two VIIRS sensors instead of one, 2018-04 .. 2021-12

Error = WAPE = sum|prediction - truth| / sum(truth). A difference is only called real when its
90% bootstrap interval (resampling months) excludes zero.

Run:  uv run --with lightgbm --with catboost --with xgboost python research/harmonize_ml/run.py loyo|oot|twin
Needs: uv run python research/harmonize_ml/features.py
"""

import os
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "research" / "harmonize_ml" / os.environ.get("HH_COUNTRY", "Ukraine")
KEYS = ["y", "m", "tx", "ty"]
FRP_EDGES = [0, 1, 2, 4, 8, 16, 32, 64]
RNG = np.random.default_rng(0)
T0 = time.time()

POINT_BASE = ["lfrp", "has_day"]
POINT_PLUS = POINT_BASE + ["lfrp_max", "n", "n_day", "n_night", "n_high", "scan", "track"]
POINT_CTX = POINT_PLUS + ["nb1_n", "lnb1_frp", "nb3_n", "lnb3_frp", "prev1", "next1", "low1", "static1"]
POINT_GEO = POINT_CTX + ["lat", "lon", "doy_sin", "doy_cos"]
CELL_NOW = ["cd", "cd_day", "cd_night", "lfrp", "lfrp_max", "det", "high", "cd_weak", "cd_strong", "nb_cd", "lnb_frp"]
CELL_PAST = CELL_NOW + ["cd_p1", "lfrp_p1", "cd_p2"]
CELL_ALL = CELL_PAST + ["cd_n1", "lfrp_n1", "cd_n2"]
CELL_GEO = CELL_ALL + ["lat", "lon", "doy_sin", "doy_cos"]
CELL_TE = CELL_GEO + ["cell_ratio", "cell_month_clim"]


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


def load():
    v = pd.read_parquet(OUT / "snpp.parquet")
    v["has_day"] = (v.n_day > 0).astype(int)
    v["b"] = np.digitize(v.frp, FRP_EDGES) + 10 * v.has_day
    for c in ("frp", "frp_max", "nb1_frp", "nb3_frp"):
        v["l" + c] = np.log1p(v[c].clip(lower=0))
    c = pd.read_parquet(OUT / "cell025.parquet")
    for col in ("frp", "frp_max", "nb_frp", "frp_p1", "frp_n1"):
        c["l" + col] = np.log1p(c[col])
    for d in (v, c):
        d["lat"], d["lon"] = d.lat.astype(float), d.lon.astype(float)  # DuckDB hands the cell centres over as decimals
        d["doy_sin"], d["doy_cos"] = np.sin(2 * np.pi * d.doy / 365.25), np.cos(2 * np.pi * d.doy / 365.25)
    m = pd.read_parquet(OUT / "modis.parquet")
    truth = m.groupby(KEYS).size().rename("truth").reset_index()
    return v, c, m, truth


# ---- scoring -----------------------------------------------------------------------------------------------------
def table(pred: pd.DataFrame, truth: pd.DataFrame, years) -> pd.DataFrame:
    p = pred.groupby(KEYS).w.sum().rename("pred").reset_index()
    return p.merge(truth[truth.y.isin(years)], on=KEYS, how="outer").fillna(0.0)


def wape(g) -> float:
    return float((g.pred - g.truth).abs().sum() / g.truth.sum())


def scores(d: pd.DataFrame) -> dict:
    return {
        "bias": d.pred.sum() / d.truth.sum() - 1,
        "country_year": wape(d.groupby("y")[["pred", "truth"]].sum()),
        "country_month": wape(d.groupby(["y", "m"])[["pred", "truth"]].sum()),
        "tile_year": wape(d.groupby(["y", "tx", "ty"])[["pred", "truth"]].sum()),
        "tile_month": wape(d),
    }


def versus(d: pd.DataFrame, ref: pd.DataFrame, n: int = 2000) -> dict:
    """Difference in error against the reference method, with a 90% interval from resampling months."""
    out = {}
    for level, by in (("country_month", ["y", "m"]), ("tile_month", KEYS)):
        a = d.groupby(by)[["pred", "truth"]].sum()
        b = ref.groupby(by)[["pred", "truth"]].sum().reindex(a.index).fillna(0.0)
        month = pd.MultiIndex.from_arrays([a.index.get_level_values("y"), a.index.get_level_values("m")])
        codes = pd.factorize(month)[0]
        ea = np.bincount(codes, (a.pred - a.truth).abs())
        eb = np.bincount(codes, (b.pred - b.truth).abs())
        t = np.bincount(codes, a.truth)
        idx = RNG.integers(0, len(t), size=(n, len(t)))
        diff = ea[idx].sum(1) / t[idx].sum(1) - eb[idx].sum(1) / t[idx].sum(1)
        lo, hi = np.quantile(diff, [0.05, 0.95])
        out[f"d_{level}"] = ea.sum() / t.sum() - eb.sum() / t.sum()
        out[f"d_{level}_90"] = f"[{lo:+.4f}, {hi:+.4f}]"
        out[f"real_{level}"] = "yes" if hi < 0 else ("worse" if lo > 0 else "no")
    return out


# ---- models ------------------------------------------------------------------------------------------------------
def fit_predict(lib: str, objective: str, xtr, ytr, xte, seed: int = 0):
    """One boosted model; returns predictions for the train and test rows."""
    if lib == "lgbm":
        import lightgbm as lgb

        cls = lgb.LGBMClassifier if objective == "binary" else lgb.LGBMRegressor
        mdl = cls(objective=objective, n_estimators=400, learning_rate=0.05, num_leaves=63, min_child_samples=100,
                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8, n_jobs=12, verbose=-1, random_state=seed)  # fmt: skip
    elif lib == "catboost":
        import catboost as cb

        if objective == "binary":
            mdl = cb.CatBoostClassifier(iterations=600, learning_rate=0.08, depth=7, verbose=0, thread_count=12, random_seed=seed)
        else:
            mdl = cb.CatBoostRegressor(loss_function="Poisson", iterations=600, learning_rate=0.08, depth=7, verbose=0,
                                       thread_count=12, random_seed=seed)  # fmt: skip
    elif lib == "xgb":
        import xgboost as xgb

        if objective == "binary":
            mdl = xgb.XGBClassifier(n_estimators=400, learning_rate=0.05, max_depth=7, subsample=0.8, colsample_bytree=0.8,
                                    tree_method="hist", n_jobs=12, random_state=seed)  # fmt: skip
        else:
            mdl = xgb.XGBRegressor(objective="count:poisson", n_estimators=400, learning_rate=0.05, max_depth=7, subsample=0.8,
                                   colsample_bytree=0.8, tree_method="hist", n_jobs=12, random_state=seed)  # fmt: skip
    elif lib == "hgb":  # scikit-learn's histogram boosting: no extra system library, same family of model
        from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

        kw = dict(max_iter=400, learning_rate=0.05, max_leaf_nodes=63, min_samples_leaf=100, random_state=seed)
        mdl = HistGradientBoostingClassifier(**kw) if objective == "binary" else HistGradientBoostingRegressor(loss="poisson", **kw)
    mdl.fit(xtr, ytr)
    out = (lambda x: mdl.predict_proba(x)[:, 1]) if objective == "binary" else mdl.predict
    return np.clip(out(xtr), 0, None), np.clip(out(xte), 0, None)


def scale_and_season(ptr, pte, tr, te, truth_tr, month: bool = True):
    """Scale k so totals match on the training years, then the calendar-month factor."""
    k = truth_tr.truth.sum() / ptr.sum()
    wtr, wte = ptr * k, pte * k
    if month:
        r = truth_tr.groupby("m").truth.sum() / pd.Series(wtr).groupby(tr.m.to_numpy()).sum()
        wte = wte * te.m.map(r).fillna(1.0).to_numpy()
    return wte


def point_model(spec: dict, v, truth, train_years, test_years):
    tr, te = v[v.y.isin(train_years)], v[v.y.isin(test_years)]
    ttr = truth[truth.y.isin(train_years)]
    if spec["lib"] == "bins":
        p = tr.groupby("b")[spec["target"]].mean()
        ptr, pte = tr.b.map(p).to_numpy(), te.b.map(p).fillna(p.mean()).to_numpy()
    else:
        obj = "binary" if spec["target"].startswith("m") else "poisson"
        ptr, pte = fit_predict(spec["lib"], obj, tr[spec["feats"]], tr[spec["target"]], te[spec["feats"]])
    return te[KEYS].assign(w=scale_and_season(ptr, pte, tr, te, ttr, spec.get("month", True)))


def cell_model(spec: dict, c, truth, train_years, test_years):
    tr, te = c[c.y.isin(train_years)].copy(), c[c.y.isin(test_years)].copy()
    if "cell_ratio" in spec["feats"]:  # what this cell usually does, learned from the training years only
        g = tr.groupby(["cy", "cx"])[["modis", "cd"]].sum()
        glob = tr.modis.sum() / tr.cd.sum()
        ratio = ((g.modis + 50 * glob) / (g.cd + 50)).rename("cell_ratio").reset_index()
        clim = tr.groupby(["cy", "cx", "m"]).modis.mean().rename("cell_month_clim").reset_index()
        tr = tr.merge(ratio, on=["cy", "cx"], how="left").merge(clim, on=["cy", "cx", "m"], how="left")
        te = te.merge(ratio, on=["cy", "cx"], how="left").merge(clim, on=["cy", "cx", "m"], how="left")
        tr, te = tr.fillna({"cell_month_clim": 0.0}), te.fillna({"cell_ratio": glob, "cell_month_clim": 0.0})
    ptr, pte = fit_predict(spec["lib"], "poisson", tr[spec["feats"]], tr.modis, te[spec["feats"]])
    ttr = truth[truth.y.isin(train_years)]
    return te[KEYS].assign(w=scale_and_season(ptr, pte, tr, te, ttr, spec.get("month", False)))


POINT = {
    "P0 pipeline method (FRP bins x month)": dict(lib="bins", target="m1"),
    "P1 bins, count-preserving target r=1": dict(lib="bins", target="share1"),
    "P2 bins, count-preserving target r=3": dict(lib="bins", target="share3"),
    "P3 lgbm P(seen), cell features": dict(lib="lgbm", target="m1", feats=POINT_PLUS),
    "P4 lgbm P(seen), + neighbours, days around": dict(lib="lgbm", target="m1", feats=POINT_CTX),
    "P5 lgbm share r=1, cell features": dict(lib="lgbm", target="share1", feats=POINT_PLUS),
    "P6 lgbm share r=1, + neighbours, days around": dict(lib="lgbm", target="share1", feats=POINT_CTX),
    "P7 lgbm share r=3, + neighbours, days around": dict(lib="lgbm", target="share3", feats=POINT_CTX),
    "P8 lgbm share r=3, + place and season": dict(lib="lgbm", target="share3", feats=POINT_GEO),
}
CELL = {
    "C1 lgbm cell-day, same day only": dict(lib="lgbm", feats=CELL_NOW),
    "C2 lgbm cell-day, + previous days": dict(lib="lgbm", feats=CELL_PAST),
    "C3 lgbm cell-day, + next days": dict(lib="lgbm", feats=CELL_ALL),
    "C4 lgbm cell-day, + place and season": dict(lib="lgbm", feats=CELL_GEO),
    "C5 lgbm cell-day, + cell history": dict(lib="lgbm", feats=CELL_TE),
    "C6 as C3 with month factor": dict(lib="lgbm", feats=CELL_ALL, month=True),
}


def blend(a: pd.DataFrame, b: pd.DataFrame, wa: float = 0.5) -> pd.DataFrame:
    return pd.concat([a.assign(w=a.w * wa), b.assign(w=b.w * (1 - wa))])


def report(preds: dict, truth, years, ref_name: str, tag: str) -> pd.DataFrame:
    tabs = {name: table(p, truth, years) for name, p in preds.items()}
    rows = [{"model": name, **scores(d), **(versus(d, tabs[ref_name]) if name != ref_name else {})} for name, d in tabs.items()]
    df = pd.DataFrame(rows)
    df.to_csv(OUT / f"results_{tag}.csv", index=False)
    pd.set_option("display.width", 250, "display.max_colwidth", 60)
    show = df.copy()
    for col in ("bias", "country_year", "country_month", "tile_year", "tile_month", "d_country_month", "d_tile_month"):
        show[col] = (show[col] * 100).round(2)
    print(show.to_string(index=False))
    return df


def run(models: dict, fn, data, truth, folds, tag: str) -> dict:
    """Out-of-fold predictions per model, cached on disk so a crash or a rerun loses nothing."""
    preds = {}
    (OUT / "oof").mkdir(exist_ok=True)
    for name, spec in models.items():
        path = OUT / "oof" / f"{tag}_{name.split()[0]}_{spec['lib']}.parquet"
        if path.exists():
            preds[name] = pd.read_parquet(path)
            continue
        t = time.time()
        parts = [fn(spec, data, truth, tr, te) for tr, te in folds]
        preds[name] = pd.concat(parts).groupby(KEYS).w.sum().reset_index()
        preds[name].to_parquet(path)
        log(f"done in {time.time() - t:5.0f}s: {name}")
    return preds


def main() -> None:
    stage = sys.argv[1] if len(sys.argv) > 1 else "loyo"
    v, c, m, truth = load()
    years = sorted(v.y.unique())
    ref = "P0 pipeline method (FRP bins x month)"
    if stage == "loyo":
        folds = [([y for y in years if y != t], [t]) for t in years]
        preds = run(POINT, point_model, v, truth, folds, "loyo")
        preds.update(run(CELL, cell_model, c, truth, folds, "loyo"))
        best_p = min((k for k in preds if k.startswith("P") and k != ref), key=lambda k: scores(table(preds[k], truth, years))["country_month"])
        best_c = min((k for k in preds if k.startswith("C")), key=lambda k: scores(table(preds[k], truth, years))["country_month"])
        preds[f"B1 blend: P0 + {best_c[:2]}"] = blend(preds[ref], preds[best_c])
        preds[f"B2 blend: {best_p[:2]} + {best_c[:2]}"] = blend(preds[best_p], preds[best_c])
        preds[f"B3 blend: P0 + {best_p[:2]} + {best_c[:2]}"] = pd.concat([preds[k].assign(w=preds[k].w / 3) for k in (ref, best_p, best_c)])
        report(preds, truth, years, ref, "loyo")
    elif stage == "oot":
        tr_years, te_years = [y for y in years if y <= 2018], [y for y in years if y >= 2019]
        folds = [(tr_years, te_years)]
        pm = {ref: POINT[ref], "P6 lgbm share r=1, ctx": POINT["P6 lgbm share r=1, + neighbours, days around"],
              "P7 lgbm share r=3, ctx": POINT["P7 lgbm share r=3, + neighbours, days around"]}  # fmt: skip
        for lib in ("catboost", "xgb"):
            pm[f"P7 {lib} share r=3, ctx"] = dict(lib=lib, target="share3", feats=POINT_CTX)
        preds = run(pm, point_model, v, truth, folds, "oot")
        cm = {f"C3 {lib} cell-day, days around": dict(lib=lib, feats=CELL_ALL) for lib in ("lgbm", "catboost", "xgb")}
        cm.update({f"C5 {lib} cell-day, + cell history": dict(lib=lib, feats=CELL_TE) for lib in ("lgbm", "catboost")})
        preds.update(run(cm, cell_model, c, truth, folds, "oot"))
        c3 = [k for k in preds if k.startswith("C3")]
        preds["B4 mean of C3 lgbm + catboost + xgb"] = pd.concat([preds[k].assign(w=preds[k].w / len(c3)) for k in c3])
        preds["B5 blend: P0 + B4"] = blend(preds[ref], preds["B4 mean of C3 lgbm + catboost + xgb"])
        report(preds, truth, te_years, ref, "oot")
    elif stage == "twin":
        twin(v, m, truth)


def twin(v, m, truth) -> None:
    """Two VIIRS instruments 50 minutes apart: does averaging them beat using one?"""
    n20 = pd.read_parquet(OUT / "n20.parquet")
    n20["has_day"] = (n20.n_day > 0).astype(int)
    n20["b"] = np.digitize(n20.frp, FRP_EDGES) + 10 * n20.has_day
    lo = pd.Timestamp("2018-04-01")
    test_years = [2018, 2019, 2020, 2021]
    parts = {"S-NPP alone": [], "NOAA-20 alone": [], "mean of both": []}
    for t in test_years:
        tr = v[v.y != t]
        ttr = truth[truth.y != t]
        p = tr.groupby("b").m1.mean()
        k = ttr.truth.sum() / tr.b.map(p).sum()
        r = ttr.groupby("m").truth.sum() / (tr.b.map(p) * k).groupby(tr.m).sum()
        w = lambda d: d.b.map(p).fillna(p.mean()) * k * d.m.map(r).fillna(1.0)  # noqa: E731
        s = v[(v.y == t) & (pd.to_datetime(v.local_date) >= lo)]
        n = n20[(n20.y == t) & (pd.to_datetime(n20.local_date) >= lo)]
        other = (v.y != t) & (pd.to_datetime(v.local_date) >= lo)
        n_other = (n20.y != t) & (pd.to_datetime(n20.local_date) >= lo)
        c = w(v[other]).sum() / w(n20[n_other]).sum()  # NOAA-20 -> S-NPP factor from the other years
        ps, pn = s[KEYS].assign(w=w(s)), n[KEYS].assign(w=w(n) * c)
        parts["S-NPP alone"].append(ps)
        parts["NOAA-20 alone"].append(pn)
        parts["mean of both"].append(blend(ps, pn))
    preds = {k: pd.concat(p) for k, p in parts.items()}
    tr_truth = truth[(truth.y > 2018) | ((truth.y == 2018) & (truth.m >= 4))]
    report(preds, tr_truth, test_years, "NOAA-20 alone", "twin")


if __name__ == "__main__":
    main()
