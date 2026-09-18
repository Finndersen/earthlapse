"""`pipeline.notability.notable_features` (ADR-035): the generic "top-N per era bucket" filter
`pipeline/publish.py` applies to `cities` before publishing.
"""

from __future__ import annotations

from pipeline.notability import notable_features
from pipeline.shapes import Feature, FeatureCertainty, FeatureSet, PopulationEstimate


def _feature(feature_id: str, *estimates: tuple[float, int]) -> Feature:
    return Feature(
        id=feature_id,
        name=feature_id,
        country="Testland",
        lat=0.0,
        lon=0.0,
        certainty=FeatureCertainty.HIGH,
        estimates=[PopulationEstimate(t=t, population=pop) for t, pop in estimates],
    )


def test_keeps_only_top_n_per_bucket() -> None:
    """Three features share one era bucket (t=0..40, bucket_years=100 -> all bucket 0); only
    the top 2 by peak population survive."""
    feature_set = FeatureSet(
        id="cities",
        features=[
            _feature("big", (0.0, 1_000_000)),
            _feature("medium", (10.0, 500_000)),
            _feature("small", (20.0, 1_000)),
        ],
    )
    result = notable_features(feature_set, bucket_years=100.0, top_n=2)
    assert {f.id for f in result.features} == {"big", "medium"}


def test_a_small_ancient_city_can_qualify_in_its_own_era_bucket() -> None:
    """Era-relative, not a global cutoff: an ancient city with a tiny population by modern
    standards still qualifies if it tops its own era's bucket -- it never has to out-rank a
    much later, unrelated bucket's giant city."""
    feature_set = FeatureSet(
        id="cities",
        features=[
            _feature("ancient-village", (5000.0, 2_000)),  # alone in its own era bucket
            _feature("modern-megacity", (0.0, 30_000_000)),  # alone in a different bucket
        ],
    )
    result = notable_features(feature_set, bucket_years=100.0, top_n=1)
    assert {f.id for f in result.features} == {"ancient-village", "modern-megacity"}


def test_a_feature_with_no_bucket_topping_estimate_is_excluded() -> None:
    feature_set = FeatureSet(
        id="cities",
        features=[
            _feature("dominant", (0.0, 1_000_000)),
            _feature("never-tops", (0.0, 10), (10.0, 20), (20.0, 30)),
        ],
    )
    result = notable_features(feature_set, bucket_years=100.0, top_n=1)
    assert {f.id for f in result.features} == {"dominant"}


def test_a_feature_can_qualify_via_a_peak_in_a_different_bucket_than_another_estimate() -> None:
    """Ranking uses each feature's own *peak* value within a bucket, not its first or last
    estimate -- a feature with one huge spike inside a bucket still tops that bucket even if
    its other estimates elsewhere are small."""
    feature_set = FeatureSet(
        id="cities",
        features=[
            _feature("spiky", (0.0, 10), (50.0, 5_000_000), (99.0, 20)),
            _feature("steady", (10.0, 100_000)),
        ],
    )
    result = notable_features(feature_set, bucket_years=100.0, top_n=1)
    assert {f.id for f in result.features} == {"spiky"}


def test_result_preserves_feature_set_id() -> None:
    feature_set = FeatureSet(id="cities", features=[_feature("a", (0.0, 100))])
    result = notable_features(feature_set, bucket_years=100.0, top_n=5)
    assert result.id == "cities"
