"""The "notable subset" rule for Cliopatria's ~1,600 political entities (ADR-037).

Cliopatria's own GeoJSON covers essentially the whole world's political map at ~508 distinct
map years -- far too much to rasterise or label on a globe (`docs/DATA_SOURCES.md`'s own
framing: "a notable subset of named empires... for legibility"). Rather than hand-pick which
empires "matter" (which would bake in one person's historical knowledge -- exactly what
`pipeline.notability`'s own precedent for `sources/cities` was built to avoid), the same
era-relative "top-N per bucket" rule cities uses is applied here to **territorial area**
instead of population: a polity qualifies if, within some `bucket_years`-wide bucket of `t`,
its peak attested area within that bucket ranks in that bucket's own top `top_n`.

This is a deliberate, parallel re-implementation of `pipeline.notability.notable_features`'s
algorithm, not a reuse of it: that function operates on an already-built `FeatureSet` (one
`Feature` per city, each carrying `PopulationEstimate`s), whereas the polities here are still
raw `(name, years, area)` windows before any `Feature` exists -- forcing them through
`FeatureSet`/`Feature` (with placeholder `lat`/`lon`/`certainty` fields a numeric ranking has
no use for) just to reuse the bucketing loop would be a worse fit than a second, small, plain
implementation of the same idea. See `sources/cliopatria/README.md` "Subset rule" for the
parameters chosen and the resulting list.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from pipeline.shapes import GeoTime


@dataclass(frozen=True)
class PolityWindow:
    """One raw Cliopatria row, after `normalise.py`'s own `Type == "POLITY"` filter and name
    canonicalisation (README.md "Duplicate aggregate entries") -- `name` is already the
    canonical (deduplicated) polity name, not necessarily the raw dataset's own `Name` value."""

    name: str
    t_start: GeoTime  # years BP, further into the past -- FromYear converted
    t_end: GeoTime  # years BP, nearer the present -- ToYear converted
    area_km2: float


def select_notable_polities(
    windows: Sequence[PolityWindow], *, bucket_years: float, top_n: int
) -> set[str]:
    """Every polity `name` that peaks in the top `top_n` by area within at least one
    `bucket_years`-wide bucket of `t` (rounded to the nearest bucket, keyed on each window's
    own midpoint) -- era-relative, exactly like `pipeline.notability.notable_features`: a
    Bronze Age city-state never has to out-rank the British Empire, only its own contemporaries.

    A polity's peak within a bucket is the largest `area_km2` across every one of its windows
    whose midpoint falls in that bucket, not a single window's own area -- the same "peak, not
    first/last" rule `notable_features` applies to population.
    """
    peak_by_bucket: dict[int, dict[str, float]] = defaultdict(dict)
    for window in windows:
        bucket = round(((window.t_start + window.t_end) / 2.0) / bucket_years)
        bucket_peaks = peak_by_bucket[bucket]
        if window.area_km2 > bucket_peaks.get(window.name, 0.0):
            bucket_peaks[window.name] = window.area_km2

    notable: set[str] = set()
    for bucket_peaks in peak_by_bucket.values():
        ranked = sorted(bucket_peaks.items(), key=lambda item: item[1], reverse=True)
        notable.update(name for name, _area in ranked[:top_n])
    return notable
