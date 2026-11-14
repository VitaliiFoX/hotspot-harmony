"""Quick look at the harmonized record: burning calendar + before/after harmonization.

Usage:  uv run python research/cellday_prototype/preview.py --data data/processed
"""
import argparse
import json
from pathlib import Path

import duckdb
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap, PowerNorm

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]  # one hue, light -> dark
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed", type=Path)
    args = ap.parse_args()
    meta = json.loads((args.data / "calibration.json").read_text())
    mo = pd.read_csv(args.data / "monthly_country.csv")
    yr = duckdb.sql(f"""
        select year(ldate) y,
               count(*) filter (stream = 'MODIS') modis,
               count(*) filter (stream = (case when year(ldate) < 2022 then 'SNPP' else 'N20' end)) viirs_raw,
               sum(weight) filter (stream = (case when year(ldate) < 2022 then 'SNPP' else 'N20' end)) viirs_eq
        from '{args.data}/celldays.parquet' where ldate >= '2001-01-01' group by 1 order by 1""").df()
    yr.loc[yr.y < 2013, ["viirs_raw", "viirs_eq"]] = np.nan  # S-NPP starts late Jan 2012: first full year is 2013

    plt.rcParams.update({"font.size": 10, "text.color": INK, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
                         "axes.edgecolor": GRID, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE})
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(15, 8.2), gridspec_kw={"width_ratios": [1.05, 1], "wspace": 0.32})

    # ---- left: the calendar ----------------------------------------------------------------
    grid = mo.pivot(index="year", columns="month", values="harmonized").reindex(columns=range(1, 13))
    years = grid.index.to_numpy()
    mesh = ax.pcolormesh(np.arange(13), np.arange(len(years) + 1), np.ma.masked_invalid(grid.to_numpy()),
                         cmap=LinearSegmentedColormap.from_list("seq", SEQ), norm=PowerNorm(0.5, vmin=0),
                         edgecolors=SURFACE, linewidth=2)
    ax.invert_yaxis()
    ax.set_xticks(np.arange(12) + 0.5, MONTHS)
    ax.set_yticks(np.arange(len(years)) + 0.5, years)
    ax.xaxis.tick_top()
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    for label, y0, y1 in (("Terra only,\nscaled up", 2000, 2002), ("Terra + Aqua\nMODIS\n(reference)", 2003, 2021),
                          ("VIIRS NOAA-20,\nharmonized", 2022, int(years.max()))):
        a, b = y0 - years[0], y1 - years[0] + 1
        ax.plot([12.25, 12.25], [a + 0.12, b - 0.12], color=INK2, lw=1.2, clip_on=False)
        ax.text(12.45, (a + b) / 2, label, va="center", ha="left", fontsize=8.5, color=INK2)
    cb = fig.colorbar(mesh, ax=ax, orientation="horizontal", pad=0.03, fraction=0.035, aspect=40)
    cb.outline.set_visible(False)
    cb.set_label("MODIS-equivalent fire cell-days per month (square-root colour scale)")
    ax.set_title(f"Burning activity calendar: {meta['country']}, harmonized MODIS + VIIRS", loc="left", fontsize=12.5, fontweight="bold", pad=26)

    # ---- right: before / after harmonization ------------------------------------------------
    series = (("viirs_raw", ORANGE, "VIIRS as delivered"), ("modis", BLUE, "MODIS (Terra + Aqua)"), ("viirs_eq", AQUA, "VIIRS harmonized"))
    for col, color, name in series:
        d = yr.dropna(subset=[col])
        bx.plot(d.y, d[col], color=color, lw=2, marker="o", ms=4.5, mec=SURFACE, mew=1, label=name, zorder=3)
    last = yr.iloc[-1]
    bx.annotate("VIIRS as delivered", (last.y, last.viirs_raw), xytext=(8, 0), textcoords="offset points", va="center", color=INK, fontsize=9)
    bx.annotate("MODIS", (last.y, last.modis), xytext=(8, 7), textcoords="offset points", va="center", color=INK, fontsize=9)
    bx.annotate("VIIRS harmonized", (last.y, last.viirs_eq), xytext=(8, -7), textcoords="offset points", va="center", color=INK, fontsize=9)
    bx.set_xlim(2000.5, 2030.5)
    bx.set_xticks(range(2001, 2026, 4))
    bx.set_ylim(0, None)
    bx.yaxis.set_major_formatter(lambda v, _: f"{v / 1000:.0f}k" if v else "0")
    bx.grid(axis="y", color=GRID, lw=0.8)
    bx.set_axisbelow(True)
    bx.tick_params(length=0)
    for s in ("top", "right", "left"):
        bx.spines[s].set_visible(False)
    bx.set_ylabel("fire cell-days per year (~1 km cell x day)")
    bx.legend(loc="upper left", frameon=False, ncols=3, bbox_to_anchor=(-0.01, 1.07), handlelength=1.6, columnspacing=1.4)
    v = meta["validation"]["viirs_snpp_to_modis_leave_one_year_out"]
    bx.set_title("Same fires, two sensors: before and after harmonization", loc="left", fontsize=12.5, fontweight="bold", pad=38)
    bx.text(0, -0.1, f"Leave-one-year-out error of harmonized VIIRS vs MODIS, 2012-2021: "
                     f"{v['wape_country_year']:.0%} per year, {v['wape_country_month']:.0%} per month. "
                     "VIIRS = S-NPP to 2021, NOAA-20 after.\nSource: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), vegetation fires only.",
            transform=bx.transAxes, fontsize=8.5, color=INK2, va="top")
    out = args.data / "preview_calendar.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    print(out)


if __name__ == "__main__":
    main()
