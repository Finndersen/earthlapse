"""Normalise data/events.yaml into pipeline.shapes.EventSet id "events-core".

events-core is hand-curated: data/events.yaml IS the dataset (see its header comment and
sources/events-core/README.md), not something derived from data/raw/. normalise() therefore
reads data/events.yaml directly and ignores raw_dir — the parameter exists only to match
the normalise(raw_dir: Path) -> list[CuratedShape] convention shared by every source's
normalise.py, so `earthlapse build` can invoke every source the same way.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Event, EventSet

REPO_ROOT = Path(__file__).resolve().parents[2]
EVENTS_YAML = REPO_ROOT / "data" / "events.yaml"


def _load_event_set(events_yaml: Path) -> EventSet:
    document = yaml.safe_load(events_yaml.read_text())
    events = [Event(**record) for record in document["events"]]
    return EventSet(id="events-core", events=events)


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Return the events-core EventSet. raw_dir is unused — see module docstring."""
    del raw_dir
    return [_load_event_set(EVENTS_YAML)]


def main() -> None:
    for shape in normalise(REPO_ROOT / "data" / "raw" / "events-core"):
        path = write_shape(shape, REPO_ROOT / "data" / "curated")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
