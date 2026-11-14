.PHONY: data ingest normalize aggregate harmonize validate json api web dev test lint

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

validate:
	uv run python -m pipeline.validate

# Local stand: API on :8000, web app on :5173 (Ctrl+C stops both)
api:
	uv run uvicorn api.main:app --reload --port 8000

web:
	npm --prefix web install && npm --prefix web run dev

dev:
	$(MAKE) -j2 api web

# Export downloaded CSV files as JSON, e.g.: make json COUNTRY=Ukraine YEAR=2024 FORMAT=geojson
json:
	uv run python -m pipeline.csv_to_json $(COUNTRY_ARG) $(if $(YEAR),--year $(YEAR)) $(if $(FORMAT),--format $(FORMAT))

test:
	uv run pytest -q

lint:
	uv run ruff check .
