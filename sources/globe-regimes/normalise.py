"""Normalise data/globe_regimes.yaml into pipeline.shapes.EventSet id "globe-regimes".

globe-regimes is hand-curated: data/globe_regimes.yaml IS the dataset (see its header
comment and sources/globe-regimes/README.md), not something derived from data/raw/.
normalise() therefore reads data/globe_regimes.yaml directly and ignores raw_dir -- the
parameter exists only to match the normalise(raw_dir: Path) -> list[CuratedShape]
convention shared by every source's normalise.py, mirroring events-core's normalise.py
exactly (see sources/events-core/normalise.py).
"""

from __future__ import annotations

from pathlib import Path

import yaml

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Event, EventSet

REPO_ROOT = Path(__file__).resolve().parents[2]
GLOBE_REGIMES_YAML = REPO_ROOT / "data" / "globe_regimes.yaml"


def _load_event_set(globe_regimes_yaml: Path) -> EventSet:
    document = yaml.safe_load(globe_regimes_yaml.read_text())
    events = [Event(**record) for record in document["events"]]
    return EventSet(id="globe-regimes", events=events)


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Return the globe-regimes EventSet. raw_dir is unused -- see module docstring."""
    del raw_dir
    return [_load_event_set(GLOBE_REGIMES_YAML)]


def main() -> None:
    for shape in normalise(REPO_ROOT / "data" / "raw" / "globe-regimes"):
        path = write_shape(shape, REPO_ROOT / "data" / "curated")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
