"""Custom validators on the curated shapes' nested models: `Event` (kind, t, tags), its optional
`GlobeEffect`/`ArrivalEffect`, and `FeatureSet`. Storage round-tripping is in test_curated.py;
TimeSeries, RasterSequence and Tree semantics are in test_contracts.py."""

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
    Feature,
    FeatureCertainty,
    FeatureSet,
    GlobeEffect,
    GlobeEffectKind,
    PopulationEstimate,
)

ANCHORS = {
    "origin": EffectAnchor(lat=2.0, lon=20.0),
    "destination": EffectAnchor(lat=31.5, lon=35.0),
}


def _event(**overrides: object) -> Event:
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
    return Event.model_validate(fields)


def _arrival(**overrides: object) -> ArrivalEffect:
    fields: dict[str, object] = {
        "kind": GlobeEffectKind.ARRIVAL,
        "arrival_kind": ArrivalKind.PEOPLING,
        "established": 1.5,
        "windows": [EffectWindow(t_min=0.0, t_max=2.0)],
        **ANCHORS,
    }
    fields.update(overrides)
    return ArrivalEffect.model_validate(fields)


# -- Event kind / t / tags --------------------------------------------------------------------


def test_a_moment_needs_a_t_inside_its_interval() -> None:
    with pytest.raises(ValidationError, match="requires t"):
        _event(kind=EventKind.MOMENT, t=None)
    with pytest.raises(ValidationError, match="outside"):
        _event(kind=EventKind.MOMENT, t=20.0)


def test_a_period_must_not_set_t_and_is_placed_at_its_midpoint() -> None:
    with pytest.raises(ValidationError, match="must not set t"):
        _event(kind=EventKind.PERIOD, t=5.0)
    assert _event(kind=EventKind.PERIOD, t=None).placement_t == 5.0
    assert _event(kind=EventKind.MOMENT, t=1.0).placement_t == 1.0


def test_tags_reject_duplicates() -> None:
    with pytest.raises(ValidationError, match="duplicate tags"):
        _event(tags=[EventTag.LIFE, EventTag.LIFE])


# -- GlobeEffect ------------------------------------------------------------------------------


def test_an_effect_window_must_not_be_inverted() -> None:
    with pytest.raises(ValidationError, match="t_min"):
        EffectWindow(t_min=2.0, t_max=1.0)


def test_a_globe_effect_needs_a_window_and_cannot_be_an_arrival() -> None:
    with pytest.raises(ValidationError):
        GlobeEffect(kind=GlobeEffectKind.GIANT_IMPACT, windows=[])
    with pytest.raises(ValidationError):
        GlobeEffect(kind="arrival", windows=[EffectWindow(t_min=0.0, t_max=1.0)])  # type: ignore[arg-type]


def test_an_arrival_persists_to_the_present_in_one_window_containing_its_established_date() -> None:
    with pytest.raises(ValidationError, match="arrival_kind"):
        ArrivalEffect.model_validate(
            {
                "kind": "arrival",
                "established": 1.5,
                "windows": [{"t_min": 0.0, "t_max": 2.0}],
                **{k: v.model_dump() for k, v in ANCHORS.items()},
            }
        )
    with pytest.raises(ValidationError, match="present"):
        _arrival(windows=[EffectWindow(t_min=1.0, t_max=2.0)])
    with pytest.raises(ValidationError, match="exactly one window"):
        _arrival(windows=[EffectWindow(t_min=0.0, t_max=2.0), EffectWindow(t_min=0.0, t_max=3.0)])
    with pytest.raises(ValidationError, match="established"):
        _arrival(established=500.0)


@pytest.mark.parametrize(
    "effect",
    [
        GlobeEffect(
            kind=GlobeEffectKind.IMPACT_WINTER,
            anchor=EffectAnchor(lat=21.3, lon=-89.5),
            windows=[EffectWindow(t_min=0.0, t_max=10.0)],
        ),
        _arrival(established=5.0, windows=[EffectWindow(t_min=0.0, t_max=10.0)]),
    ],
    ids=["point", "arrival"],
)
def test_an_events_effect_round_trips_as_its_own_variant(
    effect: GlobeEffect | ArrivalEffect,
) -> None:
    event = _event(effect=effect)

    roundtripped = Event.model_validate(event.model_dump(mode="json"))

    assert roundtripped == event
    assert type(roundtripped.effect) is type(effect)


# -- FeatureSet -------------------------------------------------------------------------------


def _feature(feature_id: str = "uruk", *estimates: PopulationEstimate) -> Feature:
    return Feature(
        id=feature_id,
        name=feature_id,
        country="Iraq",
        lat=31.32,
        lon=45.64,
        certainty=FeatureCertainty.HIGH,
        estimates=list(estimates) or [PopulationEstimate(t=5700.0, population=14_000)],
    )


def test_a_feature_sorts_its_estimates_and_rejects_a_duplicate_t() -> None:
    feature = _feature(
        "uruk",
        PopulationEstimate(t=2000.0, population=500_000),
        PopulationEstimate(t=100.0, population=10_000),
    )
    assert [e.t for e in feature.estimates] == [100.0, 2000.0]
    with pytest.raises(ValidationError, match="duplicate estimate"):
        _feature(
            "uruk",
            PopulationEstimate(t=100.0, population=10_000),
            PopulationEstimate(t=100.0, population=20_000),
        )


def test_a_feature_set_must_be_non_empty_with_unique_ids() -> None:
    with pytest.raises(ValidationError, match="empty FeatureSet"):
        FeatureSet(id="cities", features=[])
    with pytest.raises(ValidationError, match="duplicate feature ids"):
        FeatureSet(id="cities", features=[_feature("uruk"), _feature("uruk")])


def test_a_feature_set_samples_only_features_already_attested_by_t() -> None:
    old = _feature("old", PopulationEstimate(t=5000.0, population=10_000))
    young = _feature("young", PopulationEstimate(t=500.0, population=10_000))
    feature_set = FeatureSet(id="cities", features=[old, young])

    assert feature_set.domain == (500.0, 5000.0)
    assert [f.id for f in feature_set.sample(6000.0)] == []
    assert [f.id for f in feature_set.sample(4000.0)] == ["old"]
    assert sorted(f.id for f in feature_set.sample(100.0)) == ["old", "young"]
