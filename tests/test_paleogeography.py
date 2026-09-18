"""`pipeline.paleogeography` (ADR-034): present-day location -> paleo position, wrapping the
Merdith et al. 2021 plate model already fetched for sources/plates-neoproterozoic.

Offline only. `load_reconstructor`'s pygplates-touching success path (real partitioning and
rotation against real Merdith geometry) is exercised manually, never here -- the same
convention `sources/plates-neoproterozoic`'s own test suite keeps (see that source's README
"Confirming pygplates can reconstruct"). What *is* tested here: the module never binds
`pygplates` at import time (so it, and anything that imports it, stays importable without the
`geo` extra), and `load_reconstructor` raises `PlateModelUnavailable` -- never silently
succeeds or falls back -- when the plate model files aren't present. That failure path
converges to the same exception regardless of whether pygplates itself happens to be
installed in the environment running this test, so it needs no `geo`-extra skip.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import paleogeography
from pipeline.paleogeography import MODEL_DOMAIN, PlateModelUnavailable, load_reconstructor


def test_module_defers_the_pygplates_import() -> None:
    """Proof this module -- and pipeline.publish, which imports it unconditionally -- stays
    importable without the `geo` extra installed (module docstring)."""
    assert "pygplates" not in vars(paleogeography)


def test_model_domain_is_the_merdith_published_range() -> None:
    assert MODEL_DOMAIN == (0.0, 1.0e9)


def test_load_reconstructor_raises_when_the_raw_directory_is_empty(tmp_path: Path) -> None:
    with pytest.raises(PlateModelUnavailable):
        load_reconstructor(tmp_path)


def test_load_reconstructor_raises_when_only_one_file_is_present(tmp_path: Path) -> None:
    (tmp_path / "shapes_continents_Merdith_et_al.gpml").write_bytes(b"")
    # the rotation file is deliberately absent
    with pytest.raises(PlateModelUnavailable):
        load_reconstructor(tmp_path)
