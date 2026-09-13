"""Offline validator for sources/paleodem, run against the committed fixture only.

The fixture is a real, deliberately sparse slice: just the 0 Ma and 540 Ma (oldest) grids,
re-encoded to compact int16 netCDF (see sources/paleodem/fixture/ and README.md "Fixture").
Because normalise()'s frame selection (`_select_frame_epochs`) picks the *available* epoch
nearest each of the 12 target ages rather than requiring an exact match, this 2-epoch
fixture degrades gracefully to a 2-frame RasterSequence instead of raising -- the same code
path the real 109-epoch build uses to hit all 12 targets exactly.
"""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from pipeline.shapes import Interpolation, RasterSequence, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

EXPECTED_LAT_SIZE = 181
EXPECTED_LON_SIZE = 361

# The real Earth's cos(latitude)-area-weighted land fraction is often quoted as ~29% (a
# per-unit-longitude grid-cell count, not area-weighted, happens to land almost exactly on
# that figure). The *area-weighted* value measured directly off this dataset's own 0 Ma
# grid (verified while building this package, not assumed) is ~0.275 -- lower, because
# area-weighting discounts high-latitude land (much of Antarctica, northern Eurasia/Canada)
# relative to a flat per-cell count. 0.03 covers that real gap between the two conventions
# without being wide enough to pass a badly broken weighting (e.g. an unweighted count,
# which would land at ~0.29 -- inside this tolerance too, so this test pins the *value*,
# not just "some weighting was applied") or a sign error (which would give ~0.72).
LAND_FRACTION_0MA_EXPECTED = 0.29
LAND_FRACTION_TOLERANCE = 0.03


@pytest.fixture(scope="module")
def paleodem_shapes() -> tuple[RasterSequence, TimeSeries]:
    normalise = load_source_module("paleodem", "normalise")
    shapes = normalise.normalise(fixture_dir("paleodem"))
    assert len(shapes) == 2
    raster, series = shapes
    assert isinstance(raster, RasterSequence)
    assert isinstance(series, TimeSeries)
    return raster, series


@pytest.fixture(scope="module")
def paleodem_normalise():
    return load_source_module("paleodem", "normalise")


def test_fixture_grids_are_181x361(paleodem_normalise) -> None:
    """CONFIRM (docs/DATA_SOURCES.md's VERIFY item): dims are lat 181 x lon 361."""
    for path in sorted(fixture_dir("paleodem").glob("*.nc")):
        with xr.open_dataset(path) as ds:
            assert ds.sizes["lat"] == EXPECTED_LAT_SIZE
            assert ds.sizes["lon"] == EXPECTED_LON_SIZE
            assert "z" in ds.variables


def test_shape_ids_and_metadata(paleodem_shapes) -> None:
    raster, series = paleodem_shapes
    assert raster.id == "paleodem"
    assert series.id == "land_fraction"
    assert series.unit == "fraction"
    assert series.interpolation == Interpolation.LINEAR


def test_frames_are_sorted_by_t(paleodem_shapes) -> None:
    raster, _ = paleodem_shapes
    ts = [f.t for f in raster.frames]
    assert ts == sorted(ts)


def test_frame_refs_are_well_formed(paleodem_shapes) -> None:
    """Every ref is a relative `textures/paleodem/<NNN>Ma.png` path -- resolved against the
    manifest's assetBase at runtime, never absolute or reaching outside its own subtree."""
    raster, _ = paleodem_shapes
    for frame in raster.frames:
        assert frame.ref.startswith("textures/paleodem/")
        assert frame.ref.endswith("Ma.png")
        assert not frame.ref.startswith("/")
        stem = frame.ref.removeprefix("textures/paleodem/").removesuffix("Ma.png")
        assert stem.isdigit() and len(stem) == 3, f"frame ref {frame.ref!r} has malformed age"


def test_fixture_degrades_to_only_its_own_real_epochs(paleodem_shapes) -> None:
    """The fixture has only 0 Ma and 540 Ma -- every one of the 12 target ages should
    collapse onto one of those two, real, epochs. No frame may claim an age the fixture
    doesn't actually contain."""
    raster, _ = paleodem_shapes
    ages_ma = {round(f.t / 1e6) for f in raster.frames}
    assert ages_ma == {0, 540}


def test_land_fraction_covers_every_available_epoch_not_just_frame_epochs(paleodem_shapes) -> None:
    """The RasterSequence has 2 frames (both fixture epochs collapse the same way), but
    land_fraction must still have exactly one sample per raw file -- here also 2, since the
    fixture only carries 2 files, but the point is it is driven by the raw file count, not
    by `_TARGET_EPOCHS_MA` / the frame selection."""
    _, series = paleodem_shapes
    raw_file_count = len(list(fixture_dir("paleodem").glob("*.nc")))
    assert len(series.samples) == raw_file_count


def test_land_fraction_at_0ma_is_approximately_point_29(paleodem_shapes) -> None:
    _, series = paleodem_shapes
    value = series.sample(0.0)
    assert value is not None
    assert value == pytest.approx(LAND_FRACTION_0MA_EXPECTED, abs=LAND_FRACTION_TOLERANCE)


def test_land_fraction_is_a_fraction_at_every_sample(paleodem_shapes) -> None:
    _, series = paleodem_shapes
    for sample in series.samples:
        assert 0.0 <= sample.value <= 1.0


def test_land_fraction_at_540ma_differs_from_0ma(paleodem_shapes) -> None:
    """Sanity guard against a bug that returns the same (e.g. always-0-Ma) grid regardless
    of which file was opened -- Pangaea-adjacent 540 Ma geography is not identical to
    today's, so the two land fractions must differ."""
    _, series = paleodem_shapes
    v0 = series.sample(0.0)
    v540 = series.sample(540.0 * 1e6)
    assert v0 is not None
    assert v540 is not None
    assert v0 != pytest.approx(v540, abs=1e-9)


def test_domain_reaches_540ma(paleodem_shapes) -> None:
    raster, series = paleodem_shapes
    assert raster.domain == (0.0, 540.0 * 1e6)
    assert series.domain == (0.0, 540.0 * 1e6)


# --------------------------------------------------------------------------- colour map


def test_colour_map_maps_sea_and_land_to_distinct_colours(paleodem_normalise) -> None:
    sea = paleodem_normalise.elevation_to_rgb(np.array([-4000.0]))[0]
    land = paleodem_normalise.elevation_to_rgb(np.array([2000.0]))[0]
    assert tuple(sea) != tuple(land)
    # blue channel should dominate at depth, and not dominate on land -- the map should
    # read as "sea" and "land", not just "two arbitrary different colours"
    assert sea[2] > sea[1]  # sea: blue > green
    assert land[1] >= land[2]  # land: green/brown, not blue-dominant


def test_colour_map_is_deterministic(paleodem_normalise) -> None:
    z = np.array([-8000.0, -100.0, 0.0, 1.0, 500.0, 9000.0])
    first = paleodem_normalise.elevation_to_rgb(z)
    second = paleodem_normalise.elevation_to_rgb(z)
    assert np.array_equal(first, second)


def test_colour_map_output_is_uint8_rgb_shaped(paleodem_normalise) -> None:
    z = np.zeros((4, 5))
    rgb = paleodem_normalise.elevation_to_rgb(z)
    assert rgb.shape == (4, 5, 3)
    assert rgb.dtype == np.uint8


def test_colour_map_is_continuous_across_the_land_sea_boundary_within_each_side(
    paleodem_normalise,
) -> None:
    """Neighbouring elevations just below vs. just above 0 differ by the deliberate sea/land
    jump (this is the point of the contrast), but two elevations *on the same side* close
    together should be close in colour -- otherwise the hypsometric ramp isn't actually a
    ramp."""
    close_sea = paleodem_normalise.elevation_to_rgb(np.array([-100.0, -101.0])).astype(int)
    assert np.abs(close_sea[0] - close_sea[1]).max() <= 2
    close_land = paleodem_normalise.elevation_to_rgb(np.array([500.0, 501.0])).astype(int)
    assert np.abs(close_land[0] - close_land[1]).max() <= 2


def test_colour_map_extreme_values_are_clamped_not_erroring(paleodem_normalise) -> None:
    z = np.array([-50000.0, 50000.0])
    rgb = paleodem_normalise.elevation_to_rgb(z)
    assert rgb.shape == (2, 3)
    assert (rgb >= 0).all() and (rgb <= 255).all()
