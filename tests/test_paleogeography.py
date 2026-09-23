"""`pipeline.paleogeography`: present-day location to paleo position via the Merdith et al. 2021
plate model. The pygplates success path is exercised manually, never offline; these tests cover
the import deferral and the refusal when the plate model files are absent."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import paleogeography
from pipeline.paleogeography import PlateModelUnavailable, load_reconstructor


def test_module_defers_the_pygplates_import() -> None:
    assert "pygplates" not in vars(paleogeography)


def test_load_reconstructor_refuses_when_a_plate_model_file_is_missing(tmp_path: Path) -> None:
    with pytest.raises(PlateModelUnavailable):
        load_reconstructor(tmp_path)
    (tmp_path / "shapes_continents_Merdith_et_al.gpml").write_bytes(b"")
    with pytest.raises(PlateModelUnavailable):
        load_reconstructor(tmp_path)
