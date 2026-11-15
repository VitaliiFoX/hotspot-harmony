.PHONY: data ingest normalize aggregate harmonize validate day-points world json api web test lint borders

# Limit to one country with: make data COUNTRY=Ukraine
# Whole world with: make data CONFIG=config/world.yaml (and make api CONFIG=config/world.yaml)
COUNTRY_ARG := $(if $(COUNTRY),--country $(COUNTRY))
CONFIG_ARG := $(if $(CONFIG),--config $(CONFIG))

data: ingest normalize aggregate harmonize validate

ingest:
	uv run python -m pipeline.ingest $(CONFIG_ARG) $(COUNTRY_ARG)

normalize:
	uv run python -m pipeline.normalize $(CONFIG_ARG) $(COUNTRY_ARG)

aggregate:
	uv run python -m pipeline.aggregate $(CONFIG_ARG)

harmonize:
	uv run python -m pipeline.harmonize $(CONFIG_ARG)

# writes data/agg/harmonization_report.json, docs/VALIDATION.md and docs/sensor_jump_before_after.png
# NESTED=1 also repeats the choice of method for every held-out year: the figures to quote, about 25 minutes
validate:
	uv run python -m pipeline.validate $(CONFIG_ARG) $(if $(NESTED),--nested-choice)

# Hotspots of every country for the globe's day view, in data/day_points/: the FIRMS global zips (about 10 GB,
# kept zipped) are read one at a time into about 1 GB of Parquet. Leaves data/points/ and data/agg/ alone.
day-points:
	uv run python -m pipeline.ingest --config config/world.yaml --zips-only
	uv run python -m pipeline.day_points --config config/world.yaml

# Harmonize and validate every country into data/world/ (points about 6 GB, cell-days, the record), from the same
# world zips, one zip and one country at a time. The pilot countries are copied from data/agg/: run
# `make harmonize validate NESTED=1` first. Writes docs/VALIDATION_WORLD.md.
world:
	uv run python -m pipeline.ingest --config config/world.yaml --zips-only
	mkdir -p data/world/raw && ln -sfn ../../raw/zips data/world/raw/zips
	uv run python -m pipeline.normalize --config config/world.yaml --data data/world --from-zips
	uv run python -m pipeline.aggregate --config config/world.yaml --data data/world
	uv run python -m pipeline.world --data data/world --pilot data

# Export downloaded CSV files as JSON, e.g.: make json COUNTRY=Ukraine YEAR=2024 FORMAT=geojson
json:
	uv run python -m pipeline.csv_to_json $(COUNTRY_ARG) $(if $(YEAR),--year $(YEAR)) $(if $(FORMAT),--format $(FORMAT))

# http://localhost:8000/docs lists the endpoints
api:
	HH_CONFIG=$(CONFIG) uv run uvicorn --factory api.main:app --reload --reload-dir api

# http://localhost:5173, talks to `make api` through a dev proxy
web:
	cd web && npm install && npm run dev

test:
	uv run pytest -q
	cd web && npm test

# writes web/public/countries.geojson, the borders a country is picked by on the globe (Natural Earth)
borders:
	uv run python scripts/build_countries.py

lint:
	uv run ruff check .
	uv run python scripts/check_english.py
