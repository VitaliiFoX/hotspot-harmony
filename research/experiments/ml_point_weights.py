# Experiment script, run once on Ukraine on 2026-11-14 (see docs/METHOD.md, 'Tried and rejected').
# Rough by design; not part of the pipeline. Run: uv run --with scikit-learn python research/experiments/ml_point_weights.py data/raw
import sys, duckdb, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
raw = sys.argv[1]
con = duckdb.connect()
T = "types={'acq_time':'VARCHAR','confidence':'VARCHAR','version':'VARCHAR','satellite':'VARCHAR'}"
D = 1/111.32
con.execute(f"""
create table det as
with m as (select latitude lat, longitude lon, acq_date, acq_time, satellite sat, 'MODIS' sensor,
             case when confidence::int<30 then 'l' when confidence::int<80 then 'n' else 'h' end conf, frp, daynight, type, scan
           from read_csv('{raw}/modis/*_Ukraine.csv', union_by_name=true, {T})),
     v as (select latitude lat, longitude lon, acq_date, acq_time, 'SNPP' sat, 'VIIRS' sensor, confidence conf, frp, daynight, type, scan
           from read_csv('{raw}/viirs-snpp/*_Ukraine.csv', union_by_name=true, {T}))
select *, cast(cast(acq_date as timestamp) + to_minutes(cast(substr(lpad(acq_time,4,'0'),1,2) as int)*60 + cast(substr(lpad(acq_time,4,'0'),3,2) as int) + cast(round(lon*4) as int)) as date) ldate,
       cast(floor(lat/{D}) as int) gy, cast(floor(lon*cos(radians((floor(lat/{D})+0.5)*{D}))/{D}) as int) gx
from (select * from m union all select * from v) where type=0 and conf<>'l' and acq_date between '2012-01-25' and '2022-01-05';
create table mcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx from det where sensor='MODIS' group by all;
create table vcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx, sum(frp) frp, max(frp) frp_max, count(*) n,
       max((daynight='D')::int) has_day, max((daynight='N')::int) has_night, max((conf='h')::int) has_high, avg(scan) scan
  from det where sensor='VIIRS' group by all;
create table off3 as select dx, dy from (select unnest([-1,0,1]) dx), (select unnest([-1,0,1]) dy);
create table off7 as select dx, dy from (select unnest([-3,-2,-1,0,1,2,3]) dx), (select unnest([-3,-2,-1,0,1,2,3]) dy);
create table mnb as select distinct ldate, gx+dx gx, gy+dy gy from mcd, off3;
create table f as
select v.*, 
  (exists(select 1 from mnb where mnb.ldate=v.ldate and mnb.gx=v.gx and mnb.gy=v.gy))::int matched,
  (select count(*) from vcd u, off3 o where u.ldate=v.ldate and u.gx=v.gx+o.dx and u.gy=v.gy+o.dy) nb3,
  (select count(*) from vcd u, off7 o where u.ldate=v.ldate and u.gx=v.gx+o.dx and u.gy=v.gy+o.dy) nb7,
  (select count(*) from vcd u, off3 o where u.ldate=v.ldate - 1 and u.gx=v.gx+o.dx and u.gy=v.gy+o.dy) prev3,
  (select count(*) from vcd u, off3 o where u.ldate=v.ldate + 1 and u.gx=v.gx+o.dx and u.gy=v.gy+o.dy) next3
from vcd v where v.ldate between '2012-02-01' and '2021-12-31';
""")
V = con.sql("select *, year(ldate) y, month(ldate) m from f").df()
M = con.sql("select year(ldate) y, month(ldate) m, tx, ty, count(*) truth from mcd where ldate between '2012-02-01' and '2021-12-31' group by all").df()
V['lfrp'] = np.log1p(V.frp); V['lfrpmax'] = np.log1p(V.frp_max)
V['b'] = np.digitize(V.frp, [0,1,2,4,8,16,32,64]) + 10*V.has_day
FE_A = ['lfrp','has_day']
FE_B = ['lfrp','lfrpmax','has_day','has_night','n','has_high','scan']
FE_C = FE_B + ['nb3','nb7','prev3','next3']
FE_D = FE_C + ['m']
KEYS = ['y','m','tx','ty']
def wape(g): return (g.pred-g.truth).abs().sum()/g.truth.sum()
def score(name, te_all):
    d = te_all.groupby(KEYS).w.sum().rename('pred').reset_index().merge(M, on=KEYS, how='outer').fillna(0.0)
    cm = d.groupby(['y','m'])[['pred','truth']].sum()
    return dict(model=name, bias=d.pred.sum()/d.truth.sum()-1, country_year=wape(d.groupby('y')[['pred','truth']].sum()), country_month=wape(cm),
                tile_year=wape(d.groupby(['y','tx','ty'])[['pred','truth']].sum()), tile_month=wape(d))
def run(name, feats=None, month_resid=True, tile_resid=False, N0=300):
    parts = []
    for y in sorted(V.y.unique()):
        tr, te = V[V.y!=y], V[V.y==y].copy(); mtr = M[M.y!=y]
        if feats is None:
            p = tr.groupby('b').matched.mean(); ptr = tr.b.map(p); pte = te.b.map(p).fillna(p.mean())
        else:
            clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=200, random_state=0)
            clf.fit(tr[feats], tr.matched); ptr = pd.Series(clf.predict_proba(tr[feats])[:,1], index=tr.index); pte = pd.Series(clf.predict_proba(te[feats])[:,1], index=te.index)
        k = mtr.truth.sum()/ptr.sum(); wtr = ptr*k; wte = pte*k
        if month_resid:
            r = mtr.groupby('m').truth.sum()/wtr.groupby(tr.m).sum(); wtr = wtr*tr.m.map(r); wte = wte*te.m.map(r)
        if tile_resid:
            a = mtr.groupby(['tx','ty']).truth.sum(); b = wtr.groupby([tr.tx, tr.ty]).sum()
            rt = ((a.reindex(b.index).fillna(0)+N0)/(b+N0)).rename('rt').reset_index()
            te = te.merge(rt, on=['tx','ty'], how='left'); wte = wte.values*te.rt.fillna(1.0).values
        te['w'] = np.asarray(wte); te['p'] = np.asarray(pte); parts.append(te[KEYS+['w','p']])
    return score(name, pd.concat(parts)), pd.concat(parts)
rows = []
for name, kw in [("0 one k", None), ("1 prototype: FRP bins x month", dict()),
                 ("2 ML: FRP + day/night", dict(feats=FE_A)), ("3 ML: + pixel/count/confidence", dict(feats=FE_B)),
                 ("4 ML: + neighbours & persistence", dict(feats=FE_C)), ("5 ML(4), no month factor", dict(feats=FE_C, month_resid=False)),
                 ("6 ML: + month as feature, no month factor", dict(feats=FE_D, month_resid=False)),
                 ("7 ML(4) + tile correction", dict(feats=FE_C, tile_resid=True)), ("8 prototype + tile correction", dict(tile_resid=True))]:
    if kw is None:
        parts=[]
        for y in sorted(V.y.unique()):
            te = V[V.y==y].copy(); te['w'] = M[M.y!=y].truth.sum()/len(V[V.y!=y]); parts.append(te[KEYS+['w']])
        rows.append(score(name, pd.concat(parts)))
    else:
        s, pred = run(name, **kw); rows.append(s)
        if name.startswith("4"): best = pred
pd.set_option('display.width', 220)
print(pd.DataFrame(rows).round(3).to_string(index=False))
# what drives detection? matched share by neighbourhood size
print("\nP(MODIS saw it) by number of burning VIIRS cells within 3 km the same day:")
print(V.groupby(pd.cut(V.nb7, [0,1,2,4,8,16,49])).matched.agg(['mean','size']).round(3).to_string())
