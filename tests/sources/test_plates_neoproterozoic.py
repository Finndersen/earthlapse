"""sources/plates-neoproterozoic. normalise() only checks the three raw files are present (the
frame ages are fixed by the module), so these tests use empty placeholders under those names.
The pygplates reconstruction runs only from write_outputs() and is never exercised offline."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.shapes import RasterSequence
from tests.sources.support import load_source_module


@pytest.fixture(scope="module")
def plates_normalise():
    return load_source_module("plates-neoproterozoic", "normalise")


def test_normalise_emits_a_frame_every_10_myr_from_1000_ma_plus_the_540_ma_seam(
    plates_normalise, tmp_path: Path
) -> None:
    for name in plates_normalise._EXPECTED_RAW_FILENAMES:
        (tmp_path / name).write_bytes(b"")

    (raster,) = plates_normalise.normalise(tmp_path)

    assert isinstance(raster, RasterSequence)
    assert raster.id == "plates_neoproterozoic"
    assert len(raster.frames) == 47
    assert raster.domain == (5.4e8, 1.0e9)
    refs = {f.t: f.ref for f in raster.frames}
    assert refs[1.0e9] == "textures/plates_neoproterozoic/1000.0Ma.webp"
    assert refs[5.4e8] == "textures/plates_neoproterozoic/0540.0Ma.webp"


def test_normalise_raises_when_a_raw_file_is_missing(plates_normalise, tmp_path: Path) -> None:
    (tmp_path / "shapes_continents_Merdith_et_al.gpml").write_bytes(b"")

    with pytest.raises(plates_normalise.MissingRawFilesError):
        plates_normalise.normalise(tmp_path)


def test_the_module_defers_the_pygplates_import(plates_normalise) -> None:
    assert "pygplates" not in vars(plates_normalise)
