"""sources/global-temp against its committed fixtures: the three real upstream files,
byte-identical to what fetch.py verifies, so the splice boundaries here are the production ones.
"""

from __future__ import annotations

import hashlib

import pytest

from pipeline.shapes import Interpolation, TimeSeries
from tests.sources.support import SOURCES_DIR, fixture_dir, load_source_module

normalise_module = load_source_module("global-temp", "normalise")
FIXTURES = fixture_dir("global-temp")


def _text(filename: str) -> str:
    return (FIXTURES / filename).read_text(encoding="utf-8")


def test_instrumental_anomalies_become_absolute_and_stop_at_the_present() -> None:
    segment = normalise_module.parse_instrumental(_text(normalise_module.INSTRUMENTAL_FILENAME))
    times = [s.t for s in segment.samples]
    # AD 1850..2025; the file's partial AD 2026 row lies past t = 0.
    assert (min(times), max(times), len(times)) == (0.0, 175.0, 176)
    newest = next(s for s in segment.samples if s.t == 0.0)
    assert newest.model_dump() == pytest.approx(
        {"t": 0.0, "value": 15.07, "lower": 15.03, "upper": 15.11}
    )


def test_phanerozoic_stage_midpoints_are_in_years() -> None:
    segment = normalise_module.parse_phanerozoic(_text(normalise_module.PHANEROZOIC_FILENAME))
    assert segment.oldest_t == pytest.approx(481.965e6)
    holocene = min(segment.samples, key=lambda s: s.t)
    assert (holocene.t, holocene.value) == pytest.approx((5850.0, 13.99))


def test_splices_measurement_reanalysis_and_stage_averages_newest_first() -> None:
    pytest.importorskip("xarray")
    (series,) = normalise_module.normalise(FIXTURES)
    assert isinstance(series, TimeSeries)
    assert (series.id, series.unit, series.interpolation) == (
        "mean_temp",
        "°C",
        Interpolation.LINEAR,
    )
    assert series.domain == pytest.approx((0.0, 481.965e6))

    # LGMR ages count from AD 1950 (t = age + 75); its 100 BP bin falls on HadCRUT's AD 1850 and
    # loses to the measurement, its 300 BP bin is the newest it keeps.
    reanalysis = [s for s in series.samples if 175 < s.t < 24_000]
    assert (reanalysis[0].t, reanalysis[-1].t, len(reanalysis)) == (375.0, 23_975.0, 119)
    # The Last Glacial Maximum is about 7 °C below pre-industrial.
    lgm, preindustrial = series.sample(21_075), series.sample(175)
    assert lgm is not None and preindustrial is not None
    assert 6 < preindustrial - lgm < 8
    # PhanDA's Holocene stage lies inside the reanalysis and is dropped; its next stage is kept.
    assert 5850.0 not in {s.t for s in series.samples}
    assert min(s.t for s in series.samples if s.t > 24_000) == pytest.approx(70_350.0)
    assert all(s.lower is not None and s.lower < s.value < (s.upper or 0) for s in series.samples)


def test_committed_fixtures_are_the_pinned_upstream_files_normalise_reads() -> None:
    artefacts = load_source_module("global-temp", "fetch").load_artefacts(
        SOURCES_DIR / "global-temp" / "manifest.toml"
    )

    assert tuple(a.filename for a in artefacts) == normalise_module.RAW_FILENAMES
    for artefact in artefacts:
        data = (FIXTURES / artefact.filename).read_bytes()
        assert hashlib.sha256(data).hexdigest() == artefact.sha256
