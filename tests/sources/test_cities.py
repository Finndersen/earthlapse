"""Offline validator for sources/cities, run against the committed fixture only.

The fixture is a small, real subset of all three upstream CSVs (Chandler, Modelski Ancient,
Modelski Modern), chosen to exercise every merge case this source's dedupe policy handles:
- a city in all three datasets (Rome, Aleppo);
- a city in Chandler + Modelski Ancient only (Babylon, Memphis, Uruk);
- a city in Chandler + Modelski Modern only (London, New York, Tokyo);
- a city in exactly one dataset (Baghdad, Istanbul, Mexico City, Xian, York -- Chandler only;
  Eridu -- Modelski Ancient only; Cairo -- Modelski Modern only).

See README.md "Dedupe policy" for the full account.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from pipeline.shapes import Feature, FeatureCertainty, FeatureSet
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def cities_normalise():
    return load_source_module("cities", "normalise")


@pytest.fixture(scope="module")
def feature_set(cities_normalise) -> FeatureSet:
    shapes = cities_normalise.normalise(fixture_dir("cities"))
    assert len(shapes) == 1
    (shape,) = shapes
    assert isinstance(shape, FeatureSet)
    return shape


def _feature(feature_set: FeatureSet, feature_id: str) -> Feature:
    (match,) = (f for f in feature_set.features if f.id == feature_id)
    return match


def test_shape_id(feature_set: FeatureSet) -> None:
    assert feature_set.id == "cities"


def test_fixture_produces_the_expected_fifteen_cities(feature_set: FeatureSet) -> None:
    assert {f.id for f in feature_set.features} == {
        "aleppo-syria",
        "babylon-iraq",
        "baghdad-iraq",
        "cairo-egypt",
        "eridu-iraq",
        "istanbul-turkey",
        "london-united-kingdom",
        "memphis-egypt",
        "mexico-city-mexico",
        "new-york-united-states-of-america",
        "rome-italy",
        "tokyo-japan",
        "uruk-iraq",
        "xian-china",
        "york-united-kingdom",
    }


# ------------------------------------------------------------------------- merge / dedupe


def test_merge_datasets_reports_accurate_counts(cities_normalise) -> None:
    records, counts = cities_normalise.merge_datasets(fixture_dir("cities"))
    assert len(records) == 15
    assert counts.kept_cities == 15
    assert counts.dropped_no_coordinates == 0
    assert counts.dropped_no_estimates == 0
    # Aleppo (chandler+ancient+modern -> 2 merges) + Babylon/Memphis/Uruk (chandler+ancient ->
    # 1 each) + London/New York/Tokyo (chandler+modern -> 1 each) + Rome (chandler+ancient+
    # modern -> 2 merges) = 2 + 3 + 3 + 2 = 10.
    assert counts.merged_pairs == 10


def test_a_city_in_all_three_datasets_keeps_estimates_from_each(feature_set: FeatureSet) -> None:
    rome = _feature(feature_set, "rome-italy")
    ts = {e.t for e in rome.estimates}
    # spans from Modelski Ancient's own oldest reach down to a recent Chandler/Modelski Modern
    # year -- if only one dataset's estimates survived the merge, this range would be far
    # narrower.
    assert min(ts) < 200.0
    assert max(ts) > 2000.0


def test_modelski_overwrites_chandler_on_a_shared_exact_year(cities_normalise) -> None:
    """The paper's own stated precedent ("we selected Modelski's values ... for the ancient
    period") applied uniformly: when Chandler and a Modelski file both report a population for
    the *same* attested year for the same city, the merged record keeps Modelski's number, not
    Chandler's."""
    records, _counts = cities_normalise.merge_datasets(fixture_dir("cities"))
    (rome,) = (r for r in records if r.name == "Rome")
    # Confirm this test is actually exercising a real conflict, not a coincidence: read both
    # raw datasets directly rather than trusting the merge to have done the right thing.
    chandler_rows, chandler_years = cities_normalise._read_rows(
        fixture_dir("cities") / "chandlerV2.csv"
    )
    ancient_rows, ancient_years = cities_normalise._read_rows(
        fixture_dir("cities") / "modelskiAncientV2.csv"
    )
    (chandler_rome,) = (r for r in chandler_rows if r["City"] == "Rome")
    (ancient_rome,) = (r for r in ancient_rows if r["City"] == "Rome")
    chandler_estimates = cities_normalise._row_estimates(chandler_rome, chandler_years)
    ancient_estimates = cities_normalise._row_estimates(ancient_rome, ancient_years)
    conflicting_years = {
        t
        for t in set(chandler_estimates) & set(ancient_estimates)
        if chandler_estimates[t] != ancient_estimates[t]
    }
    assert conflicting_years, "fixture no longer exercises a real Chandler/Modelski conflict"
    for t in conflicting_years:
        assert rome.estimates[t] == ancient_estimates[t]


def test_a_dataset_only_city_keeps_exactly_that_datasets_estimates(feature_set: FeatureSet) -> None:
    baghdad = _feature(feature_set, "baghdad-iraq")
    eridu = _feature(feature_set, "eridu-iraq")
    cairo = _feature(feature_set, "cairo-egypt")
    assert len(baghdad.estimates) > 1
    assert len(eridu.estimates) > 1
    assert len(cairo.estimates) == 1  # Modelski Modern has exactly one column, AD_2000


# --------------------------------------------------------------------------------- schema


def test_certainty_is_mapped_from_the_raw_numeric_code(feature_set: FeatureSet) -> None:
    # Chandler's own raw Certainty column: Babylon/Uruk/Rome/Aleppo/Baghdad/... = "1" (high);
    # Memphis = "2" (medium) -- confirmed directly against the fixture CSV.
    assert _feature(feature_set, "rome-italy").certainty == FeatureCertainty.HIGH
    assert _feature(feature_set, "memphis-egypt").certainty == FeatureCertainty.MEDIUM


def test_every_feature_has_plausible_coordinates(feature_set: FeatureSet) -> None:
    for feature in feature_set.features:
        assert -90.0 <= feature.lat <= 90.0
        assert -180.0 <= feature.lon <= 180.0


def test_every_estimate_is_a_positive_population(feature_set: FeatureSet) -> None:
    for feature in feature_set.features:
        for estimate in feature.estimates:
            assert estimate.population > 0


def test_feature_ids_are_url_safe_slugs(feature_set: FeatureSet) -> None:
    for feature in feature_set.features:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", feature.id), feature.id


# ------------------------------------------------------------------------- year parsing


@pytest.mark.parametrize(
    ("column", "expected_t"),
    [
        ("AD_2000", 25.0),
        ("AD_1", 2024.0),
        ("BC_100", 2125.0),
        ("BC_3700", 5725.0),
    ],
)
def test_year_column_to_t(cities_normalise, column: str, expected_t: float) -> None:
    assert cities_normalise._year_column_to_t(column) == expected_t


def test_year_column_to_t_rejects_an_unrecognised_column(cities_normalise) -> None:
    with pytest.raises(cities_normalise.CitiesFormatError):
        cities_normalise._year_column_to_t("garbage")


# ------------------------------------------------------------------------------ fetch.py


@pytest.fixture(scope="module")
def cities_fetch():
    return load_source_module("cities", "fetch")


def test_manifest_declares_three_artefacts(cities_fetch) -> None:
    artefacts = cities_fetch.load_artefacts(
        Path(__file__).resolve().parents[2] / "sources" / "cities" / "manifest.toml"
    )
    assert {a.filename for a in artefacts} == {
        "chandlerV2.csv",
        "modelskiAncientV2.csv",
        "modelskiModernV2.csv",
    }
    for artefact in artefacts:
        assert len(artefact.sha256) == 64
        assert "CC BY" in artefact.licence


def test_fetch_touches_no_network_when_everything_is_cached(
    cities_fetch, tmp_path, monkeypatch
) -> None:
    """`fetch()` delegates the actual "is this file already verified" decision to
    `pipeline.fetching.ensure_verified_artefact` (tested generically there); this only checks
    that `fetch()` itself never reaches `_download` when that check reports every artefact
    already present, the same "never opens the network when nothing's needed" guarantee
    `sources/hyde`'s own fetch test asserts."""

    def _boom(*_args, **_kwargs):
        raise AssertionError("fetch() attempted a network download despite cached files")

    monkeypatch.setattr(cities_fetch, "_download", _boom)
    monkeypatch.setattr(
        cities_fetch,
        "ensure_verified_artefact",
        lambda raw_dir, filename, expected_sha256, download: tmp_path / filename,
    )
    cities_fetch.fetch(tmp_path)  # must not raise -- if it reaches _download(), _boom fires
