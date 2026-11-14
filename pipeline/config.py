"""Read config/regions.yaml into typed objects shared by every pipeline step."""

from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "regions.yaml"
DEFAULT_DATA = ROOT / "data"


@dataclass(frozen=True)
class Region:
    name: str  # as written in FIRMS archive file names, e.g. "United_States"
    bbox: tuple[float, float, float, float]  # west, south, east, north


@dataclass(frozen=True)
class Sensor:
    id: str  # modis | viirs_snpp | viirs_noaa20
    archive: str  # folder name in the FIRMS country archive
    first_year: int


@dataclass(frozen=True)
class Config:
    regions: tuple[Region, ...]
    sensors: tuple[Sensor, ...]
    cell_deg: float
    drop_confidence: tuple[str, ...]
    keep_types: tuple[int, ...]
    world: bool = False  # take every country in the FIRMS archive instead of the listed regions

    def countries(self, only: list[str] | None = None) -> list[str] | None:
        """Country names to process; None means every country found in the raw data (world mode)."""
        if self.world:
            return only or None
        return self.region_names(only)

    def region_names(self, only: list[str] | None = None) -> list[str]:
        names = [r.name for r in self.regions]
        if not only:
            return names
        unknown = sorted(set(only) - set(names))
        if unknown:
            raise SystemExit(f"not in config/regions.yaml: {', '.join(unknown)} (available: {', '.join(names)})")
        return [n for n in names if n in only]


def load_config(path: Path = DEFAULT_CONFIG) -> Config:
    raw = yaml.safe_load(Path(path).read_text())
    return Config(
        regions=tuple(Region(r["name"], tuple(r["bbox"])) for r in raw["regions"]),
        sensors=tuple(Sensor(sid, s["archive"], int(s["first_year"])) for sid, s in raw["sensors"].items()),
        cell_deg=float(raw["grid"]["cell_deg"]),
        drop_confidence=tuple(raw["filters"]["drop_confidence"]),
        keep_types=tuple(int(t) for t in raw["filters"]["keep_types"]),
        world=bool(raw.get("world", False)),
    )
