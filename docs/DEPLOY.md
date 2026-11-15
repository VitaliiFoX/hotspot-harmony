# Deploying the demo

The demo has two parts: the API, a Docker image with the record inside, and the web app, static files that
call it. Both fit free plans: the API on a Render free web service (512 MB, 0.1 CPU), the web app as a
Cloudflare Worker with static assets. A push to `main` deploys both (step 4).

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

Since 2026-11-15 the default is the record of every country (147 MB packed): the harmonized record and the
report of `make world`, with the hotspots of Argentina and Ukraine, since those of every country are 6 GB.
The image then runs with `HH_CONFIG=config/world.yaml`, set in the `Dockerfile`.

```sh
mkdir -p data/deploy_world/agg && cp -R data/points data/deploy_world/points
cp data/world/agg/harmonized.parquet data/world/agg/harmonization_report.json data/deploy_world/agg/
COPYFILE_DISABLE=1 tar -czf hotspot-harmony-world.tar.gz -C data/deploy_world \
  agg/harmonized.parquet agg/harmonization_report.json points
gh release create data-world-2026-11-15 hotspot-harmony-world.tar.gz --title "World record for the demo, 2026-11-15"
```

Measured on 2026-11-15 on a laptop, not in the limited container, with `HH_DUCKDB_MEMORY=150MB` and
`HH_DUCKDB_THREADS=1`: 205 MB idle, 257 MB after the requests of one page (1-degree tiles), 425 MB after
`/api/cells` at 0.25 degrees for the whole world. To go back to the two countries, build the image with
`--build-arg DATA_URL=<the data-2026-11-15 link>` and run it with `HH_CONFIG=config/regions.yaml`.

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

## 3. The web app on Cloudflare

The web app is a Cloudflare Worker with static assets only, configured in `web/wrangler.jsonc`. Build it
with the address of the API and upload it:

```sh
cd web && npm install && VITE_API_URL=https://hotspot-harmony.onrender.com npm run build
npx wrangler login        # once
npx wrangler deploy
```

The first upload can also go through the dashboard: Workers & Pages > Create > Upload your static files,
the folder `web/dist`, "Not found handling" set to `single-page-application`.

The site is then at `https://hotspot-harmony.<account>.workers.dev`. Put that address into
`HH_CORS_ORIGINS` on Render (comma-separated, more than one is fine), or the browser refuses the API's
answers.

## 4. Deploys on every push to main

`.github/workflows/deploy.yml` deploys the part of the demo a push to `main` changes, after its checks pass:

| Push changes | Checks | Deploy |
|---|---|---|
| `api/`, `pipeline/`, `config/`, `Dockerfile`, `.dockerignore`, `pyproject.toml`, `uv.lock` | `pytest` | the Render deploy hook builds the image from `main` |
| `web/` | `npm test`, `npm run build` (with `tsc`) | `wrangler deploy` uploads `web/dist` |

"Run workflow" on the Deploy workflow in the Actions tab deploys both. It needs three repository secrets
(Settings > Secrets and variables > Actions; only the owner of the repository can add them):

| Secret | Where to get it |
|---|---|
| `RENDER_DEPLOY_HOOK_URL` | Render, the service > Settings > Deploy Hook |
| `CLOUDFLARE_API_TOKEN` | Cloudflare, My Profile > API Tokens > Create Token, template "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare, Workers & Pages overview, or `npx wrangler whoami` |

Without a secret the job warns and deploys nothing, so the workflow stays green before the setup. The web
app is built against `https://hotspot-harmony.onrender.com`; a repository variable `VITE_API_URL` points it
elsewhere. A new record still goes through step 1: a new release, and the new link as the default of
`DATA_URL` in the `Dockerfile`.
