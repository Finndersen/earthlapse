"""Exposure normalisation of published portrait plates (ADR-015, amendment 2026-09-14). Pillow only.

    pinned plate -> luma at ANALYSIS_SIZE -> backdrop (a morphological opening of the plate)
                 -> subject mask: clearly brighter than the backdrop, inside the central disc
                 -> subject highlight: the HIGHLIGHT_PERCENTILE luma code of the mask
                 -> gain that lifts it to TARGET_HIGHLIGHT, capped at MAX_GAIN, never below 1
                 -> per pixel: one linear-light factor for all three channels, read from the
                    pixel's brightest channel (toe, gain, white-preserving shoulder) and faded in
                    by how far that channel stands above the backdrop

The pinned candidate is never rewritten (ADR-005): `earthtime publish` writes this derivative to
data/media/portraits/. Geometry is untouched, so morph fields computed from the pinned originals
(pipeline/morph.py) stay valid, and a plate that needs no gain publishes byte for byte.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageMath, JpegImagePlugin

ANALYSIS_SIZE = 256
# Wider, at analysis size, than a subject's body is thick, so opening the plate removes the
# organism and keeps the backdrop's soft central glow; the mask then measures the organism
# against the glow behind it rather than against the black rim.
BACKDROP_KERNEL = 41
SUBJECT_CONTRAST = 10
# The organism is centred at about 70% fill (VISUAL_SPEC §10). A microscope plate's dish rim and
# the vignette's edge lie outside this disc and must not count as subject.
SUBJECT_DISC_RADIUS = 0.42
HIGHLIGHT_PERCENTILE = 95
# The subject highlight of the plates that already read well (the fossil fish, the microscope
# plates) sits at or above this; the dark hominin and mammal plates sit 20-50 codes below it.
TARGET_HIGHLIGHT = 160
# In linear light. Past this the subject's own shadows and the JPEG noise in them lift into
# visible grain; a plate that would need more is underlit and needs regenerating, not stretching.
MAX_GAIN = 3.5
# Below this code the gain eases in from none, so near-black and its JPEG noise keep their depth.
# Any highlight this dark already needs more than MAX_GAIN, so the toe never moves an uncapped
# plate's highlight off the target.
TOE_CODE = 16
# The gain fades in over this many codes above the backdrop. The glow behind the subject is the
# backdrop, so it keeps its level and grain wherever it lies, and the lift draws no outline.
LIFT_RAMP = 20
GAIN_DECIMALS = 3
# The same transfer web/src/layers/portraitShaders.ts blends plates in.
DISPLAY_GAMMA = 2.2
JPEG_QUALITY = 100
_FULL_CHROMA = 0  # Pillow's 4:4:4, for a source whose subsampling it cannot name
_KEPT_INFO = ("dpi", "icc_profile")


class ExposureError(ValueError):
    """A plate that cannot be exposure-normalised as stored. Nothing is published."""


@dataclass(frozen=True)
class PlateExposure:
    highlight: int | None  # the pinned original's subject highlight, a luma code; None: no subject
    gain: float  # linear light; 1 means the published plate is the pinned file, byte for byte


@dataclass(frozen=True)
class ExposedPlate:
    data: bytes
    exposure: PlateExposure


def subject_mask(image: Image.Image) -> Image.Image:
    """A binary (0/255) `ANALYSIS_SIZE` mask: where the subject stands, not the backdrop.

    A pixel counts as subject when it is more than `SUBJECT_CONTRAST` codes brighter than the
    *local* backdrop (`_backdrop`'s morphological opening, wide enough to remove the organism but
    narrow enough to keep the vignette's own radial glow) inside the central disc. Comparing to
    the local level rather than a single frame-wide threshold is what makes this robust to the
    vignette: a strong glow reads as backdrop wherever it falls, instead of inflating the mask.
    Reused by `pipeline.morph` to place the scale-bar band without depending on that module's own
    `detect_subject_box`, whose single frame-corner threshold does exactly the inflation this
    avoids (see `pipeline.morph`'s module docstring).
    """
    luma = _at_analysis_size(image.convert("L"))
    brighter = ImageChops.subtract(luma, _backdrop(luma)).point(
        lambda v: 255 if v > SUBJECT_CONTRAST else 0
    )
    return ImageChops.multiply(brighter, _central_disc())


def measure_highlight(image: Image.Image) -> int | None:
    """The luma code below which `HIGHLIGHT_PERCENTILE`% of the subject's pixels fall.

    None when nothing stands out: a plate with no subject has nothing to expose.
    """
    luma = _at_analysis_size(image.convert("L"))
    return _percentile_code(luma.histogram(mask=subject_mask(image)), HIGHLIGHT_PERCENTILE)


def exposure_gain(highlight: int | None) -> float:
    """The linear-light gain that lifts `highlight` to `TARGET_HIGHLIGHT` through
    `exposure_curve`, capped at `MAX_GAIN`; 1 for a plate already that bright or with no subject."""
    if highlight is None or highlight >= TARGET_HIGHLIGHT:
        return 1.0
    x, target = _decode(highlight), _decode(TARGET_HIGHLIGHT)
    # Solves the shoulder g·x / (1 + (g − 1)·x) = target for g (see TOE_CODE for why the toe
    # can be ignored here).
    gain = target * (1 - x) / (x * (1 - target))
    return round(min(gain, MAX_GAIN), GAIN_DECIMALS)


def exposure_curve(x: float, gain: float) -> float:
    """Linear light [0, 1] -> [0, 1]. Monotonic, never below `x`, and 1 only at 1, so nothing clips.

    Above the toe it is the shoulder g·x / (1 + (g − 1)·x): slope `gain` in the shadows, easing to
    1/`gain` at white. Below `TOE_CODE` it blends from the identity into the shoulder by a
    smoothstep.
    """
    if gain < 1:
        raise ValueError(f"exposure gain {gain} would darken the plate")
    shoulder = gain * x / (1 + (gain - 1) * x)
    toe = min(x / _decode(TOE_CODE), 1.0)
    return x + (shoulder - x) * toe * toe * (3 - 2 * toe)


def exposure_scale_lut(gain: float) -> list[float]:
    """For each code of a pixel's brightest channel, the factor that multiplies all three of its
    channel codes when the pixel takes the full gain.

    Scaling encoded codes by k scales linear light by k^`DISPLAY_GAMMA`, so the pixel keeps its
    hue and saturation. The brightest channel lands on `exposure_curve` of itself, at most 255, so
    no channel clips.
    """
    return [1.0] + [_encode(exposure_curve(_decode(code), gain)) / code for code in range(1, 256)]


def expose_plate(data: bytes) -> ExposedPlate:
    """The plate as published: exposure-normalised in its own format, or `data` itself at gain 1."""
    with Image.open(io.BytesIO(data)) as image:
        if image.mode != "RGB":
            raise ExposureError(f"expected an RGB plate, got mode {image.mode}")
        highlight = measure_highlight(image)
        exposure = PlateExposure(highlight=highlight, gain=exposure_gain(highlight))
        if exposure.gain == 1.0:
            return ExposedPlate(data=data, exposure=exposure)
        exposed = _exposed(image, exposure.gain)
        return ExposedPlate(data=_encode_like(image, exposed), exposure=exposure)


def _exposed(image: Image.Image, gain: float) -> Image.Image:
    red, green, blue = image.split()
    peak = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    backdrop = _backdrop(_at_analysis_size(peak)).resize(image.size, Image.Resampling.BILINEAR)
    weight = ImageChops.subtract(peak, backdrop).point(_lift_weight_lut())
    scale = peak.point(exposure_scale_lut(gain), "F")
    factor = ImageMath.lambda_eval(
        lambda args: 1 + (args["scale"] - 1) * args["weight"] / 255, scale=scale, weight=weight
    )
    # Converting F to L truncates, so the half rounds to nearest.
    channels = [
        ImageMath.lambda_eval(
            lambda args: args["channel"] * args["factor"] + 0.5, channel=channel, factor=factor
        ).convert("L")
        for channel in (red, green, blue)
    ]
    return Image.merge("RGB", channels)


def _lift_weight_lut() -> list[int]:
    """How much of the gain a pixel takes (0-255) for each code it stands above the backdrop."""
    ramp = [min(excess / LIFT_RAMP, 1.0) for excess in range(256)]
    return [round(255 * t * t * (3 - 2 * t)) for t in ramp]


def _encode_like(original: Image.Image, exposed: Image.Image) -> bytes:
    """`exposed` in `original`'s format, at no lower quality than the generator delivered."""
    kept = {key: original.info[key] for key in _KEPT_INFO if key in original.info}
    buffer = io.BytesIO()
    match original.format:
        case "JPEG":
            sampling = JpegImagePlugin.get_sampling(original)
            exposed.save(
                buffer,
                "JPEG",
                quality=JPEG_QUALITY,
                subsampling=_FULL_CHROMA if sampling < 0 else sampling,
                **kept,
            )
        case "PNG":
            exposed.save(buffer, "PNG", **kept)
        case other:
            raise ExposureError(f"cannot re-encode a {other} plate; expected JPEG or PNG")
    return buffer.getvalue()


def _at_analysis_size(plane: Image.Image) -> Image.Image:
    return plane.resize((ANALYSIS_SIZE, ANALYSIS_SIZE), Image.Resampling.BOX)


def _backdrop(plane: Image.Image) -> Image.Image:
    """A morphological opening of an analysis-size plane: the backdrop and its glow, no organism."""
    return (
        plane.filter(ImageFilter.MinFilter(BACKDROP_KERNEL))
        .filter(ImageFilter.MaxFilter(BACKDROP_KERNEL))
        .filter(ImageFilter.GaussianBlur(BACKDROP_KERNEL / 4))
    )


def _central_disc() -> Image.Image:
    disc = Image.new("L", (ANALYSIS_SIZE, ANALYSIS_SIZE), 0)
    centre, radius = ANALYSIS_SIZE / 2, SUBJECT_DISC_RADIUS * ANALYSIS_SIZE
    ImageDraw.Draw(disc).ellipse(
        (centre - radius, centre - radius, centre + radius, centre + radius), fill=255
    )
    return disc


def _percentile_code(histogram: list[int], percentile: float) -> int | None:
    """Nearest-rank percentile of a 256-bin histogram; None when it is empty."""
    total = sum(histogram)
    if total == 0:
        return None
    rank = math.ceil(percentile / 100 * total)
    cumulative = 0
    for code, count in enumerate(histogram):
        cumulative += count
        if cumulative >= rank:
            return code
    raise AssertionError("a non-empty histogram reaches its own total")


def _decode(code: float) -> float:
    return (code / 255) ** DISPLAY_GAMMA


def _encode(x: float) -> float:
    return 255 * x ** (1 / DISPLAY_GAMMA)
