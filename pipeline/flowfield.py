"""Dense morph fields between two portrait plates, as small PNG data textures (ADR-015).

Pure numpy and Pillow, no OpenCV: the alignment maths and the texture encoding the browser
decodes are tested without the optional `morph` extra. pipeline/morph.py computes the optical
flow that feeds `compose_flow`.

Coordinates are plate UV: u to the right and v *down* the image, both in [0, 1], so a field
reads like the image it describes. The browser flips v when it samples
(web/src/layers/portraitShaders.ts).

A field F on plate A's grid says where each point of A lands in plate B:

    A(p) ~ B(p + F(p))
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image

FLOW_TEXTURE_SIZE = 128
# A displacement d encodes as round(d / range * 127) + 128: zero is exact and bytes 1..255 span
# [-range, +range]. Mirrored by `decodeFlowByte` in web/src/layers/portraits.ts.
FLOW_ZERO_BYTE = 128
FLOW_BYTE_SPAN = 127
RANGE_QUANTUM = 1 / 1024

FloatField = NDArray[np.float32]
"""(rows, columns, 2): u and v displacement in plate UV."""

FloatGrid = NDArray[np.float64]


@dataclass(frozen=True)
class SubjectBox:
    """The subject's bounding box on its plate, in plate UV."""

    left: float
    top: float
    right: float
    bottom: float

    def __post_init__(self) -> None:
        if not (0.0 <= self.left < self.right <= 1.0 and 0.0 <= self.top < self.bottom <= 1.0):
            raise ValueError(f"not a box inside the unit square: {self}")

    @property
    def centre(self) -> tuple[float, float]:
        return (self.left + self.right) / 2, (self.top + self.bottom) / 2

    @property
    def span(self) -> float:
        """The longer side: framing scales uniformly, so one number fits the whole subject."""
        return max(self.right - self.left, self.bottom - self.top)


@dataclass(frozen=True)
class Framing:
    """A uniform similarity from plate UV to normalised UV: n = p * scale + offset."""

    scale: float
    offset_u: float
    offset_v: float

    def __post_init__(self) -> None:
        if not self.scale > 0:
            raise ValueError(f"framing scale must be positive, got {self.scale}")

    @classmethod
    def centring(cls, box: SubjectBox, fill: float) -> Framing:
        """Centre `box` and scale its longer side to `fill` of the normalised frame."""
        scale = fill / box.span
        centre_u, centre_v = box.centre
        return cls(scale=scale, offset_u=0.5 - centre_u * scale, offset_v=0.5 - centre_v * scale)

    def to_normalised(self, u: FloatGrid, v: FloatGrid) -> tuple[FloatGrid, FloatGrid]:
        return u * self.scale + self.offset_u, v * self.scale + self.offset_v

    def from_normalised(self, u: FloatGrid, v: FloatGrid) -> tuple[FloatGrid, FloatGrid]:
        return (u - self.offset_u) / self.scale, (v - self.offset_v) / self.scale


def texel_centres(size: int) -> tuple[FloatGrid, FloatGrid]:
    """UV of every texel centre of a size x size grid, as (u, v) arrays indexed [row, column]."""
    centres = (np.arange(size, dtype=np.float64) + 0.5) / size
    u, v = np.meshgrid(centres, centres)
    return u, v


def sample_bilinear(field: FloatField, u: FloatGrid, v: FloatGrid) -> NDArray[np.float64]:
    """`field` read at UV positions with bilinear filtering, clamped to its edge texels."""
    rows, columns = field.shape[:2]
    x = np.clip(u * columns - 0.5, 0, columns - 1)
    y = np.clip(v * rows - 0.5, 0, rows - 1)
    x0 = np.floor(x).astype(np.intp)
    y0 = np.floor(y).astype(np.intp)
    x1 = np.minimum(x0 + 1, columns - 1)
    y1 = np.minimum(y0 + 1, rows - 1)
    fx = (x - x0)[..., np.newaxis]
    fy = (y - y0)[..., np.newaxis]
    top = field[y0, x0] * (1 - fx) + field[y0, x1] * fx
    bottom = field[y1, x0] * (1 - fx) + field[y1, x1] * fx
    sampled: NDArray[np.float64] = top * (1 - fy) + bottom * fy
    return sampled


def compose_flow(
    normalised_flow: FloatField, source: Framing, target: Framing, size: int
) -> FloatField:
    """Bake both plates' framing into one field on the source plate's own grid.

    `normalised_flow` is the optical flow between the two *normalised* plates, in normalised UV.
    For a source texel p: n = source(p), n' = n + flow(n), p' = target⁻¹(n'), F(p) = p' - p.
    The browser then needs no alignment transforms: the plates stay exactly as generated.
    """
    u, v = texel_centres(size)
    normalised_u, normalised_v = source.to_normalised(u, v)
    displacement = sample_bilinear(normalised_flow, normalised_u, normalised_v)
    target_u, target_v = target.from_normalised(
        normalised_u + displacement[..., 0], normalised_v + displacement[..., 1]
    )
    return np.stack([target_u - u, target_v - v], axis=-1).astype(np.float32)


@dataclass(frozen=True)
class EncodedFlow:
    png: bytes
    range: float  # |displacement| the extreme bytes stand for, in plate UV
    size: int


def encode_flow(field: FloatField) -> EncodedFlow:
    """An 8-bit RGB PNG: u in red, v in green, blue held at the zero byte. No alpha channel,
    because browsers may premultiply alpha into the colour channels when decoding."""
    rows, columns = field.shape[:2]
    if rows != columns or field.shape[2:] != (2,):
        raise ValueError(f"expected a square (n, n, 2) field, got shape {field.shape}")
    peak = float(np.abs(field).max())
    flow_range = max(math.ceil(peak / RANGE_QUANTUM), 1) * RANGE_QUANTUM
    encoded = np.clip(
        np.rint(field / flow_range * FLOW_BYTE_SPAN) + FLOW_ZERO_BYTE,
        FLOW_ZERO_BYTE - FLOW_BYTE_SPAN,
        FLOW_ZERO_BYTE + FLOW_BYTE_SPAN,
    ).astype(np.uint8)
    blue = np.full((rows, columns), FLOW_ZERO_BYTE, dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(np.dstack([encoded[..., 0], encoded[..., 1], blue]), "RGB").save(buffer, "PNG")
    return EncodedFlow(png=buffer.getvalue(), range=flow_range, size=rows)


def decode_flow(png: bytes, flow_range: float) -> FloatField:
    with Image.open(io.BytesIO(png)) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    decoded: FloatField = (rgb[..., :2] - FLOW_ZERO_BYTE) / FLOW_BYTE_SPAN * flow_range
    return decoded
