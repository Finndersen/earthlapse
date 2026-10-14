"""sources/un-wpp against its committed fixture: real rows of the WPP 2024 CSV, cut to the World
medium variant from 1950 plus a few rows of another variant and another location."""

from __future__ import annotations

import pytest

from pipeline.shapes import Interpolation, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

normalise_module = load_source_module("un-wpp", "normalise")


def test_world_medium_variant_in_people_from_1950_to_the_present() -> None:
    (series,) = normalise_module.normalise(fixture_dir("un-wpp"))
    assert isinstance(series, TimeSeries)
    assert (series.id, series.unit, series.interpolation) == (
        "population_wpp",
        "people",
        Interpolation.LOG_LINEAR,
    )
    # AD 2025 .. 1950, one sample a year; projection years after the present are dropped.
    assert (series.domain, len(series.samples)) == ((0.0, 75.0), 76)
    # PopTotal is in thousands; the Low variant and Africa rows are ignored.
    assert series.sample(75.0) == pytest.approx(2_493_092_848)
    assert series.sample(0.0) == pytest.approx(8_231_613_070)
