"""Optical flow between consecutive pinned portrait plates (ADR-015, amendments 2026-09-15,
2026-09-16, 2026-09-17).

    plate -> subject box (from the dark backdrop) -> framing that centres and scales it
          -> a *separate*, vignette-robust subject extent anchors and clips a scale-bar band
             (`bar_search_extent`), which is erased before normalising and zeroed again after
          -> both plates normalised -> DIS optical flow both ways, smoothed more for
             pose-divergent pairs -> composed back onto each plate's own grid
          -> incoherent pairs (measured within the vignette-robust extent, not the subject box)
             fall back to an all-zero (plain crossfade) field
          -> encoded PNG data textures

Two subject-extent estimates coexist deliberately. `detect_subject_box` (a single frame-corner
threshold) still drives framing/zoom and pose-divergence smoothing exactly as before: changing
those would reframe every pinned pair, out of scope for either amendment. `bar_search_extent`
(`pipeline.exposure`'s local-backdrop technique, already calibrated for exposure normalisation)
is not susceptible to that threshold's main failure -- reading a strong vignette's own glow as
part of the subject -- so it is used instead, and only, for the two places that failure actually
corrupted: where the scale-bar band gets excluded, and the region the dissolve gate measures.

Deterministic and free, so it runs at publish preparation time rather than through the paid
asset graph; its output is cached by the two pins' digests (pipeline/portraits.py `MorphKey`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline.exposure import subject_mask as exposure_subject_mask
from pipeline.flowfield import (
    FLOW_TEXTURE_SIZE,
    FloatField,
    Framing,
    SubjectBox,
    compose_flow,
    encode_flow,
    texel_centres,
)
from pipeline.portraits import (
    BACKWARD_FLOW_NAME,
    FORWARD_FLOW_NAME,
    MORPH_ALGORITHM_VERSION,
    MORPH_RECORD_NAME,
    MorphKey,
    MorphRecord,
)
from pipeline.scale_bar import Extent, ScaleBarBand, box_from_mask, scale_bar_band

GrayImage = NDArray[np.uint8]

COMPUTE_SIZE = 384
# Matches the plate style's "longest dimension spans about 70% of the frame" (VISUAL_SPEC §10),
# so a well-framed plate barely moves when normalised.
SUBJECT_FILL = 0.7
ANALYSIS_SIZE = 256
BORDER_FRACTION = 0.04
MIN_CONTRAST = 18.0
NOISE_MADS = 4.0
# Neighbouring subjects are framed at most this much apart in scale. Past it the morph stops
# reading as one organism becoming another and reads as the whole plate bursting outward (a
# lone cell becoming a colony four times its size); body-plan changes that large dissolve better.
MAX_MORPH_ZOOM = 1.4
# 95th-percentile displacement, in plate widths, past which a field is refused. The worst
# well-framed pair reaches 0.43; the two bursting pairs that motivated MAX_MORPH_ZOOM reached
# 1.0 and 2.1.
MAX_FLOW_P95 = 0.6
# Two different organisms never correspond pixel for pixel; a smooth field bends one into the
# other instead of tearing it.
FLOW_SMOOTHING_SIGMA = 6.0

# `PORTRAIT_STYLE` (pipeline/prompts.py) no longer asks the generator for a scale bar (ADR-015
# amendment 2026-09-17: the human found it inconsistent -- faint on most plates, thick and bright
# on a couple -- and not helpful, and it is erased from every *published* plate, `pipeline.exposure`).
# But the 40 already-pinned plates this module reads still carry one (a pin is never regenerated,
# ADR-005), and its position drifts differently between two independently normalised plates (each
# centred and scaled to its own subject box), so optical flow still bends it into a hook or
# squiggle rather than leaving it straight if left in (queue item 14 evidence) -- this module's own
# exclusion stays needed regardless of what publish does with the result. The band is anchored to
# a subject extent (`SCALE_BAR_BAND_*`, `scale_bar_band`, `pipeline.scale_bar` -- shared with
# `pipeline.exposure`'s publish-time erase) rather than trying to detect the bar itself (measured
# unreliable in practice, both by the original 2026-09-15 amendment and a second check that tried a
# wider search window: still too faint or thin at generation size to separate reliably from a
# subject's own edges and shadow). The anchor is `bar_search_extent`, *not* `detect_subject_box`:
# the latter's single frame-corner threshold reads a strong vignette's own radial glow as subject
# on most plates (measured 2026-09-16: e.g. `amniota`'s box bottom at 0.92 with the lizard's real
# belly around 0.6), which both misses the true bar on most plates and, worse, was wide enough on
# some to erase real anatomy when used to place this band -- a regression the 2026-09-15 amendment
# introduced (`theria` -> `eutheria` and `leca` -> `opisthokonta` both showed new ghosting).
# `bar_search_extent` leans well below the box (the bar sits close under the subject, and this
# half of the band only ever covers backdrop on a well-anchored plate) and a little above it too
# (the four pairs measured 2026-09-16 put the true bar as much as 0.063 plate-UV above the
# extent's own bottom edge). Either margin can still overshoot on an individual plate; `erase_band`
# and `zero_band` additionally never touch a pixel `bar_search_extent`'s own mask calls subject,
# so an overshoot only ever costs band precision, never anatomy.

# `zero_band`'s edge, in FLOW_TEXTURE_SIZE texels: a hard cutoff in the composed flow field is a
# discontinuity the shader renders as a visible tear at the band's boundary. This Gaussian eases
# the zeroed region in instead.
ZERO_BAND_FEATHER_SIGMA = 3.0

# Two subjects in very different poses (a squat quadruped vs. an upright biped) cannot be
# reconciled by DIS's local correspondence alone: forcing a sharp field to bridge them produces
# the offset silhouettes and tangled limbs queue item 14 reports. Widening the flow's smoothing
# kernel in proportion to how differently *shaped* the two subject boxes are (not merely how far
# apart in scale — `bounded_fills` already handles that) trades fine detail for a coherent bend.
POSE_DIVERGENCE_SMOOTHING_GAIN = 3.0
MAX_FLOW_SMOOTHING_SIGMA = 16.0

# Past this mean round-trip error (plate UV, measured within `bar_search_extent`'s vignette-robust
# region, not `detect_subject_box`'s own — see this module's docstring), the forward and backward
# fields disagree enough that the flow reads as two overlapping bodies rather than one bending
# into the other; `compute_morph` then reports `fallback_dissolve` and the pair publishes as a
# plain linear-light dissolve instead (ADR-015 amendment). Recalibrated 2026-09-16 against all 39
# pinned-adjacent pairs on the live tree, through this same pipeline (fixed scale-bar band, the
# extent-based region): scores cluster from 0.007 to 0.038 with no single clean gap, then
# `gnathostomata` -> `osteichthyes` at 0.0397, then 0.041 up to 0.177. 0.039 sits just under that
# first pair: every pair at or above it was rendered as the actual mid-transition frame the
# shader produces and confirmed visibly doubled or tangled; every pair below it was spot-checked
# the same way and confirmed a single coherent body. 20 pairs stay a real morph, 18 dissolve by
# this threshold; one more (`metazoa` -> `eumetazoa`, 0.0365, under it) needs
# `FORCED_DISSOLVE_PAIRS` because this statistic cannot separate it from a clean pair at any
# threshold; see the ADR amendment's "Limit" section.
MAX_INVERSE_CONSISTENCY = 0.039

# Pairs the round-trip statistic above cannot catch at any threshold without also dissolving
# clearly clean pairs, confirmed doubled by eye instead (queue item 14 QA, 2026-09-16; rendered
# the actual mid-transition frame the shader produces, `MAX_INVERSE_CONSISTENCY`'s comment). Both
# involve a translucent, radially-symmetric microscope subject: its edges disagree with its
# neighbour's just enough, everywhere, to read as visible ghosting without ever producing the
# concentrated round-trip disagreement the statistic looks for.
FORCED_DISSOLVE_PAIRS: frozenset[tuple[str, str]] = frozenset({("metazoa", "eumetazoa")})


class MorphError(ValueError):
    """A plate cannot be morphed as generated. Fix the plate or its pick; nothing is written."""


def load_plate(path: Path) -> GrayImage:
    with Image.open(path) as image:
        gray = np.asarray(image.convert("L"), dtype=np.uint8)
    height, width = gray.shape
    if height != width:
        raise MorphError(f"{path}: portrait plates are square (1:1), got {width}x{height}")
    return gray


def _backdrop_statistics(small: GrayImage) -> tuple[float, float]:
    """(level, spread): the backdrop's median code and its MAD, read from `small`'s own rim."""
    rim = max(1, round(ANALYSIS_SIZE * BORDER_FRACTION))
    border = np.concatenate(
        [small[:rim].ravel(), small[-rim:].ravel(), small[:, :rim].ravel(), small[:, -rim:].ravel()]
    ).astype(np.float64)
    level = float(np.median(border))
    spread = float(np.median(np.abs(border - level)))
    return level, spread


def backdrop_level(gray: GrayImage) -> float:
    """The plate's own backdrop code (the same statistic `detect_subject_box` thresholds
    against), used to erase its scale-bar band without leaving a visible patch."""
    small = cv2.resize(gray, (ANALYSIS_SIZE, ANALYSIS_SIZE), interpolation=cv2.INTER_AREA)
    level, _ = _backdrop_statistics(small)
    return level


@dataclass(frozen=True)
class BarSearchExtent:
    """A subject extent used only to anchor and clip the scale-bar exclusion -- never for
    framing, pose divergence or `MAX_MORPH_ZOOM`, which keep using `detect_subject_box` (module
    docstring)."""

    box: SubjectBox
    band: ScaleBarBand  # scale_bar_band(box), precomputed so callers need not repeat it
    mask: GrayImage  # the subject silhouette at ANALYSIS_SIZE (pipeline.exposure), 0/255


def _subject_box(extent: Extent) -> SubjectBox:
    return SubjectBox(left=extent.left, top=extent.top, right=extent.right, bottom=extent.bottom)


def detect_subject_box(gray: GrayImage) -> SubjectBox:
    """The subject's box: everything clearly brighter than the backdrop at the plate's rim.

    Drives framing, zoom and pose-divergence smoothing -- never the scale-bar band, which anchors
    on `bar_search_extent` instead (see this module's docstring for why)."""
    small = cv2.resize(gray, (ANALYSIS_SIZE, ANALYSIS_SIZE), interpolation=cv2.INTER_AREA)
    level, spread = _backdrop_statistics(small)
    threshold = level + max(MIN_CONTRAST, NOISE_MADS * spread)
    mask = (small > threshold).astype(np.uint8)
    extent = box_from_mask(mask, ANALYSIS_SIZE)
    if extent is None:
        raise MorphError("no subject stands out from the plate's backdrop")
    return _subject_box(extent)


def bar_search_extent(gray: GrayImage) -> BarSearchExtent | None:
    """The subject's extent for `scale_bar_band` to anchor on and `erase_band`/`zero_band` to
    never paint over -- *not* `detect_subject_box`'s box (module docstring). Reuses
    `pipeline.exposure.subject_mask`'s local-backdrop technique, already calibrated against the
    whole pinned corpus for exposure normalisation, so a vignette's own glow reads as backdrop
    here wherever it falls, rather than inflating the mask the way a single frame-corner
    threshold does. None when nothing stands out, so callers skip masking rather than guess."""
    with Image.fromarray(gray, mode="L") as plate:
        mask = np.asarray(exposure_subject_mask(plate), dtype=np.uint8)
    extent = box_from_mask(mask, mask.shape[0])
    if extent is None:
        return None
    box = _subject_box(extent)
    return BarSearchExtent(box=box, band=scale_bar_band(box), mask=mask)


def _mask_at(extent: BarSearchExtent, size: int) -> NDArray[np.bool_]:
    """`extent.mask`, resampled to a `size`x`size` boolean grid (nearest-neighbour: it is
    already binary, and interpolating would blur its edge into fractional "maybe subject")."""
    resized: NDArray[np.bool_] = (
        cv2.resize(extent.mask, (size, size), interpolation=cv2.INTER_NEAREST) > 0
    )
    return resized


def bounded_fills(older: SubjectBox, younger: SubjectBox) -> tuple[float, float]:
    """Per-plate framing fills that keep the two subjects within `MAX_MORPH_ZOOM` of each other.

    Each subject is framed as if its span were pulled toward the pair's geometric mean, so a
    well-matched pair keeps `SUBJECT_FILL` exactly and a mismatched one meets in the middle.
    """
    mean = math.sqrt(older.span * younger.span)
    half_zoom = math.sqrt(MAX_MORPH_ZOOM)

    def fill(span: float) -> float:
        framed_span = min(max(span, mean / half_zoom), mean * half_zoom)
        return SUBJECT_FILL * span / framed_span

    return fill(older.span), fill(younger.span)


def _band_slice(band: ScaleBarBand, size: int) -> tuple[slice, slice]:
    top, bottom = int(band.top * size), min(size, math.ceil(band.bottom * size))
    left, right = int(band.left * size), min(size, math.ceil(band.right * size))
    return slice(top, bottom), slice(left, right)


def erase_band(
    gray: GrayImage, band: ScaleBarBand, level: float, subject_mask: NDArray[np.bool_]
) -> GrayImage:
    """`gray` with `band` painted over at the backdrop's own `level`, so DIS never treats the
    scale bar as texture to correspond -- except wherever `subject_mask` (same resolution as
    `gray`) says the real subject stands. `band`'s anchor is an approximation (see
    `bar_search_extent`); this guarantees an overshoot never erases anatomy, only backdrop."""
    erased = gray.copy()
    rows, columns = _band_slice(band, gray.shape[0])
    region = erased[rows, columns]
    region[~subject_mask[rows, columns]] = np.uint8(round(level))
    erased[rows, columns] = region
    return erased


def zero_band(
    field: FloatField, band: ScaleBarBand, size: int, subject_mask: NDArray[np.bool_]
) -> FloatField:
    """`field` with displacement faded to zero inside `band` (never where `subject_mask` says
    the real subject stands, for the same reason as `erase_band`), so the scale bar never warps
    even if some of it survived normalisation and flow estimation at its edges. The fade is
    feathered by `ZERO_BAND_FEATHER_SIGMA`, not a hard cut, so the band's own edge cannot tear
    the field."""
    indicator = np.zeros((size, size), dtype=np.float32)
    rows, columns = _band_slice(band, size)
    indicator[rows, columns] = 1.0
    alpha = np.clip(cv2.GaussianBlur(indicator, (0, 0), ZERO_BAND_FEATHER_SIGMA), 0.0, 1.0)
    # The blur is purely about the band's own edge; a subject pixel gets exactly zero alpha
    # regardless, even one the blur would otherwise have bled a little into -- their boundary is
    # a real content edge, not a seam that needs smoothing.
    alpha[subject_mask] = 0.0
    zeroed: FloatField = (field * (1.0 - alpha[..., np.newaxis])).astype(np.float32)
    return zeroed


def pose_divergence(older: SubjectBox, younger: SubjectBox) -> float:
    """How differently *shaped* the two subject boxes are: 0 for identical proportions, growing
    with the log ratio of their aspect ratios (symmetric in which one is older, unlike a plain
    ratio). `bounded_fills` already reconciles how far apart they are in scale; this is about
    their silhouette instead, which a uniform `Framing` cannot correct for."""
    return abs(math.log(older.aspect / younger.aspect))


def flow_smoothing_sigma(divergence: float) -> float:
    """The Gaussian sigma `normalised_flow` should smooth with, widened for a pose-divergent
    pair (see `POSE_DIVERGENCE_SMOOTHING_GAIN`'s comment) and capped so it never washes out a
    well-matched pair's real motion."""
    return min(
        FLOW_SMOOTHING_SIGMA * (1 + POSE_DIVERGENCE_SMOOTHING_GAIN * divergence),
        MAX_FLOW_SMOOTHING_SIGMA,
    )


def normalise_plate(gray: GrayImage, framing: Framing, size: int) -> GrayImage:
    """The plate resampled into normalised UV at `size` pixels, backdrop black beyond its edge."""
    side = gray.shape[0]
    # Pixel x has UV (x + 0.5) / side; normalised UV n lands on pixel n * size - 0.5.
    gain = framing.scale * size / side
    matrix = np.array(
        [
            [gain, 0.0, size * (framing.scale * 0.5 / side + framing.offset_u) - 0.5],
            [0.0, gain, size * (framing.scale * 0.5 / side + framing.offset_v) - 0.5],
        ],
        dtype=np.float64,
    )
    normalised: GrayImage = cv2.warpAffine(
        gray,
        matrix,
        (size, size),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    return normalised


def normalised_flow(source: GrayImage, target: GrayImage, sigma: float) -> FloatField:
    """DIS optical flow in normalised UV: source(p) ~ target(p + flow(p))."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    pixels = dis.calc(source, target, None)
    smoothed = cv2.GaussianBlur(pixels, (0, 0), sigma)
    flow: FloatField = (smoothed / source.shape[0]).astype(np.float32)
    return flow


@dataclass(frozen=True)
class PlateMorph:
    forward: FloatField  # on the older plate's grid: where it lands in the younger plate
    backward: FloatField  # on the younger plate's grid: where it lands in the older plate
    older_box: SubjectBox
    younger_box: SubjectBox
    fallback_dissolve: bool  # True when the flow was too incoherent to trust (both fields are
    # then all-zero, which the shader already renders as a plain linear-light crossfade)


def refuse_bursting_flow(field: FloatField) -> None:
    """Raise if the field would fling most of the plate further than `MAX_FLOW_P95`."""
    reach = float(np.percentile(np.hypot(field[..., 0], field[..., 1]), 95))
    if reach > MAX_FLOW_P95:
        raise MorphError(
            f"the morph would burst: 95th-percentile displacement {reach:.2f} plate widths "
            f"exceeds {MAX_FLOW_P95}; check both plates' subject boxes"
        )


def inverse_consistency(
    forward: FloatField, backward: FloatField, region: SubjectBox, size: int
) -> float:
    """Mean round-trip error of `forward` through `backward`, within `region` of `forward`'s own
    grid: how far `p + forward(p) + backward(p + forward(p))` lands from `p`, in plate UV.

    Both fields are already composed onto their own plate's grid (`compose_flow`), so this reads
    directly in plate UV with no framing to undo; a coherent pair returns most texels close to 0.
    """
    u, v = texel_centres(size)
    landed_u = np.clip(u + forward[..., 0], 0.0, 1.0)
    landed_v = np.clip(v + forward[..., 1], 0.0, 1.0)
    map_x = (landed_u * size - 0.5).astype(np.float32)
    map_y = (landed_v * size - 0.5).astype(np.float32)
    back_at_landed = cv2.remap(backward, map_x, map_y, cv2.INTER_LINEAR, borderValue=0)
    roundtrip = np.hypot(
        forward[..., 0] + back_at_landed[..., 0], forward[..., 1] + back_at_landed[..., 1]
    )
    mask = (u >= region.left) & (u < region.right) & (v >= region.top) & (v < region.bottom)
    if not mask.any():
        # Unreachable given a valid SubjectBox at a texture-sized grid or coarser; a whole-frame
        # fallback here would silently dilute the statistic (ADR-015 amendment: rejected for the
        # dissolve gate once already) rather than surface the degenerate region as the bug it is.
        raise AssertionError(f"{region} contains no texel of a {size}x{size} grid")
    return float(roundtrip[mask].mean())


def _erase_scale_bar(gray: GrayImage, extent: BarSearchExtent | None) -> GrayImage:
    """`gray` with its scale-bar band erased, or `gray` unchanged when no subject stood out to
    anchor the band on -- fail open rather than guess where the bar is."""
    if extent is None:
        return gray
    return erase_band(gray, extent.band, backdrop_level(gray), _mask_at(extent, gray.shape[0]))


def _zero_scale_bar(field: FloatField, extent: BarSearchExtent | None, size: int) -> FloatField:
    """`field` with its scale-bar band zeroed, or `field` unchanged when no subject stood out."""
    if extent is None:
        return field
    return zero_band(field, extent.band, size, _mask_at(extent, size))


def compute_morph(older: GrayImage, younger: GrayImage) -> PlateMorph:
    older_box, younger_box = detect_subject_box(older), detect_subject_box(younger)
    older_bar, younger_bar = bar_search_extent(older), bar_search_extent(younger)
    older_clean = _erase_scale_bar(older, older_bar)
    younger_clean = _erase_scale_bar(younger, younger_bar)
    older_fill, younger_fill = bounded_fills(older_box, younger_box)
    older_framing = Framing.centring(older_box, older_fill)
    younger_framing = Framing.centring(younger_box, younger_fill)
    older_normalised = normalise_plate(older_clean, older_framing, COMPUTE_SIZE)
    younger_normalised = normalise_plate(younger_clean, younger_framing, COMPUTE_SIZE)
    sigma = flow_smoothing_sigma(pose_divergence(older_box, younger_box))
    forward = compose_flow(
        normalised_flow(older_normalised, younger_normalised, sigma),
        older_framing,
        younger_framing,
        FLOW_TEXTURE_SIZE,
    )
    backward = compose_flow(
        normalised_flow(younger_normalised, older_normalised, sigma),
        younger_framing,
        older_framing,
        FLOW_TEXTURE_SIZE,
    )
    forward = _zero_scale_bar(forward, older_bar, FLOW_TEXTURE_SIZE)
    backward = _zero_scale_bar(backward, younger_bar, FLOW_TEXTURE_SIZE)
    refuse_bursting_flow(forward)
    refuse_bursting_flow(backward)
    # The dissolve gate measures within the vignette-robust extent, not `detect_subject_box`'s
    # box: the box is inflated on most plates (module docstring), which dilutes this statistic
    # the same way the ADR-015 amendment's own rejected whole-frame alternative did. Falls back
    # to the box only on the rare plate `bar_search_extent` itself could not anchor on.
    older_region = older_bar.box if older_bar is not None else older_box
    younger_region = younger_bar.box if younger_bar is not None else younger_box
    incoherence = max(
        inverse_consistency(forward, backward, older_region, FLOW_TEXTURE_SIZE),
        inverse_consistency(backward, forward, younger_region, FLOW_TEXTURE_SIZE),
    )
    fallback_dissolve = incoherence > MAX_INVERSE_CONSISTENCY
    if fallback_dissolve:
        forward = np.zeros_like(forward)
        backward = np.zeros_like(backward)
    return PlateMorph(
        forward=forward,
        backward=backward,
        older_box=older_box,
        younger_box=younger_box,
        fallback_dissolve=fallback_dissolve,
    )


def write_morph(
    cache_root: Path, key: MorphKey, older_plate: Path, younger_plate: Path
) -> MorphRecord:
    morph = compute_morph(load_plate(older_plate), load_plate(younger_plate))
    fallback_dissolve = morph.fallback_dissolve or (key.older, key.younger) in FORCED_DISSOLVE_PAIRS
    forward = np.zeros_like(morph.forward) if fallback_dissolve else morph.forward
    backward = np.zeros_like(morph.backward) if fallback_dissolve else morph.backward
    forward_texture, backward_texture = encode_flow(forward), encode_flow(backward)
    directory = key.directory(cache_root)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / FORWARD_FLOW_NAME).write_bytes(forward_texture.png)
    (directory / BACKWARD_FLOW_NAME).write_bytes(backward_texture.png)
    record = MorphRecord(
        key=key,
        algorithm_version=MORPH_ALGORITHM_VERSION,
        size=forward_texture.size,
        forward_range=forward_texture.range,
        backward_range=backward_texture.range,
        fallback_dissolve=fallback_dissolve,
    )
    (directory / MORPH_RECORD_NAME).write_text(record.model_dump_json(indent=2))
    return record
