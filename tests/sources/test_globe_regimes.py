"""sources/globe-regimes. Hand-curated like events-core: data/globe_regimes.yaml is the source of
truth and normalise() reads it directly; fetch.py is a no-op."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.shapes import EventSet
from tests.sources.support import load_source_module


@pytest.mark.content
def test_committed_regimes_normalise_to_five_events_each_carrying_an_effect() -> None:
    (event_set,) = load_source_module("globe-regimes", "normalise").normalise(Path("unused"))

    assert isinstance(event_set, EventSet)
    assert event_set.id == "globe-regimes"
    assert {e.id for e in event_set.events} == {
        "magma-ocean-regime",
        "hadean-water-world-regime",
        "archean-haze-regime",
        "paleoproterozoic-glaciation-regime",
        "proterozoic-unknown-geography-regime",
    }
    assert all(e.effect is not None for e in event_set.events)
