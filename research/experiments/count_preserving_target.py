# Experiment script, run once on Ukraine on 2026-11-14 (see docs/METHOD.md, 'Tried and rejected').
# Rough by design; not part of the pipeline. Run: uv run --with scikit-learn python research/experiments/count_preserving_target.py data/raw
import sys, duckdb, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
raw = sys.argv[1]
con = duckdb.connect()
T = "types={'acq_time':'VARCHAR','confidence':'VARCHAR','version':'VARCHAR','satellite':'VARCHAR'}"
D = 1/111.32
con.execute(f"""
create table det as
with m as (select latitude lat, longitude lon, acq_date, acq_time, 'MODIS' sensor,
             case when confidence::int<30 then 'l' when confidence::int<80 then 'n' else 'h' end conf, frp, daynight, type, scan
           from read_csv('{raw}/modis/*_Ukraine.csv', union_by_name=true, {T})),
     v as (select latitude lat, longitude lon, acq_date, acq_time, 'VIIRS' sensor, confidence conf, frp, daynight, type, scan
           from read_csv('{raw}/viirs-snpp/*_Ukraine.csv', union_by_name=true, {T}))
select *, cast(cast(acq_date as timestamp) + to_minutes(cast(substr(lpad(acq_time,4,'0'),1,2) as int)*60 + cast(substr(lpad(acq_time,4,'0'),3,2) as int) + cast(round(lon*4) as int)) as date) ldate,
       cast(floor(lat/{D}) as int) gy, cast(floor(lon*cos(radians((floor(lat/{D})+0.5)*{D}))/{D}) as int) gx
from (select * from m union all select * from v) where type=0 and conf<>'l' and acq_date between '2012-01-25' and '2022-01-05';
create table mcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx from det where sensor='MODIS' and ldate between '2012-02-01' and '2021-12-31' group by all;
create table vcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx, sum(frp) frp, max(frp) frp_max, count(*) n,
       max((daynight='D')::int) has_day, max((daynight='N')::int) has_night, max((conf='h')::int) has_high, avg(scan) scan
  from det where sensor='VIIRS' and ldate between '2012-02-01' and '2021-12-31' group by all;
create table off3 as select dx, dy from (select unnest([-1,0,1]) dx), (select unnest([-1,0,1]) dy);
-- every (MODIS cell-day, VIIRS cell-day) pair within +-1 cell the same local day
create table pairs as select m.ldate, m.gx mx, m.gy my, v.gx vx, v.gy vy
  from mcd m, off3 o, vcd v where v.ldate=m.ldate and v.gx=m.gx+o.dx and v.gy=m.gy+o.dy;
-- split each MODIS cell-day's unit of activity equally among the VIIRS cells that explain it
create table share as select ldate, vx gx, vy gy, sum(1.0/nv) t from (select *, count(*) over (partition by ldate, mx, my) nv from pairs) group by all;
create table nb as select v.ldate, v.gx, v.gy, count(*) nb3 from vcd v, off3 o, vcd u where u.ldate=v.ldate and u.gx=v.gx+o.dx and u.gy=v.gy+o.dy group by all;
""")
print(con.sql("select (select count(*) from mcd) modis_celldays, (select count(distinct (ldate,mx,my)) from pairs) explained_by_viirs, (select round(sum(t)) from share) mass_assigned").df().to_string(index=False))
V = con.sql("select v.*, year(v.ldate) y, month(v.ldate) m, coalesce(s.t,0) t, (s.t is not null)::int matched, n.nb3 from vcd v left join share s using (ldate,gx,gy) join nb n using (ldate,gx,gy)").df()
M = con.sql("select year(ldate) y, month(ldate) m, tx, ty, count(*) truth from mcd group by all").df()
V['lfrp'] = np.log1p(V.frp); V['lfrpmax'] = np.log1p(V.frp_max)
V['b'] = np.digitize(V.frp, [0,1,2,4,8,16,32,64]) + 10*V.has_day
V['b2'] = V.b + 100*np.minimum(V.nb3, 6)
FE_B = ['lfrp','lfrpmax','has_day','has_night','n','has_high','scan']; FE_C = FE_B + ['nb3']
KEYS = ['y','m','tx','ty']
def wape(g): return (g.pred-g.truth).abs().sum()/g.truth.sum()
def score(name, te_all):
    d = te_all.groupby(KEYS).w.sum().rename('pred').reset_index().merge(M, on=KEYS, how='outer').fillna(0.0)
    return dict(model=name, bias=d.pred.sum()/d.truth.sum()-1, k=te_all.k.mean(), country_year=wape(d.groupby('y')[['pred','truth']].sum()),
                country_month=wape(d.groupby(['y','m'])[['pred','truth']].sum()), tile_year=wape(d.groupby(['y','tx','ty'])[['pred','truth']].sum()), tile_month=wape(d))
def run(name, target, by=None, feats=None, month_resid=True):
    parts = []
    for y in sorted(V.y.unique()):
        tr, te = V[V.y!=y], V[V.y==y].copy(); mtr = M[M.y!=y]
        if feats is None:
            p = tr.groupby(by)[target].mean(); ptr = tr[by].map(p); pte = te[by].map(p).fillna(tr[target].mean())
        else:
            reg = HistGradientBoostingRegressor(loss='poisson', max_iter=150, learning_rate=0.08, min_samples_leaf=200, random_state=0)
            reg.fit(tr[feats], tr[target]); ptr = pd.Series(reg.predict(tr[feats]), index=tr.index); pte = pd.Series(reg.predict(te[feats]), index=te.index)
        k = mtr.truth.sum()/ptr.sum(); wtr = ptr*k; wte = pte*k
        if month_resid:
            r = mtr.groupby('m').truth.sum()/wtr.groupby(tr.m).sum(); wte = wte*te.m.map(r)
        te['w'] = np.asarray(wte); te['k'] = k; parts.append(te[KEYS+['w','k']])
    return score(name, pd.concat(parts))
rows = [run("1 prototype: P(seen) by FRP x day/night, x month", 'matched', by='b'),
        run("9 shared activity by FRP x day/night, x month", 't', by='b'),
        run("10 shared activity by FRP x day/night x neighbours, x month", 't', by='b2'),
        run("11 shared activity, ML on cell features, x month", 't', feats=FE_B),
        run("12 shared activity, ML + neighbours, x month", 't', feats=FE_C),
        run("13 as 10, no month factor", 't', by='b2', month_resid=False),
        run("14 as 12, no month factor", 't', feats=FE_C, month_resid=False)]
pd.set_option('display.width', 240)
print(pd.DataFrame(rows).round(3).to_string(index=False))
