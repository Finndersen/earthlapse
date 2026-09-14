"""Validates the REAL, committed data/globe_regimes.yaml — offline, no network, no fixture.

globe-regimes is hand-curated (see sources/globe-regimes/README.md): data/globe_regimes.yaml
is the source of truth, so this suite asserts directly on it, exactly like
tests/sources/test_events.py does for events-core. fetch.py is a no-op (see its own module
docstring, mirroring sources/astronomy/fetch.py), so unlike test_events.py there is nothing
to test on the fetch side.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.shapes import EventSet, GlobeEffectKind
from tests.sources.support import load_source_module

REGIME_IDS = frozenset(
    {
        "magma-ocean-regime",
        "hadean-water-world-regime",
        "archean-haze-regime",
        "paleoproterozoic-glaciation-regime",
        "proterozoic-unknown-geography-regime",
    }
)


@pytest.fixture(scope="module")
def globe_regimes() -> EventSet:
    normalise = load_source_module("globe-regimes", "normalise")
    shapes = normalise.normalise(Path("unused-raw-dir"))
    assert len(shapes) == 1
    event_set = shapes[0]
    assert isinstance(event_set, EventSet)
    return event_set


def test_shape_id_is_globe_regimes(globe_regimes: EventSet) -> None:
    assert globe_regimes.id == "globe-regimes"


def test_exactly_the_five_regimes_from_globe_md_are_present(globe_regimes: EventSet) -> None:
    ids = {e.id for e in globe_regimes.events}
    assert ids == REGIME_IDS


def test_ids_are_unique(globe_regimes: EventSet) -> None:
    ids = [e.id for e in globe_regimes.events]
    assert len(ids) == len(set(ids))


def test_every_regime_has_a_non_empty_citation(globe_regimes: EventSet) -> None:
    for event in globe_regimes.events:
        assert event.citation.strip(), f"{event.id}: empty citation"


def test_every_regime_has_t_min_at_most_t_max(globe_regimes: EventSet) -> None:
    for event in globe_regimes.events:
        assert event.t_min <= event.t_max, f"{event.id}: t_min > t_max"


def test_every_regime_importance_is_in_unit_range(globe_regimes: EventSet) -> None:
    for event in globe_regimes.events:
        assert 0.0 <= event.importance <= 1.0, f"{event.id}: importance out of range"


def test_descriptions_are_non_empty(globe_regimes: EventSet) -> None:
    for event in globe_regimes.events:
        assert event.description.strip(), f"{event.id}: empty description"


def test_domain_spans_from_1_ga_to_the_moon_forming_impacts_contested_upper_bound(
    globe_regimes: EventSet,
) -> None:
    newest, oldest = globe_regimes.domain
    assert newest == pytest.approx(1.0e9)
    assert oldest == pytest.approx(4.52e9)


def test_every_regime_carries_an_effect(globe_regimes: EventSet) -> None:
    """Unlike events-core, every event here exists to drive a globe visual (docs/GLOBE.md
    §4.2/§6) — a regime without an effect would be curated for nothing."""
    for event in globe_regimes.events:
        assert event.effect is not None, f"{event.id}: no effect"


def test_effect_kinds_match_globe_md_table_4_2(globe_regimes: EventSet) -> None:
    by_id = {e.id: e.effect.kind for e in globe_regimes.events if e.effect is not None}
    assert by_id == {
        "magma-ocean-regime": GlobeEffectKind.REGIME_MAGMA_OCEAN,
        "hadean-water-world-regime": GlobeEffectKind.REGIME_WATER_WORLD,
        "archean-haze-regime": GlobeEffectKind.REGIME_ARCHEAN,
        # docs/GLOBE.md §4.2: "ice shell, same effect as §4.3" — not a regime-* kind.
        "paleoproterozoic-glaciation-regime": GlobeEffectKind.ICE_SHELL,
        "proterozoic-unknown-geography-regime": GlobeEffectKind.REGIME_UNKNOWN_GEOGRAPHY,
    }


def test_magma_ocean_regime_matches_events_cores_moon_forming_impact_date_range(
    globe_regimes: EventSet,
) -> None:
    """Deliberate, per sources/globe-regimes/README.md: the same contested dating question,
    one as a point event (events-core), one as the ensuing regime (here)."""
    magma_ocean = next(e for e in globe_regimes.events if e.id == "magma-ocean-regime")
    assert (magma_ocean.t_min, magma_ocean.t_max) == (4.35e9, 4.52e9)


def test_paleoproterozoic_glaciation_extent_is_flagged_contested(globe_regimes: EventSet) -> None:
    glaciation = next(
        e for e in globe_regimes.events if e.id == "paleoproterozoic-glaciation-regime"
    )
    assert "contested" in glaciation.description.lower()
