"""HTTP API for the burning activity calendar.

    GET  /api/health         is the service up, and has the pipeline produced data
    GET  /api/meta           regions, available series, months covered
    POST /api/calendar       month-by-month burning activity of an area of interest
    POST /api/hotspots.csv   the hotspots inside an area between two dates
    GET  /api/hotspots/days  the hotspot count of each UTC day of one month, all regions together
    GET  /api/hotspots/day   the hotspots of one UTC day, all regions together, earliest first

Run locally:  make api   (needs `make data` first)
Settings: HH_DATA_DIR (default ./data), HH_CONFIG (default config/regions.yaml),
          HH_CORS_ORIGINS (comma-separated, default the Vite dev server).
"""

import os
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from api.store import ApiError, Store
from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA, load_config

MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
DAY = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"


class CalendarRequest(BaseModel):
    geometry: dict = Field(description="GeoJSON Polygon or MultiPolygon, longitude first")
    start: str | None = Field(None, pattern=MONTH, description="first month, YYYY-MM; default: start of the record")
    end: str | None = Field(None, pattern=MONTH, description="last month, YYYY-MM; default: end of the record")
    series: Literal["raw", "harmonized"] | None = Field(None, description="default: harmonized when available")


class HotspotsRequest(BaseModel):
    geometry: dict = Field(description="GeoJSON Polygon or MultiPolygon, longitude first")
    start: str = Field(pattern=DAY, description="first day, YYYY-MM-DD (UTC)")
    end: str = Field(pattern=DAY, description="last day, YYYY-MM-DD (UTC), inclusive")


def create_app(
    data_dir: Path | None = None,
    config_path: Path | None = None,
    csv_limit: int = 500_000,
    day_limit: int = 50_000,
) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("HH_DATA_DIR") or DEFAULT_DATA)
    config_path = Path(config_path or os.environ.get("HH_CONFIG") or DEFAULT_CONFIG)
    store = Store(data_dir, load_config(config_path), csv_limit)
    app = FastAPI(title="hotspot-harmony", description=__doc__.splitlines()[0])
    origins = os.environ.get("HH_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["X-Truncated"],
    )
    # A calendar answer is ~18 kB of JSON and a CSV export can be tens of MB: both shrink 5-10 times.
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.exception_handler(ApiError)
    def api_error(_: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "data": bool(store.series)}

    @app.get("/api/meta")
    def meta() -> dict:
        return store.meta()

    @app.post("/api/calendar")
    def calendar(body: CalendarRequest) -> dict:
        return store.calendar(body.geometry, body.start, body.end, body.series)

    @app.post("/api/hotspots.csv")
    def hotspots_csv(body: HotspotsRequest) -> Response:
        text, truncated = store.hotspots_csv(body.geometry, body.start, body.end)
        return Response(
            text,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="hotspots_{body.start}_{body.end}.csv"',
                "X-Truncated": str(truncated).lower(),
            },
        )

    @app.get("/api/hotspots/days")
    def hotspot_days(month: Annotated[str, Query(pattern=MONTH, description="YYYY-MM (UTC)")]) -> dict:
        return store.hotspot_days(month)

    @app.get("/api/hotspots/day")
    def hotspot_day(date: Annotated[str, Query(pattern=DAY, description="YYYY-MM-DD (UTC)")]) -> dict:
        return store.hotspot_day(date, day_limit)

    return app


def app() -> FastAPI:
    """Factory for `uvicorn --factory api.main:app`; the data is read when the server starts."""
    return create_app()
