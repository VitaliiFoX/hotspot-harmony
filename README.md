# hotspot-harmony

One comparable record of satellite fire hotspots from 2000 to today, built from two generations of
sensors (MODIS and VIIRS), and a burning activity calendar for any area you draw on a map.

Built during the 2026 NASA Space Apps Challenge for the challenge
[Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

**Demo:** not deployed yet.

![The dashboard on the harmonized record for Ukraine](docs/screenshots/dashboard-harmonized-ukraine.png)

*The harmonized record for Ukraine. Switch to "Raw" and the yearly totals double from 2012, when VIIRS replaces MODIS; harmonized, they do not.*

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
| Fire cell-days on a 1 km grid, local solar day | done |
| Harmonize the sensors and validate on held-out years | done, see [docs/METHOD.md](docs/METHOD.md) and [docs/VALIDATION.md](docs/VALIDATION.md) (generated) |
| API (FastAPI): calendar, anomaly, CSV export, daily hotspots | done; serves the raw and the harmonized series in fire cell-days, plus daily hotspot counts and coordinates |
| Web app: 3D satellite globe, date/hour picker, filters, anomaly figures, calendar, seasonal and yearly charts, CSV export | done; region boxes can be picked on the globe or typed in degrees; downloads: calendar data as CSV, every chart as PNG |
| Drawn polygon on the map | not started |

## Run it

Requires [uv](https://docs.astral.sh/uv/) and `make`.

```bash
make data                  # download, normalize, aggregate, harmonize, validate every country in config/regions.yaml
make data COUNTRY=Ukraine  # one country only
make api                   # serve the API on http://localhost:8000 (endpoints listed at /docs)
make web                   # serve the web app on http://localhost:5173 (needs `make api` running, and Node 24)
make test                  # pytest
make lint                  # ruff + English-only check
```

`make data` needs no account or key. It downloads public yearly CSV files from FIRMS
(roughly 200 MB for Ukraine) and skips files that are already there.

To add a country, add one entry to [`config/regions.yaml`](config/regions.yaml) and run `make data`.

To process the whole world, use [`config/world.yaml`](config/world.yaml):

```bash
make data CONFIG=config/world.yaml   # every country, from one FIRMS zip per sensor and year
make api CONFIG=config/world.yaml    # serve it; the region list then holds a single "World" entry
```

This downloads about 10 GB of zips and extracts about 50 GB of CSV files into `data/raw/`.

## Layout

```
config/regions.yaml   countries, grid size, filters
pipeline/             ingest -> normalize -> aggregate -> harmonize -> validate (+ tests)
api/                  FastAPI service over the pipeline's output (+ tests)
web/                  React + TypeScript dashboard (Vite); charts are hand-written SVG, no chart library
docs/                 METHOD.md, ADRs, and VALIDATION.md + the sensor jump figure (both generated)
research/             experiments that are not part of the pipeline
data/                 generated, git-ignored (see data/README.md)
CLAUDE.md             instructions for AI coding agents
GLOSSARY.md           the project's vocabulary
.claude/skills/       agent skills (see "Working with AI agents")
```

## Working with AI agents

The repo is set up so that a coding agent can start work without a briefing:

- [`CLAUDE.md`](CLAUDE.md) holds the rules, the data facts that are easy to get wrong, and the open decisions.
- [`GLOSSARY.md`](GLOSSARY.md) fixes one word per concept, for people and agents alike.
- [`.claude/skills/`](.claude/skills/) holds eleven skills from
  [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see `.claude/skills/NOTICE.md`).

| Skill | Use |
|---|---|
| `tdd`, `codebase-design` | build pipeline logic test-first |
| `diagnosing-bugs` | find the cause of a wrong number or a failing step |
| `research` | check a fact against primary sources and save a cited note |
| `prototype` | answer a design question with throwaway code |
| `domain-modeling`, `grilling` | sharpen terms and decisions, keep `GLOSSARY.md` and ADRs current |
| `pr` | write a PR body that is fast to review |
| `writing-for-agents` | edit `CLAUDE.md` or a skill |
| `/grill-with-docs` | you type it: get interviewed about a design before building it |
| `/handoff` | you type it: pack the session into a note for the next person or agent |

The agent picks up every skill except the last two on its own. Update the copies with
`npx skills update`; `skills-lock.json` records where each one came from.

## Data

All data come from NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m):
<https://firms.modaps.eosdis.nasa.gov/>

- MODIS on Terra and Aqua, from November 2000
- VIIRS on Suomi NPP, January 2012 to November 2026
- VIIRS on NOAA-20, from April 2018

The record ends in December 2025, the last year in the FIRMS country archive. 2026 is out of scope.

By default the pipeline keeps presumed vegetation fires (FIRMS `type = 0`) and drops
low-confidence detections. Both filters are set in `config/regions.yaml`.

## Contributing

- **English only.** Code, comments, docs, UI text, commit messages, branch names, PR titles and
  bodies, issues and review comments are written in English, whoever or whatever writes them.
  CI fails when Cyrillic text shows up in a tracked file, a commit message, or a PR title or body.
- Work on a branch and open a pull request against `main`.
- Run `make test` and `make lint` before you push.
- **No commits after Sunday 2026-11-15 23:59 Kyiv time (21:59 UTC).** The hackathon submission is frozen then.

## Use of AI tools

An AI coding assistant (Claude Code by Anthropic) is used to write the code, tests and
documentation in this repository: the data pipeline, the API and the web app. No language
model and no pretrained model runs inside the product. The harmonization fits its own small
regression model (gradient boosting, scikit-learn) to the FIRMS data where that beats a plain table
on held-out years; anomalies are plain statistics.

## License

MIT, see [LICENSE](LICENSE). This project is not affiliated with or endorsed by NASA.
