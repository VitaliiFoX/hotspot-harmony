# Hotspot Harmony: web app

One screen: draw an area on the map and get a burning activity calendar for it, from 2000 to today,
on one comparable scale (MODIS-equivalent fire cell-days). All numbers come from the API; the
frontend only draws them.

## Run

Needs Node 20+ and npm.

```bash
npm install
npm run dev        # http://localhost:5173, expects the API at http://localhost:8000
```

Without a backend, on built-in synthetic fixtures (the numbers mean nothing):

```bash
VITE_USE_FIXTURES=1 npm run dev
```

## Scripts

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Dev server on port 5173                                         |
| `npm run build`     | Type-check, then production build into `dist/`                  |
| `npm run preview`   | Serve the production build on port 4173                         |
| `npm test`          | Unit tests (vitest)                                             |
| `npm run lint`      | eslint + prettier check                                         |
| `npm run format`    | Rewrite files with prettier                                     |
| `npm run check:api` | Check a running API against the contract the frontend relies on |

## Environment

Copy `.env.example` to `.env.local` if you need to change anything.

| Variable            | Default                 | Meaning                                        |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `VITE_API_URL`      | `http://localhost:8000` | Base URL of the API                            |
| `VITE_USE_FIXTURES` | empty                   | `1` = no network, synthetic data from fixtures |

The API must allow the page's origin (CORS) and expose the `X-Truncated` and `Content-Disposition`
headers, otherwise the CSV export cannot tell when a file was cut off.

## Layout

```
src/api/         typed client for /api/health, /api/meta, /api/calendar, /api/hotspots.csv
src/lib/         pure logic with tests: URL state, headline sentence, bbox/circle to polygon,
                 month grid, number formatting, report parsing, example areas
src/charts/      ECharts option builders (calendar heatmap, seasonal profile, yearly totals,
                 detection curve) and the PNG export
src/components/  React components: map with drawing, forms, panels
src/fixtures/    saved /api/meta answer and a deterministic generator of calendar answers
scripts/         check-contract.mjs
```

## Notes

- Basemap: OpenFreeMap "positron" (no key). If its style cannot be loaded, the map falls back to
  OpenStreetMap raster tiles.
- The polygon, the date range and the raw/harmonized switch are kept in the URL hash, so a link
  reproduces the view: `#g=29.2,51.1;30.6,51.1;30.6,51.6;29.2,51.6&from=2010-01&view=raw`.
- Colours: viridis for counts, PuOr for deviation from the usual level; the calendar also has a
  table view, and every value is in a tooltip.
- Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Hotspots are thermal anomalies, not
  confirmed fires or burned area. Not affiliated with or endorsed by NASA.
