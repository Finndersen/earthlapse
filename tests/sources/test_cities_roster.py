"""`sources/cities/roster.toml` (ADR-038): the hand-curated significance roster that replaces
ADR-035's population-rank notability filter, run against the real curated dataset.

Unlike `tests/test_pipeline.py`'s synthetic-data unit tests for `pipeline.publish.
apply_city_roster`/`load_city_roster` themselves, this module checks the *actual shipped
roster* -- that every entry resolves against `data/curated/cities.parquet` (the same check
`apply_city_roster` performs at publish time, so a roster typo fails here too, not just in a
real build) and that the published set has the global and era spread the task that created this
roster was about: the previous population-rank filter (`pipeline.notability`, deleted by this
change) published zero cities in sub-Saharan Africa, zero in Oceania/the Pacific, and only a
handful in South-East Asia and South America. `data/curated/cities.parquet` is a small (<5 MB),
committed file, not a live fetch or a large download -- reading it here is the same thing
`sources/cities/README.md`'s own reproduction command already does.
"""

from __future__ import annotations

from collections import Counter

from pipeline.curated import read_shape
from pipeline.publish import apply_city_roster, load_city_roster
from pipeline.shapes import FeatureSet
from tests.sources.support import REPO_ROOT

ROSTER_PATH = REPO_ROOT / "sources" / "cities" / "roster.toml"
CURATED_PATH = REPO_ROOT / "data" / "curated" / "cities.parquet"

MIN_ROSTER_SIZE = 150
MAX_ROSTER_SIZE = 250

# Every country the roster is expected to draw from, grouped into the broad regions the task
# that created this roster was measuring. A country missing from this map fails the spread test
# loudly (KeyError) rather than silently falling out of every region's count.
_REGION_BY_COUNTRY = {
    # sub-Saharan Africa
    "Nigeria": "sub-saharan-africa",
    "Democratic Republic of the Congo": "sub-saharan-africa",
    "Angola": "sub-saharan-africa",
    "Kenya": "sub-saharan-africa",
    "Ethiopia": "sub-saharan-africa",
    "Sudan": "sub-saharan-africa",
    "Senegal": "sub-saharan-africa",
    "Ghana": "sub-saharan-africa",
    "Cote D'Ivoire": "sub-saharan-africa",
    "Sierra Leone": "sub-saharan-africa",
    "Guinea": "sub-saharan-africa",
    "Zimbabwe": "sub-saharan-africa",
    "Madagascar": "sub-saharan-africa",
    "South Africa": "sub-saharan-africa",
    "Tanzania": "sub-saharan-africa",
    "Mali": "sub-saharan-africa",
    "Mozambique": "sub-saharan-africa",
    # Oceania / Pacific
    "Australia": "oceania-pacific",
    "New Zealand": "oceania-pacific",
    # South America
    "Peru": "south-america",
    "Bolivia": "south-america",
    "Ecuador": "south-america",
    "Colombia": "south-america",
    "Columbia": "south-america",
    "Venezuela": "south-america",
    "Chile": "south-america",
    "Argentina": "south-america",
    "Brazil": "south-america",
    # Caribbean / Central America
    "Cuba": "caribbean-central-america",
    "Dominican Republic": "caribbean-central-america",
    "Jamaica": "caribbean-central-america",
    "Haiti": "caribbean-central-america",
    "Puerto Rico": "caribbean-central-america",
    "Panama": "caribbean-central-america",
    "Guatemala": "caribbean-central-america",
    # Mexico
    "Mexico": "mexico",
    # North America
    "United States of America": "north-america",
    "Canada": "north-america",
    # South Asia
    "India": "south-asia",
    "Pakistan": "south-asia",
    "Bangladesh": "south-asia",
    "Nepal": "south-asia",
    "Sri Lanka": "south-asia",
    # South-East Asia
    "Cambodia": "southeast-asia",
    "Myanmar": "southeast-asia",
    "Thailand": "southeast-asia",
    "Indonesia": "southeast-asia",
    "Malaysia": "southeast-asia",
    "Singapore": "southeast-asia",
    "Philippines": "southeast-asia",
    "Vietnam": "southeast-asia",
    "Brunei": "southeast-asia",
    # Central Asia
    "Uzbekistan": "central-asia",
    "Turkmenistan": "central-asia",
    "Afghanistan": "central-asia",
    "Kazakhstan": "central-asia",
    "Mongolia": "central-asia",
    # East Asia
    "China": "east-asia",
    "Japan": "east-asia",
    "Republic of Korea": "east-asia",
    "Dem. People's Republic of Korea": "east-asia",
    "Taiwan": "east-asia",
    # Russia
    "Russian Federation": "russia",
    # Europe
    "United Kingdom": "europe",
    "France": "europe",
    "Italy": "europe",
    "Greece": "europe",
    "Spain": "europe",
    "Portugal": "europe",
    "Germany": "europe",
    "Austria": "europe",
    "Netherlands": "europe",
    "Belgium": "europe",
    "Denmark": "europe",
    "Sweden": "europe",
    "Norway": "europe",
    "Finland": "europe",
    "Ireland": "europe",
    "Poland": "europe",
    "Czech Republic": "europe",
    "Hungary": "europe",
    "Ukraine": "europe",
    "Switzerland": "europe",
    # Middle East / North Africa
    "Iraq": "middle-east",
    "Egypt": "middle-east",
    "Israel": "middle-east",
    "Syria": "middle-east",
    "Lebanon": "middle-east",
    "Jordan": "middle-east",
    "Saudi Arabia": "middle-east",
    "Yemen": "middle-east",
    "Turkey": "middle-east",
    "Iran": "middle-east",
}

MIN_PER_REGION = {
    "sub-saharan-africa": 15,
    "oceania-pacific": 5,
    "south-america": 8,
    "caribbean-central-america": 3,
    "mexico": 3,
    "north-america": 8,
    "south-asia": 8,
    "southeast-asia": 10,
    "central-asia": 3,
    "east-asia": 10,
    "russia": 3,
    "europe": 10,
    "middle-east": 10,
}

# Broad era buckets, keyed by each city's *oldest* attested estimate (the deepest antiquity the
# merged Chandler/Modelski dataset records for it). Bucketed coarsely because the merged
# dataset's own year coverage is uneven across eras (README.md "Notability filter"'s successor,
# "Significance roster", explains why) -- the point is that no era is silently empty, not a
# precise per-century count.
_ERA_BOUNDARIES = (0, 1000, 1800, 2026)  # calendar year upper bound (exclusive) per bucket
_ERA_LABELS = ("pre-1-ce", "1-1000-ce", "1000-1800-ce", "1800-2000-ce")
MIN_PER_ERA = {
    "pre-1-ce": 15,
    "1-1000-ce": 10,
    "1000-1800-ce": 20,
    "1800-2000-ce": 20,
}


def _era_bucket(oldest_calendar_year: float) -> str:
    for upper_bound, label in zip(_ERA_BOUNDARIES, _ERA_LABELS, strict=True):
        if oldest_calendar_year < upper_bound:
            return label
    raise AssertionError(f"year {oldest_calendar_year} is not before any era boundary")


def _published_cities() -> FeatureSet:
    curated = read_shape(CURATED_PATH)
    assert isinstance(curated, FeatureSet)
    roster = load_city_roster(ROSTER_PATH)
    return apply_city_roster(curated, roster)


def test_every_roster_entry_resolves_against_the_curated_dataset() -> None:
    """`apply_city_roster` itself raises on a mismatch (covered with synthetic data in
    `tests/test_pipeline.py`) -- this exercises that same strict check against the real,
    shipped roster and real curated data, so a typo in roster.toml fails this suite, not just a
    real `earthtime publish` run."""
    published = _published_cities()
    assert MIN_ROSTER_SIZE <= len(published.features) <= MAX_ROSTER_SIZE


def test_published_cities_cover_every_broad_region() -> None:
    published = _published_cities()
    region_counts: Counter[str] = Counter()
    for feature in published.features:
        region_counts[_REGION_BY_COUNTRY[feature.country]] += 1

    for region, minimum in MIN_PER_REGION.items():
        assert region_counts[region] >= minimum, (
            f"{region}: only {region_counts[region]} published cities, want >= {minimum} "
            f"(regression check: the population-rank filter this roster replaced published "
            f"zero cities in sub-Saharan Africa and Oceania)"
        )


def test_published_cities_cover_every_broad_era() -> None:
    published = _published_cities()
    era_counts: Counter[str] = Counter()
    for feature in published.features:
        oldest_t = max(estimate.t for estimate in feature.estimates)
        oldest_calendar_year = 2025.0 - oldest_t
        era_counts[_era_bucket(oldest_calendar_year)] += 1

    for era, minimum in MIN_PER_ERA.items():
        assert era_counts[era] >= minimum, (
            f"{era}: only {era_counts[era]} published cities' oldest reading falls here, want "
            f">= {minimum} (an ancient-only or modern-only roster would fail this)"
        )


def test_roster_ids_are_unique() -> None:
    roster = load_city_roster(ROSTER_PATH)
    ids = [entry.id for entry in roster.cities]
    assert len(ids) == len(set(ids))


def test_named_example_cities_are_still_published() -> None:
    """A spot check on cities the ADR-035 notability filter's own README named as must-haves,
    plus the specific gaps this roster was built to close."""
    published = _published_cities()
    ids = {f.id for f in published.features}
    for expected in (
        "uruk-iraq",
        "rome-italy",
        "xian-china",
        "istanbul-turkey",
        "mexico-city-mexico",
        "london-united-kingdom",
        "new-york-united-states-of-america",
        "tokyo-japan",
        # closing the gaps the population-rank filter left empty
        "lagos-nigeria",
        "sydney-australia",
        "jakarta-indonesia",
        "rio-de-janeiro-brazil",
        "cuzco-peru",
    ):
        assert expected in ids, f"{expected} missing from the published roster"


def test_region_map_covers_every_country_in_the_curated_dataset_the_roster_uses() -> None:
    """A defensive check on the test's own fixture data: every country a roster city actually
    carries in the curated dataset must be classified in `_REGION_BY_COUNTRY`, or the spread
    checks above would silently under-count (a `KeyError` here beats a silent gap there)."""
    published = _published_cities()
    unclassified = sorted({f.country for f in published.features} - set(_REGION_BY_COUNTRY))
    assert unclassified == []
