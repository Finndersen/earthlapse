"""sources/events-core. The source is hand-curated: data/events.yaml is the source of truth and
normalise() reads it directly, so the content test below loads the committed file itself."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from pipeline.shapes import Event, EventKind, EventSet
from tests.sources.support import fixture_dir, load_source_module


@pytest.mark.content
def test_committed_events_normalise_to_one_valid_event_set_with_unique_ids() -> None:
    (event_set,) = load_source_module("events-core", "normalise").normalise(Path("unused"))

    assert isinstance(event_set, EventSet)
    assert event_set.id == "events-core"
    ids = [e.id for e in event_set.events]
    assert len(ids) == len(set(ids))


def test_fixture_slice_parses_as_events_of_both_kinds() -> None:
    document = yaml.safe_load((fixture_dir("events-core") / "events.yaml").read_text())
    events = EventSet(id="fixture", events=[Event(**record) for record in document["events"]])

    assert {e.kind for e in events.events} == {EventKind.MOMENT, EventKind.PERIOD}
