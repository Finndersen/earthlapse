"""The web globe reads PaleoDEM depth back from pixel colour, so it carries a copy of the
hypsometric palette (`web/src/globe/ice/shelf.ts`). These tests fail if the copy drifts."""

import re
from pathlib import Path

from pipeline.palette import LAND_STOPS, SEA_STOPS

SHELF_TS = Path(__file__).resolve().parent.parent / "web" / "src" / "globe" / "ice" / "shelf.ts"

Stops = tuple[tuple[float, tuple[int, int, int]], ...]


def _ts_stops(name: str) -> Stops:
    source = SHELF_TS.read_text()
    block = re.search(rf"export const {name}\b[^=]*= \[\n(.*?)\n\]", source, re.DOTALL)
    assert block is not None, f"{name} not found in {SHELF_TS}"
    rows = re.findall(r"\[(-?\d+), \[(\d+), (\d+), (\d+)\]\]", block.group(1))
    return tuple((float(z), (int(r), int(g), int(b))) for z, r, g, b in rows)


def test_the_web_palette_copy_matches_the_pipeline_palette() -> None:
    assert _ts_stops("PALEODEM_SEA_STOPS") == SEA_STOPS
    assert _ts_stops("PALEODEM_LAND_STOPS") == LAND_STOPS
