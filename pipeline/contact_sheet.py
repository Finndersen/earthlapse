"""Labelled thumbnail grids, for reviewing candidates side by side."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE_WIDTH = 640
LABEL_HEIGHT = 30
LABEL_FONT_SIZE = 18


@dataclass(frozen=True)
class Tile:
    path: Path | None  # None leaves the cell blank, label only
    label: str


def write_contact_sheet(rows: Sequence[Sequence[Tile]], path: Path) -> None:
    """A grid of TILE_WIDTH-wide thumbnails, each with its label in a strip beneath it."""
    thumbnails = {
        tile.path: _thumbnail(tile.path) for row in rows for tile in row if tile.path is not None
    }
    if not thumbnails:
        raise ValueError(f"{path.name}: a contact sheet needs at least one image")
    image_height = max(thumb.height for thumb in thumbnails.values())
    cell_height = image_height + LABEL_HEIGHT
    columns = max(len(row) for row in rows)
    sheet = Image.new("RGB", (columns * TILE_WIDTH, len(rows) * cell_height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=LABEL_FONT_SIZE)
    for row_index, row in enumerate(rows):
        for column_index, tile in enumerate(row):
            x, y = column_index * TILE_WIDTH, row_index * cell_height
            if tile.path is not None:
                sheet.paste(thumbnails[tile.path], (x, y))
            draw.text((x + 8, y + image_height + 5), tile.label, fill="black", font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=90)


def _thumbnail(path: Path) -> Image.Image:
    with Image.open(path) as source:
        rgb = source.convert("RGB")
    height = round(TILE_WIDTH * rgb.height / rgb.width)
    return rgb.resize((TILE_WIDTH, height), Image.Resampling.LANCZOS)
