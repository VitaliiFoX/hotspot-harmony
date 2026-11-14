"""Step 6 - measure how well the harmonization works and write the evidence.

Every number comes from data the model did not see:
  * leave-one-year-out: each overlap year is predicted from VIIRS by a model fitted on the other years
    and compared with what MODIS actually reported;
  * NOAA-20 is checked against MODIS although it was never used to fit the weights;
  * the Terra-only scaling is checked the same way on 2003-2011;
  * the sensor jump check compares the years before and after the raw record switches sensors (2012).

WAPE = sum|prediction - truth| / sum(truth): 0.08 means a typical miss of 8%.

Output:
    data/agg/harmonization_report.json   read by the API and shown in the app
    docs/sensor_jump_before_after.png           yearly totals, raw record vs harmonized record

Usage:  uv run python -m pipeline.validate
"""

import argparse
import datetime as dt
import json
from pathlib import Path

import duckdb
import matplotlib
import numpy as np
import pandas as pd

from pipeline import harmonize as hz
from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, ROOT, load_config

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

KEYS = ["y", "m", "tx", "ty"]  # year, month, 1-degree tile
SIZE_EDGES = [0, 10, 30, 100, 300, 1000, 3000, np.inf]  # harmonized cell-days in an area-month
UNIT = "MODIS-equivalent fire cell-days"
WAPE_COLUMNS = ["wape_country_year", "wape_country_month", "wape_tile_year", "wape_tile_month"]


def wape(g: pd.DataFrame) -> float:
    return round(float((g.pred - g.truth).abs().sum() / g.truth.sum()), 4)


def compare(pred: pd.DataFrame, truth: pd.DataFrame) -> pd.DataFrame:
    """Predicted weights and true MODIS cell-days side by side per year, month and 1-degree tile."""
    p = pred.groupby(KEYS).w.sum().rename("pred").reset_index()
    t = truth.groupby(KEYS).size().rename("truth").reset_index()
    return p.merge(t, on=KEYS, how="outer").fillna(0.0)


def scores(d: pd.DataFrame) -> dict:
    return {
        "bias": round(float(d.pred.sum() / d.truth.sum() - 1), 4),
        "wape_country_year": wape(d.groupby("y")[["pred", "truth"]].sum()),
        "wape_country_month": wape(d.groupby(["y", "m"])[["pred", "truth"]].sum()),
        "wape_tile_year": wape(d.groupby(["y", "tx", "ty"])[["pred", "truth"]].sum()),
        "wape_tile_month": wape(d),
        "n_months": int(d.groupby(["y", "m"]).ngroups),
    }


def leave_one_year_out(
    viirs: pd.DataFrame, modis: pd.DataFrame, weights: str = "boosted", also: pd.DataFrame | None = None
) -> pd.DataFrame | tuple[pd.DataFrame, pd.DataFrame]:
    """Weights for every year from a model fitted on the other years.

    `also` is a second set of cell-days (e.g. with sensor gap days kept) to weigh with the same models,
    so that a second comparison costs no second round of fitting.
    """
    folds, extra = [], []
    for year in sorted(viirs.y.unique()):
        par = hz.fit_viirs(viirs[viirs.y != year], modis[modis.y != year], weights)
        test = viirs[viirs.y == year]
        folds.append(test.assign(w=hz.viirs_weights(par, test)))
        if also is not None:
            test = also[also.y == year]
            extra.append(test.assign(w=hz.viirs_weights(par, test)))
    return (pd.concat(folds), pd.concat(extra)) if also is not None else pd.concat(folds)


def interval_by_size(d: pd.DataFrame) -> list[dict]:
    """90% range of truth / prediction, by how large the predicted value is (small areas are noisier)."""
    rows = []
    area_month = pd.concat([d, d.groupby(["y", "m"])[["pred", "truth"]].sum().reset_index()])
    area_month = area_month[area_month.pred > 0]
    ratio = area_month.truth / area_month.pred
    for lo, hi in zip(SIZE_EDGES[:-1], SIZE_EDGES[1:], strict=True):
        r = ratio[(area_month.pred > lo) & (area_month.pred <= hi)]
        if len(r) >= 20:
            rows.append({
                "from": lo, "to": None if np.isinf(hi) else hi, "n": int(len(r)),
                "lo": round(float(r.quantile(0.05)), 3), "hi": round(float(r.quantile(0.95)), 3),
            })  # fmt: skip
    return rows


def sensor_jump(df: pd.DataFrame) -> dict | None:
    """Mean yearly total in the five years before and after 2012, raw record vs harmonized record."""
    out = {}
    for name, mask, value in (("raw", df.in_raw, 1.0), ("harmonized", df.in_series, df.weight)):
        yearly = (df.assign(v=value)[mask]).groupby("y").v.sum()
        before, after = yearly.reindex(range(2007, 2012)).mean(), yearly.reindex(range(2012, 2017)).mean()
        if not (before > 0 and after > 0):
            return None
        out[name] = {"before": round(float(before), 1), "after": round(float(after), 1),
                     "jump_ratio": round(float(after / before), 3)}  # fmt: skip
    return out


def validate_country(df: pd.DataFrame, par: dict, weights: str = "boosted") -> dict:
    s, d = df.stream, df.local_date
    # a day the sensor did not observe says nothing about the method: it is left out of fit and comparison,
    # and the same check on every day is reported next to it
    fit_all = d.between(*hz.FIT)
    fit = fit_all & ~d.isin(hz.gap_days(df, "viirs_snpp"))
    viirs, modis = df[fit & (s == "viirs_snpp")], df[fit & (s == "modis")]
    viirs_all, modis_all = df[fit_all & (s == "viirs_snpp")], df[fit_all & (s == "modis")]
    held_out, held_out_all = leave_one_year_out(viirs, modis, weights, also=viirs_all)
    loyo, with_gaps = compare(held_out, modis), compare(held_out_all, modis_all)
    out = {
        "viirs_to_modis_leave_one_year_out": scores(loyo),
        "viirs_to_modis_sensor_gap_days_included": scores(with_gaps),
        "baseline_raw_viirs": scores(compare(viirs.assign(w=1.0), modis)),
        "baseline_single_factor": scores(compare(viirs.assign(w=len(modis) / len(viirs)), modis)),
    }
    if weights == "boosted":  # the same check with the plain table by fire power, to show what the model adds
        out["weight_table_instead_of_model"] = scores(compare(leave_one_year_out(viirs, modis, "bins"), modis))
    chk = d.between(hz.N20_START, hz.FIT[1]) & ~d.isin(hz.gap_days(df, "viirs_noaa20"))
    if (chk & (s == "viirs_noaa20")).any():  # NOAA-20 never took part in fitting p, k, r
        n20 = df[chk & (s == "viirs_noaa20")]
        out["noaa20_independent"] = scores(compare(n20.assign(w=n20.weight), df[chk & (s == "modis")]))
    tf = d.between(*hz.TERRA_FIT)
    terra, both = df[tf & (s == "modis_terra")], df[tf & (s == "modis")]
    if len(terra):
        folds = []
        for year in sorted(terra.y.unique()):
            t_m = hz.fit_terra(terra[terra.y != year], both[both.y != year])
            test = terra[terra.y == year]
            folds.append(test.assign(w=test.m.map(t_m).fillna(1.0)))
        out["terra_only_leave_one_year_out"] = scores(compare(pd.concat(folds), both))

    # MODIS orbits drift after 2021 (Terra earlier, Aqua later): compare with VIIRS-equivalent per year
    since = df[d >= hz.FIT[0]]
    n_yr = since.groupby(["y", "stream"]).size().unstack()
    w_yr = since.groupby(["y", "stream"]).weight.sum().unstack()
    if "viirs_noaa20" in w_yr:
        veq = w_yr.viirs_snpp.where(w_yr.index < 2022, w_yr.viirs_noaa20)
    else:
        veq = w_yr.viirs_snpp
    drift = [
        {"year": int(y), "modis_over_viirs_equiv": round(float(n_yr.modis[y] / veq[y]), 3),
         "terra_only_over_viirs_equiv": round(float(n_yr.modis_terra[y] / veq[y]), 3)}
        for y in n_yr.index if veq.get(y, 0) > 0 and n_yr.modis.get(y, 0) > 0
    ]  # fmt: skip
    return {
        "validation": out,
        "sensor_jump": sensor_jump(df),
        "interval_by_size": interval_by_size(loyo),
        "modis_orbit_drift": drift,
    }


def plot_sensor_jump(df: pd.DataFrame, country: str, report: dict, out: Path) -> None:
    surface, ink, ink2, grid = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
    raw = df[df.in_raw].groupby("y").size()
    harm = df[df.in_series].groupby("y").weight.sum()
    years = [y for y in harm.index if y > 2000]  # 2000 has two months only
    plt.rcParams.update({"font.size": 10, "text.color": ink, "axes.labelcolor": ink2, "xtick.color": ink2,
                         "ytick.color": ink2, "axes.edgecolor": grid, "figure.facecolor": surface,
                         "axes.facecolor": surface, "savefig.facecolor": surface})  # fmt: skip
    fig, ax = plt.subplots(figsize=(10, 5.2))
    ax.axvline(2011.5, color=ink2, lw=1, ls=(0, (4, 3)))
    ax.text(2011.7, 0.97, "VIIRS data start (2012)", transform=ax.get_xaxis_transform(), va="top", fontsize=9,
            color=ink2)  # fmt: skip
    for series, color, name in ((raw, "#eb6834", "Raw record: MODIS, then VIIRS as delivered"),
                                (harm, "#2a78d6", "Harmonized record")):  # fmt: skip
        ax.plot(years, series.reindex(years), color=color, lw=2, marker="o", ms=4.5, mec=surface, mew=1, label=name)
    ax.annotate("raw", (years[-1], raw.reindex(years).iloc[-1]), xytext=(8, 0), textcoords="offset points",
                va="center", fontsize=9)  # fmt: skip
    ax.annotate("harmonized", (years[-1], harm.reindex(years).iloc[-1]), xytext=(8, 0), textcoords="offset points",
                va="center", fontsize=9)  # fmt: skip
    ax.set_xlim(years[0] - 0.5, years[-1] + 3.2)
    ax.set_ylim(0, None)
    ax.yaxis.set_major_formatter(lambda v, _: f"{v / 1000:.0f}k" if v else "0")
    ax.grid(axis="y", color=grid, lw=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.set_ylabel("fire cell-days per year")
    ax.legend(loc="upper left", frameon=False, ncols=2, bbox_to_anchor=(-0.01, 1.09), handlelength=1.6)
    ax.set_title(f"{country}: the sensor jump is gone from the harmonized record", loc="left", fontsize=12.5,
                 fontweight="bold", pad=34)  # fmt: skip
    sm = report["sensor_jump"]
    note = "Source: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), vegetation fires only."
    if sm:
        note = (f"Mean of 2012-2016 over mean of 2007-2011: {sm['raw']['jump_ratio']:.2f}x raw, "
                f"{sm['harmonized']['jump_ratio']:.2f}x harmonized.\n") + note  # fmt: skip
    ax.text(0, -0.13, note, transform=ax.transAxes, fontsize=8.5, color=ink2, va="top")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)


def weights_line(entry: dict) -> str:
    """Which detection weight this country got, and the held-out errors the choice was made on."""
    used = "the boosted model" if entry["weights"] == "boosted" else "the table by fire power"
    tried = entry.get("weights_held_out_month_error") or {}
    if not tried:
        return f"Detection weight: {used}."
    return (
        f"Detection weight: {used}. Chosen on years held out three at a time, country x month error: "
        f"table {tried['bins']:.1%}, boosted model {tried['boosted']:.1%}; the model is used only when it wins "
        f"by more than {hz.WEIGHTS_MARGIN:.1%}."
    )


def write_markdown(report: dict, out: Path) -> None:
    """docs/VALIDATION.md: the report as tables, generated so that no number is ever typed by hand."""
    rows = [
        ("viirs_to_modis_leave_one_year_out", "Harmonized VIIRS vs MODIS, each year predicted without seeing it"),
        ("viirs_to_modis_sensor_gap_days_included", "The same with sensor gap days counted against the method"),
        ("weight_table_instead_of_model", "The same with a table by fire power instead of the boosted model"),
        ("baseline_single_factor", "Baseline: one scaling factor for the whole country"),
        ("baseline_raw_viirs", "Baseline: VIIRS cell-days as delivered"),
        ("noaa20_independent", "NOAA-20 vs MODIS (NOAA-20 was not used to fit the weights)"),
        ("terra_only_leave_one_year_out", "Terra-only months scaled to Terra + Aqua, leave-one-year-out"),
    ]
    lines = [
        "# Validation",
        "",
        f"Generated by `pipeline.validate` on {report['generated_at_utc']}. Do not edit by hand: run `make validate`.",
        "",
        f"Unit: {report['unit']}. Error metric: {report['metric']}.",
        f"Weights are fitted on {report['fit_period'][0]} .. {report['fit_period'][1]}.",
    ]
    for country, e in report["countries"].items():
        lines += ["", f"## {country}", ""]
        if "validation" not in e:
            lines += [e.get("note", "Not validated."), ""]
            continue
        lines += [
            "| Check | Bias | Country x year | Country x month | 1-degree tile x year | 1-degree tile x month |",
            "|---|---|---|---|---|---|",
        ]
        for key, label in rows:
            v = e["validation"].get(key)
            if v:
                cells = [f"{v['bias']:+.1%}"] + [f"{v[c]:.1%}" for c in WAPE_COLUMNS]
                lines.append(f"| {label} | " + " | ".join(cells) + " |")
        if e.get("sensor_jump"):
            sm = e["sensor_jump"]
            lines += [
                "",
                "Sensor jump check, mean yearly total 2012-2016 over 2007-2011:",
                f"raw record {sm['raw']['jump_ratio']:.2f}x, harmonized {sm['harmonized']['jump_ratio']:.2f}x.",
                "",
                "![Yearly totals, raw record vs harmonized record](sensor_jump_before_after.png)",
            ]
        lines += [
            "",
            "Detection curve: share of VIIRS fire cell-days that MODIS also reported nearby the same day.",
            "",
            "| Fire power of the cell-day (MW) | Night only | With a daytime detection |",
            "|---|---|---|",
        ]
        curve = {(c["has_day"], c["frp_from_mw"]): c for c in e["detection_curve"]}
        for lo in sorted({frp for _, frp in curve}):
            hi = next(c["frp_to_mw"] for (_, frp), c in curve.items() if frp == lo)
            night, day = (f"{curve[(d, lo)]['p']:.0%}" if (d, lo) in curve else "-" for d in (0, 1))
            lines.append(f"| {lo} - {hi if hi is not None else 'more'} | {night} | {day} |")
        drift = ", ".join(
            f"{d['year']}: {d['modis_over_viirs_equiv']:.2f} ({d['terra_only_over_viirs_equiv']:.2f})"
            for d in e["modis_orbit_drift"]
        )
        lines += [
            "",
            weights_line(e),
            f"Scale k = {e['k']}. NOAA-20 to S-NPP factor = {e['n20_to_snpp']}.",
            f"Months left out of that factor as sensor gaps: {', '.join(e['sensor_gap_months']) or 'none'}.",
            "",
            "Sensor gap days (the sensor reported under "
            f"{hz.GAP_MAX_RATIO} fire cell-days per MODIS one while MODIS had at least {hz.GAP_MIN_MODIS}):",
            *(f"- {stream}: {', '.join(days) or 'none'}" for stream, days in e["sensor_gap_days"].items()),
            "",
            "MODIS against the VIIRS-equivalent of the same year (1.0 = the sensors agree; Terra alone in brackets):",
            "",
            drift,
        ]
    out.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--docs", type=Path, default=ROOT / "docs")
    ap.add_argument("--weights", choices=["auto", "boosted", "bins"], default="auto", help="as in pipeline.harmonize")
    args = ap.parse_args()

    cfg = load_config(args.config)
    agg = args.data / "agg"
    results = hz.harmonize_all(duckdb.connect(), agg / "cell_day.parquet", cfg.countries(), args.weights)
    report = {
        "generated_at_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "unit": UNIT,
        "metric": "WAPE = sum|prediction - truth| / sum(truth), on years the model did not see",
        "fit_period": list(hz.FIT),
        "record": hz.RECORD,
        "countries": {},
    }
    plotted = False
    for country, (df, par, source) in results.items():
        entry = {"calibration": source, **hz.params_to_json(par, source)}
        if source == "own":
            entry.update(validate_country(df, par, par["weights"]))
            if not plotted and entry["sensor_jump"]:
                plot_sensor_jump(df, country, entry, args.docs / "sensor_jump_before_after.png")
                plotted = True
            v = entry["validation"]["viirs_to_modis_leave_one_year_out"]
            print(f"validate: {country:<12} held-out error {v['wape_country_year']:.1%} per year, "
                  f"{v['wape_country_month']:.1%} per month (VIIRS as delivered: "
                  f"{entry['validation']['baseline_raw_viirs']['wape_country_month']:.0%}); "
                  f"sensor jump {entry['sensor_jump']['raw']['jump_ratio']:.2f}x -> "
                  f"{entry['sensor_jump']['harmonized']['jump_ratio']:.2f}x")  # fmt: skip
        else:
            entry["note"] = (
                "Too little MODIS/VIIRS overlap downloaded for this country: calibration borrowed, not validated here."
            )
            print(f"validate: {country:<12} borrowed calibration, not validated")
        report["countries"][country] = entry
    (agg / "harmonization_report.json").write_text(json.dumps(report, indent=2))
    args.docs.mkdir(parents=True, exist_ok=True)
    write_markdown(report, args.docs / "VALIDATION.md")
    print(f"validate: report -> {agg / 'harmonization_report.json'}, tables -> {args.docs / 'VALIDATION.md'}")
    if plotted:
        print(f"validate: figure -> {args.docs / 'sensor_jump_before_after.png'}")


if __name__ == "__main__":
    main()
