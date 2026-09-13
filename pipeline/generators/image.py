"""Provider-neutral image request and image-file helpers shared by every generator."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from pipeline.graph import AssetNode


class ImageSize(StrEnum):
    K1 = "1K"
    K2 = "2K"
    K4 = "4K"


# Aspect ratio and resolution are camera properties, so invariant (VISUAL_SPEC §2).
PROJECT_ASPECT_RATIO = "16:9"
PROJECT_IMAGE_SIZE = ImageSize.K2


class PartKind(StrEnum):
    TEXT = "text"
    REFERENCE_IMAGE = "reference_image"


class PartOrder(StrEnum):
    """Where a reference image sits relative to the prompt text in a multimodal request.

    Order changes what the model makes of the image, so it is part of the node's identity.
    """

    TEXT_FIRST = "text_first"
    REFERENCE_FIRST = "reference_first"


class ReferenceImage(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    path: Path
    part_order: PartOrder


class ImageRequest(BaseModel):
    """What an image node asks for, parsed once from `AssetNode.inputs` + `config`."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    prompt: str = Field(min_length=1)
    reference: ReferenceImage | None = None  # absent for an unconditioned image
    aspect_ratio: str = Field(pattern=r"^\d+:\d+$")
    image_size: ImageSize

    @property
    def part_kinds(self) -> tuple[PartKind, ...]:
        if self.reference is None:
            return (PartKind.TEXT,)
        match self.reference.part_order:
            case PartOrder.TEXT_FIRST:
                return (PartKind.TEXT, PartKind.REFERENCE_IMAGE)
            case PartOrder.REFERENCE_FIRST:
                return (PartKind.REFERENCE_IMAGE, PartKind.TEXT)

    @classmethod
    def from_node(cls, node: AssetNode) -> ImageRequest:
        overlap = node.inputs.keys() & node.config.keys()
        if overlap:
            raise ValueError(f"{node.id}: keys in both inputs and config: {sorted(overlap)}")
        return cls.model_validate({**node.inputs, **node.config})


@dataclass(frozen=True)
class ImageInfo:
    mime_type: str
    width: int
    height: int

    @property
    def extension(self) -> str:
        return _EXTENSIONS[self.mime_type]


_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg"}
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SOI = b"\xff\xd8"
# Start-of-frame markers carry the dimensions; C4, C8 and CC share the range but are not frames.
_JPEG_SOF_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def sniff_image(data: bytes) -> ImageInfo:
    """Format and pixel size read from the file header, trusting bytes over any declared type."""
    if data.startswith(_PNG_SIGNATURE) and data[12:16] == b"IHDR":
        width, height = struct.unpack(">II", data[16:24])
        return ImageInfo("image/png", width, height)
    if data.startswith(_JPEG_SOI):
        width, height = _jpeg_size(data)
        return ImageInfo("image/jpeg", width, height)
    raise ValueError("unrecognised image format (expected PNG or JPEG)")


def _jpeg_size(data: bytes) -> tuple[int, int]:
    offset = len(_JPEG_SOI)
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            raise ValueError(f"malformed JPEG: expected marker at byte {offset}")
        marker = data[offset + 1]
        (segment_length,) = struct.unpack(">H", data[offset + 2 : offset + 4])
        if marker in _JPEG_SOF_MARKERS:
            height, width = struct.unpack(">HH", data[offset + 5 : offset + 9])
            return width, height
        offset += 2 + segment_length
    raise ValueError("malformed JPEG: no start-of-frame marker")
