# Crimea coverage in the FIRMS Ukraine archive

The country picker uses Natural Earth 1:10m (`ne_10m_admin_0_countries_ukr`, pinned at `v5.1.2`), which places Crimea inside Ukraine's border. Because `config/regions.yaml` builds Ukraine from the FIRMS `Ukraine` country archive, any gap in Crimean rows inside that archive would silently count Crimean cells as zero burning.

## Check

Run against `data/points/` (or `data/demo/points/`), built from the FIRMS yearly country CSVs for 2000–2025:

```sql
select sensor, count(*) as n, min(acq_datetime_utc) as first_dt, max(acq_datetime_utc) as last_dt
from read_parquet('data/points/**/*.parquet')
where country = 'Ukraine' and lat < 46.0 and lon > 32.5
group by sensor
order by sensor;
```

## Result (checked 2026-11-15)

| Sensor | Hotspots (`lat < 46.0`, `lon > 32.5`) | First UTC timestamp | Last UTC timestamp |
|---|---:|---|---|
| `modis` | 14,815 | `2000-11-09 09:02` | `2025-10-30 11:50` |
| `viirs_snpp` | 15,328 | `2012-03-11 00:15` | `2025-12-23 23:56` |
| `viirs_noaa20` | 6,134 | `2018-04-01 09:36` | `2025-12-24 23:58` |

The archive holds 36,277 Crimean-area hotspots across all 26 years (2000–2025) with detections in every year (including 2014–2025 across MODIS and both VIIRS sensors), so the FIRMS `Ukraine` country files do include Crimea.
