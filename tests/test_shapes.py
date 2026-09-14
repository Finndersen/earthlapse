"""`pipeline.shapes.GlobeEffect` and its nested types (docs/GLOBE.md §6, ADR-013): the
additive, closed-enum contract an `Event` optionally carries. Storage round-tripping through
`write_shape`/`read_shape` is covered in `tests/test_curated.py`; this file is the model-level
validators themselves.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pipeline.shapes import EffectAnchor, EffectWindow, Event, GlobeEffect, GlobeEffectKind

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
        t_min=0.0,
        t_max=1.0,
        importance=0.1,
        description="d",
        citation="c",
    )
    assert event.effect is None


def test_event_effect_round_trips_through_model_dump() -> None:
    event = Event(
        id="kpg-impact",
        label="K-Pg impact",
        t_min=6.6032e7,
        t_max=6.6054e7,
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
