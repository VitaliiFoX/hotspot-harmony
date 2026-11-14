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
| Normalize MODIS and VIIRS to one point schema | done |
| Aggregate to grid cell x month x sensor | done |
| Harmonize the sensors and validate | prototype in `research/`, not in the pipeline yet |
| Current-year data through the FIRMS Area API | not started |
| API (FastAPI) | not started |
| Web app (map, calendar, anomalies, CSV export) | not started |

## Run it

Requires [uv](https://docs.astral.sh/uv/) and `make`.

```bash
make data                  # download, normalize, aggregate every country in config/regions.yaml
make data COUNTRY=Ukraine  # one country only
make test                  # pytest
make lint                  # ruff
```

`make data` needs no account or key. It downloads public yearly CSV files from FIRMS
(roughly 200 MB for Ukraine) and skips files that are already there.

To add a country, add one entry to [`config/regions.yaml`](config/regions.yaml) and run `make data`.

## Layout

```
config/regions.yaml   countries, grid size, filters
pipeline/             ingest -> normalize -> aggregate (+ tests)
research/             experiments that are not part of the pipeline
data/                 generated, git-ignored (see data/README.md)
```

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
