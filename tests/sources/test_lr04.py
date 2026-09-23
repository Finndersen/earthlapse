"""sources/lr04 against its committed fixture: the real NCEI file cut to three real slices, so
the calibration anchors (0 ka and the 19-23 ka LGM chronozone) and both ends of the record are
the production ones."""

from __future__ import annotations

import statistics

import pytest

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


def test_only_the_stack_carries_an_error_band_and_t_counts_from_ad_2025(
    shapes: dict[str, TimeSeries],
) -> None:
    assert shapes["benthic_d18o"].samples[0] == Sample(t=75.0, value=3.23, lower=3.2, upper=3.26)
    assert shapes["benthic_d18o"].samples[-1] == Sample(
        t=5_320_075.0, value=2.91, lower=2.82, upper=3.0
    )
    for sid in ("sea_level", "ice_volume"):
        assert all(s.lower is None and s.upper is None for s in shapes[sid].samples)


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


def test_rejects_an_unexpected_header() -> None:
    with pytest.raises(ValueError, match="expected header"):
        normalise_module.parse_stack("age\td18O\n0\t3.23\n")


def test_calibration_needs_the_present_and_the_lgm() -> None:
    no_present = [normalise_module.StackRow(age_ka=1.0, d18o=3.2, error=0.03)]
    with pytest.raises(ValueError, match="not the present"):
        normalise_module.calibrate(no_present)
    no_lgm = [normalise_module.StackRow(age_ka=0.0, d18o=3.2, error=0.03)]
    with pytest.raises(ValueError, match="LGM chronozone"):
        normalise_module.calibrate(no_lgm)
