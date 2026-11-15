# The API of the burning activity calendar, with the record it serves inside the image.
# The record is not in git (`make data` builds it), so the build takes it from a .tar.gz that holds
# agg/harmonized.parquet, agg/harmonization_report.json and points/. See docs/DEPLOY.md.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_NO_CACHE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY api api
COPY pipeline pipeline
COPY config config

ARG DATA_URL=https://github.com/VitaliiFoX/hotspot-harmony/releases/download/data-2026-11-15/hotspot-harmony-data.tar.gz
RUN python -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], '/tmp/data.tar.gz')" "$DATA_URL" \
    && mkdir data && tar -xzf /tmp/data.tar.gz -C data && rm /tmp/data.tar.gz

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# The host names the port in PORT (Render does); 8000 otherwise.
CMD ["sh", "-c", "exec uvicorn --factory api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
