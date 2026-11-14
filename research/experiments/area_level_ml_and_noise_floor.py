# Experiment script, run once on Ukraine on 2026-11-14 (see docs/METHOD.md, 'Tried and rejected').
# Rough by design; not part of the pipeline. Run: uv run --with scikit-learn python research/experiments/area_level_ml_and_noise_floor.py data/raw
import sys, duckdb, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
raw = sys.argv[1]
con = duckdb.connect()
T = "types={'acq_time':'VARCHAR','confidence':'VARCHAR','version':'VARCHAR','satellite':'VARCHAR'}"
D = 1/111.32
con.execute(f"""
create table det as
with m as (select latitude lat, longitude lon, acq_date, acq_time, 'MODIS' sensor,
             case when confidence::int<30 then 'l' when confidence::int<80 then 'n' else 'h' end conf, frp, daynight, type
           from read_csv('{raw}/modis/*_Ukraine.csv', union_by_name=true, {T})),
     v as (select latitude lat, longitude lon, acq_date, acq_time, 'VIIRS' sensor, confidence conf, frp, daynight, type
           from read_csv('{raw}/viirs-snpp/*_Ukraine.csv', union_by_name=true, {T}))
select *, cast(cast(acq_date as timestamp) + to_minutes(cast(substr(lpad(acq_time,4,'0'),1,2) as int)*60 + cast(substr(lpad(acq_time,4,'0'),3,2) as int) + cast(round(lon*4) as int)) as date) ldate,
       cast(floor(lat/{D}) as int) gy, cast(floor(lon*cos(radians((floor(lat/{D})+0.5)*{D}))/{D}) as int) gx
from (select * from m union all select * from v) where type=0 and conf<>'l' and acq_date between '2012-01-25' and '2022-01-05';
create table mcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx from det where sensor='MODIS' and ldate between '2012-02-01' and '2021-12-31' group by all;
create table vcd as select ldate, gx, gy, any_value(floor(lat)) ty, any_value(floor(lon)) tx, sum(frp) frp, count(*) n,
       max((daynight='D')::int) has_day from det where sensor='VIIRS' and ldate between '2012-02-01' and '2021-12-31' group by all;
create table mnb as select distinct ldate, gx+dx gx, gy+dy gy from mcd, (select unnest([-1,0,1]) dx), (select unnest([-1,0,1]) dy);
""")
V = con.sql("select v.*, year(ldate) y, month(ldate) m, (exists(select 1 from mnb n where n.ldate=v.ldate and n.gx=v.gx and n.gy=v.gy))::int matched from vcd v").df()
M = con.sql("select year(ldate) y, month(ldate) m, tx, ty, count(*) truth from mcd group by all").df()
V['b'] = np.digitize(V.frp, [0,1,2,4,8,16,32,64]) + 10*V.has_day; V['lfrp'] = np.log1p(V.frp); V['night'] = 1-V.has_day
KEYS = ['y','m','tx','ty']
def wape(g): return (g.pred-g.truth).abs().sum()/g.truth.sum()
def score(name, d):
    return dict(model=name, bias=d.pred.sum()/d.truth.sum()-1, country_year=wape(d.groupby('y')[['pred','truth']].sum()),
                country_month=wape(d.groupby(['y','m'])[['pred','truth']].sum()), tile_year=wape(d.groupby(['y','tx','ty'])[['pred','truth']].sum()), tile_month=wape(d))
FEATS = ['lW','ln','lfrp','night','m','tile_ratio','lWcm','tx','ty']
out = {'prototype': [], 'ML on tile-months': [], 'ML, no tile position': []}
for y in sorted(V.y.unique()):
    tr = V.y != y; mtr = M[M.y != y]
    p = V[tr].groupby('b').matched.mean(); base = V.b.map(p).fillna(p.mean())
    k = mtr.truth.sum()/base[tr].sum(); r = mtr.groupby('m').truth.sum()/(base[tr]*k).groupby(V.m[tr]).sum()
    V['w'] = base*k*V.m.map(r)
    A = V.groupby(KEYS).agg(W=('w','sum'), n=('w','size'), lfrp=('lfrp','mean'), night=('night','mean')).reset_index()
    A = A.merge(M, on=KEYS, how='outer').fillna({'W':0,'n':0,'truth':0})
    A['lW'] = np.log1p(A.W); A['ln'] = np.log1p(A.n)
    A['lWcm'] = np.log1p(A.groupby(['y','m']).W.transform('sum'))
    tt = A[A.y != y].groupby(['tx','ty'])[['truth','W']].sum(); tt['tile_ratio'] = (tt.truth+200)/(tt.W+200)
    A = A.merge(tt[['tile_ratio']].reset_index(), on=['tx','ty'], how='left').fillna({'tile_ratio':1.0})
    te = A[A.y == y]; trA = A[A.y != y]
    out['prototype'].append(te.assign(pred=te.W))
    for name, feats in (('ML on tile-months', FEATS), ('ML, no tile position', FEATS[:-2])):
        reg = HistGradientBoostingRegressor(loss='poisson', max_iter=200, learning_rate=0.06, min_samples_leaf=40, random_state=0).fit(trA[feats], trA.truth)
        out[name].append(te.assign(pred=reg.predict(te[feats])))
pd.set_option('display.width', 220)
print(pd.DataFrame([score(n, pd.concat(v)) for n, v in out.items()]).round(3).to_string(index=False))
# noise floor: two identical VIIRS sensors 50 minutes apart, after the same weighting
nf = duckdb.sql("""
 select year(ldate) y, month(ldate) m, cast(floor(lat) as int) ty, cast(floor(lon) as int) tx,
        sum(weight) filter (stream='SNPP') pred, sum(weight) filter (stream='N20') truth
 from 'data/processed/celldays.parquet' where ldate between '2018-04-01' and '2021-12-31' and stream in ('SNPP','N20') group by all""").df().fillna(0.0)
print("\nNoise floor - S-NPP vs NOAA-20 (same instrument design, same weights), 2018-04..2021-12:")
print(pd.DataFrame([score('S-NPP vs NOAA-20', nf)]).round(3).to_string(index=False))
