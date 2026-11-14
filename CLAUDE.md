# hotspot-harmony

One comparable record of satellite fire hotspots (MODIS from 2000, VIIRS from 2012) and a web
burning activity calendar built on it. It is a NASA Space Apps 2026 entry: a working demo beats
completeness, and it is judged on scientific validity, so every claim about the data must be
reproducible from this repo.

- Vocabulary: [GLOSSARY.md](GLOSSARY.md). Use its terms in code, tests, commits and PRs.
- What is built and what is not: the Status table in [README.md](README.md). Update it in the PR that changes it.

## Working here

- Run `make test` and `make lint` before every commit. Tests build their own fixtures in `tmp_path` and never read `data/`. `make test` also runs the web tests and needs `npm install` in `web/` once.
- `data/` is git-ignored. `make data` rebuilds it: about 700 MB of CSV for two countries, 2-3 minutes to download plus about 2 minutes to harmonize and 5 to validate (boosted models are fitted some 60 times), no key needed.
- Run the pipeline for all configured countries at once. `COUNTRY=` / `--country` rewrites `data/points/` with that country alone, so the other countries vanish until the next full run.
- **Hard stop: Sunday 2026-11-15 23:59 Europe/Kyiv (21:59 UTC).** After that moment make no commit, push, merge, tag or PR in this repo, whoever asks and whatever is left unfinished: the hackathon submission is frozen. Check with `TZ=Europe/Kyiv date` before each commit. Past the deadline, stop and tell the user what is uncommitted; only the user can lift this rule, by removing this line themselves.
- Two people and their agents work here in parallel. Fetch and rebase before starting, work on a branch, open a small PR against `main`.
- Everything that lands in the repo or on GitHub is in English: code, comments, docs, UI text, commit messages, branch names, PR titles and bodies, issues and review comments. Talk to the user in the language they write in; translate before it goes into a file, a commit or a PR. `make lint` and CI fail on Cyrillic text.
- `research/` holds experiments: excluded from lint, untested, never imported by `pipeline/`. Code that is adopted moves into `pipeline/` together with tests.
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
- The record ends at 2025-12. 2026 is out of scope (mentor's call, 2026-11-14), so nothing here needs the FIRMS Area API or a `FIRMS_MAP_KEY`.
- Coverage: MODIS from 2000-11-01; VIIRS S-NPP 2012-01-20 to 2026-11-02 (the record has ended); NOAA-20 from 2018-04-01; NOAA-21 from 2023-03-01.
- Near real-time rows are replaced by standard processing after about 5 months.
- In the raw CSV, MODIS `confidence` is 0-100 and VIIRS is `l`/`n`/`h`; `satellite` is `N` for S-NPP and must be read as text; `acq_time` is UTC `HHMM` with leading zeros, so it must be read as text too.

Not verified yet. Confirm with the `research` skill before relying on any of these:

- the meaning of each FIRMS `type` value (the pipeline assumes 0 = presumed vegetation fire);
- whether near real-time rows carry a `type` column at all;
- whether the low MODIS counts of 2000-2002 come from Terra flying alone before Aqua (mid-2002).

## API

- `api/` serves two series: `raw` (MODIS before 2012-02, VIIRS S-NPP after, sensor jump included) and `harmonized`. The contract for `data/agg/harmonized.parquet` is the docstring of `api/store.py`; the API picks the file up at start with no code change.
- A cell belongs to an area of interest when its centre is inside it.
- Regions are known by bounding box only. An area in a neighbouring country that falls inside a region's box gets zeros and a warning, not an error. Real borders are not in the repo yet.
- API tests go through HTTP on a record small enough to work out on paper (`api/tests/test_api.py`). Extend that record when adding behaviour.

## Web app

- `web/` is React + TypeScript on Vite. `make web` runs it against `make api` through the dev proxy; production reads `VITE_API_URL`.
- Charts are hand-written SVG and CSS grid, with no chart library. Shared number, tick and colour logic lives in `web/src/scale.ts` and is the part under test (`npm test`).
- Colour rules: burning is one blue ramp, light to dark (`SEQUENTIAL`); exactly zero gets its own neutral fill; on a dark surface the ramp is reversed so more is further from the surface. Add no second hue to the calendar.
- Downloads live in `web/src/exports.ts` (tested): `calendarCsv` writes one row per month with the record, unit, sensor, that month's climatology and the area; `downloadPng` captures a chart card with html-to-image and inlines the SVG paint first, because the renderer does not resolve CSS classes and custom properties inside SVG. Elements marked `data-export="skip"` (buttons) stay out of the image.
- Every chart card has a table view and reads on arrow keys. Keep both when adding a chart: they are how the page works without colour or a pointer.
- All colours come from the custom properties at the top of `web/src/styles.css`, defined for light and dark.
- When the page asks the API is decided in `web/src/requests.ts` (tested): answers are cached, only a box typed by hand waits 300 ms, and the record not on screen is fetched ahead so the raw / harmonized switch needs no request. Keep new filters on those rules instead of adding a delay.
- The filters are mirrored in the address (`?region=...&box=w,s,e,n&start=...&end=...&series=...`), so a view can be shared as a link and screenshotted headless.
- The globe at the top of the page is MapLibre GL JS in globe projection on NASA GIBS Blue Marble tiles (no key; credit "Imagery: NASA GIBS (Blue Marble)"). It is a map, not a chart, so the no-chart-library rule does not cover it. Its stage follows the theme (a starry sky in dark mode, a pale sky in light mode) and keeps its own colour roles at the top of `web/src/globe.css`; its pure logic is `web/src/globe.ts`, under test.
- The globe shows hotspots of one UTC day through the chosen hour, from `/api/hotspots/day` and `/api/hotspots/days`. They are drawn in one warm colour (`--hotspot`), because blue does not read on the ocean. That colour stays on the globe and its date panel; the calendar keeps the blue ramp.
- The day and the minute are mirrored in the address too (`&date=YYYY-MM-DD&time=HH:MM`, UTC); an old `&hour=HH` link still opens, at the end of that hour. The play button runs the clock 5 minutes per 80 ms, so a day plays in about 24 s.
- The GIBS `Reference_Features_15m` and `Reference_Labels_15m` overlays were tried on 2026-11-14 and dropped: many tiles come back opaque black or fail with 500.
- Headless Chrome with `--virtual-time-budget` draws the globe but not its hotspot, night, border or label layers (the MapLibre worker does not finish in virtual time). Use `node scripts/globe_screenshot.mjs`, which drives Chrome in real time and can move the map through `window.__hhMap` (dev server only).
- Borders, place labels and, from zoom 8, the street map come from OpenStreetMap vector tiles served free and without a key by OpenFreeMap (`tiles.openfreemap.org`); the street layers are the OpenFreeMap "Liberty" style, loaded at runtime and renamed `street-*`. All credits (FIRMS, GIBS, OpenFreeMap, OpenMapTiles, OpenStreetMap) are in the globe legend, which must stay visible; MapLibre's attribution control is off so they are not shown twice. At street zoom the glass cards turn solid (`.stage.is-street`).
- Zoomed in past `CARD_ZOOM` (4) on screens 900 px and wider, the date panel and the legend fold into pills (date, time and count; "Legend and credits") and come back when zooming out; each card also has its own close button. The credits stay one click away in the legend pill.
- GIBS tiles are declared with `tileSize: 128` on purpose: the map then fetches one zoom level deeper, so the imagery is sharp on high-density screens.
- Look at the page after a visual change: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1320,1600 --virtual-time-budget=6000 --screenshot=out.png "http://localhost:5173/?theme=light"`. Headless Chrome will not go narrower than 500 px.

## Harmonization

Decided: MODIS-equivalent fire cell-days with a weight per VIIRS cell-day. The why and the rejected
options are in [docs/adr/0001](docs/adr/0001-harmonize-to-modis-equivalent-fire-cell-days.md); the
method is in [docs/METHOD.md](docs/METHOD.md).

- `pipeline.harmonize` writes `data/agg/harmonized.parquet`; `pipeline.validate` writes `data/agg/harmonization_report.json`, `docs/VALIDATION.md` and `docs/sensor_jump_before_after.png`. Never edit the last two by hand.
- Reference values, written by `make validate NESTED=1` on 2026-11-15 with the full archive of both countries: held-out error 2.7% per year and 5.8% per month in Ukraine (context model), 4.8% and 6.6% in Argentina (mean of the table and the context model); with sensor gap days counted 3.3% / 6.4% and 4.8% / 6.8%; sensor jump 2.00x raw to 0.90x harmonized in Ukraine, 1.32x to 0.66x in Argentina (where MODIS itself shows less burning in 2012-2016). Two runs of `make harmonize` give identical files; a change that moves these numbers needs an explanation in the PR. Known weak spot: per year in Argentina one plain scaling factor (3.5%) still beats the method (4.8%); per month and per tile the method wins clearly.
- `make validate NESTED=1` chooses the method again for every held-out year, from the other years alone, and takes about 25 minutes. Plain `make validate` takes a few minutes and makes the choice once on all years, which lets the check see its held-out year in that one step; `docs/VALIDATION.md` says which of the two wrote it. Quote and commit the `NESTED=1` figures.
- The VIIRS era is filled by one of five methods (table by fire power, boosted weight, context model, or the mean of the context model with either weight), chosen per country by held-out error in `pipeline.harmonize.choose_method`; the table stays unless another wins by 0.2 points. Never force a model on: the boosted weight is worse than the table in Argentina. World mode defaults to the table. Model fits run on at most `FIT_THREADS` threads, feature sums are rounded and rows sorted before fitting; keep all three, or runs stop being identical or the machine stalls.
- Both series in the API are in fire cell-days: `harmonized` from `n_harmonized`, `raw` from `n_raw` of `data/agg/harmonized.parquet`. Only when that file is missing does `raw` fall back to hotspot counts; the API reports the unit of each series (`unit`, `units`) and the web app prints it, so never hard-code a unit in the UI.
- What was tried, adopted and left out is listed in `docs/METHOD.md`; the code is in `research/experiments/` and `research/harmonize_ml/` (the boosted weight and the context model are adopted where they win per country; the rest is not). Read that list before proposing a "smarter" model.

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
