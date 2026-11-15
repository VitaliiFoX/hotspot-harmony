# Deploying the demo

The demo has two parts: the API, a Docker image with the record inside, and the web app, static files that
call it. Both fit free plans: the API on a Render free web service (512 MB, 0.1 CPU), the web app on
Cloudflare Pages.

## 1. The record

`data/` is not in git, so the image downloads the part of it the API reads (about 104 MB packed) from a
release of this repository. Build it after `make data` and publish it once per version of the record:

```sh
COPYFILE_DISABLE=1 tar -czf hotspot-harmony-data.tar.gz -C data \
  agg/harmonized.parquet agg/harmonization_report.json points
gh release create data-2026-11-15 hotspot-harmony-data.tar.gz \
  --title "Record for the demo, 2026-11-15" \
  --notes "Harmonized record and filtered hotspots of Argentina and Ukraine, 2000-11 to 2025-12, as written by make data. Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)."
```

The `Dockerfile` reads that file through its `DATA_URL` build argument. A new record means a new release
tag and the new link as the default of `DATA_URL`.

## 2. The API on Render

New > Web Service > Public Git Repository, with the address of this repository.

| Setting | Value |
|---|---|
| Language | Docker |
| Branch | `main` |
| Instance type | Free |
| Health check path | `/api/health` |
| `HH_CORS_ORIGINS` | the address of the web app, for example `https://hotspot-harmony.pages.dev` |
| `HH_DUCKDB_MEMORY` | `150MB` |
| `HH_DUCKDB_THREADS` | `1` |
| `HH_CSV_LIMIT` | `100000` |

Why the three last settings. Measured on 2026-11-15 in the image of this `Dockerfile`, limited as the free
instance is (`docker run --memory=512m --memory-swap=512m --cpus=0.1`), with the record of Argentina and
Ukraine:

| Request | Memory of the container | Time |
|---|---|---|
| idle after start | 117 MiB | starts in about 14 s |
| every request the page makes; the slowest is `/api/cells` at 0.25 degrees | up to 151 MiB | 2.3 s |
| hotspot download, Ukraine, one year (16.7 MB of CSV) | 235 MiB | 12 s |
| hotspot download, Ukraine, whole record, default settings | killed for memory at 512 MiB | - |
| the same with the three settings above (cut short at 100,000 rows, 7.2 MB) | 345 MiB at its peak | 22 s |
| the same with `HH_CSV_LIMIT=200000` (14.5 MB) | 393 MiB at its peak | 27 s |

The row limit alone does not help: DuckDB sorts every hotspot of the area and period before the limit
applies, and by default it takes memory in proportion to the machine, not to the container. With
`HH_DUCKDB_MEMORY` it sorts on disk. Two downloads at the same time were not
measured, so the lower limit is the safer one. The page reads the row limit from `/api/meta` and says when a download
was cut short.

A free instance sleeps after 15 minutes without a request and takes about a minute to wake. To keep it
awake during judging, have an uptime monitor request `/api/health` every 10 minutes.

## 3. The web app on Cloudflare Pages

Build it with the address of the API, then upload `web/dist` (Workers & Pages > Create > Pages > Upload
assets, or `npx wrangler pages deploy dist --project-name hotspot-harmony`):

```sh
cd web && npm install && VITE_API_URL=https://<service>.onrender.com npm run build
```

With the repository connected instead of an upload: root directory `web`, build command `npm run build`,
output directory `dist`, and `VITE_API_URL` as a build variable.

Then put the address Pages gives the site into `HH_CORS_ORIGINS` on Render, or the browser refuses the
API's answers.
