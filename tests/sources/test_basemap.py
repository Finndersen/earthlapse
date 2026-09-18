"""Offline validator for sources/basemap, run against the committed fixture only.

The fixture is the real downloaded Natural Earth II GeoTIFF, resized (Lanczos, real pixel
data) down to 64x32 -- see sources/basemap/fixture/ and README.md "Fixture". `normalise()`
never opens the .tif (there is nothing to discover per-epoch -- this source is a single flat
image, unlike sources/paleodem), so these tests only confirm fetch()'s expected raw file is
present and that `normalise()`/`render_textures()` build the right shapes and images from it.
"""

from __future__ import annotations

import pytest
from PIL import Image

from pipeline.shapes import RasterSequence
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def basemap_normalise():
    return load_source_module("basemap", "normalise")


@pytest.fixture(scope="module")
def rasters(basemap_normalise) -> list[RasterSequence]:
    shapes = basemap_normalise.normalise(fixture_dir("basemap"))
    assert all(isinstance(s, RasterSequence) for s in shapes)
    return shapes


def test_fixture_has_the_tif_fetch_extracts() -> None:
    matches = list(fixture_dir("basemap").glob("*.tif"))
    assert len(matches) == 1


def test_normalise_raises_when_no_tif(basemap_normalise, tmp_path) -> None:
    with pytest.raises(basemap_normalise.MissingRawFileError):
        basemap_normalise.normalise(tmp_path)


def test_normalise_raises_when_multiple_tifs(basemap_normalise, tmp_path) -> None:
    (tmp_path / "a.tif").write_bytes(b"")
    (tmp_path / "b.tif").write_bytes(b"")
    with pytest.raises(basemap_normalise.MissingRawFileError):
        basemap_normalise.normalise(tmp_path)


def test_two_tiers_published(rasters: list[RasterSequence]) -> None:
    ids = {r.id for r in rasters}
    assert ids == {"basemap_t0", "basemap_t1"}


def test_each_tier_has_two_identical_ref_frames(rasters: list[RasterSequence]) -> None:
    for raster in rasters:
        assert len(raster.frames) == 2
        refs = {f.ref for f in raster.frames}
        assert len(refs) == 1  # both frames reference the same texture file


def test_domain_is_present_to_pleistocene_start(
    rasters: list[RasterSequence], basemap_normalise
) -> None:
    for raster in rasters:
        assert raster.domain == (0.0, basemap_normalise.PLEISTOCENE_START)


def test_frame_refs_are_well_formed(rasters: list[RasterSequence]) -> None:
    by_id = {r.id: r for r in rasters}
    assert by_id["basemap_t0"].frames[0].ref == "textures/basemap/basemap_t0.webp"
    assert by_id["basemap_t1"].frames[0].ref == "textures/basemap/basemap_t1.webp"


def test_render_textures_writes_both_tiers_at_the_right_size(basemap_normalise, tmp_path) -> None:
    basemap_normalise.render_textures(fixture_dir("basemap"), tmp_path)
    out_dir = tmp_path / "textures" / "basemap"
    for tier, size in basemap_normalise.TIER_SIZES.items():
        path = out_dir / f"{tier}.webp"
        assert path.is_file()
        with Image.open(path) as image:
            assert image.size == size


def test_render_textures_clears_stale_files(basemap_normalise, tmp_path) -> None:
    out_dir = tmp_path / "textures" / "basemap"
    out_dir.mkdir(parents=True)
    stale = out_dir / "old_tier.webp"
    stale.write_bytes(b"stale")
    basemap_normalise.render_textures(fixture_dir("basemap"), tmp_path)
    assert not stale.exists()
