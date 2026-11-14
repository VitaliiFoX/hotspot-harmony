.PHONY: data ingest normalize aggregate harmonize validate json api web test lint

# Limit to one country with: make data COUNTRY=Ukraine
COUNTRY_ARG := $(if $(COUNTRY),--country $(COUNTRY))

data: ingest normalize aggregate harmonize validate

ingest:
	uv run python -m pipeline.ingest $(COUNTRY_ARG)

normalize:
	uv run python -m pipeline.normalize $(COUNTRY_ARG)

aggregate:
	uv run python -m pipeline.aggregate

harmonize:
	uv run python -m pipeline.harmonize

# writes data/agg/harmonization_report.json, docs/VALIDATION.md and docs/sensor_jump_before_after.png
validate:
	uv run python -m pipeline.validate

# Export downloaded CSV files as JSON, e.g.: make json COUNTRY=Ukraine YEAR=2024 FORMAT=geojson
json:
	uv run python -m pipeline.csv_to_json $(COUNTRY_ARG) $(if $(YEAR),--year $(YEAR)) $(if $(FORMAT),--format $(FORMAT))

# http://localhost:8000/docs lists the endpoints
api:
	uv run uvicorn --factory api.main:app --reload --reload-dir api

# http://localhost:5173, talks to `make api` through a dev proxy
web:
	cd web && npm install && npm run dev

test:
	uv run pytest -q
	cd web && npm test

lint:
	uv run ruff check .
	uv run python scripts/check_english.py
