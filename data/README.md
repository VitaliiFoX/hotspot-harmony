# data/

Everything here except this file is git-ignored and rebuilt by `make data`.

| Path | Written by | Content |
|---|---|---|
| `raw/<archive>/<archive>_<year>_<Country>.csv` | `pipeline.ingest` | FIRMS country-year CSV files, as downloaded |
| `points/sensor=<id>/year=<yyyy>/*.parquet` | `pipeline.normalize` | all hotspots in one schema |
| `agg/cell_month.parquet` | `pipeline.aggregate` | hotspots per grid cell, month and sensor |
| `agg/cell_day.parquet` | `pipeline.aggregate` | fire cell-days: 1 km cell x local day x sensor stream |
| `agg/harmonized.parquet` | `pipeline.harmonize` | the harmonized record per 0.25 deg cell and month (what the API serves) |
| `agg/calibration.json` | `pipeline.harmonize` | fitted parameters per country |
| `agg/harmonization_report.json` | `pipeline.validate` | validation metrics shown in the app |

Source: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/
