"""sources/astronomy against its committed fixture.

astronomy has no raw input: every value is a closed-form formula or a cited checkpoint. The
fixture (fixture/checkpoints.json) restates those citations independently, so these tests check
normalise()'s output against a committed reference rather than against its own source.
"""

from __future__ import annotations

import json

import pytest

from pipeline.shapes import Interpolation, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

UNITS = {
    "day_length": "h",
    "moon_distance": "km",
    "solar_luminosity": "relative",
    "obliquity": "deg",
}
DOMAINS = {
    "day_length": (0.0, 2.46e9),
    "moon_distance": (0.0, 2.46e9),
    "solar_luminosity": (0.0, 4.567e9),
    "obliquity": (0.0, 2.5e8),
}
FIXTURE_KEYS = {
    "day_length": "day_length_hours",
    "moon_distance": "moon_distance_km",
    "solar_luminosity": "solar_luminosity_rel",
    "obliquity": "obliquity_deg",
}


@pytest.fixture(scope="module")
def series() -> dict[str, TimeSeries]:
    shapes = load_source_module("astronomy", "normalise").normalise(fixture_dir("astronomy"))
    assert all(isinstance(shape, TimeSeries) for shape in shapes)
    return {shape.id: shape for shape in shapes}


def test_emits_four_linear_series_bounded_to_their_cited_coverage(
    series: dict[str, TimeSeries],
) -> None:
    assert {k: (s.unit, s.interpolation) for k, s in series.items()} == {
        k: (unit, Interpolation.LINEAR) for k, unit in UNITS.items()
    }
    assert {k: s.domain for k, s in series.items()} == DOMAINS
    for series_id, (_, t_max) in DOMAINS.items():
        assert series[series_id].sample(t_max * 1.2) is None


def test_matches_every_cited_checkpoint(series: dict[str, TimeSeries]) -> None:
    checkpoints = json.loads((fixture_dir("astronomy") / "checkpoints.json").read_text())
    for series_id, key in FIXTURE_KEYS.items():
        for point in checkpoints[key]:
            value = series[series_id].sample(float(point["t"]))
            assert value == pytest.approx(float(point["value"]), rel=1e-3), (series_id, point)


def test_a_checkpoints_cited_bounds_survive_at_its_own_t(series: dict[str, TimeSeries]) -> None:
    checks = {
        "day_length": (6.20e8, 21.5, 22.3),
        "moon_distance": (6.20e8, 369_000.0, 372_800.0),
    }
    for series_id, (t, lower, upper) in checks.items():
        sample = next(s for s in series[series_id].samples if s.t == t)
        assert (sample.lower, sample.upper) == pytest.approx((lower, upper))
