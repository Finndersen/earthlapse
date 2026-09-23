"""sources/co2-o2 against its committed fixtures: the three real upstream files, byte-identical
to what fetch.py verifies, so the splice boundaries here are the production ones.
"""

from __future__ import annotations

import hashlib
import math
import shutil
from pathlib import Path

import pytest

from pipeline.shapes import Interpolation, Sample, TimeSeries
from tests.sources.support import SOURCES_DIR, fixture_dir, load_source_module

PREINDUSTRIAL_CO2_PPM = 280.0
MLO_ROWS = 67  # 1959..2025
ICE_CORE_ROWS_KEPT = 1853  # 1,901 rows minus the 48 at AD 1959 or later
GEOCARB_ROWS_KEPT = 57  # 58 rows minus the 0 Ma model value
ICE_CORE_OLDEST_T = 805_668.87 + 75

normalise_module = load_source_module("co2-o2", "normalise")


@pytest.fixture(scope="module")
def co2_series() -> TimeSeries:
    (shape,) = normalise_module.normalise(fixture_dir("co2-o2"))
    assert isinstance(shape, TimeSeries)
    return shape


def _samples_between(series: TimeSeries, newest: float, oldest: float) -> list[Sample]:
    return [s for s in series.samples if newest <= s.t <= oldest]


def test_splices_instrumental_ice_core_and_geocarb_into_one_log_linear_series(
    co2_series: TimeSeries,
) -> None:
    assert (co2_series.id, co2_series.unit, co2_series.interpolation) == (
        "co2",
        "ppm",
        Interpolation.LOG_LINEAR,
    )
    assert co2_series.domain == (0.0, 5.7e8)
    assert len(_samples_between(co2_series, 0, 66)) == MLO_ROWS
    assert len(_samples_between(co2_series, 66.01, ICE_CORE_OLDEST_T)) == ICE_CORE_ROWS_KEPT
    assert len(_samples_between(co2_series, ICE_CORE_OLDEST_T + 1, 5.7e8)) == GEOCARB_ROWS_KEPT


def test_each_segments_time_convention_is_rebased_to_the_2025_present(
    co2_series: TimeSeries,
) -> None:
    # Instrumental CE years: t = 2025 - year, and they win over overlapping ice-core rows.
    assert [s.t for s in _samples_between(co2_series, 0, 66)] == [float(t) for t in range(67)]
    assert co2_series.samples[0].model_dump() == pytest.approx(
        {"t": 0.0, "value": 427.35, "lower": 427.23, "upper": 427.47}
    )
    # Ice-core ages count from AD 1950: t = age + 75.
    rebased = next(s for s in co2_series.samples if s.t == pytest.approx(21_039.43))
    assert rebased.value == pytest.approx(190.87)
    # GEOCARB's RCO2 is a ratio to pre-industrial: ppm = RCO2 * 280.
    assert co2_series.sample(5.2e8) == pytest.approx(26.18222 * PREINDUSTRIAL_CO2_PPM)


def test_interpolates_log_linearly_between_bracketing_samples(co2_series: TimeSeries) -> None:
    v_340, v_350 = co2_series.sample(3.4e8), co2_series.sample(3.5e8)
    assert v_340 is not None and v_350 is not None
    log_linear = math.exp((math.log(v_340) + math.log(v_350)) / 2)
    assert abs(log_linear - (v_340 + v_350) / 2) > 20.0

    assert co2_series.sample(3.45e8) == pytest.approx(log_linear, rel=1e-6)


def test_uncertainty_comes_only_from_the_files_own_columns(co2_series: TimeSeries) -> None:
    measured = _samples_between(co2_series, 0, ICE_CORE_OLDEST_T)
    modelled = _samples_between(co2_series, ICE_CORE_OLDEST_T + 1, 5.7e8)

    assert all(s.lower is not None and s.lower < s.value < (s.upper or 0) for s in measured)
    assert all(s.lower is None and s.upper is None for s in modelled)


def test_the_ice_core_to_geocarb_bridge_is_a_declared_gap(co2_series: TimeSeries) -> None:
    (gap,) = co2_series.gaps
    assert (gap.from_index, gap.to_index) == (
        MLO_ROWS + ICE_CORE_ROWS_KEPT - 1,
        MLO_ROWS + ICE_CORE_ROWS_KEPT,
    )
    newest, oldest = co2_series.samples[gap.from_index].t, co2_series.samples[gap.to_index].t
    assert (newest, oldest) == pytest.approx((ICE_CORE_OLDEST_T, 1.0e7))
    assert co2_series.sample(newest) is not None
    assert co2_series.sample(3.2e6) is None


def test_an_instrumental_year_after_the_present_raises(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    shutil.copytree(fixture_dir("co2-o2"), raw_dir)
    path = raw_dir / normalise_module.INSTRUMENTAL_FILENAME
    path.write_text(path.read_text() + "  2026   430.00     0.12\n")

    with pytest.raises(ValueError, match="year 2026 is after the fixed AD 2025 present"):
        normalise_module.normalise(raw_dir)


def test_committed_fixtures_are_the_pinned_upstream_files_normalise_reads() -> None:
    artefacts = load_source_module("co2-o2", "fetch").load_artefacts(
        SOURCES_DIR / "co2-o2" / "manifest.toml"
    )

    assert tuple(a.filename for a in artefacts) == normalise_module.RAW_FILENAMES
    for artefact in artefacts:
        data = (fixture_dir("co2-o2") / artefact.filename).read_bytes()
        assert hashlib.sha256(data).hexdigest() == artefact.sha256
