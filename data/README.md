# data/

Everything here except this file is git-ignored and rebuilt by `make data`.

| Path | Written by | Content |
|---|---|---|
| `raw/<archive>/<archive>_<year>_<Country>.csv` | `pipeline.ingest` | FIRMS country-year CSV files, as downloaded |
| `raw/zips/<archive>_<year>_all_countries.zip` | `pipeline.ingest` (world mode) | FIRMS global zips; their country CSV files are extracted into `raw/<archive>/`, unless `--zips-only` |
| `points/sensor=<id>/year=<yyyy>/*.parquet` | `pipeline.normalize` | all hotspots in one schema |
| `day_points/sensor=<id>/year=<yyyy>/data_0.parquet` | `pipeline.day_points` (`make day-points`) | hotspots of every country for the globe's day view: MODIS before 2012-02, VIIRS S-NPP from then on, filters applied; `lat_e4`, `lon_e4` (degrees x 10 000), `acq_datetime_utc`, `country` |
| `day_points/manifest.json` | `pipeline.day_points` | the filters it was built with and the hotspots per sensor and year |
| `agg/cell_month.parquet` | `pipeline.aggregate` | hotspots per grid cell, month and sensor |
| `agg/cell_day.parquet` | `pipeline.aggregate` | fire cell-days: 1 km cell x local day x sensor stream |
| `agg/harmonized.parquet` | `pipeline.harmonize` | the harmonized record per 0.25 deg cell and month, read by the API |
| `agg/calibration.json` | `pipeline.harmonize` | fitted parameters per country |
| `agg/harmonization_report.json` | `pipeline.validate` | validation metrics shown in the app |

Source: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/
