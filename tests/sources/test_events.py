"""Validates the REAL, committed data/events.yaml — offline, no network, no fixture.

events-core is hand-curated (see sources/events-core/README.md): data/events.yaml is the
source of truth, so this suite asserts directly on it rather than on a fixture slice.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest
import yaml

from pipeline.fetching import FetchIntegrityError
from pipeline.shapes import EARTH_FORMATION, Event, EventKind, EventSet, GlobeEffectKind
from tests.sources.support import load_source_module

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "sources" / "events-core" / "fixture" / "events.yaml"
)

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


# ------------------------------------------------------------------------- docs/GLOBE.md §6
#
# The three events docs/GLOBE.md §5.3/§6 names for an effect. Most events carry none —
# `effect` is optional and additive.


def test_most_events_carry_no_effect(events_core: EventSet) -> None:
    with_effect = [e.id for e in events_core.events if e.effect is not None]
    assert set(with_effect) == {"moon-forming-impact", "snowball-earth", "k-pg-impact"}


def test_moon_forming_impact_effect_is_a_giant_impact_matching_its_own_contested_dates(
    events_core: EventSet,
) -> None:
    event = next(e for e in events_core.events if e.id == "moon-forming-impact")
    assert event.effect is not None
    assert event.effect.kind == GlobeEffectKind.GIANT_IMPACT
    assert event.effect.anchor is None
    assert [(w.t_min, w.t_max) for w in event.effect.windows] == [(event.t_min, event.t_max)]


def test_snowball_earth_effect_carries_the_sturtian_and_marinoan_windows_separately(
    events_core: EventSet,
) -> None:
    event = next(e for e in events_core.events if e.id == "snowball-earth")
    assert event.effect is not None
    assert event.effect.kind == GlobeEffectKind.ICE_SHELL
    windows = sorted((w.t_min, w.t_max) for w in event.effect.windows)
    assert windows == [(6.35e8, 6.39e8), (6.61e8, 7.17e8)]
    # The event's own dates (the whole Cryogenian) are untouched by the narrower effect
    # windows, per this work package's brief: "the Cryogenian event keeps its dates".
    assert (event.t_min, event.t_max) == (6.35e8, 7.2e8)


def test_k_pg_impact_effect_is_anchored_at_the_conventional_chicxulub_centre(
    events_core: EventSet,
) -> None:
    event = next(e for e in events_core.events if e.id == "k-pg-impact")
    assert event.effect is not None
    assert event.effect.kind == GlobeEffectKind.IMPACT_WINTER
    assert event.effect.anchor is not None
    assert (event.effect.anchor.lat, event.effect.anchor.lon) == (21.3, -89.5)
    assert [(w.t_min, w.t_max) for w in event.effect.windows] == [(event.t_min, event.t_max)]


def test_descriptions_are_non_empty(events_core: EventSet) -> None:
    for event in events_core.events:
        assert event.description.strip(), f"{event.id}: empty description"


# --------------------------------------------------------------------------------- ADR-022
#
# `kind`/`t`/`tags` are required, not defaulted (ADR-022), and data/events.yaml is not yet
# migrated to carry them (see sources/events-core/README.md "Migration status") -- so the
# `events_core` fixture above is expected to fail before these tests would even run. The
# committed fixture/events.yaml slice (never read by normalise.py in production) is already in
# the new shape, so this schema still gets exercised offline in the meantime.


@pytest.fixture(scope="module")
def fixture_events() -> EventSet:
    document = yaml.safe_load(FIXTURE_PATH.read_text())
    events = [Event(**record) for record in document["events"]]
    return EventSet(id="events-core-fixture", events=events)


def test_fixture_conforms_to_the_kind_t_tags_schema(fixture_events: EventSet) -> None:
    assert len(fixture_events.events) == 5
    for event in fixture_events.events:
        assert event.tags, f"{event.id}: empty tags"
        if event.kind is EventKind.MOMENT:
            assert event.t is not None, f"{event.id}: moment with no t"
            assert event.t_min <= event.t <= event.t_max
        else:
            assert event.t is None, f"{event.id}: period must not set t"


def test_fixture_mixes_moment_and_period_kinds(fixture_events: EventSet) -> None:
    kinds = {event.kind for event in fixture_events.events}
    assert kinds == {EventKind.MOMENT, EventKind.PERIOD}


# ----------------------------------------------------------------------------------- fetch
#
# fetch()'s own manifest.toml is swapped for a tmp_path fixture the test controls, and only
# the HTTP layer -- httpx.get, the single call `_download` makes -- is faked.


def _write_manifest(path: Path, *, url: str, sha256: str) -> None:
    path.write_text(
        f'name = "events-core"\nurl = "{url}"\nsha256 = "{sha256}"\n'
        'licence = "test"\ncitation = "test"\ntime_domain = [0, 0]\n'
        'output_shape = "EventSet"\ninterpolation = "n/a"\n'
        'volume_bytes = 0\nstorage_tier = "git"\n'
    )


@pytest.fixture
def fetch_module(tmp_path, monkeypatch):
    module = load_source_module("events-core", "fetch")
    monkeypatch.setattr(module, "_MANIFEST", tmp_path / "manifest.toml")
    return module


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_reuses_an_already_verified_chart_without_calling_httpx_get(
    fetch_module, tmp_path, monkeypatch
) -> None:
    content = b"%PDF-1.4 fake chart bytes"
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/chart.pdf",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / fetch_module._CHART_FILENAME).write_bytes(content)

    def _must_not_be_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.get must not be called when the cached chart already verifies")

    monkeypatch.setattr(httpx, "get", _must_not_be_called)

    fetch_module.fetch(raw_dir)

    assert (raw_dir / fetch_module._CHART_FILENAME).read_bytes() == content


def test_fetch_downloads_the_chart_when_none_is_cached(fetch_module, tmp_path, monkeypatch) -> None:
    content = b"%PDF-1.4 fake chart bytes"
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/chart.pdf",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    calls = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(raw_dir)

    assert calls == ["https://example.invalid/chart.pdf"]
    assert (raw_dir / fetch_module._CHART_FILENAME).read_bytes() == content


def test_fetch_raises_and_writes_nothing_on_a_sha256_mismatch(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_manifest(
        tmp_path / "manifest.toml", url="https://example.invalid/chart.pdf", sha256="0" * 64
    )
    raw_dir = tmp_path / "raw"
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(b"corrupt"))

    with pytest.raises(FetchIntegrityError):
        fetch_module.fetch(raw_dir)

    assert not (raw_dir / fetch_module._CHART_FILENAME).exists()
