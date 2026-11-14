import pytest

from pipeline.config import load_config
from pipeline.ingest import archive_jobs, fetch


def test_default_config_loads():
    cfg = load_config()
    assert {s.id for s in cfg.sensors} == {"modis", "viirs_snpp", "viirs_noaa20"}
    assert cfg.cell_deg > 0 and cfg.regions
    for r in cfg.regions:
        west, south, east, north = r.bbox
        assert -180 <= west < east <= 180 and -90 <= south < north <= 90


def test_unknown_country_is_rejected():
    with pytest.raises(SystemExit, match="Atlantis"):
        load_config().region_names(["Atlantis"])


def test_archive_jobs_cover_every_sensor_year():
    cfg = load_config()
    jobs = archive_jobs(cfg, ["Ukraine"], 2025)
    assert ("modis", 2000, "Ukraine") in jobs and ("viirs-jpss1", 2025, "Ukraine") in jobs
    assert ("viirs-snpp", 2011, "Ukraine") not in jobs  # before the sensor existed
    assert len(jobs) == sum(2025 - s.first_year + 1 for s in cfg.sensors)


def test_existing_file_is_not_downloaded_again(tmp_path):
    dest = tmp_path / "modis" / "modis_2024_Ukraine.csv"
    dest.parent.mkdir(parents=True)
    dest.write_text("latitude,longitude\n1,2\n")
    name, status, size = fetch("modis", 2024, "Ukraine", tmp_path, force=False)  # would need network if not cached
    assert (name, status, size) == ("modis_2024_Ukraine.csv", "cached", dest.stat().st_size)
