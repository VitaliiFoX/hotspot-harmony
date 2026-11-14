"""HTTP API over the harmonized record.

Run:  uv run uvicorn api.main:app --reload --port 8000
Env:  HOTSPOT_DATA (default ./data), HOTSPOT_CONFIG (default config/regions.yaml),
      CORS_ORIGINS (comma-separated extra origins; localhost is always allowed)
"""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.queries import BadGeometry, OutsideCoverage, Store
from pipeline.config import DEFAULT_CONFIG, DEFAULT_DATA


class CalendarRequest(BaseModel):
    geometry: dict
    start: str | None = None  # YYYY-MM
    end: str | None = None


class ExportRequest(BaseModel):
    geometry: dict
    start: str  # YYYY-MM-DD
    end: str


def create_app(store: Store | None = None) -> FastAPI:
    app = FastAPI(title="hotspot-harmony API", version="0.1.0")
    extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=extra,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["X-Truncated", "Content-Disposition"],
    )
    state: dict = {"store": store}

    def get_store() -> Store:
        if state["store"] is None:
            data = Path(os.environ.get("HOTSPOT_DATA", DEFAULT_DATA))
            config = Path(os.environ.get("HOTSPOT_CONFIG", DEFAULT_CONFIG))
            if not (data / "agg" / "harmonized.parquet").exists():
                raise HTTPException(503, "Data is not built yet: run `make data`.")
            state["store"] = Store(data, config)
        return state["store"]

    def guarded(fn, *args):
        try:
            return fn(*args)
        except BadGeometry as e:
            raise HTTPException(400, str(e)) from None
        except OutsideCoverage as e:
            raise HTTPException(422, str(e)) from None

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/meta")
    def meta() -> dict:
        return get_store().meta()

    @app.post("/api/calendar")
    def calendar(req: CalendarRequest) -> dict:
        return guarded(get_store().calendar, req.geometry, req.start, req.end)

    @app.post("/api/hotspots.csv")
    def hotspots_csv(req: ExportRequest) -> StreamingResponse:
        chunks, truncated = guarded(get_store().hotspots_csv, req.geometry, req.start, req.end)
        headers = {
            "Content-Disposition": f'attachment; filename="hotspots_{req.start}_{req.end}.csv"',
            "X-Truncated": "true" if truncated else "false",
        }
        return StreamingResponse(iter(chunks), media_type="text/csv", headers=headers)

    return app


app = create_app()
