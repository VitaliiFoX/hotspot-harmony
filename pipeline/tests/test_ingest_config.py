import zipfile

import pytest

from pipeline.config import ROOT, load_config
from pipeline.ingest import archive_jobs, fetch, fetch_world, world_jobs


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


def test_force_replaces_a_file_that_is_already_there(tmp_path, monkeypatch):
    dest = tmp_path / "modis" / "modis_2024_Ukraine.csv"
    dest.parent.mkdir(parents=True)
    dest.write_text("old\n")

    class Reply:
        status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def raise_for_status(self):
            pass

        def iter_content(self, size):
            yield b"new\n"

    monkeypatch.setattr("pipeline.ingest.requests.get", lambda *a, **kw: Reply())
    name, status, size = fetch("modis", 2024, "Ukraine", tmp_path, force=True)
    assert (status, dest.read_text()) == ("downloaded", "new\n")
    assert not dest.with_suffix(".part").exists()


def test_existing_file_is_not_downloaded_again(tmp_path):
    dest = tmp_path / "modis" / "modis_2024_Ukraine.csv"
    dest.parent.mkdir(parents=True)
    dest.write_text("latitude,longitude\n1,2\n")
    name, status, size = fetch("modis", 2024, "Ukraine", tmp_path, force=False)  # would need network if not cached
    assert (name, status, size) == ("modis_2024_Ukraine.csv", "cached", dest.stat().st_size)


def test_world_config_takes_every_country():
    cfg = load_config(ROOT / "config" / "world.yaml")
    assert cfg.world and cfg.countries() is None
    assert cfg.countries(["Brazil"]) == ["Brazil"]  # any FIRMS country name, not only listed regions
    assert [r.bbox for r in cfg.regions] == [(-180.0, -90.0, 180.0, 90.0)]
    assert load_config().countries() == load_config().region_names()


def test_world_jobs_have_one_zip_per_sensor_year():
    cfg = load_config(ROOT / "config" / "world.yaml")
    jobs = world_jobs(cfg, 2025)
    assert ("modis", 2000) in jobs and ("viirs-jpss1", 2025) in jobs and ("viirs-snpp", 2011) not in jobs
    assert len(jobs) == sum(2025 - s.first_year + 1 for s in cfg.sensors)


def write_world_zip(raw, archive, year, files):
    path = raw / "zips" / f"{archive}_{year}_all_countries.zip"
    path.parent.mkdir(parents=True)
    with zipfile.ZipFile(path, "w") as z:
        for name, text in files.items():
            z.writestr(f"{archive}/{year}/{name}", text)
    return path


def test_cached_world_zip_is_extracted_without_overwriting(tmp_path):
    write_world_zip(
        tmp_path,
        "modis",
        2024,
        {
            "modis_2024_Brazil.csv": "latitude\n1\n",
            "modis_2024_Ukraine.csv": "latitude\n2\n",
            "AttributesReadme.txt": "not data",
        },
    )
    kept = tmp_path / "modis" / "modis_2024_Ukraine.csv"
    kept.parent.mkdir()
    kept.write_text("latitude\nalready here\n")
    name, status, _ = fetch_world("modis", 2024, tmp_path, force=False)  # would need network if not cached
    assert (name, status) == ("modis_2024_all_countries.zip", "extracted")
    assert sorted(p.name for p in (tmp_path / "modis").iterdir()) == ["modis_2024_Brazil.csv", "modis_2024_Ukraine.csv"]
    assert kept.read_text() == "latitude\nalready here\n"
    assert fetch_world("modis", 2024, tmp_path, force=False)[1] == "cached"


def test_broken_world_zip_is_removed(tmp_path):
    path = tmp_path / "zips" / "modis_2024_all_countries.zip"
    path.parent.mkdir()
    path.write_text("truncated download")
    _, status, _ = fetch_world("modis", 2024, tmp_path, force=False)
    assert status.startswith("FAILED") and not path.exists()
