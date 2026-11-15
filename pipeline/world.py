"""Harmonize and validate every country of the world, one country at a time.

`pipeline.harmonize` and `pipeline.validate` hold every country in memory at once; two countries already take
6-7 GB, so the world does not fit. This step loads, fits, checks and writes one country at a time, with the
plain table by fire power (`bins`), the method world mode uses: scoring the five methods per country is
affordable for a few regions, not for every country on Earth.

Calibration unit. A country is one calibration unit unless squares earn their place: every country is also
cut into squares of SQUARE_DEG degrees, each square with enough MODIS/VIIRS overlap of its own gets its own
calibration, and the other squares are calibrated together. Both ways predict every year of the fit period
from the other years; the squares are used only when they lower the error per 1-degree tile and month by more
than UNIT_MARGIN and do not raise the error per country and month by more than that. Sensor gap days stay those
of the whole country: an outage is the same day everywhere in it.

The pilot countries (the regions of config/regions.yaml) are not refitted. Their rows and report entries are
copied from <pilot>/agg/, where `make harmonize` and `make validate NESTED=1` chose their method on held-out years,
so the figures quoted in the README stay those of the pilot run.

A country with too little MODIS/VIIRS overlap of its own borrows a pooled calibration, fitted on the smallest
countries that do have one, taken in order of size until POOL_CELLDAYS cell-days; it is not validated.

Input:  <data>/agg/cell_day.parquet, sorted by country, and cell_month.parquet (pipeline.aggregate --config
        config/world.yaml --data <data>)
Output: <data>/agg/harmonized.parquet, calibration.json, harmonization_report.json; docs/VALIDATION_WORLD.md

Usage:  uv run python -m pipeline.world --data data/world [--pilot data]
"""

import argparse
import datetime as dt
import json
import shutil
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from pipeline import harmonize as hz
from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, ROOT, load_config
from pipeline.validate import (
    TABLE_ONLY,
    UNIT,
    WAPE_COLUMNS,
    compare,
    comparisons,
    interval_by_size,
    jump_of,
    leave_one_year_out,
    scores,
    yearly_records,
)

POOL_CELLDAYS = 10_000_000  # the pooled calibration is fitted on the smallest countries up to this many cell-days
SQUARE_DEG = 10  # side of the squares a country may be calibrated by
UNIT_MARGIN = hz.METHOD_MARGIN  # squares must beat one calibration per country by this much tile x month error
REST = 10**6  # unit id of the squares that are calibrated together
WORLD_CONFIG = ROOT / "config" / "world.yaml"
STREAMS = ("modis", "modis_terra", "viirs_snpp", "viirs_noaa20")
SQUARE_SQL = f"cast(floor(cd.lat / {SQUARE_DEG}) as integer) * 1000 + cast(floor(cd.lon / {SQUARE_DEG}) as integer)"
# what the table method reads, in small types: a large country then takes a third of the memory
SLIM = (
    "cd.stream::stream_t as stream, cd.local_date, cd.lat, cd.lon, cast(cd.frp as float) as frp, "
    "cast(cd.frp_max as float) as frp_max, cast(cd.has_day as tinyint) as has_day, "
    "cast(cd.cell_id as integer) as cell_id"
)


def square_of(lat: pd.Series, lon: pd.Series) -> pd.Series:
    """Id of the SQUARE_DEG square of each point. Mirrors SQUARE_SQL."""
    return np.floor(lat / SQUARE_DEG).astype(int) * 1000 + np.floor(lon / SQUARE_DEG).astype(int)


def assign_units(viirs: pd.Series, modis: pd.Series, least: int = hz.MIN_FIT_CELLDAYS) -> tuple[dict[int, int], int]:
    """square -> calibration unit, and the unit of a square that has no cell-days in the fit period.

    `viirs` and `modis` count the fit period's cell-days per square. A square with at least `least` VIIRS and
    `least / 2` MODIS cell-days is a unit of its own. The other squares form the unit REST; while REST is short
    of that itself, the smallest unit joins it. One unit left means the country is calibrated whole.
    """
    squares = sorted(set(viirs.index) | set(modis.index))
    v = {sq: int(viirs.get(sq, 0)) for sq in squares}
    m = {sq: int(modis.get(sq, 0)) for sq in squares}
    enough = lambda group: sum(v[q] for q in group) >= least and sum(m[q] for q in group) >= least / 2  # noqa: E731
    own = sorted((sq for sq in squares if enough([sq])), key=lambda sq: (v[sq], sq))  # smallest first
    rest = [sq for sq in squares if sq not in own]
    while rest and own and not enough(rest):
        rest.append(own.pop(0))
    unit = {sq: sq for sq in own} | dict.fromkeys(rest, REST)
    return unit, (REST if rest else own[-1] if own else REST)


def country_sizes(con: duckdb.DuckDBPyConnection, cell_day: Path) -> pd.DataFrame:
    """country, n (all cell-days), n_fit (S-NPP cell-days of the fit period), smallest first."""
    return con.execute(f"""
        select country, count(*) as n,
               count(*) filter (where stream = 'viirs_snpp'
                                  and local_date between '{hz.FIT[0]}' and '{hz.FIT[1]}') as n_fit
        from read_parquet('{cell_day.as_posix()}') group by country order by n, country
    """).df()


def pool_countries(sizes: pd.DataFrame, budget: int = POOL_CELLDAYS) -> list[str]:
    """The smallest countries with enough overlap of their own, in order of size, until `budget` cell-days."""
    pool, total = [], 0
    for row in sizes[sizes.n_fit >= hz.MIN_FIT_CELLDAYS].itertuples():
        if total >= budget:
            break
        pool.append(row.country)
        total += row.n
    return pool


def load_slim(con: duckdb.DuckDBPyConnection, country: str, where: str = "true") -> pd.DataFrame:
    """Cell-days of the country in `hz.cell_day_tables` (or the part `where` selects), slim columns."""
    f = hz.fetch_cell_days(con, where, SLIM)
    f["country"] = pd.Categorical([country] * len(f))
    return f


def country_gaps(con: duckdb.DuckDBPyConnection) -> dict[str, pd.DatetimeIndex]:
    """Sensor gap days of the country in `hz.cell_day_tables`, from its daily counts alone."""
    days = con.execute("select cd.stream::stream_t as stream, cd.local_date from cd").df()
    days["local_date"] = pd.to_datetime(days.local_date)
    return {stream: hz.gap_days(days, stream) for stream in ("viirs_snpp", "viirs_noaa20")}


def choose_units(con: duckdb.DuckDBPyConnection, gaps: dict[str, pd.DatetimeIndex]) -> tuple[dict | None, dict]:
    """How to calibrate the country in `hz.cell_day_tables`: (square -> unit and the default unit, or None for the
    country whole), and what the choice was based on. An empty choice means too little overlap for any fit."""
    fit = hz.fetch_cell_days(
        con, f"cd.stream in ('viirs_snpp', 'modis') and cd.local_date between '{hz.FIT[0]}' and '{hz.FIT[1]}'", SLIM
    )
    fit = fit[~fit.local_date.isin(gaps["viirs_snpp"])]
    viirs, modis = fit[fit.stream == "viirs_snpp"], fit[fit.stream == "modis"]
    if len(viirs) < hz.MIN_FIT_CELLDAYS or len(modis) < hz.MIN_FIT_CELLDAYS / 2:
        return None, {}
    whole = scores(compare(leave_one_year_out(viirs, modis, TABLE_ONLY)[0], modis))
    choice = {"country": {c: whole[c] for c in WAPE_COLUMNS}, "squares": None, "units": 1, "used": "country"}
    sq_v, sq_m = square_of(viirs.lat, viirs.lon), square_of(modis.lat, modis.lon)
    unit, default = assign_units(sq_v.value_counts(), sq_m.value_counts())
    units = sorted(set(unit.values()))
    if len(units) < 2:
        return None, choice
    uv, um = sq_v.map(unit), sq_m.map(unit)
    held = pd.concat([leave_one_year_out(viirs[uv == u], modis[um == u], TABLE_ONLY)[0] for u in units])
    split = scores(compare(held, modis))
    choice |= {"squares": {c: split[c] for c in WAPE_COLUMNS}, "units": len(units)}
    better = split["wape_tile_month"] < whole["wape_tile_month"] - UNIT_MARGIN
    no_worse = split["wape_country_month"] <= whole["wape_country_month"] + UNIT_MARGIN
    if not (better and no_worse):
        return None, choice
    choice["used"] = "squares"
    return {"unit": unit, "default": default}, choice


def unit_filters(units: dict | None) -> dict[str, str]:
    """name -> SQL condition on `cd` for each calibration unit of a country; one entry when it is calibrated whole."""
    if units is None:
        return {"country": "true"}
    by_unit: dict[int, list[int]] = {}
    for sq, u in units["unit"].items():
        by_unit.setdefault(u, []).append(sq)
    out = {}
    for u, squares in sorted(by_unit.items()):
        if u == units["default"]:  # also every square that has no cell-days in the fit period
            others = ", ".join(str(q) for v, qs in by_unit.items() if v != u for q in qs)
            out[f"unit_{u}"] = f"{SQUARE_SQL} not in ({others})" if others else "true"
        else:
            out[f"unit_{u}"] = f"{SQUARE_SQL} in ({', '.join(str(q) for q in squares)})"
    return out


def harmonize_country(
    con: duckdb.DuckDBPyConnection, cell_day: Path, country: str, pooled: dict | None, cell_deg: float
) -> tuple[pd.DataFrame, dict, dict] | None:
    """The record of one country, its report entry and its fitted parameters. None when nothing can calibrate it."""
    hz.cell_day_tables(con, cell_day, country)
    gaps = country_gaps(con)
    units, choice = choose_units(con, gaps)
    source = "own" if choice else "pooled"
    if source == "pooled" and pooled is None:
        return None
    records, tables, yearly, params = [], {}, None, {}
    for name, where in unit_filters(units).items():
        f = load_slim(con, country, where)
        if f.empty:
            continue
        par = hz.calibrate([f], "bins", gaps=gaps) if source == "own" else pooled
        if par is None:  # cannot happen for a unit of assign_units; a safeguard, not a path
            raise RuntimeError(f"{country} {name}: unit without enough overlap")
        par = {**par, "_context": {}}
        if par["n20_to_snpp"] is None and pooled is not None:
            par["n20_to_snpp"] = pooled["n20_to_snpp"]
        df = hz.apply(f, par, gaps["viirs_noaa20"])
        records.append(hz.record_table(df, par, cell_deg))
        totals = yearly_records(df)
        yearly = totals if yearly is None else yearly.add(totals, fill_value=0)
        params[name] = hz.params_to_json({**par, "gap_days": gaps}, source)
        if source == "own":
            for check, table in comparisons(df, par, gaps=gaps)[0].items():
                tables.setdefault(check, []).append(table)
        del f, df
    whole = len(params) == 1
    first = next(iter(params.values()))
    entry = {"calibration": source, **(first if whole else {
        "source": source, "fit_period": list(hz.FIT), "method": "bins",
        "fit_viirs_celldays": sum(p["fit_viirs_celldays"] for p in params.values()),
        "sensor_gap_days": first["sensor_gap_days"],
    })}  # fmt: skip
    entry["calibration_unit"] = {"square_deg": SQUARE_DEG, "chosen_on_all_years": True, **choice} if choice else None
    if source == "own":
        stacked = {check: pd.concat(parts) for check, parts in tables.items()}
        raw = stacked["baseline_raw_viirs"]  # one factor for the whole country, also when it is fitted in parts
        stacked["baseline_single_factor"] = raw.assign(pred=raw.pred * raw.truth.sum() / raw.pred.sum())
        entry |= {
            "validation": {check: scores(table) for check, table in stacked.items()},
            "method_chosen_per_held_out_year": False,
            "sensor_jump": jump_of(yearly),
            "interval_by_size": interval_by_size(stacked["viirs_to_modis_leave_one_year_out"]),
        }
    else:
        entry["note"] = "Too little MODIS/VIIRS overlap for a calibration of its own: borrowed, not validated."
    return pd.concat(records, ignore_index=True), entry, (first if whole else {"units": params})


def run(data: Path, pilot: Path, pilots: list[str], cell_deg: float, docs: Path, only: list[str] | None = None) -> dict:
    """`only`: harmonize just these countries (for a trial run); the pilots are still copied."""
    con = duckdb.connect()
    con.execute("create type stream_t as enum (" + ", ".join(f"'{s}'" for s in STREAMS) + ")")
    agg = data / "agg"
    cell_day = agg / "cell_day.parquet"
    parts = agg / "harmonized_parts"
    shutil.rmtree(parts, ignore_errors=True)
    parts.mkdir(parents=True)

    sizes = country_sizes(con, cell_day)
    pool = pool_countries(sizes)
    frames = []
    for c in pool:
        hz.cell_day_tables(con, cell_day, c)
        frames.append(load_slim(con, c))
    pooled = hz.calibrate(frames, "bins") if frames else None
    del frames
    print(f"world: {len(sizes)} countries; pooled calibration from the {len(pool)} smallest with their own")

    calib, entries = {}, {}
    for c in sizes.country[::-1]:  # largest first: a country that does not fit in memory fails early
        if c in pilots or (only is not None and c not in only):
            continue
        result = harmonize_country(con, cell_day, c, pooled, cell_deg)
        if result is None:
            print(f"world: {c}: no calibration of its own and no pooled one - skipped")
            continue
        table, entries[c], calib[c] = result
        con.register("part_df", table)
        con.execute(f"copy part_df to '{(parts / f'{len(calib):04d}.parquet').as_posix()}' (format parquet)")
        con.unregister("part_df")
        if "validation" in entries[c]:
            v, u = entries[c]["validation"]["viirs_to_modis_leave_one_year_out"], entries[c]["calibration_unit"]
            how = f"{u['units']} squares" if u["used"] == "squares" else "country"
            print(f"world: {c:<34} {how:<11} held-out error {v['wape_country_year']:6.1%} per year, "
                  f"{v['wape_country_month']:6.1%} per month, {v['wape_tile_month']:6.1%} per tile and month",
                  flush=True)  # fmt: skip
        else:
            print(f"world: {c:<34} borrowed calibration", flush=True)

    pilot_report = json.loads((pilot / "agg" / "harmonization_report.json").read_text())
    if pilots:  # the pilot countries as their own run left them
        pilot_calib = json.loads((pilot / "agg" / "calibration.json").read_text())
        names = ", ".join(f"'{c}'" for c in pilots)
        con.execute(f"""
            copy (select * from read_parquet('{(pilot / "agg" / "harmonized.parquet").as_posix()}')
                  where country in ({names}))
            to '{(parts / "pilot.parquet").as_posix()}' (format parquet)
        """)
        for c in pilots:
            entries[c] = pilot_report["countries"][c]
            calib[c] = pilot_calib[c]

    # Local solar days run ahead of UTC in the east, so the archive's last UTC evening falls into a month of its
    # own there. A month after the archive's last UTC month would read as a nearly empty month: it is dropped.
    (last,) = con.execute(
        f"select max(year * 12 + month) from read_parquet('{(agg / 'cell_month.parquet').as_posix()}')"
    ).fetchone()
    con.execute(f"""
        copy (select * from read_parquet('{parts.as_posix()}/*.parquet')
              where year * 12 + month <= {last}
              order by country, year, month, cell_id)
        to '{(agg / "harmonized.parquet").as_posix()}' (format parquet, compression zstd)
    """)
    shutil.rmtree(parts)
    yearly = con.execute(f"""
        select year as y, sum(n_raw) as raw, sum(n_harmonized) as harmonized
        from read_parquet('{(agg / "harmonized.parquet").as_posix()}') group by year order by year
    """).df().set_index("y")  # fmt: skip
    (agg / "calibration.json").write_text(json.dumps(calib, indent=2))
    report = {
        "generated_at_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "unit": UNIT,
        "metric": "WAPE = sum|prediction - truth| / sum(truth), on years the model did not see",
        "fit_period": list(hz.FIT),
        "record": hz.RECORD,
        "world": {
            "method": "bins",
            "square_deg": SQUARE_DEG,
            "unit_margin": UNIT_MARGIN,
            "pilot_countries": pilots,
            "pilot_report_generated_at_utc": pilot_report["generated_at_utc"],
            "pooled_from": pool,
            "sensor_jump": jump_of(yearly),  # every country together
        },
        "countries": entries,
    }
    (agg / "harmonization_report.json").write_text(json.dumps(report, indent=2))
    write_world_markdown(report, sizes, docs / "VALIDATION_WORLD.md")
    return report


def write_world_markdown(report: dict, sizes: pd.DataFrame, out: Path) -> None:
    """docs/VALIDATION_WORLD.md: one row per country, largest first, generated so no number is typed by hand."""
    n = dict(zip(sizes.country, sizes.n, strict=True))
    w = report["world"]
    own = sorted((c for c, e in report["countries"].items() if "validation" in e), key=lambda c: -n.get(c, 0))
    borrowed = sorted(c for c in report["countries"] if c not in own)
    held = {c: report["countries"][c]["validation"]["viirs_to_modis_leave_one_year_out"] for c in own}
    split = [c for c in own if (report["countries"][c].get("calibration_unit") or {}).get("used") == "squares"]
    total = sum(n.get(c, 0) for c in report["countries"])
    share = lambda cs: sum(n.get(c, 0) for c in cs) / total  # noqa: E731
    month = pd.Series({c: v["wape_country_month"] for c, v in held.items()})
    lines = [
        "# Validation, every country",
        "",
        f"Generated by `pipeline.world` on {report['generated_at_utc']}. Do not edit by hand: run `make world`.",
        "",
        f"Unit: {report['unit']}. Error metric: {report['metric']}. Each year of {report['fit_period'][0][:4]}-"
        f"{report['fit_period'][1][:4]} is predicted by a fit on the other years.",
        "",
        f"Method: the plain table by fire power, except {', '.join(w['pilot_countries'])}, which keep the method "
        f"chosen in their own run (`make validate NESTED=1`, {w['pilot_report_generated_at_utc']}).",
        "",
        f"- {len(own)} countries, with {share(own):.1%} of the world's fire cell-days, have a calibration of their "
        "own and are checked below.",
        f"- {len(borrowed)} countries, with {share(borrowed):.2%} of the fire cell-days, have too little MODIS/VIIRS "
        f"overlap and borrow a calibration fitted on the {len(w['pooled_from'])} smallest countries that have their "
        "own. They are not checked.",
        f"- Error per country and month: median {month.median():.1%}, a quarter of the countries under "
        f"{month.quantile(0.25):.1%}, three quarters under {month.quantile(0.75):.1%}. Countries under 10%: "
        f"{int((month < 0.10).sum())}, with {share(month.index[month < 0.10]):.1%} of the fire cell-days.",
        f"- Sensor jump of the world, mean yearly total {hz.JUMP_AFTER[0]}-{hz.JUMP_AFTER[1]} over "
        f"{hz.JUMP_BEFORE[0]}-{hz.JUMP_BEFORE[1]}: raw record {w['sensor_jump']['raw']['jump_ratio']:.2f}x, "
        f"harmonized record {w['sensor_jump']['harmonized']['jump_ratio']:.2f}x.",
        f"- {len(split)} countries are calibrated by {w['square_deg']}-degree squares instead of whole, because "
        f"that lowered their error per 1-degree tile and month by more than {w['unit_margin'] * 100:.1f} points "
        "without raising the error per country and month. That choice was made once on all years, so for those "
        'countries the error shown has seen its held-out year in that one step; the column "Whole country" is the '
        "error of one calibration for the country, which involves no choice.",
        "",
        "| Country | Fire cell-days | Calibrated by | Per year | Per month | 1-degree tile x month "
        "| Whole country: tile x month | One factor, per month | Sensor jump raw | Sensor jump harmonized |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for c in own:
        e = report["countries"][c]
        v, f = held[c], e["validation"]["baseline_single_factor"]
        u = e.get("calibration_unit")  # None for a pilot country
        by = f"{u['units']} squares" if u and u["used"] == "squares" else "country"
        whole = f"{u['country']['wape_tile_month']:.1%}" if u and u["used"] == "squares" else ""
        jump = e.get("sensor_jump") or {}
        raw = f"{jump['raw']['jump_ratio']:.2f}x" if jump else "-"
        harm = f"{jump['harmonized']['jump_ratio']:.2f}x" if jump else "-"
        lines.append(
            f"| {c.replace('_', ' ')} | {n.get(c, 0):,} | {by} | {v['wape_country_year']:.1%} "
            f"| {v['wape_country_month']:.1%} | {v['wape_tile_month']:.1%} | {whole} | {f['wape_country_month']:.1%} "
            f"| {raw} | {harm} |"
        )
    lines += ["", "Borrowed calibration: " + (", ".join(c.replace("_", " ") for c in borrowed) or "none") + "."]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA / "world", help="world data folder (cell_day input)")
    ap.add_argument("--pilot", type=Path, default=DEFAULT_DATA, help="data folder of the pilot run (data/)")
    ap.add_argument("--config", type=Path, default=WORLD_CONFIG)
    ap.add_argument("--docs", type=Path, default=ROOT / "docs")
    args = ap.parse_args()
    pilots = load_config(DEFAULT_CONFIG).region_names()
    report = run(args.data, args.pilot, pilots, load_config(args.config).cell_deg, args.docs)
    print(f"world: {len(report['countries'])} countries -> {args.data / 'agg'}, {args.docs / 'VALIDATION_WORLD.md'}")


if __name__ == "__main__":
    main()
