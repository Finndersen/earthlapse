"""Optical flow between consecutive pinned portrait plates (ADR-015). Needs the `morph` extra.

    plate -> subject box (from the dark backdrop) -> framing that centres and scales it
          -> both plates normalised -> DIS optical flow both ways -> smoothed
          -> composed back onto each plate's own grid -> encoded PNG data textures

Deterministic and free, so it runs at publish preparation time rather than through the paid
asset graph; its output is cached by the two pins' digests (pipeline/portraits.py `MorphKey`).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline.flowfield import (
    FLOW_TEXTURE_SIZE,
    FloatField,
    Framing,
    SubjectBox,
    compose_flow,
    encode_flow,
)
from pipeline.portraits import (
    BACKWARD_FLOW_NAME,
    FORWARD_FLOW_NAME,
    MORPH_ALGORITHM_VERSION,
    MORPH_RECORD_NAME,
    MorphKey,
    MorphRecord,
)

GrayImage = NDArray[np.uint8]

COMPUTE_SIZE = 384
# Matches the plate style's "longest dimension spans about 70% of the frame" (VISUAL_SPEC §10),
# so a well-framed plate barely moves when normalised.
SUBJECT_FILL = 0.7
ANALYSIS_SIZE = 256
BORDER_FRACTION = 0.04
MIN_CONTRAST = 18.0
NOISE_MADS = 4.0
# Detached parts of one subject (a tentacle, a trailing flagellum) are kept; the scale bar,
# a thin sliver removed by the opening below or far smaller than the subject, is not.
COMPANION_AREA_FRACTION = 0.1
# Two different organisms never correspond pixel for pixel; a smooth field bends one into the
# other instead of tearing it.
FLOW_SMOOTHING_SIGMA = 6.0


class MorphError(ValueError):
    """A plate cannot be morphed as generated. Fix the plate or its pick; nothing is written."""


def load_plate(path: Path) -> GrayImage:
    with Image.open(path) as image:
        gray = np.asarray(image.convert("L"), dtype=np.uint8)
    height, width = gray.shape
    if height != width:
        raise MorphError(f"{path}: portrait plates are square (1:1), got {width}x{height}")
    return gray


def detect_subject_box(gray: GrayImage) -> SubjectBox:
    """The subject's box: everything clearly brighter than the backdrop at the plate's rim."""
    small = cv2.resize(gray, (ANALYSIS_SIZE, ANALYSIS_SIZE), interpolation=cv2.INTER_AREA)
    rim = max(1, round(ANALYSIS_SIZE * BORDER_FRACTION))
    border = np.concatenate(
        [small[:rim].ravel(), small[-rim:].ravel(), small[:, :rim].ravel(), small[:, -rim:].ravel()]
    ).astype(np.float64)
    level = float(np.median(border))
    spread = float(np.median(np.abs(border - level)))
    threshold = level + max(MIN_CONTRAST, NOISE_MADS * spread)
    mask = (small > threshold).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), dtype=np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count < 2:
        raise MorphError("no subject stands out from the plate's backdrop")
    components = stats[1:]
    largest = int(components[:, cv2.CC_STAT_AREA].max())
    kept = components[components[:, cv2.CC_STAT_AREA] >= COMPANION_AREA_FRACTION * largest]
    left = int(kept[:, cv2.CC_STAT_LEFT].min())
    top = int(kept[:, cv2.CC_STAT_TOP].min())
    right = int((kept[:, cv2.CC_STAT_LEFT] + kept[:, cv2.CC_STAT_WIDTH]).max())
    bottom = int((kept[:, cv2.CC_STAT_TOP] + kept[:, cv2.CC_STAT_HEIGHT]).max())
    return SubjectBox(
        left=left / ANALYSIS_SIZE,
        top=top / ANALYSIS_SIZE,
        right=right / ANALYSIS_SIZE,
        bottom=bottom / ANALYSIS_SIZE,
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


def normalised_flow(source: GrayImage, target: GrayImage) -> FloatField:
    """DIS optical flow in normalised UV: source(p) ~ target(p + flow(p))."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    pixels = dis.calc(source, target, None)
    smoothed = cv2.GaussianBlur(pixels, (0, 0), FLOW_SMOOTHING_SIGMA)
    flow: FloatField = (smoothed / source.shape[0]).astype(np.float32)
    return flow


@dataclass(frozen=True)
class PlateMorph:
    forward: FloatField  # on the older plate's grid: where it lands in the younger plate
    backward: FloatField  # on the younger plate's grid: where it lands in the older plate
    older_box: SubjectBox
    younger_box: SubjectBox


def compute_morph(older: GrayImage, younger: GrayImage) -> PlateMorph:
    older_box, younger_box = detect_subject_box(older), detect_subject_box(younger)
    older_framing = Framing.centring(older_box, SUBJECT_FILL)
    younger_framing = Framing.centring(younger_box, SUBJECT_FILL)
    older_normalised = normalise_plate(older, older_framing, COMPUTE_SIZE)
    younger_normalised = normalise_plate(younger, younger_framing, COMPUTE_SIZE)
    forward = compose_flow(
        normalised_flow(older_normalised, younger_normalised),
        older_framing,
        younger_framing,
        FLOW_TEXTURE_SIZE,
    )
    backward = compose_flow(
        normalised_flow(younger_normalised, older_normalised),
        younger_framing,
        older_framing,
        FLOW_TEXTURE_SIZE,
    )
    return PlateMorph(
        forward=forward, backward=backward, older_box=older_box, younger_box=younger_box
    )


def write_morph(
    cache_root: Path, key: MorphKey, older_plate: Path, younger_plate: Path
) -> MorphRecord:
    morph = compute_morph(load_plate(older_plate), load_plate(younger_plate))
    forward, backward = encode_flow(morph.forward), encode_flow(morph.backward)
    directory = key.directory(cache_root)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / FORWARD_FLOW_NAME).write_bytes(forward.png)
    (directory / BACKWARD_FLOW_NAME).write_bytes(backward.png)
    record = MorphRecord(
        key=key,
        algorithm_version=MORPH_ALGORITHM_VERSION,
        size=forward.size,
        forward_range=forward.range,
        backward_range=backward.range,
    )
    (directory / MORPH_RECORD_NAME).write_text(record.model_dump_json(indent=2))
    return record
