.PHONY: data ingest normalize aggregate api web test lint

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

# http://localhost:5173, talks to `make api` through a dev proxy
web:
	cd web && npm install && npm run dev

test:
	uv run pytest -q
	cd web && npm test

lint:
	uv run ruff check .
	uv run python scripts/check_english.py
