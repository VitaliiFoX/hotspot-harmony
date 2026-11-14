"""PROTOTYPE - feature tables for the question "can ML beat the detection-weight harmonization?".

Reads data/points (one country), writes to data/research/harmonize_ml/:
    snpp.parquet     one row per VIIRS S-NPP fire cell-day of the overlap period, with context features
                     and targets (did MODIS see it; its share of the MODIS cell-days it explains)
    n20.parquet      the same for VIIRS NOAA-20 (no targets needed beyond the match flag)
    modis.parquet    MODIS fire cell-days of the overlap period (the truth)
    cell025.parquet  one row per 0.25 degree cell and local day with VIIRS activity nearby, with the
                     MODIS cell-days of that cell and day as the target

Run:  uv run python research/harmonize_ml/features.py [--country Ukraine]
"""

import argparse
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "research" / "harmonize_ml"
D = 1 / 111.32  # ~1 km in degrees of latitude
FIT = ("2012-02-01", "2021-12-31")
PAD = ("2012-01-25", "2022-01-07")  # a few days around the fit period for previous / next day features


def offsets(con, name: str, r: int) -> None:
    rng = ", ".join(str(i) for i in range(-r, r + 1))
    con.execute(f"create or replace table {name} as select dx, dy from (select unnest([{rng}]) dx), (select unnest([{rng}]) dy)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", default="Ukraine")
    args = ap.parse_args()
    global OUT
    OUT = OUT / args.country
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("set threads = 12")
    t0 = time.time()

    def step(msg: str) -> None:
        print(f"[{time.time() - t0:6.1f}s] {msg}", flush=True)

    con.execute(f"""
        create table pts as
        select sensor, satellite, lat, lon, frp, daynight, confidence_class as conf, type, scan_km, track_km, local_date,
               cast(floor(lat / {D}) as integer) as gy,
               cast(floor(lon * cos(radians((floor(lat / {D}) + 0.5) * {D})) / {D}) as integer) as gx
        from read_parquet('{ROOT}/data/points/**/*.parquet', hive_partitioning = true)
        where country = '{args.country}' and local_date between '{PAD[0]}' and '{PAD[1]}'
    """)
    # fire cell-days with the default filters (vegetation fires, low confidence dropped)
    con.execute("""
        create table mcd as
        select local_date, gx, gy, avg(lat) lat, avg(lon) lon, count(*) n, sum(frp) frp,
               max((satellite = 'Terra')::int) terra, max((satellite = 'Aqua')::int) aqua
        from pts where sensor = 'modis' and type = 0 and conf <> 'low' group by all;
        create table vcd as
        select sensor, local_date, gx, gy, avg(lat) lat, avg(lon) lon, sum(frp) frp, max(frp) frp_max, count(*) n,
               sum((daynight = 'D')::int) n_day, sum((daynight = 'N')::int) n_night, sum((conf = 'high')::int) n_high,
               avg(scan_km) scan, avg(track_km) track
        from pts where sensor like 'viirs%' and type = 0 and conf <> 'low' group by all;
        -- VIIRS detections the default filters throw away: they may still explain a MODIS hotspot
        create table vextra as
        select sensor, local_date, gx, gy, sum((conf = 'low')::int) n_low, sum((type <> 0)::int) n_static
        from pts where sensor like 'viirs%' and (type <> 0 or conf = 'low') group by all;
    """)
    step("cell-days built")
    for r in (1, 2, 3):
        offsets(con, f"off{r}", r)

    def neighbours(name: str, src: str, where: str, r: int, shift: int, cols: str) -> None:
        """Per target cell-day (date, gx, gy): aggregate `src` rows within r cells, `shift` days away."""
        con.execute(f"""
            create or replace table {name} as
            select u.local_date - {shift} as local_date, u.gx + o.dx as gx, u.gy + o.dy as gy, {cols}
            from {src} u, off{r} o where {where} group by all
        """)

    for sensor, tag in (("viirs_snpp", "snpp"), ("viirs_noaa20", "n20")):
        other = "viirs_noaa20" if sensor == "viirs_snpp" else "viirs_snpp"
        own = f"u.sensor = '{sensor}'"
        neighbours("nb1", "vcd", own, 1, 0, "count(*) nb1_n, sum(u.frp) nb1_frp")
        neighbours("nb3", "vcd", own, 3, 0, "count(*) nb3_n, sum(u.frp) nb3_frp")
        neighbours("prev1", "vcd", own, 1, -1, "count(*) prev1")  # burning the day before
        neighbours("next1", "vcd", own, 1, 1, "count(*) next1")  # burning the day after
        neighbours("oth1", "vcd", f"u.sensor = '{other}'", 1, 0, "count(*) other1, sum(u.frp) other1_frp")
        neighbours("ext1", "vextra", own, 1, 0, "sum(u.n_low) low1, sum(u.n_static) static1")
        for r in (1, 2, 3):
            neighbours(f"m{r}", "mcd", "true", r, 0, "count(*) n")
            # count-preserving target: each MODIS cell-day is one unit, split among the VIIRS cells that explain it
            con.execute(f"""
                create or replace table share{r} as
                with pairs as (
                    select m.local_date, m.gx mx, m.gy my, v.gx, v.gy
                    from mcd m, off{r} o, vcd v
                    where v.sensor = '{sensor}' and v.local_date = m.local_date and v.gx = m.gx + o.dx and v.gy = m.gy + o.dy
                )
                select local_date, gx, gy, sum(1.0 / nv) share
                from (select *, count(*) over (partition by local_date, mx, my) nv from pairs) group by all
            """)
        con.execute(f"""
            copy (
                select v.local_date, v.gx, v.gy, v.lat, v.lon, v.frp, v.frp_max, v.n, v.n_day, v.n_night, v.n_high, v.scan, v.track,
                       year(v.local_date) y, month(v.local_date) m, dayofyear(v.local_date) doy,
                       cast(floor(v.lon) as int) tx, cast(floor(v.lat) as int) ty,
                       coalesce(nb1.nb1_n, 1) - 1 nb1_n, coalesce(nb1.nb1_frp, v.frp) - v.frp nb1_frp,
                       coalesce(nb3.nb3_n, 1) - 1 nb3_n, coalesce(nb3.nb3_frp, v.frp) - v.frp nb3_frp,
                       coalesce(prev1.prev1, 0) prev1, coalesce(next1.next1, 0) next1,
                       coalesce(oth1.other1, 0) other1, coalesce(oth1.other1_frp, 0) other1_frp,
                       coalesce(ext1.low1, 0) low1, coalesce(ext1.static1, 0) static1,
                       (m1.n is not null)::int m1, (m2.n is not null)::int m2, (m3.n is not null)::int m3,
                       coalesce(share1.share, 0) share1, coalesce(share2.share, 0) share2, coalesce(share3.share, 0) share3
                from vcd v
                left join nb1 using (local_date, gx, gy) left join nb3 using (local_date, gx, gy)
                left join prev1 using (local_date, gx, gy) left join next1 using (local_date, gx, gy)
                left join oth1 using (local_date, gx, gy) left join ext1 using (local_date, gx, gy)
                left join m1 using (local_date, gx, gy) left join m2 using (local_date, gx, gy)
                left join m3 using (local_date, gx, gy)
                left join share1 using (local_date, gx, gy) left join share2 using (local_date, gx, gy)
                left join share3 using (local_date, gx, gy)
                where v.sensor = '{sensor}' and v.local_date between '{FIT[0]}' and '{FIT[1]}'
            ) to '{OUT}/{tag}.parquet' (format parquet)
        """)
        step(f"{tag}.parquet written")

    con.execute(f"""
        copy (select local_date, gx, gy, lat, lon, terra, aqua, year(local_date) y, month(local_date) m,
                     cast(floor(lon) as int) tx, cast(floor(lat) as int) ty
              from mcd where local_date between '{FIT[0]}' and '{FIT[1]}')
        to '{OUT}/modis.parquet' (format parquet)
    """)

    # ---- 0.25 degree cell x day table: let a model see what VIIRS did around a cell and a day -------------------
    con.execute("""
        create table vd as
        select local_date, cast(floor(lat / 0.25) as int) cy, cast(floor(lon / 0.25) as int) cx,
               count(*) cd, sum((n_day > 0)::int) cd_day, sum((n_night > 0)::int) cd_night, sum(frp) frp, max(frp) frp_max,
               sum(n) det, sum(n_high) high, sum((frp < 2)::int) cd_weak, sum((frp >= 16)::int) cd_strong
        from vcd where sensor = 'viirs_snpp' group by all;
        create table md as
        select local_date, cast(floor(lat / 0.25) as int) cy, cast(floor(lon / 0.25) as int) cx, count(*) modis
        from mcd group by all;
        -- rows are chosen from VIIRS alone: a cell-day is included when VIIRS burned in the cell or next to it within +-2 days
        create table rows as
        select distinct v.local_date + k.k as local_date, v.cy + o.dy as cy, v.cx + o.dx as cx
        from vd v, (select unnest([-2, -1, 0, 1, 2]) k) k, off1 o;
    """)
    lag = lambda k, name: f"left join vd {name} on {name}.cy = r.cy and {name}.cx = r.cx and {name}.local_date = r.local_date + {k}"  # noqa: E731
    con.execute(f"""
        create table nbr as
        select r.local_date, r.cy, r.cx, sum(v.cd) nb_cd, sum(v.frp) nb_frp
        from rows r, off1 o, vd v
        where v.local_date = r.local_date and v.cy = r.cy + o.dy and v.cx = r.cx + o.dx and not (o.dx = 0 and o.dy = 0)
        group by all;
        copy (
            select r.local_date, r.cy, r.cx, (r.cy + 0.5) * 0.25 lat, (r.cx + 0.5) * 0.25 lon,
                   year(r.local_date) y, month(r.local_date) m, dayofyear(r.local_date) doy,
                   cast(floor((r.cx + 0.5) * 0.25) as int) tx, cast(floor((r.cy + 0.5) * 0.25) as int) ty,
                   coalesce(md.modis, 0) modis,
                   coalesce(v0.cd, 0) cd, coalesce(v0.cd_day, 0) cd_day, coalesce(v0.cd_night, 0) cd_night,
                   coalesce(v0.frp, 0) frp, coalesce(v0.frp_max, 0) frp_max, coalesce(v0.det, 0) det, coalesce(v0.high, 0) high,
                   coalesce(v0.cd_weak, 0) cd_weak, coalesce(v0.cd_strong, 0) cd_strong,
                   coalesce(p1.cd, 0) cd_p1, coalesce(p1.frp, 0) frp_p1, coalesce(p2.cd, 0) cd_p2,
                   coalesce(n1.cd, 0) cd_n1, coalesce(n1.frp, 0) frp_n1, coalesce(n2.cd, 0) cd_n2,
                   coalesce(nbr.nb_cd, 0) nb_cd, coalesce(nbr.nb_frp, 0) nb_frp
            from rows r
            left join md on md.cy = r.cy and md.cx = r.cx and md.local_date = r.local_date
            {lag(0, "v0")} {lag(-1, "p1")} {lag(-2, "p2")} {lag(1, "n1")} {lag(2, "n2")}
            left join nbr on nbr.cy = r.cy and nbr.cx = r.cx and nbr.local_date = r.local_date
            where r.local_date between '{FIT[0]}' and '{FIT[1]}'
        ) to '{OUT}/cell025.parquet' (format parquet)
    """)
    step("cell025.parquet written")
    print(con.sql(f"""
        select (select count(*) from '{OUT}/snpp.parquet') snpp_celldays, (select count(*) from '{OUT}/n20.parquet') n20_celldays,
               (select count(*) from '{OUT}/modis.parquet') modis_celldays, (select count(*) from '{OUT}/cell025.parquet') cell025_rows,
               (select sum(modis) from '{OUT}/cell025.parquet') modis_in_cell025_rows,
               (select round(avg(m1), 3) from '{OUT}/snpp.parquet') p_m1, (select round(avg(m3), 3) from '{OUT}/snpp.parquet') p_m3,
               (select round(sum(share1)) from '{OUT}/snpp.parquet') mass1, (select round(sum(share3)) from '{OUT}/snpp.parquet') mass3
    """).df().T.to_string(header=False))


if __name__ == "__main__":
    main()
