# data/

Everything here except this file is git-ignored and rebuilt by `make data`.

| Path | Written by | Content |
|---|---|---|
| `raw/<archive>/<archive>_<year>_<Country>.csv` | `pipeline.ingest` | FIRMS country-year CSV files, as downloaded |
| `points/sensor=<id>/year=<yyyy>/*.parquet` | `pipeline.normalize` | all hotspots in one schema |
| `agg/cell_month.parquet` | `pipeline.aggregate` | hotspots per grid cell, month and sensor |

Source: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/
