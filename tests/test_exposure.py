"""Exposure normalisation of published portrait plates (ADR-015 amendment). Synthetic plates only."""

from __future__ import annotations

import io
import math
from itertools import pairwise

import pytest
from PIL import Image, ImageDraw, JpegImagePlugin

from pipeline.exposure import (
    DISPLAY_GAMMA,
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

SIZE = 512
GAINS = (1.02, 1.7, 2.5, MAX_GAIN)
CENTRE = (SIZE // 2, SIZE // 2)


def _plate(
    peak: int,
    *,
    glow: int = 25,
    centre: tuple[int, int] = CENTRE,
    subject: tuple[int, int] = (300, 70),
) -> Image.Image:
    """A specimen-like plate: black rim, a soft central glow of `glow`, and an elliptical subject
    lit from just above the glow on one side to `peak` on the other."""
    distance = Image.radial_gradient("L").resize((SIZE, SIZE))  # 0 at the centre
    backdrop = distance.point(lambda v: round(glow * max(0.0, 1 - v / 180)))
    shade = glow + 5
    ramp = (
        Image.linear_gradient("L")
        .rotate(90)
        .resize(subject)
        .point(lambda v: round(shade + v * (peak - shade) / 255))
    )
    outline = Image.new("L", subject, 0)
    ImageDraw.Draw(outline).ellipse((0, 0, subject[0] - 1, subject[1] - 1), fill=255)
    backdrop.paste(ramp, (centre[0] - subject[0] // 2, centre[1] - subject[1] // 2), outline)
    return Image.merge("RGB", (backdrop, backdrop, backdrop))


def _tinted(image: Image.Image, green: float, blue: float) -> Image.Image:
    red, _, _ = image.split()
    return Image.merge(
        "RGB", (red, red.point(lambda v: round(v * green)), red.point(lambda v: round(v * blue)))
    )


def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=100, subsampling=2)  # as the generator delivers plates
    return buffer.getvalue()


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _decode(code: int) -> float:
    return (code / 255) ** DISPLAY_GAMMA


def _fully_exposed(pixel: tuple[int, ...], gain: float) -> tuple[int, ...]:
    """`pixel` as published where it takes the full gain: every channel scaled by one factor."""
    scale = exposure_scale_lut(gain)[max(pixel)]
    return tuple(math.floor(channel * scale + 0.5) for channel in pixel)


# -- the curve ------------------------------------------------------------------------------


def test_unit_gain_scales_nothing() -> None:
    assert exposure_scale_lut(1.0) == pytest.approx([1.0] * 256)


@pytest.mark.parametrize("gain", GAINS)
def test_a_grey_code_is_monotonic_never_darkens_and_keeps_black_and_white(gain: float) -> None:
    codes = [_fully_exposed((code,), gain)[0] for code in range(256)]

    assert all(lower <= upper for lower, upper in pairwise(codes))
    assert [code for code, out in enumerate(codes) if out < code] == []
    assert (codes[0], codes[255]) == (0, 255)


@pytest.mark.parametrize("gain", GAINS)
def test_the_brightest_channel_never_clips(gain: float) -> None:
    scale = exposure_scale_lut(gain)

    assert max(code * scale[code] for code in range(256)) <= 255 + 1e-9


@pytest.mark.parametrize("gain", GAINS)
def test_the_curve_rises_strictly_and_reaches_white_only_at_white(gain: float) -> None:
    xs = [i / 4096 for i in range(4097)]
    ys = [exposure_curve(x, gain) for x in xs]

    assert all(lower < upper for lower, upper in pairwise(ys))
    assert ys[-1] == pytest.approx(1.0)
    assert max(ys[:-1]) < 1.0


def test_the_toe_keeps_near_black_from_taking_the_full_gain() -> None:
    near_black, subject = _decode(8), _decode(100)

    assert exposure_curve(near_black, MAX_GAIN) / near_black < 1.5
    assert exposure_curve(subject, MAX_GAIN) / subject > 2.5


def test_a_darkening_gain_is_refused() -> None:
    with pytest.raises(ValueError, match="would darken"):
        exposure_curve(0.5, 0.9)


# -- the gain -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("highlight", "gain"),
    [(None, 1.0), (TARGET_HIGHLIGHT, 1.0), (230, 1.0), (60, MAX_GAIN), (30, MAX_GAIN)],
)
def test_the_gain_is_one_when_bright_enough_and_capped_when_far_too_dark(
    highlight: int | None, gain: float
) -> None:
    assert exposure_gain(highlight) == gain


@pytest.mark.parametrize("highlight", [110, 130, 150])
def test_an_uncapped_gain_lands_the_highlight_on_the_target(highlight: int) -> None:
    gain = exposure_gain(highlight)

    assert 1.0 < gain < MAX_GAIN
    assert _fully_exposed((highlight,), gain)[0] == pytest.approx(TARGET_HIGHLIGHT, abs=1)


# -- measuring a plate ----------------------------------------------------------------------


@pytest.mark.parametrize("peak", [70, 120, 200])
def test_the_highlight_is_the_lit_side_of_the_subject_not_the_glow_behind_it(peak: int) -> None:
    highlight = measure_highlight(_plate(peak))

    assert highlight is not None
    assert peak - 0.12 * peak - 4 <= highlight <= peak


def test_a_plate_with_no_subject_has_no_highlight() -> None:
    assert measure_highlight(_plate(0, glow=25, subject=(2, 2))) is None
    assert measure_highlight(Image.new("RGB", (16, 9), (37, 91, 128))) is None


def test_a_bright_thing_outside_the_central_disc_is_not_the_subject() -> None:
    corner = _plate(220, glow=0, centre=(60, 60), subject=(60, 40))

    assert measure_highlight(corner) is None


# -- exposing a plate -----------------------------------------------------------------------


def test_a_dark_jpeg_is_brightened_toward_the_target_at_full_quality() -> None:
    data = _jpeg(_plate(90))
    with Image.open(io.BytesIO(data)) as original:
        highlight = measure_highlight(original)
        sampling = JpegImagePlugin.get_sampling(original)
        before = original.getpixel(CENTRE)

    exposed = expose_plate(data)

    assert exposed.exposure == PlateExposure(highlight=highlight, gain=exposure_gain(highlight))
    assert exposed.exposure.gain > 1.0
    with Image.open(io.BytesIO(exposed.data)) as out:
        assert (out.format, out.mode, out.size) == ("JPEG", "RGB", (SIZE, SIZE))
        assert JpegImagePlugin.get_sampling(out) == sampling
        assert {q for table in out.quantization.values() for q in table} == {1}
        after = out.getpixel(CENTRE)
        assert after == pytest.approx(_fully_exposed(before, exposed.exposure.gain), abs=2)
        assert min(after) > max(before) + 20
        assert max(out.getpixel((2, 2))) <= 3  # the black rim stays black


def test_a_dark_coloured_subject_keeps_its_hue_and_saturation() -> None:
    data = _png(_tinted(_plate(90), green=0.7, blue=0.5))
    with Image.open(io.BytesIO(data)) as original:
        shadow = (CENTRE[0], CENTRE[1] - 20)  # the darker side of the subject's lighting ramp
        before = original.getpixel(CENTRE), original.getpixel(shadow)

    exposed = expose_plate(data)

    with Image.open(io.BytesIO(exposed.data)) as out:
        after = out.getpixel(CENTRE), out.getpixel(shadow)
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


def test_the_glow_behind_the_subject_keeps_its_level() -> None:
    data = _png(_plate(90, glow=40))
    # Just above, just below and below-right of the subject, where the glow is still bright.
    glow_points = [(CENTRE[0], CENTRE[1] - 66), (CENTRE[0], CENTRE[1] + 60), (300, 320)]
    with Image.open(io.BytesIO(data)) as original:
        before = [original.getpixel(point) for point in glow_points]

    exposed = expose_plate(data)

    with Image.open(io.BytesIO(exposed.data)) as out:
        after = [out.getpixel(point) for point in glow_points]
    full_gain = [_fully_exposed(pixel, exposed.exposure.gain) for pixel in before]
    assert all(max(pixel) >= 20 for pixel in before)  # glow, not the black rim
    assert all(max(f) - max(b) >= 8 for f, b in zip(full_gain, before, strict=True))
    assert [c for pixel in after for c in pixel] == pytest.approx(
        [c for pixel in before for c in pixel], abs=3
    )


def test_a_plate_already_bright_enough_publishes_byte_for_byte() -> None:
    data = _jpeg(_plate(200))

    assert expose_plate(data) == ExposedPlate(
        data=data, exposure=PlateExposure(highlight=measure_highlight(_plate(200)), gain=1.0)
    )


def test_a_png_plate_stays_png_and_exposing_is_deterministic() -> None:
    data = _png(_plate(90))

    first, second = expose_plate(data), expose_plate(data)

    assert first == second
    assert first.data != data
    with Image.open(io.BytesIO(first.data)) as out:
        assert out.format == "PNG"


def test_a_plate_that_is_not_rgb_is_refused() -> None:
    with pytest.raises(ExposureError, match="expected an RGB plate, got mode RGBA"):
        expose_plate(_png(_plate(90).convert("RGBA")))


# -- erasing the scale bar (ADR-015 amendment 2026-09-17) -------------------------------------

# A tail-like appendage, touching the subject and dipping well below it -- must never be erased.
TAIL_BOX = (230, 291, 280, 350)
# A separate, uniform "scale bar" below both the subject and the tail, clear of either -- wide
# and thin enough to pass `pipeline.exposure`'s line-shape filter (>= 8% of plate width, <= 2.5%
# of plate height).
BAR_BOX = (150, 380, 350, 387)
BAR_LEVEL = 200


def _plate_with_bar_and_tail(peak: int = 200, *, glow: int = 20) -> Image.Image:
    """`_plate` plus a tail dipping low and a separate, flat, bar-like rectangle below it, both
    well inside `SUBJECT_DISC_RADIUS` so `subject_mask` sees them."""
    plane, _, _ = _plate(peak, glow=glow).split()
    draw = ImageDraw.Draw(plane)
    draw.rectangle(TAIL_BOX, fill=peak)
    draw.rectangle(BAR_BOX, fill=BAR_LEVEL)
    return Image.merge("RGB", (plane, plane, plane))


def test_erase_scale_bar_removes_the_bar_and_leaves_the_subject_and_tail_untouched() -> None:
    before = _plate_with_bar_and_tail()
    data = _jpeg(before)

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


def test_erase_scale_bar_is_a_no_op_with_no_subject() -> None:
    blank = Image.new("RGB", (SIZE, SIZE), (5, 5, 5))
    data = _jpeg(blank)

    assert erase_scale_bar(data) == data


def test_erase_scale_bar_refuses_a_non_rgb_plate() -> None:
    with pytest.raises(ExposureError, match="expected an RGB plate, got mode RGBA"):
        erase_scale_bar(_png(_plate(90).convert("RGBA")))
