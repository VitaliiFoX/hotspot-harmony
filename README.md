# hotspot-harmony

One comparable record of satellite fire hotspots from 2000 to today, built from two generations of
sensors (MODIS and VIIRS), and a burning activity calendar for any area you draw on a map.

Built during the 2026 NASA Space Apps Challenge for the challenge
[Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

**Demo:** not deployed yet.

## Why

Satellites have recorded active fires since 2000, but the record is split between sensors that
cannot be compared directly: MODIS (1 km pixels, in orbit since 2000, near the end of its life) and
VIIRS (375 m pixels, since 2012). VIIRS reports several times more hotspots for the same fires. Put
the two side by side and a fake jump appears in every trend. This project removes that jump so that
a fire manager can ask "is this month unusual for my area?" and get an answer that does not depend
on which satellite was flying.

## Status

| Part | State |
|---|---|
| Ingest FIRMS country archives (2000-2025) | done |
| Normalize MODIS and VIIRS to one point schema (Parquet) | done |
| Fire cell-days on a 1 km grid, local solar day | done |
| Harmonize the sensors and validate on held-out years | done, see [docs/METHOD.md](docs/METHOD.md) and [docs/VALIDATION.md](docs/VALIDATION.md) |
| API (FastAPI): calendar for any polygon, CSV export | done |
| Web app (map, calendar, anomalies, CSV export) | in progress, see `web/` |
| Current-year data through the FIRMS Area API | not started |
| Public deployment | not started |

Ukraine is processed in full. Other countries in `config/regions.yaml` need `make data` first.

## Run it

Requires [uv](https://docs.astral.sh/uv/) and `make`.

```bash
make data COUNTRY=Ukraine  # download, normalize, aggregate, harmonize, validate (one country)
make data                  # ...every country in config/regions.yaml
make dev                   # API on http://localhost:8000 and web app on http://localhost:5173
make test                  # pytest
make lint                  # ruff
```

`make data` needs no account or key. It downloads public yearly CSV files from FIRMS
(roughly 200 MB for Ukraine) and skips files that are already there.

To add a country, add one entry to [`config/regions.yaml`](config/regions.yaml) and run `make data`.

## Work with the data

Parquet is the one format for everything. After `make data`, every hotspot from every sensor sits in
`data/points/` with the same columns (`lat`, `lon`, `acq_datetime_utc`, `satellite`,
`confidence_class`, `frp`, `daynight`, `type`, `country`, plus `sensor` and `year` from the folder
names), and the monthly grid counts are in `data/agg/cell_month.parquet`. Query them in place:

```python
import duckdb

duckdb.sql("""
    select sensor, year, count(*) as hotspots
    from read_parquet('data/points/**/*.parquet', hive_partitioning = true)
    where country = 'Ukraine' and confidence_class <> 'low' and type = 0
    group by all order by all
""").show()
```

`pandas.read_parquet("data/points")` works too. For a small slice in JSON or GeoJSON (a map layer,
a sample to look at), use `make json COUNTRY=Ukraine YEAR=2024 FORMAT=geojson`; do not use JSON for
the whole record, it is about 20 times larger than Parquet.

## Layout

```
config/regions.yaml   countries, grid size, filters
pipeline/             ingest -> normalize -> aggregate -> harmonize -> validate (+ tests)
api/                  FastAPI over the Parquet files (+ tests)
web/                  React + MapLibre + ECharts front end
docs/                 METHOD.md, VALIDATION.md (generated), seam figure (generated)
research/             experiments and notes that are not part of the product
data/                 generated, git-ignored (see data/README.md)
```

## API

| Endpoint | What |
|---|---|
| `POST /api/calendar` | `{geometry, start?, end?}` -> monthly harmonized record, climatology, latest-month anomaly, most unusual months, yearly totals |
| `POST /api/hotspots.csv` | `{geometry, start, end}` -> raw detections inside the area (capped at 500,000 rows, `X-Truncated` header) |
| `GET /api/meta` | countries, record periods, grid, the validation report |
| `GET /api/health` | liveness |

Interactive docs at `http://localhost:8000/docs`.

## Data

All data come from NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m):
<https://firms.modaps.eosdis.nasa.gov/>

- MODIS on Terra and Aqua, from November 2000
- VIIRS on Suomi NPP, January 2012 to November 2026
- VIIRS on NOAA-20, from April 2018

By default the pipeline keeps presumed vegetation fires (FIRMS `type = 0`) and drops
low-confidence detections. Both filters are set in `config/regions.yaml`.

## Use of AI tools

An AI coding assistant (Claude Code by Anthropic) is used to write pipeline code, tests and
documentation in this repository.

## License

MIT, see [LICENSE](LICENSE). This project is not affiliated with or endorsed by NASA.
