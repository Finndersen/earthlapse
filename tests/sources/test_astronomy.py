"""Offline validator for sources/astronomy, run against the committed fixture only.

astronomy has no data/raw/ input -- every value is a closed-form formula or a cited
checkpoint (see sources/astronomy/normalise.py and README.md). The fixture
(fixture/checkpoints.json) is an independent restatement of those citations, used
here so the test checks normalise()'s *output* against a committed reference rather
than against its own source code.
"""

from __future__ import annotations

import json
from itertools import pairwise
from types import ModuleType

import pytest

from pipeline.shapes import CuratedShape, GeoTime, Interpolation, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

_EXPECTED_UNITS = {
    "day_length": "h",
    "moon_distance": "km",
    "solar_luminosity": "relative",
    "obliquity": "deg",
}

# Series id -> its key in fixture/checkpoints.json.
_FIXTURE_KEYS = {
    "day_length": "day_length_hours",
    "moon_distance": "moon_distance_km",
    "solar_luminosity": "solar_luminosity_rel",
    "obliquity": "obliquity_deg",
}


@pytest.fixture(scope="module")
def normalise_module() -> ModuleType:
    return load_source_module("astronomy", "normalise")


@pytest.fixture(scope="module")
def series(normalise_module: ModuleType) -> dict[str, TimeSeries]:
    shapes: list[CuratedShape] = normalise_module.normalise(fixture_dir("astronomy"))
    assert len(shapes) == 4
    by_id: dict[str, TimeSeries] = {}
    for shape in shapes:
        assert isinstance(shape, TimeSeries)
        assert shape.id not in by_id
        by_id[shape.id] = shape
    assert by_id.keys() == _EXPECTED_UNITS.keys()
    return by_id


@pytest.fixture(scope="module")
def checkpoints() -> dict[str, list[dict[str, float | str]]]:
    path = fixture_dir("astronomy") / "checkpoints.json"
    data = json.loads(path.read_text())
    del data["_comment"]
    return data


# --------------------------------------------------------------------------- metadata


def test_shape_metadata(series: dict[str, TimeSeries]) -> None:
    for series_id, unit in _EXPECTED_UNITS.items():
        ts = series[series_id]
        assert ts.unit == unit
        assert ts.interpolation == Interpolation.LINEAR


def test_domains_restricted_to_cited_coverage(series: dict[str, TimeSeries]) -> None:
    """Domains must stop where the citations stop, not extend by extrapolation."""
    assert series["day_length"].domain == (0.0, 2.46e9)
    assert series["moon_distance"].domain == (0.0, 2.46e9)
    assert series["solar_luminosity"].domain == (0.0, 4.567e9)
    assert series["obliquity"].domain == (0.0, 2.5e8)


def test_series_are_densely_sampled(series: dict[str, TimeSeries]) -> None:
    """A handful of checkpoints alone would not be a "dense grid" -- guard against
    normalise() regressing to emitting only the literal checkpoints."""
    for ts in series.values():
        assert len(ts.samples) >= 100


# --------------------------------------------------------------------- fixture replay


def test_matches_every_cited_checkpoint(
    series: dict[str, TimeSeries], checkpoints: dict[str, list[dict[str, float | str]]]
) -> None:
    for series_id, fixture_key in _FIXTURE_KEYS.items():
        ts = series[series_id]
        for point in checkpoints[fixture_key]:
            t = float(point["t"])
            value = ts.sample(t)
            assert value is not None, f"{series_id}: expected a value at t={t}, got None"
            assert value == pytest.approx(float(point["value"]), rel=1e-3), (
                f"{series_id} at t={t}: {value} != {point['value']} ({point['citation']})"
            )


# --------------------------------------------------------------- required assertions
# (mirrors the acceptance criteria in the D7 work package / docs/IMPLEMENTATION.md)


def test_day_length_at_600ma_is_within_21_to_22_hours(series: dict[str, TimeSeries]) -> None:
    value = series["day_length"].sample(6.0e8)
    assert value is not None
    assert 21.0 <= value <= 22.0


def test_solar_luminosity_at_4ga_is_about_0_75(series: dict[str, TimeSeries]) -> None:
    value = series["solar_luminosity"].sample(4.0e9)
    assert value is not None
    assert value == pytest.approx(0.75, abs=0.02)


def test_present_day_values(series: dict[str, TimeSeries]) -> None:
    day_length = series["day_length"].sample(0.0)
    moon_distance = series["moon_distance"].sample(0.0)
    solar_luminosity = series["solar_luminosity"].sample(0.0)
    obliquity = series["obliquity"].sample(0.0)

    assert day_length == pytest.approx(24.0)
    assert moon_distance == pytest.approx(384_400.0)
    assert solar_luminosity == pytest.approx(1.0)
    assert obliquity == pytest.approx(23.3, abs=1.5)  # present instantaneous value is 23.44 deg


@pytest.mark.parametrize(
    ("series_id", "beyond_domain_t"),
    [
        ("day_length", 3.0e9),
        ("moon_distance", 3.0e9),
        ("solar_luminosity", 5.0e9),
        ("obliquity", 3.0e8),
    ],
)
def test_none_outside_domain(
    series: dict[str, TimeSeries], series_id: str, beyond_domain_t: GeoTime
) -> None:
    assert series[series_id].sample(beyond_domain_t) is None


@pytest.mark.parametrize("series_id", ["day_length", "moon_distance", "solar_luminosity"])
def test_monotonic_trend_into_the_past(series: dict[str, TimeSeries], series_id: str) -> None:
    """Day length, lunar distance and solar luminosity all decrease monotonically
    (non-strictly, to allow the day_length stall's flat segment) going into the past
    -- t increases, value never increases."""
    values = [s.value for s in series[series_id].samples]  # samples are t-sorted
    assert all(a >= b for a, b in pairwise(values))


# ------------------------------------------------------------------- uncertainty bounds


def test_uncertainty_bounds_carried_where_cited(series: dict[str, TimeSeries]) -> None:
    """Williams (2000) and Lantink et al. (2022) both give explicit error bars --
    losing them at a checkpoint would silently understate the record's precision."""
    for series_id in ("day_length", "moon_distance", "obliquity"):
        ts = series[series_id]
        has_bounds = any(s.lower is not None and s.upper is not None for s in ts.samples)
        assert has_bounds, f"{series_id}: no sample carries lower/upper bounds"


def test_checkpoint_bounds_survive_at_the_checkpoints_own_t(
    series: dict[str, TimeSeries],
) -> None:
    """Regression guard: interpolate_checkpoints() once blended bounds across the
    bracketing pair even when `t` landed exactly on a checkpoint, so a checkpoint
    whose *neighbour* had no bounds (e.g. day_length/moon_distance's 620 Ma point,
    bracketed against the unbounded t=0 present-day anchor) silently lost its own
    published bounds even though the value came out right. Assert the bounds at the
    checkpoint's own t, not just "some sample somewhere has bounds"."""
    checks = {
        "day_length": (6.20e8, 21.5, 22.3),
        "moon_distance": (6.20e8, 369_000.0, 372_800.0),
    }
    for series_id, (t, lower, upper) in checks.items():
        sample = next(s for s in series[series_id].samples if s.t == t)
        assert sample.lower == pytest.approx(lower)
        assert sample.upper == pytest.approx(upper)


def test_moon_distance_not_a_naive_linear_backward_extrapolation(
    series: dict[str, TimeSeries],
) -> None:
    """The present lunar recession rate is ~3.8 cm/yr (LLR). Extrapolating that
    constant rate backward is the classic "lunar time problem" the source docstring
    warns against -- it would put the Moon at Earth's surface only ~1.5 Gyr ago. The
    checkpoint-derived average rate between 0 and 620 Ma must be well below that."""
    d0 = series["moon_distance"].sample(0.0)
    d620 = series["moon_distance"].sample(6.20e8)
    assert d0 is not None
    assert d620 is not None
    implied_rate_cm_per_yr = (d0 - d620) * 1e5 / 6.20e8  # km -> cm
    naive_present_rate_cm_per_yr = 3.8
    assert implied_rate_cm_per_yr < 0.8 * naive_present_rate_cm_per_yr
