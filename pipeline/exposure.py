"""Exposure normalisation of published portrait plates (ADR-015, amendments 2026-09-14,
2026-09-17).

    pinned plate -> luma at ANALYSIS_SIZE -> backdrop (a morphological opening of the plate)
                 -> subject mask: clearly brighter than the backdrop, inside the central disc
                 -> subject highlight: the HIGHLIGHT_PERCENTILE luma code of the mask
                 -> gain that lifts it to TARGET_HIGHLIGHT, capped at MAX_GAIN, never below 1
                 -> per pixel: one linear-light factor for all three channels, read from the
                    pixel's brightest channel (toe, gain, white-preserving shoulder) and faded in
                    by how far that channel stands above the backdrop
                 -> within the plate's scale-bar band (`pipeline.scale_bar`, shared with
                    `pipeline.morph`'s own exclusion of it from flow estimation), a thin,
                    colourless, horizontal-line-shaped mask -- not the whole band -- is inpainted
                    and re-grained, so the bar the generator no longer draws (`pipeline.prompts`
                    `PORTRAIT_STYLE`) never reaches the viewer either, without touching the
                    backdrop or subject around it

The pinned candidate is never rewritten (ADR-005): `earthtime publish` writes this derivative to
data/media/portraits/, WebP-transcoded (pipeline/transcode.py) on top of whatever this module
does. Geometry is untouched, so morph fields computed from the pinned originals (pipeline/
morph.py) stay valid, and a plate that needs no gain and no scale-bar erase still gets that one
transcode -- see `expose_plate`'s own docstring for what "gain 1" means for this module alone.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageMath, JpegImagePlugin

from pipeline.scale_bar import band_pixels, box_from_mask, scale_bar_band

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
    avoids (see `pipeline.morph`'s module docstring), and by this module's own scale-bar erase to
    anchor the search band.
    """
    return _bright_mask(image, SUBJECT_CONTRAST)


def _bright_mask(image: Image.Image, threshold: int) -> Image.Image:
    """`subject_mask`'s own technique at an arbitrary `threshold`. `pipeline.exposure`'s erase
    uses this a second time, at `PROTECT_CONTRAST`, for `_subject_protect_mask`: at
    `SUBJECT_CONTRAST` a soft contact shadow or ambient floor bounce can itself read as "subject"
    and, being connected to both, bridge the organism to the scale bar -- fine for
    `subject_mask`'s own job (anchoring the search band; an imprecise anchor only ever costs
    search precision, per this module's docstring) but not for deciding, pixel by pixel, what the
    line-shape-and-colour-filtered erase candidate is allowed to touch."""
    luma = _at_analysis_size(image.convert("L"))
    brighter = ImageChops.subtract(luma, _backdrop(luma)).point(
        lambda v: 255 if v > threshold else 0
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


# ---------------------------------------------------------------- scale-bar erase (ADR-015
# ---------------------------------------------------------------- amendment 2026-09-17)

# The search band's own anchor is found at a stricter threshold than `subject_mask`'s own
# `SUBJECT_CONTRAST`: unlike `pipeline.morph.bar_search_extent`, which anchors on the *pinned*
# plate, this runs on the *exposure-gained* published derivative, and exposure gain can lift a
# soft contact shadow's contrast enough to bridge it to the organism at `SUBJECT_CONTRAST` --
# measured 2026-09-17, `opisthokonta`: at `SUBJECT_CONTRAST` the largest component reaches 90% of
# plate height (the vignette's own glow, not the cell), inflating the band's anchor so far down
# that it misses the bar entirely; at `EXTENT_CONTRAST` it stops at a tight 57%, matching the cell.
EXTENT_CONTRAST = 40
# How far above a smooth local estimate of the band's own backdrop (`_smooth_backdrop`) a pixel
# has to stand to be a scale-bar candidate. Well below a real bar's contrast (100+ codes measured
# on the pinned corpus) but above ordinary JPEG/render noise, so a faint bar is still found.
BAR_EXCESS_THRESHOLD = 14
# How colourless a candidate has to be. `PORTRAIT_STYLE` draws the bar "pale grey"; every organism
# in the corpus -- fur, skin, scales, even a pale microscope cell -- keeps some warmth. Measured
# 2026-09-17, per pixel along several plates' own bars (not just the plate-wide average, which
# hides the spread JPEG re-encoding and exposure gain add): up to 18 on individual bar pixels
# (`homo-sapiens`); real anatomy measured the same way in the same band was never under 23.
BAR_MAX_CHROMA = 20
# `_smooth_backdrop`'s Gaussian sigma, as a fraction of the plate's own width: wide enough that a
# ~1%-of-width-tall bar contributes almost nothing to its own local backdrop estimate, so the
# estimate under the bar is close to what the backdrop would read without it.
BACKDROP_BLUR_FRACTION = 0.08
# The morphological opening that keeps only long, thin, *horizontal* candidates -- a bar, not a
# foot or a patch of mottled shadow -- and the final component filter after it. A kernel this wide
# already rejects anything that is not predominantly a horizontal run; the width/height bounds on
# each surviving component are an independent second check on the same idea. A wide, shallow
# opening kernel alone was not enough: a gently sloped edge (the vignette's own boundary, or a
# shadow's) survives it too, broken into a staircase of short, individually thin-and-wide-enough
# segments (measured 2026-09-17, `holozoa`, `haplorhini`). `BAR_MIN_FILL_RATIO` is what actually
# separates them from a real bar: a solid rectangle fills almost all of its own bounding box, a
# diagonal sliver of one does not.
BAR_MIN_WIDTH_FRACTION = 0.08  # a component (and the opening kernel) must be at least this wide
# `boreoeutheria` -- the human's own "thick and bright" example -- measured 17px tall at 1024,
# 1.66% of plate height; 0.025 clears it with margin while staying far under real anatomy's own
# bounding-box height (a foot or leg fragment measured 15-40% of plate height in the same band).
BAR_MAX_HEIGHT_FRACTION = 0.025
# How much of its own bounding box a kept component's pixels must fill. A real bar, and even a
# short fragment of one, is solid (measured 1.0 on every genuine bar fragment found in the
# corpus); a run of short, diagonally-offset segments the opening did not fully separate reads as
# one component with a much lower fill (measured 0.13-0.62 on the false positives above).
BAR_MIN_FILL_RATIO = 0.85
BAR_MASK_DILATE_PX = 3  # grown a little past the detected line so inpainting has no hard edge
# The subject's own protection is measured at a stricter threshold than `SUBJECT_CONTRAST`
# (`subject_mask`'s own, used only to anchor the search band): a soft contact shadow or ambient
# floor bounce can itself clear `SUBJECT_CONTRAST`, and being connected to both the organism and
# the bar, would bridge "protected" all the way across the band and past the bar too (measured
# 2026-09-17, `amniota`: at `SUBJECT_CONTRAST` the organism's own largest component reaches 70% of
# plate height; at `PROTECT_CONTRAST` it stops at 61%, clear of the bar). Comfortably above a
# shadow's own brightness, matching `SEED_CONTRAST` from an earlier iteration of this amendment.
PROTECT_CONTRAST = 60
# The subject's own protection: the largest connected component at `PROTECT_CONTRAST`, dilated by
# this many pixels so a foot or tail immediately adjacent to the mask's own soft edge is never
# eroded into "erasable". Never touched regardless of what the line mask above finds inside it.
SUBJECT_PROTECT_DILATE_PX = 6
INPAINT_RADIUS = 3
# A fixed seed, not real randomness, so `earthtime publish` stays deterministic: the same plate
# always inpaints to the same bytes. The grain is added only inside the thin erased line, scaled
# to that plate's own local backdrop noise, so the strip does not read as an unnaturally smooth
# streak against its grainy surroundings.
GRAIN_SEED = 20260917


def erase_scale_bar(data: bytes) -> bytes:
    """`data` with its scale-bar line inpainted from its own surrounding backdrop, or `data`
    itself when there is nothing to erase.

    `PORTRAIT_STYLE` (`pipeline.prompts`) no longer asks the generator for a bar -- the human
    found it inconsistent (faint on most plates, thick and bright on a couple) and not helpful --
    but the 40 already-pinned plates still carry one (ADR-005: a pin is never regenerated), so
    every plate `earthtime publish` writes gets it painted out here instead. The pinned original
    is untouched and `pipeline.morph`'s flow fields stay computed from it -- unaffected by this,
    since it still excludes the same band from flow estimation on its own copy of the plate.

    Deliberately narrow: only a thin, colourless, horizontal-line-shaped mask inside the known
    band is ever touched (see `_scale_bar_mask`), not the band's whole area -- filling the whole
    band from a smoothed backdrop estimate left visible geometric patches where it replaced real
    (if plain) backdrop or shadow, found and rejected 2026-09-17.
    """
    with Image.open(io.BytesIO(data)) as image:
        if image.mode != "RGB":
            raise ExposureError(f"expected an RGB plate, got mode {image.mode}")
        rgb = np.array(image, dtype=np.uint8)
        mask, gray, backdrop = _scale_bar_mask(rgb)
        if mask is None or not mask.any():
            return data
        inpainted = cv2.inpaint(rgb, mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
        grained = _grained(inpainted, gray, backdrop, mask)
        return _encode_like(image, Image.fromarray(grained, "RGB"))


def _scale_bar_mask(
    rgb: NDArray[np.uint8],
) -> tuple[NDArray[np.uint8] | None, NDArray[np.uint8], NDArray[np.uint8]]:
    """The thin mask to inpaint (0/255, `rgb`'s own size), or `None` when no subject stands out to
    anchor the search band on (fail open, as `pipeline.morph`'s own extent-finding does) -- along
    with the full-size luma and its smooth local backdrop, reused by `_grained`.

    A pixel is a candidate only inside `pipeline.scale_bar.scale_bar_band` (the same known-layout
    anchor `pipeline.morph` already excludes from flow estimation, never a contrast or shape
    detector for the bar's *position* -- ADR-015's 2026-09-15 amendment measured that unreliable),
    and only when it is *both* brighter than a smoothed local backdrop estimate and colourless
    (`BAR_EXCESS_THRESHOLD`, `BAR_MAX_CHROMA`); a long, thin horizontal opening and a per-component
    width/height filter then keep only what is actually line-shaped, so a differently-shaped
    bright, colourless patch (there should not be one, but nothing here assumes it) is not touched
    either. The subject's own extent, dilated, is subtracted last, regardless of shape or colour:
    a foot or tail that happens to be both bright and colourless is still never erased.
    """
    height, width = rgb.shape[:2]
    image = Image.fromarray(rgb, "RGB")
    extent_mask = _bright_mask(image, EXTENT_CONTRAST)
    extent = box_from_mask(np.asarray(extent_mask, dtype=np.uint8), extent_mask.size[0])
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    backdrop = _smooth_backdrop(gray, width)
    if extent is None:
        return None, gray, backdrop
    band = scale_bar_band(extent)
    band_rows, band_cols = band_pixels(band, width, height)
    if band_rows.stop <= band_rows.start or band_cols.stop <= band_cols.start:
        return None, gray, backdrop

    excess = gray.astype(np.int16) - backdrop.astype(np.int16)
    channel_max = rgb.max(axis=2).astype(np.int16)
    channel_min = rgb.min(axis=2).astype(np.int16)
    chroma = channel_max - channel_min
    candidate = np.zeros((height, width), dtype=np.uint8)
    candidate[band_rows, band_cols] = (
        (excess[band_rows, band_cols] > BAR_EXCESS_THRESHOLD)
        & (chroma[band_rows, band_cols] <= BAR_MAX_CHROMA)
    ).astype(np.uint8) * 255
    if not candidate.any():
        return None, gray, backdrop

    kernel_width = max(3, round(BAR_MIN_WIDTH_FRACTION * width))
    opened = cv2.morphologyEx(
        candidate, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
    )
    if not opened.any():
        return None, gray, backdrop

    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    min_width = BAR_MIN_WIDTH_FRACTION * width
    max_height = BAR_MAX_HEIGHT_FRACTION * height
    line_mask = np.zeros((height, width), dtype=np.uint8)
    for label in range(1, count):
        comp_width = stats[label, cv2.CC_STAT_WIDTH]
        comp_height = stats[label, cv2.CC_STAT_HEIGHT]
        comp_area = stats[label, cv2.CC_STAT_AREA]
        fill_ratio = comp_area / (comp_width * comp_height)
        if (
            comp_width >= min_width
            and comp_height <= max_height
            and fill_ratio >= BAR_MIN_FILL_RATIO
        ):
            line_mask[labels == label] = 255
    if not line_mask.any():
        return None, gray, backdrop

    dilate_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (BAR_MASK_DILATE_PX * 2 + 1, BAR_MASK_DILATE_PX * 2 + 1)
    )
    line_mask = cv2.dilate(line_mask, dilate_kernel)
    line_mask[_subject_protect_mask(image, width, height) > 0] = 0
    return (line_mask if line_mask.any() else None), gray, backdrop


def _subject_protect_mask(image: Image.Image, width: int, height: int) -> NDArray[np.uint8]:
    """The largest connected component of `_bright_mask(image, PROTECT_CONTRAST)` -- the organism
    itself, not a separate bright blob such as the bar, and not a shadow or floor bounce too faint
    to clear this stricter threshold -- resampled to full size and dilated by
    `SUBJECT_PROTECT_DILATE_PX`. Never touched by the erase above, regardless of what it looks
    like: this is the hard backstop, not the line-shape and colour tests, which are only meant to
    narrow the search."""
    mask = np.asarray(_bright_mask(image, PROTECT_CONTRAST), dtype=np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count < 2:
        return np.zeros((height, width), dtype=np.uint8)
    largest_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    subject = np.where(labels == largest_label, np.uint8(255), np.uint8(0))
    full = cv2.resize(subject, (width, height), interpolation=cv2.INTER_NEAREST)
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (SUBJECT_PROTECT_DILATE_PX * 2 + 1, SUBJECT_PROTECT_DILATE_PX * 2 + 1)
    )
    return cv2.dilate(full, kernel)


def _smooth_backdrop(gray: NDArray[np.uint8], width: int) -> NDArray[np.uint8]:
    """A heavily blurred estimate of `gray`'s own backdrop: wide enough that a thin scale bar
    barely moves it, so the estimate under the bar reads close to the backdrop the bar sits on."""
    sigma = BACKDROP_BLUR_FRACTION * width
    return cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma)


def _grained(
    rgb: NDArray[np.uint8],
    gray: NDArray[np.uint8],
    backdrop: NDArray[np.uint8],
    mask: NDArray[np.uint8],
) -> NDArray[np.uint8]:
    """`rgb` with deterministic Gaussian grain added inside `mask`, scaled to the plate's own
    local backdrop noise (measured just outside the mask, within its band's own rows) -- a plain
    `cv2.inpaint` result reads as an unnaturally smooth streak against the surrounding grain."""
    band_rows = np.any(mask, axis=1)
    if not band_rows.any():
        return rgb
    residual = gray.astype(np.float64) - backdrop.astype(np.float64)
    backdrop_residual = residual[band_rows][mask[band_rows] == 0]
    std = float(np.std(backdrop_residual)) if backdrop_residual.size else 0.0
    if std <= 0:
        return rgb
    noise = np.random.RandomState(GRAIN_SEED).normal(0.0, std, size=gray.shape)
    grained = rgb.astype(np.float64)
    grained += noise[..., np.newaxis] * (mask > 0)[..., np.newaxis]
    return np.clip(grained, 0, 255).astype(np.uint8)


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
