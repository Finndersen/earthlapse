"""The scale-bar band geometry and connected-component subject extent shared by `pipeline.morph`
and `pipeline.exposure` (ADR-015 amendment 2026-09-17). Synthetic masks only."""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.scale_bar import (
    COMPANION_AREA_FRACTION,
    SCALE_BAR_BAND_ABOVE,
    SCALE_BAR_BAND_BELOW,
    SCALE_BAR_BAND_RIGHT_MARGIN,
    Extent,
    band_pixels,
    box_from_mask,
    scale_bar_band,
)

SIZE = 100


def _mask(*boxes: tuple[int, int, int, int]) -> np.ndarray:
    """A `SIZE`x`SIZE` 0/255 mask with a filled rectangle per `(left, top, right, bottom)` box
    (inclusive of both corners, matching `cv2`'s own drawing convention elsewhere)."""
    array = np.zeros((SIZE, SIZE), dtype=np.uint8)
    for left, top, right, bottom in boxes:
        array[top : bottom + 1, left : right + 1] = 255
    return array


# -- scale_bar_band -----------------------------------------------------------------------


def test_scale_bar_band_brackets_a_generous_region_below_the_box() -> None:
    box = Extent(left=0.3, top=0.2, right=0.7, bottom=0.6)

    band = scale_bar_band(box)

    assert band.left == 0.0
    assert band.top == pytest.approx(0.6 - SCALE_BAR_BAND_ABOVE)
    assert band.bottom == pytest.approx(0.6 + SCALE_BAR_BAND_BELOW)
    assert band.right == pytest.approx(0.5 + SCALE_BAR_BAND_RIGHT_MARGIN)


def test_scale_bar_band_clamps_to_the_frame_and_is_never_empty() -> None:
    box = Extent(left=0.1, top=0.1, right=0.9, bottom=0.95)

    band = scale_bar_band(box)

    assert band.bottom == 1.0
    assert band.right <= 1.0
    assert band.top < band.bottom
    assert band.left < band.right


# -- band_pixels ----------------------------------------------------------------------------


def test_band_pixels_converts_plate_uv_to_a_pixel_slice() -> None:
    band = scale_bar_band(Extent(left=0.2, top=0.2, right=0.8, bottom=0.5))

    rows, cols = band_pixels(band, width=200, height=100)

    assert rows == slice(round(band.top * 100), round(band.bottom * 100))
    assert cols == slice(0, round(band.right * 200))


# -- box_from_mask --------------------------------------------------------------------------


def test_box_from_mask_is_the_bounding_box_of_the_largest_component() -> None:
    mask = _mask((10, 10, 40, 40))

    box = box_from_mask(mask, SIZE)

    assert box == Extent(left=0.10, top=0.10, right=0.41, bottom=0.41)


def test_box_from_mask_keeps_a_companion_at_least_the_area_fraction() -> None:
    # Primary: 31x31 = 961px. Companion: 20x20 = 400px, well over 10% of 961 -- kept, and it
    # extends the box past the primary alone.
    primary = (10, 10, 40, 40)
    companion = (60, 60, 79, 79)
    mask = _mask(primary, companion)
    assert 20 * 20 >= COMPANION_AREA_FRACTION * 31 * 31

    box = box_from_mask(mask, SIZE)

    assert box == Extent(left=0.10, top=0.10, right=0.80, bottom=0.80)


def test_box_from_mask_drops_a_component_too_small_to_be_a_companion() -> None:
    primary = (10, 10, 40, 40)
    speck = (70, 70, 72, 72)  # 3x3 = 9px, far under 10% of the primary's 961
    mask = _mask(primary, speck)

    box = box_from_mask(mask, SIZE)

    assert box == Extent(left=0.10, top=0.10, right=0.41, bottom=0.41)


def test_box_from_mask_drops_single_pixel_noise_via_the_opening() -> None:
    mask = _mask((10, 10, 40, 40))
    mask[5, 5] = 255  # an isolated speck the 3x3 opening removes before components are counted

    box = box_from_mask(mask, SIZE)

    assert box == Extent(left=0.10, top=0.10, right=0.41, bottom=0.41)


def test_box_from_mask_is_none_for_an_empty_mask() -> None:
    assert box_from_mask(np.zeros((SIZE, SIZE), dtype=np.uint8), SIZE) is None
