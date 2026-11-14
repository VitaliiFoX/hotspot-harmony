# hotspot-harmony

One comparable record of satellite fire hotspots (MODIS from 2000, VIIRS from 2012) and a web
burning activity calendar built on it. It is a NASA Space Apps 2026 entry: a working demo beats
completeness, and it is judged on scientific validity, so every claim about the data must be
reproducible from this repo.

- Vocabulary: [GLOSSARY.md](GLOSSARY.md). Use its terms in code, tests, commits and PRs.
- What is built and what is not: the Status table in [README.md](README.md). Update it in the PR that changes it.

## Working here

- Run `make test` and `make lint` before every commit. Tests build their own fixtures in `tmp_path` and never read `data/`.
- `data/` is git-ignored. `make data` rebuilds it: about 700 MB of CSV for two countries, 2-3 minutes, no key needed.
- Run the pipeline for all configured countries at once. `COUNTRY=` / `--country` rewrites `data/points/` with that country alone, so the other countries vanish until the next full run.
- Two people and their agents work here in parallel. Fetch and rebase before starting, work on a branch, open a small PR against `main`.
- Code, docs, commit messages and UI text are in English.
- `research/` holds experiments: excluded from lint, untested, never imported by `pipeline/`. Code that is adopted moves into `pipeline/` together with tests.
- `FIRMS_MAP_KEY` is read from the environment or `.env` only.
- Credit the data as "NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)". Keep the names and logos of NASA and Space Apps out of the product name and branding.
- The "Use of AI tools" section of the README must stay true. Update it when AI is used for something new.

## Numbers

A number quoted in docs, the UI or a PR comes from a file the pipeline wrote, with the command that
produces it. Reference values to check new work against, measured 2026-11-14 on
`data/agg/cell_month.parquet` with the default filters:

- VIIRS S-NPP hotspots / MODIS hotspots over 2012-02 to 2025-12: 3.31 in Argentina, 3.11 in Ukraine.
- That ratio is not constant: per year it runs from 2.9 (2012) to 3.8 (2022) in Argentina and from 2.6 to 3.5 in Ukraine. One fixed factor leaves a drift.
- NOAA-20 / S-NPP in full years 2019-2025: 0.95 to 1.03 in Argentina, 0.97 to 1.14 in Ukraine.

A sensor ratio far from these means a bug upstream, not a discovery.

## FIRMS facts that cost time to rediscover

Checked against firms.modaps.eosdis.nasa.gov on 2026-11-14.

- The country archive has `modis`, `viirs-snpp` and `viirs-jpss1` (NOAA-20) up to 2025. It has no 2026 files and no NOAA-21.
- 2026 comes only from the Area API: `/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}/{YYYY-MM-DD}`, at most 5 days per request, 5000 transactions per 10 minutes. `/api/country/` is switched off. This ingest is not built yet.
- Coverage: MODIS from 2000-11-01; VIIRS S-NPP 2012-01-20 to 2026-11-02 (the record has ended); NOAA-20 from 2018-04-01; NOAA-21 from 2023-03-01. Anything after 2026-11-02 has to come from NOAA-20.
- Near real-time rows are replaced by standard processing after about 5 months.
- In the raw CSV, MODIS `confidence` is 0-100 and VIIRS is `l`/`n`/`h`; `satellite` is `N` for S-NPP and must be read as text; `acq_time` is UTC `HHMM` with leading zeros, so it must be read as text too.

Not verified yet. Confirm with the `research` skill before relying on any of these:

- the meaning of each FIRMS `type` value (the pipeline assumes 0 = presumed vegetation fire);
- whether near real-time rows carry a `type` column at all;
- whether the low MODIS counts of 2000-2002 come from Terra flying alone before Aqua (mid-2002).

## Open decision: how to harmonize

Two approaches exist and they disagree on the unit of the harmonized record:

- `research/cellday_prototype/`: MODIS-equivalent fire cell-days on a 1 km grid, VIIRS weighted by fire power and calendar month, with a bridge for the Terra-only start.
- The original plan: VIIRS-equivalent hotspot counts, one factor per 0.25 degree cell from the overlap period.

Ask the humans before building the API or the web app on either. When it is settled, record it as
an ADR in `docs/adr/` (the `domain-modeling` skill has the format) and replace this section with a
pointer to it.

## Skills in this repo

`.claude/skills/` holds unmodified copies from mattpocock/skills. Change behaviour here, in this
file, and leave the copies as they are so `npx skills update` stays clean. How they apply to this
project:

- A FIRMS or sensor fact you are unsure of: `research`. Save the note as `docs/research/<topic>.md` and cite the FIRMS page.
- Pipeline math (filters, grid, sensor ratios, anomalies): `tdd`. Expected values are hand-worked literals on a few synthetic hotspots.
- A new or fuzzy domain term: `domain-modeling`, and update `GLOSSARY.md` in the same PR.
- Comparing approaches (harmonization, calendar layout): `prototype`. Prototypes live in `research/<name>/` on `main`, which overrides the skill's throwaway-branch rule.
- A wrong number or a failing step: `diagnosing-bugs`.
- A PR body: `pr`.
- Editing this file or a skill: `writing-for-agents`.

Two skills only a human can start. Suggest them when they fit: `/grill-with-docs` before a design
decision, `/handoff` when work passes to another person or session.
