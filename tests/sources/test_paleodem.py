"""sources/paleodem against its committed fixture: the real 0 Ma and 540 Ma grids re-encoded to
compact int16 netCDF. normalise() emits one frame per raw epoch, so the fixture yields a
2-frame RasterSequence by the same path the real build uses for all 109."""

from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path

import httpx
import numpy as np
import pytest
from PIL import Image

pytest.importorskip("xarray")

from pipeline.shapes import Interpolation, RasterSequence, TimeSeries
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def paleodem_normalise():
    return load_source_module("paleodem", "normalise")


def test_normalise_emits_one_frame_and_one_land_fraction_per_epoch(paleodem_normalise) -> None:
    raster, series = paleodem_normalise.normalise(fixture_dir("paleodem"))

    assert isinstance(raster, RasterSequence) and isinstance(series, TimeSeries)
    assert (raster.id, series.id, series.unit, series.interpolation) == (
        "paleodem",
        "land_fraction",
        "fraction",
        Interpolation.LINEAR,
    )
    assert [(f.t, f.ref) for f in raster.frames] == [
        (0.0, "textures/paleodem/000.0Ma.webp"),
        (540.0e6, "textures/paleodem/540.0Ma.webp"),
    ]
    # Area-weighted land fraction: ~0.275 today, and not the same grid read twice.
    today, cambrian = series.sample(0.0), series.sample(540.0e6)
    assert today == pytest.approx(0.29, abs=0.03)
    assert cambrian is not None and cambrian != pytest.approx(today, abs=1e-9)


def test_frame_ref_keeps_the_real_age_of_off_grid_epochs(paleodem_normalise) -> None:
    assert paleodem_normalise._frame_ref(385.2) == "textures/paleodem/385.2Ma.webp"


def test_render_textures_writes_one_webp_per_frame_ref_and_removes_stale_files(
    paleodem_normalise, tmp_path: Path
) -> None:
    out_dir = tmp_path / "textures" / "paleodem"
    out_dir.mkdir(parents=True)
    (out_dir / "000Ma.png").write_bytes(b"texture from an older naming scheme")

    paleodem_normalise.render_textures(fixture_dir("paleodem"), tmp_path)

    assert sorted(p.name for p in out_dir.iterdir()) == ["000.0Ma.webp", "540.0Ma.webp"]
    for path in out_dir.iterdir():
        with Image.open(path) as image:
            assert (image.format, image.mode, image.size) == ("WEBP", "RGB", (1024, 512))


def test_colour_map_reads_blue_at_depth_and_not_blue_on_land(paleodem_normalise) -> None:
    sea, land = paleodem_normalise.elevation_to_rgb(np.array([-4000.0, 2000.0]))

    assert sea[2] > sea[1]
    assert land[1] >= land[2]


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_extracts_only_the_nc_members_of_the_archive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Scotese_Wright_2018_v2/Map01_0Ma.nc", b"fake netcdf bytes")
        archive.writestr("Scotese_Wright_2018_v2/License.txt", b"licence text")
    zip_bytes = buffer.getvalue()
    module = load_source_module("paleodem", "fetch")
    manifest = tmp_path / "manifest.toml"
    manifest.write_text(
        'name = "paleodem"\nurl = "https://example.invalid/paleodem.zip"\n'
        f'sha256 = "{hashlib.sha256(zip_bytes).hexdigest()}"\n'
    )
    monkeypatch.setattr(module, "_MANIFEST", manifest)
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(zip_bytes))
    raw_dir = tmp_path / "raw"

    module.fetch(raw_dir)

    assert (raw_dir / "Map01_0Ma.nc").is_file()
    assert not (raw_dir / "License.txt").exists()
