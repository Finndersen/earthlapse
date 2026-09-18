"""`pipeline.shapes.GlobeEffect` and its nested types (docs/GLOBE.md §6, ADR-013): the
additive, closed-enum contract an `Event` optionally carries. Storage round-tripping through
`write_shape`/`read_shape` is covered in `tests/test_curated.py`; this file is the model-level
validators themselves.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pipeline.shapes import (
    ArrivalEffect,
    ArrivalKind,
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventTag,
    GlobeEffect,
    GlobeEffectKind,
)

VALID_WINDOW = EffectWindow(t_min=6.6032e7, t_max=6.6054e7)


def test_effect_window_rejects_t_min_greater_than_t_max() -> None:
    with pytest.raises(ValidationError, match="t_min"):
        EffectWindow(t_min=2.0, t_max=1.0)


def test_effect_window_allows_a_point_interval() -> None:
    window = EffectWindow(t_min=1.0, t_max=1.0)
    assert (window.t_min, window.t_max) == (1.0, 1.0)


def test_globe_effect_requires_at_least_one_window() -> None:
    with pytest.raises(ValidationError):
        GlobeEffect(kind=GlobeEffectKind.GIANT_IMPACT, windows=[])


def test_globe_effect_accepts_several_disjoint_windows() -> None:
    effect = GlobeEffect(
        kind=GlobeEffectKind.ICE_SHELL,
        windows=[
            EffectWindow(t_min=6.61e8, t_max=7.17e8),
            EffectWindow(t_min=6.35e8, t_max=6.39e8),
        ],
    )
    assert len(effect.windows) == 2


def test_globe_effect_anchor_is_optional() -> None:
    effect = GlobeEffect(kind=GlobeEffectKind.GIANT_IMPACT, windows=[VALID_WINDOW])
    assert effect.anchor is None


@pytest.mark.parametrize(("lat", "lon"), [(91.0, 0.0), (-91.0, 0.0), (0.0, 181.0), (0.0, -181.0)])
def test_effect_anchor_rejects_out_of_range_coordinates(lat: float, lon: float) -> None:
    with pytest.raises(ValidationError):
        EffectAnchor(lat=lat, lon=lon)


def test_effect_anchor_accepts_the_conventional_chicxulub_centre() -> None:
    anchor = EffectAnchor(lat=21.3, lon=-89.5)
    assert (anchor.lat, anchor.lon) == (21.3, -89.5)


def test_globe_effect_kind_is_closed() -> None:
    with pytest.raises(ValidationError):
        GlobeEffect(kind="not-a-real-kind", windows=[VALID_WINDOW])  # type: ignore[arg-type]


def test_event_effect_defaults_to_none() -> None:
    event = Event(
        id="no-effect",
        label="x",
        kind=EventKind.PERIOD,
        t_min=0.0,
        t_max=1.0,
        tags=[EventTag.LIFE],
        importance=0.1,
        description="d",
        citation="c",
    )
    assert event.effect is None


def test_event_effect_round_trips_through_model_dump() -> None:
    event = Event(
        id="kpg-impact",
        label="K-Pg impact",
        kind=EventKind.MOMENT,
        t_min=6.6032e7,
        t_max=6.6054e7,
        t=6.6043e7,
        tags=[EventTag.CATASTROPHE, EventTag.LIFE],
        importance=1.0,
        description="Chicxulub.",
        citation="Renne et al. 2013",
        effect=GlobeEffect(
            kind=GlobeEffectKind.IMPACT_WINTER,
            anchor=EffectAnchor(lat=21.3, lon=-89.5),
            windows=[VALID_WINDOW],
        ),
    )
    dumped = event.model_dump(mode="json")
    assert dumped["effect"] == {
        "kind": "impact-winter",
        "anchor": {"lat": 21.3, "lon": -89.5},
        "windows": [{"t_min": 6.6032e7, "t_max": 6.6054e7}],
    }
    assert Event.model_validate(dumped) == event


# --------------------------------------------------------------- arrival effect (ADR-032)

ARRIVAL_ANCHORS = {
    "origin": EffectAnchor(lat=2.0, lon=20.0),
    "destination": EffectAnchor(lat=31.5, lon=35.0),
}


def test_globe_effect_rejects_arrival_kind() -> None:
    """`kind='arrival'` needs `ArrivalEffect`'s required origin/destination pair, not
    `GlobeEffect`'s optional single anchor -- an invalid state made unrepresentable rather
    than merely undocumented."""
    with pytest.raises(ValidationError):
        GlobeEffect(kind="arrival", windows=[VALID_WINDOW])  # type: ignore[arg-type]


def test_arrival_effect_requires_origin_and_destination() -> None:
    with pytest.raises(ValidationError):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            established=1.0,
            windows=[VALID_WINDOW],
        )  # type: ignore[call-arg]


def test_arrival_effect_requires_arrival_kind() -> None:
    """`arrival_kind` (peopling vs. migration) is required, not defaulted -- a new arrival
    with no explicit answer must fail loudly rather than silently becoming one or the other."""
    with pytest.raises(ValidationError, match="arrival_kind"):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            established=1.5,
            windows=[EffectWindow(t_min=0.0, t_max=2.0)],
            **ARRIVAL_ANCHORS,
        )  # type: ignore[call-arg]


def test_arrival_effect_must_persist_to_the_present() -> None:
    with pytest.raises(ValidationError, match="present"):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            established=1.5,
            windows=[EffectWindow(t_min=1.0, t_max=2.0)],
            **ARRIVAL_ANCHORS,
        )


def test_arrival_effect_established_must_fall_within_a_window() -> None:
    with pytest.raises(ValidationError, match="established"):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            established=500.0,
            windows=[EffectWindow(t_min=0.0, t_max=2.0)],
            **ARRIVAL_ANCHORS,
        )


def test_arrival_effect_accepts_a_persisting_window_and_established_date() -> None:
    effect = ArrivalEffect(
        kind=GlobeEffectKind.ARRIVAL,
        arrival_kind=ArrivalKind.PEOPLING,
        established=1.5,
        windows=[EffectWindow(t_min=0.0, t_max=2.0)],
        **ARRIVAL_ANCHORS,
    )
    assert effect.origin == ARRIVAL_ANCHORS["origin"]
    assert effect.destination == ARRIVAL_ANCHORS["destination"]


def test_arrival_effect_accepts_the_migration_kind() -> None:
    effect = ArrivalEffect(
        kind=GlobeEffectKind.ARRIVAL,
        arrival_kind=ArrivalKind.MIGRATION,
        established=1.5,
        windows=[EffectWindow(t_min=0.0, t_max=2.0)],
        **ARRIVAL_ANCHORS,
    )
    assert effect.arrival_kind == ArrivalKind.MIGRATION


def test_event_effect_accepts_an_arrival_effect_and_round_trips() -> None:
    event = Event(
        id="levant-early-dispersal",
        label="Levant early dispersal",
        kind=EventKind.MOMENT,
        t_min=177000.0,
        t_max=194000.0,
        t=185500.0,
        tags=[EventTag.HUMAN_ORIGINS],
        importance=0.5,
        description="d.",
        citation="c.",
        effect=ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            established=185500.0,
            windows=[EffectWindow(t_min=0.0, t_max=194000.0)],
            **ARRIVAL_ANCHORS,
        ),
    )
    assert isinstance(event.effect, ArrivalEffect)
    dumped = event.model_dump(mode="json")
    assert dumped["effect"] == {
        "kind": "arrival",
        "arrival_kind": "peopling",
        "origin": {"lat": 2.0, "lon": 20.0},
        "destination": {"lat": 31.5, "lon": 35.0},
        "established": 185500.0,
        "windows": [{"t_min": 0.0, "t_max": 194000.0}],
    }
    roundtripped = Event.model_validate(dumped)
    assert roundtripped == event
    assert isinstance(roundtripped.effect, ArrivalEffect)


# ----------------------------------------------------------------- kind / t / tags (ADR-022)


def _bare_event(**overrides: object) -> Event:
    fields: dict[str, object] = {
        "id": "x",
        "label": "X",
        "kind": EventKind.MOMENT,
        "t_min": 0.0,
        "t_max": 10.0,
        "t": 5.0,
        "tags": [EventTag.LIFE],
        "importance": 0.5,
        "description": "d",
        "citation": "c",
    }
    fields.update(overrides)
    return Event(**fields)


def test_moment_requires_t() -> None:
    with pytest.raises(ValidationError, match="requires t"):
        _bare_event(kind=EventKind.MOMENT, t=None)


def test_moment_t_must_fall_inside_the_interval() -> None:
    with pytest.raises(ValidationError, match="outside"):
        _bare_event(kind=EventKind.MOMENT, t=20.0)


def test_period_must_not_set_t() -> None:
    with pytest.raises(ValidationError, match="must not set t"):
        _bare_event(kind=EventKind.PERIOD, t=5.0)


def test_period_with_no_t_is_valid() -> None:
    event = _bare_event(kind=EventKind.PERIOD, t=None)
    assert event.t is None


def test_tags_must_be_non_empty() -> None:
    with pytest.raises(ValidationError):
        _bare_event(tags=[])


def test_tags_reject_duplicates() -> None:
    with pytest.raises(ValidationError, match="duplicate tags"):
        _bare_event(tags=[EventTag.LIFE, EventTag.LIFE])


def test_tags_first_is_preserved_as_primary() -> None:
    event = _bare_event(tags=[EventTag.CATASTROPHE, EventTag.EARTH_CLIMATE])
    assert event.tags[0] is EventTag.CATASTROPHE


def test_placement_t_is_the_best_estimate_for_a_moment() -> None:
    event = _bare_event(kind=EventKind.MOMENT, t_min=0.0, t_max=10.0, t=1.0)
    assert event.placement_t == 1.0


def test_placement_t_is_the_midpoint_for_a_period() -> None:
    event = _bare_event(kind=EventKind.PERIOD, t_min=0.0, t_max=10.0, t=None)
    assert event.placement_t == 5.0
