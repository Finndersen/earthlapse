"""Offline validator for sources/plates-neoproterozoic, run against the committed fixture only.

The fixture is a real, deliberately narrow slice: plate id 8013 only (Tasmania's Tyennan /
Rocky Cape / Mt Read terranes) from Merdith et al. 2021's continent and craton shapefiles,
plus the full (small) 1000-0 Ma rotation file -- see sources/plates-neoproterozoic/fixture/
and README.md "Fixture". `normalise()` never opens these -- unlike sources/paleodem, the
frame ages are fixed by the module, not discovered from raw content (see normalise.py's
module docstring) -- so these tests only confirm fetch()'s expected raw files are present
and that `normalise()` builds the right `RasterSequence` shape from them. The actual
pygplates reconstruction (`relief.py`, loaded only from `write_outputs()`) is exercised
manually, never in this offline suite -- see README.md "Confirming pygplates can
reconstruct".
"""

from __future__ import annotations

import pytest

from pipeline.shapes import RasterSequence
from tests.sources.support import fixture_dir, load_source_module

EXPECTED_FRAME_COUNT = 47  # 1000..550 Ma every 10 Myr (46) plus the 540 Ma seam frame


@pytest.fixture(scope="module")
def plates_normalise():
    return load_source_module("plates-neoproterozoic", "normalise")


@pytest.fixture(scope="module")
def raster(plates_normalise) -> RasterSequence:
    shapes = plates_normalise.normalise(fixture_dir("plates-neoproterozoic"))
    assert len(shapes) == 1
    (shape,) = shapes
    assert isinstance(shape, RasterSequence)
    return shape


def test_fixture_has_the_three_files_fetch_extracts(plates_normalise) -> None:
    raw_dir = fixture_dir("plates-neoproterozoic")
    for name in (
        "shapes_continents_Merdith_et_al.gpml",
        "shapes_cratons_Merdith_et_al.gpml",
        "1000_0_rotfile_Merdith_et_al.rot",
    ):
        assert (raw_dir / name).is_file()


def test_normalise_raises_when_a_raw_file_is_missing(plates_normalise, tmp_path) -> None:
    (tmp_path / "shapes_continents_Merdith_et_al.gpml").write_bytes(b"")
    # cratons and rotations deliberately absent
    with pytest.raises(plates_normalise.MissingRawFilesError):
        plates_normalise.normalise(tmp_path)


def test_shape_id(raster: RasterSequence) -> None:
    assert raster.id == "plates_neoproterozoic"


def test_frame_count(raster: RasterSequence) -> None:
    assert len(raster.frames) == EXPECTED_FRAME_COUNT


def test_frames_are_sorted_by_t(raster: RasterSequence) -> None:
    ts = [f.t for f in raster.frames]
    assert ts == sorted(ts)


def test_frame_domain_is_1000_to_540_ma_in_years(raster: RasterSequence) -> None:
    assert raster.domain == (5.4e8, 1.0e9)


def test_every_10_myr_from_1000_to_550_plus_the_540_seam_frame(plates_normalise) -> None:
    ages = sorted(plates_normalise.FRAME_AGES_MA, reverse=True)
    assert ages[0] == 1000.0
    assert ages[-2] == 550.0
    assert ages[-1] == 540.0  # the extra seam frame, 10 Myr short of the regular spacing
    regular = ages[:-1]
    assert regular == [1000.0 - 10.0 * i for i in range(len(regular))]


def test_frame_refs_are_well_formed(raster: RasterSequence) -> None:
    """Every ref is a relative `textures/plates_neoproterozoic/<age>Ma.webp` path, resolved
    against the manifest's assetBase at runtime -- same convention as sources/paleodem."""
    refs = {f.t: f.ref for f in raster.frames}
    assert refs[1.0e9] == "textures/plates_neoproterozoic/1000.0Ma.webp"
    assert refs[5.5e8] == "textures/plates_neoproterozoic/0550.0Ma.webp"
    assert refs[5.4e8] == "textures/plates_neoproterozoic/0540.0Ma.webp"


def test_texture_name_zero_pads_to_a_fixed_width(plates_normalise) -> None:
    assert plates_normalise._texture_name(1000.0) == "1000.0Ma.webp"
    assert plates_normalise._texture_name(540.0) == "0540.0Ma.webp"


def test_write_outputs_defers_the_pygplates_import(plates_normalise) -> None:
    """normalise.py's own module dict must never bind `pygplates` -- proof the module stays
    importable, and this test suite runnable, without the `geo` extra installed (module
    docstring)."""
    assert "pygplates" not in vars(plates_normalise)
