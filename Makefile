.PHONY: data ingest normalize aggregate api test lint

# Limit to one country with: make data COUNTRY=Ukraine
COUNTRY_ARG := $(if $(COUNTRY),--country $(COUNTRY))

data: ingest normalize aggregate

ingest:
	uv run python -m pipeline.ingest $(COUNTRY_ARG)

normalize:
	uv run python -m pipeline.normalize $(COUNTRY_ARG)

aggregate:
	uv run python -m pipeline.aggregate

# http://localhost:8000/docs lists the endpoints
api:
	uv run uvicorn --factory api.main:app --reload --reload-dir api

test:
	uv run pytest -q

lint:
	uv run ruff check .
	uv run python scripts/check_english.py
