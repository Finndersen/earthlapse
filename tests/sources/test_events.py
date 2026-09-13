"""Validates the REAL, committed data/events.yaml — offline, no network, no fixture.

events-core is hand-curated (see sources/events-core/README.md): data/events.yaml is the
source of truth, so this suite asserts directly on it rather than on a fixture slice.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.shapes import EARTH_FORMATION, EventSet
from tests.sources.support import load_source_module

MINIMUM_COVERAGE_IDS = frozenset(
    {
        "earth-formation",
        "moon-forming-impact",
        "first-life",
        "great-oxidation-event",
        "snowball-earth",
        "ediacaran-biota",
        "cambrian-explosion",
        "land-plants",
        "insects",
        "tetrapods",
        "amniotes",
        "permian-extinction",
        "dinosaurs",
        "flowering-plants",
        "k-pg-impact",
        "primates",
        "hominins",
        "agriculture",
        "writing",
        "industrial-revolution",
        "present",
    }
)


@pytest.fixture(scope="module")
def events_core() -> EventSet:
    normalise = load_source_module("events-core", "normalise")
    shapes = normalise.normalise(Path("unused-raw-dir"))
    assert len(shapes) == 1
    event_set = shapes[0]
    assert isinstance(event_set, EventSet)
    return event_set


def test_shape_id_is_events_core(events_core: EventSet) -> None:
    assert events_core.id == "events-core"


def test_at_least_twenty_events(events_core: EventSet) -> None:
    assert len(events_core.events) >= 20


def test_ids_are_unique(events_core: EventSet) -> None:
    ids = [e.id for e in events_core.events]
    assert len(ids) == len(set(ids))


def test_every_event_has_a_non_empty_citation(events_core: EventSet) -> None:
    for event in events_core.events:
        assert event.citation.strip(), f"{event.id}: empty citation"


def test_every_event_has_t_min_at_most_t_max(events_core: EventSet) -> None:
    for event in events_core.events:
        assert event.t_min <= event.t_max, f"{event.id}: t_min > t_max"


def test_every_event_importance_is_in_unit_range(events_core: EventSet) -> None:
    for event in events_core.events:
        assert 0.0 <= event.importance <= 1.0, f"{event.id}: importance out of range"


def test_span_covers_more_than_4e9_years(events_core: EventSet) -> None:
    newest, oldest = events_core.domain
    assert oldest - newest > 4e9


def test_span_reaches_back_to_earth_formation(events_core: EventSet) -> None:
    _, oldest = events_core.domain
    # Within 2% of the shared EARTH_FORMATION constant (pipeline/shapes.py) — this source
    # does not import that constant for its own event date (it cites Dalrymple 2001
    # directly, see data/events.yaml), but the oldest event should still land near it.
    assert oldest == pytest.approx(EARTH_FORMATION, rel=0.02)


def test_minimum_coverage_topics_are_present(events_core: EventSet) -> None:
    ids = {e.id for e in events_core.events}
    missing = MINIMUM_COVERAGE_IDS - ids
    assert not missing, f"missing minimum-coverage events: {sorted(missing)}"


def test_present_event_is_at_t_zero(events_core: EventSet) -> None:
    present = next(e for e in events_core.events if e.id == "present")
    assert present.t_min == 0.0
    assert present.t_max == 0.0


def test_descriptions_are_non_empty(events_core: EventSet) -> None:
    for event in events_core.events:
        assert event.description.strip(), f"{event.id}: empty description"
