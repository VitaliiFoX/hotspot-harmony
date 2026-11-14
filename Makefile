.PHONY: data ingest normalize aggregate test lint

# Limit to one country with: make data COUNTRY=Ukraine
COUNTRY_ARG := $(if $(COUNTRY),--country $(COUNTRY))

data: ingest normalize aggregate

ingest:
	uv run python -m pipeline.ingest $(COUNTRY_ARG)

normalize:
	uv run python -m pipeline.normalize $(COUNTRY_ARG)

aggregate:
	uv run python -m pipeline.aggregate

test:
	uv run pytest -q

lint:
	uv run ruff check .
