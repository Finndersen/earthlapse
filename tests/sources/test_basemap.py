"""sources/basemap against its committed fixture: a real Natural Earth II GeoTIFF resized to
64x32. The source is a single flat image published as two resolution tiers."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from pipeline.shapes import RasterSequence
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def basemap_normalise():
    return load_source_module("basemap", "normalise")


def test_normalise_emits_two_flat_tiers_spanning_present_to_the_pleistocene(
    basemap_normalise,
) -> None:
    rasters = basemap_normalise.normalise(fixture_dir("basemap"))

    assert all(isinstance(r, RasterSequence) for r in rasters)
    assert {r.id: {f.ref for f in r.frames} for r in rasters} == {
        "basemap_t0": {"textures/basemap/basemap_t0.webp"},
        "basemap_t1": {"textures/basemap/basemap_t1.webp"},
    }
    for raster in rasters:
        assert raster.domain == (0.0, basemap_normalise.PLEISTOCENE_START)


def test_normalise_refuses_anything_but_exactly_one_tif(basemap_normalise, tmp_path: Path) -> None:
    with pytest.raises(basemap_normalise.MissingRawFileError):
        basemap_normalise.normalise(tmp_path)
    (tmp_path / "a.tif").write_bytes(b"")
    (tmp_path / "b.tif").write_bytes(b"")
    with pytest.raises(basemap_normalise.MissingRawFileError):
        basemap_normalise.normalise(tmp_path)


def test_render_textures_writes_both_tiers_and_clears_stale_files(
    basemap_normalise, tmp_path: Path
) -> None:
    out_dir = tmp_path / "textures" / "basemap"
    out_dir.mkdir(parents=True)
    (out_dir / "old_tier.webp").write_bytes(b"stale")

    basemap_normalise.render_textures(fixture_dir("basemap"), tmp_path)

    for tier, size in basemap_normalise.TIER_SIZES.items():
        with Image.open(out_dir / f"{tier}.webp") as image:
            assert image.size == size
    assert not (out_dir / "old_tier.webp").exists()
