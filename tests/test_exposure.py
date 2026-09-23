"""Exposure normalisation of published portrait plates (ADR-015 amendment). Synthetic plates only."""

from __future__ import annotations

import io
import math
from itertools import pairwise

import pytest
from PIL import Image, ImageDraw, JpegImagePlugin

from pipeline.exposure import (
    MAX_GAIN,
    TARGET_HIGHLIGHT,
    ExposedPlate,
    ExposureError,
    PlateExposure,
    erase_scale_bar,
    expose_plate,
    exposure_curve,
    exposure_gain,
    exposure_scale_lut,
    measure_highlight,
)
from tests.support import SPECIMEN_CENTRE, SPECIMEN_SIZE, jpeg_bytes, specimen_plate


def _tinted(image: Image.Image, green: float, blue: float) -> Image.Image:
    red, _, _ = image.split()
    return Image.merge(
        "RGB", (red, red.point(lambda v: round(v * green)), red.point(lambda v: round(v * blue)))
    )


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _fully_exposed(pixel: tuple[int, ...], gain: float) -> tuple[int, ...]:
    """`pixel` as published where it takes the full gain: every channel scaled by one factor."""
    scale = exposure_scale_lut(gain)[max(pixel)]
    return tuple(math.floor(channel * scale + 0.5) for channel in pixel)


# -- the curve ------------------------------------------------------------------------------


def test_at_full_gain_a_grey_code_never_darkens_or_clips_and_keeps_black_and_white() -> None:
    codes = [_fully_exposed((code,), MAX_GAIN)[0] for code in range(256)]
    scale = exposure_scale_lut(MAX_GAIN)

    assert all(lower <= upper for lower, upper in pairwise(codes))
    assert [code for code, out in enumerate(codes) if out < code] == []
    assert (codes[0], codes[255]) == (0, 255)
    assert max(code * scale[code] for code in range(256)) <= 255 + 1e-9


def test_a_darkening_gain_is_refused() -> None:
    with pytest.raises(ValueError, match="would darken"):
        exposure_curve(0.5, 0.9)


# -- the gain -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("highlight", "gain"),
    [(None, 1.0), (TARGET_HIGHLIGHT, 1.0), (30, MAX_GAIN)],
)
def test_the_gain_is_one_when_bright_enough_and_capped_when_far_too_dark(
    highlight: int | None, gain: float
) -> None:
    assert exposure_gain(highlight) == gain


# -- measuring a plate ----------------------------------------------------------------------


def test_the_highlight_is_the_lit_side_of_the_subject_not_the_glow_behind_it() -> None:
    peak = 120
    highlight = measure_highlight(specimen_plate(peak))

    assert highlight is not None
    assert peak - 0.12 * peak - 4 <= highlight <= peak


def test_a_plate_with_no_subject_has_no_highlight() -> None:
    assert measure_highlight(specimen_plate(0, glow=25, subject=(2, 2))) is None
    assert measure_highlight(Image.new("RGB", (16, 9), (37, 91, 128))) is None


# -- exposing a plate -----------------------------------------------------------------------


def test_a_dark_jpeg_is_brightened_toward_the_target_at_full_quality() -> None:
    data = jpeg_bytes(specimen_plate(90))
    with Image.open(io.BytesIO(data)) as original:
        highlight = measure_highlight(original)
        sampling = JpegImagePlugin.get_sampling(original)
        before = original.getpixel(SPECIMEN_CENTRE)

    exposed = expose_plate(data)

    assert exposed.exposure == PlateExposure(highlight=highlight, gain=exposure_gain(highlight))
    assert exposed.exposure.gain > 1.0
    with Image.open(io.BytesIO(exposed.data)) as out:
        assert (out.format, out.mode, out.size) == ("JPEG", "RGB", (SPECIMEN_SIZE, SPECIMEN_SIZE))
        assert JpegImagePlugin.get_sampling(out) == sampling
        assert {q for table in out.quantization.values() for q in table} == {1}
        after = out.getpixel(SPECIMEN_CENTRE)
        assert after == pytest.approx(_fully_exposed(before, exposed.exposure.gain), abs=2)
        assert min(after) > max(before) + 20
        assert max(out.getpixel((2, 2))) <= 3  # the black rim stays black


def test_a_dark_coloured_subject_keeps_its_hue_and_saturation() -> None:
    data = _png(_tinted(specimen_plate(90), green=0.7, blue=0.5))
    with Image.open(io.BytesIO(data)) as original:
        shadow = (
            SPECIMEN_CENTRE[0],
            SPECIMEN_CENTRE[1] - 20,
        )  # the darker side of the subject's lighting ramp
        before = original.getpixel(SPECIMEN_CENTRE), original.getpixel(shadow)

    exposed = expose_plate(data)

    with Image.open(io.BytesIO(exposed.data)) as out:
        after = out.getpixel(SPECIMEN_CENTRE), out.getpixel(shadow)
    gain = exposed.exposure.gain
    assert after == (
        pytest.approx(_fully_exposed(before[0], gain), abs=1),
        pytest.approx(_fully_exposed(before[1], gain), abs=1),
    )
    for pixel_before, pixel_after in zip(before, after, strict=True):
        assert pixel_after[0] > 1.3 * pixel_before[0]
        assert [c / pixel_after[0] for c in pixel_after] == pytest.approx(
            [c / pixel_before[0] for c in pixel_before], abs=0.03
        )


def test_a_plate_already_bright_enough_publishes_byte_for_byte() -> None:
    data = jpeg_bytes(specimen_plate(200))

    assert expose_plate(data) == ExposedPlate(
        data=data,
        exposure=PlateExposure(highlight=measure_highlight(specimen_plate(200)), gain=1.0),
    )


def test_a_plate_that_is_not_rgb_is_refused() -> None:
    with pytest.raises(ExposureError, match="expected an RGB plate, got mode RGBA"):
        expose_plate(_png(specimen_plate(90).convert("RGBA")))


# -- erasing the scale bar ------------------------------------------------------------------

# A tail-like appendage, touching the subject and dipping well below it -- must never be erased.
TAIL_BOX = (230, 291, 280, 350)
# A separate, uniform "scale bar" below both the subject and the tail, clear of either -- wide
# and thin enough to pass `pipeline.exposure`'s line-shape filter (>= 8% of plate width, <= 2.5%
# of plate height).
BAR_BOX = (150, 380, 350, 387)
BAR_LEVEL = 200


def _plate_with_bar_and_tail(peak: int = 200, *, glow: int = 20) -> Image.Image:
    """`specimen_plate` plus a tail dipping low and a separate, flat, bar-like rectangle below it, both
    well inside `SUBJECT_DISC_RADIUS` so `subject_mask` sees them."""
    plane, _, _ = specimen_plate(peak, glow=glow).split()
    draw = ImageDraw.Draw(plane)
    draw.rectangle(TAIL_BOX, fill=peak)
    draw.rectangle(BAR_BOX, fill=BAR_LEVEL)
    return Image.merge("RGB", (plane, plane, plane))


def test_erase_scale_bar_removes_the_bar_and_leaves_the_subject_and_tail_untouched() -> None:
    before = _plate_with_bar_and_tail()
    data = jpeg_bytes(before)

    erased = erase_scale_bar(data)

    assert erased != data
    with Image.open(io.BytesIO(erased)) as out:
        after = out.convert("RGB")
    # The bar is gone: no pixel in its box is anywhere near BAR_LEVEL any more.
    bar_after = [
        after.getpixel((x, y)) for x in range(*BAR_BOX[0::2]) for y in range(*BAR_BOX[1::2])
    ]
    assert max(max(pixel) for pixel in bar_after) < BAR_LEVEL - 40
    # The subject and its tail are byte-identical to the un-erased plate.
    for point in [(256, 256), (240, 280), (250, 340), (260, 349)]:
        assert after.getpixel(point) == before.getpixel(point)
