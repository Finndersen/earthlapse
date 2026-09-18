"""Generic "top-N per era bucket" notability filter for a `FeatureSet` (ADR-034).

A `FeatureSet` sourced from a large gazetteer (e.g. `sources/cities`) typically has far more
records than are worth putting in front of a viewer — most are small, local, or only briefly
notable. `notable_features` keeps only the features that were genuinely significant *for their
own era*, without hand-curating a list: a feature qualifies if, within any `bucket_years`-wide
era bucket, its peak attested value within that bucket ranks in that era's own top `top_n`.

Ranking **within each bucket** rather than against the value's all-time maximum is what makes
this era-relative rather than a blunt global cutoff: comparing a Bronze Age city's population
directly against a modern megacity's would exclude every pre-industrial settlement outright,
since no ancient city ever reached even a modern city's tens-of-thousands floor. Bucketing by
era means Uruk only has to out-rank its own 4th-millennium-BC contemporaries, not Tokyo.

See `pipeline/publish.py`'s `FEATURE_LAYERS` for the concrete parameters chosen for `cities`
and why, and `sources/cities/README.md` for the measured effect (how many features pass).
"""

from __future__ import annotations

from pipeline.shapes import FeatureSet


def notable_features(feature_set: FeatureSet, *, bucket_years: float, top_n: int) -> FeatureSet:
    """A new `FeatureSet` (same id) holding only the features whose peak estimate value falls
    in the top `top_n` of some `bucket_years`-wide bucket of `t` (years before present, rounded
    to the nearest bucket) — every other feature's estimates are entirely excluded, not just
    trimmed. `feature_set.features` is never empty going in (the shape's own validator
    enforces that), but the result *can* be empty if `top_n` is 0 or every estimate is tied out
    of every bucket — the caller decides whether an empty published layer is acceptable."""
    peak_by_bucket: dict[int, dict[str, int]] = {}
    for feature in feature_set.features:
        for estimate in feature.estimates:
            bucket = round(estimate.t / bucket_years)
            bucket_peaks = peak_by_bucket.setdefault(bucket, {})
            if estimate.population > bucket_peaks.get(feature.id, 0):
                bucket_peaks[feature.id] = estimate.population

    notable_ids: set[str] = set()
    for bucket_peaks in peak_by_bucket.values():
        ranked = sorted(bucket_peaks.items(), key=lambda item: item[1], reverse=True)
        notable_ids.update(feature_id for feature_id, _ in ranked[:top_n])

    kept = [f for f in feature_set.features if f.id in notable_ids]
    return FeatureSet(id=feature_set.id, features=kept)
