"""`pipeline.shapes.FeatureSet` and its nested types (ADR-034): the fifth curated shape, for
labelled, dated geographic points (e.g. `sources/cities`). A separate file from
`tests/test_shapes.py` (which is scoped to `GlobeEffect`/`Event`) so the two don't collide.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pipeline.shapes import Feature, FeatureCertainty, FeatureSet, PopulationEstimate

VALID_ESTIMATE = PopulationEstimate(t=2000.0, population=50_000)


def _feature(**overrides: object) -> Feature:
    defaults: dict[str, object] = {
        "id": "uruk",
        "name": "Uruk",
        "country": "Iraq",
        "lat": 31.32,
        "lon": 45.64,
        "certainty": FeatureCertainty.HIGH,
        "estimates": [PopulationEstimate(t=5700.0, population=14_000)],
    }
    defaults.update(overrides)
    return Feature.model_validate(defaults)


# ------------------------------------------------------------------- PopulationEstimate


def test_population_estimate_rejects_zero_population() -> None:
    with pytest.raises(ValidationError):
        PopulationEstimate(t=100.0, population=0)


def test_population_estimate_rejects_negative_population() -> None:
    with pytest.raises(ValidationError):
        PopulationEstimate(t=100.0, population=-5)


# ------------------------------------------------------------------------------- Feature


def test_feature_rejects_latitude_out_of_range() -> None:
    with pytest.raises(ValidationError):
        _feature(lat=91.0)


def test_feature_rejects_longitude_out_of_range() -> None:
    with pytest.raises(ValidationError):
        _feature(lon=181.0)


def test_feature_rejects_empty_estimates() -> None:
    with pytest.raises(ValidationError):
        _feature(estimates=[])


def test_feature_sorts_estimates_ascending_by_t() -> None:
    feature = _feature(
        estimates=[
            PopulationEstimate(t=2000.0, population=500_000),
            PopulationEstimate(t=100.0, population=10_000),
            PopulationEstimate(t=5000.0, population=1_000),
        ]
    )
    assert [e.t for e in feature.estimates] == [100.0, 2000.0, 5000.0]


def test_feature_rejects_duplicate_estimate_t() -> None:
    with pytest.raises(ValidationError, match="duplicate estimate"):
        _feature(
            estimates=[
                PopulationEstimate(t=100.0, population=10_000),
                PopulationEstimate(t=100.0, population=20_000),
            ]
        )


def test_feature_certainty_is_a_closed_enum() -> None:
    with pytest.raises(ValidationError):
        _feature(certainty="very sure")  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- FeatureSet


def test_feature_set_rejects_empty_features() -> None:
    with pytest.raises(ValidationError, match="empty FeatureSet"):
        FeatureSet(id="cities", features=[])


def test_feature_set_rejects_duplicate_feature_ids() -> None:
    with pytest.raises(ValidationError, match="duplicate feature ids"):
        FeatureSet(id="cities", features=[_feature(id="uruk"), _feature(id="uruk")])


def test_feature_set_sorts_features_by_id() -> None:
    feature_set = FeatureSet(
        id="cities", features=[_feature(id="zanzibar"), _feature(id="babylon")]
    )
    assert [f.id for f in feature_set.features] == ["babylon", "zanzibar"]


def test_feature_set_domain_spans_every_feature_every_estimate() -> None:
    feature_set = FeatureSet(
        id="cities",
        features=[
            _feature(id="a", estimates=[PopulationEstimate(t=100.0, population=1)]),
            _feature(id="b", estimates=[PopulationEstimate(t=5000.0, population=1)]),
        ],
    )
    assert feature_set.domain == (100.0, 5000.0)


def test_feature_set_sample_includes_only_features_already_attested_by_t() -> None:
    """A city "exists" at query time t (years BP) once its oldest attested estimate is at
    least that old -- mirrors `Tree.sample`'s "not yet diverged" semantics for "not yet
    founded"."""
    old_city = _feature(id="old", estimates=[PopulationEstimate(t=5000.0, population=10_000)])
    young_city = _feature(id="young", estimates=[PopulationEstimate(t=500.0, population=10_000)])
    feature_set = FeatureSet(id="cities", features=[old_city, young_city])

    assert [f.id for f in feature_set.sample(6000.0)] == []
    assert [f.id for f in feature_set.sample(4000.0)] == ["old"]
    assert sorted(f.id for f in feature_set.sample(100.0)) == ["old", "young"]
