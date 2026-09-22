"""Offline validator for sources/lr04, run against the committed fixture only.

The fixture is the real NCEI template file with its header intact and its data table cut to three
real slices (0-130 ka, 2.69-2.71 Ma, 5.30-5.32 Ma), so the calibration anchors (0 ka and the
19-23 ka LGM chronozone) and both ends of the record are the production ones. Covers the time
convention (ka before AD 1950 -> years before AD 2025), the two-point calibration, and parsing
failures.
"""

from __future__ import annotations

import statistics
from pathlib import Path

import pytest

from pipeline.curated import load_world, write_shape
from pipeline.publish import SCALAR_LAYERS
from pipeline.shapes import Interpolation, Sample, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

normalise_module = load_source_module("lr04", "normalise")

FIXTURE_ROWS = 145
PRESENT_D18O = 3.23
LGM_D18O = statistics.fmean([4.96, 4.99, 4.91, 4.88, 4.86])  # LR04 at 19, 20, 21, 22, 23 ka


@pytest.fixture(scope="module")
def shapes() -> dict[str, TimeSeries]:
    result = normalise_module.normalise(fixture_dir("lr04"))
    assert all(isinstance(shape, TimeSeries) for shape in result)
    return {shape.id: shape for shape in result if isinstance(shape, TimeSeries)}


def test_emits_the_stack_and_its_two_derived_series(shapes: dict[str, TimeSeries]) -> None:
    assert {
        sid: (s.unit, s.interpolation, len(s.samples), s.domain) for sid, s in shapes.items()
    } == {
        "benthic_d18o": ("‰", Interpolation.LINEAR, FIXTURE_ROWS, (75.0, 5_320_075.0)),
        "sea_level": ("m", Interpolation.LINEAR, FIXTURE_ROWS, (75.0, 5_320_075.0)),
        "ice_volume": ("LGM = 1", Interpolation.LINEAR, FIXTURE_ROWS, (75.0, 5_320_075.0)),
    }


def test_ages_count_from_ad_1950_and_t_from_ad_2025(shapes: dict[str, TimeSeries]) -> None:
    assert [s.t for s in shapes["benthic_d18o"].samples[:3]] == [75.0, 1075.0, 2075.0]


def test_stack_keeps_its_standard_error_band(shapes: dict[str, TimeSeries]) -> None:
    assert shapes["benthic_d18o"].samples[0] == Sample(t=75.0, value=3.23, lower=3.2, upper=3.26)
    assert shapes["benthic_d18o"].samples[-1] == Sample(
        t=5_320_075.0, value=2.91, lower=2.82, upper=3.0
    )


def test_calibration_anchors_present_and_lgm(shapes: dict[str, TimeSeries]) -> None:
    calibration = normalise_module.calibrate(
        normalise_module.parse_stack(
            (fixture_dir("lr04") / normalise_module.RAW_FILENAME).read_text(encoding="utf-8")
        )
    )
    assert (calibration.present_d18o, calibration.lgm_d18o) == (
        PRESENT_D18O,
        pytest.approx(LGM_D18O),
    )
    assert calibration.ice_volume(LGM_D18O) == pytest.approx(1.0)
    assert calibration.sea_level_m(LGM_D18O) == pytest.approx(normalise_module.LGM_SEA_LEVEL_M)


@pytest.mark.parametrize(
    ("t", "sea_level_m", "ice_volume"),
    [
        (75.0, 0.0, 0.0),  # the present anchor
        (21_075.0, -133.2, 0.9941),  # LGM
        (125_075.0, 7.1, -0.0533),  # Eemian highstand, ~+6-9 m in the literature
        (5_320_075.0, 25.4, -0.1893),  # early Pliocene, warmer than today
    ],
)
def test_derived_series_are_one_linear_scaling(
    shapes: dict[str, TimeSeries], t: float, sea_level_m: float, ice_volume: float
) -> None:
    assert (shapes["sea_level"].sample(t), shapes["ice_volume"].sample(t)) == (
        sea_level_m,
        ice_volume,
    )


def test_derived_series_carry_no_invented_band(shapes: dict[str, TimeSeries]) -> None:
    for sid in ("sea_level", "ice_volume"):
        assert all(s.lower is None and s.upper is None for s in shapes[sid].samples)


def test_present_is_exactly_zero_not_negative_zero(shapes: dict[str, TimeSeries]) -> None:
    assert str(shapes["sea_level"].samples[0].value) == "0.0"
    assert str(shapes["ice_volume"].samples[0].value) == "0.0"


def test_round_trips_through_curated_storage_into_world_state(
    shapes: dict[str, TimeSeries], tmp_path: Path
) -> None:
    for shape in shapes.values():
        write_shape(shape, tmp_path)
    world = load_world(tmp_path)
    assert world.at(21_075.0).climate.sea_level_m == -133.2
    assert world.at(10e6).climate.sea_level_m is None


def test_publishes_the_two_derived_layers_on_the_globe_surface() -> None:
    specs = {spec.curated_id: spec for spec in SCALAR_LAYERS if spec.source == "lr04"}
    assert {cid: (spec.surface.value, spec.chartable) for cid, spec in specs.items()} == {
        "ice_volume": ("globe", False),
        "sea_level": ("globe", False),
    }


def test_rejects_an_unexpected_header() -> None:
    with pytest.raises(ValueError, match="expected header"):
        normalise_module.parse_stack("age\td18O\n0\t3.23\n")


def test_rejects_ages_that_do_not_increase() -> None:
    text = "age_calkaBP\td18O_benthic\td18O_error\n0\t3.23\t0.03\n0\t3.23\t0.04\n"
    with pytest.raises(ValueError, match="does not increase"):
        normalise_module.parse_stack(text)


def test_calibration_needs_the_present_and_the_lgm() -> None:
    no_present = [normalise_module.StackRow(age_ka=1.0, d18o=3.2, error=0.03)]
    with pytest.raises(ValueError, match="not the present"):
        normalise_module.calibrate(no_present)
    no_lgm = [normalise_module.StackRow(age_ka=0.0, d18o=3.2, error=0.03)]
    with pytest.raises(ValueError, match="LGM chronozone"):
        normalise_module.calibrate(no_lgm)
