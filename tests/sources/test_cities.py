"""sources/cities against its committed fixture: a small real subset of the Chandler, Modelski
Ancient and Modelski Modern CSVs covering every merge case (a city in all three, in two, in one).
"""

from __future__ import annotations

import pytest

from pipeline.shapes import FeatureCertainty, FeatureSet
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def cities_normalise():
    return load_source_module("cities", "normalise")


def test_normalise_merges_the_three_datasets_into_one_feature_set(cities_normalise) -> None:
    (feature_set,) = cities_normalise.normalise(fixture_dir("cities"))

    assert isinstance(feature_set, FeatureSet)
    assert feature_set.id == "cities"
    assert len(feature_set.features) == 15
    by_id = {f.id: f for f in feature_set.features}
    rome_ts = {e.t for e in by_id["rome-italy"].estimates}
    assert min(rome_ts) < 200.0 and max(rome_ts) > 2000.0  # estimates from every dataset
    assert by_id["memphis-egypt"].certainty == FeatureCertainty.MEDIUM


def test_modelski_overwrites_chandler_on_a_shared_exact_year(cities_normalise) -> None:
    records, _ = cities_normalise.merge_datasets(fixture_dir("cities"))
    (rome,) = (r for r in records if r.name == "Rome")
    estimates = {}
    for name in ("chandlerV2.csv", "modelskiAncientV2.csv"):
        rows, years = cities_normalise._read_rows(fixture_dir("cities") / name)
        (row,) = (r for r in rows if r["City"] == "Rome")
        estimates[name] = cities_normalise._row_estimates(row, years)
    chandler, ancient = estimates["chandlerV2.csv"], estimates["modelskiAncientV2.csv"]
    conflicts = {t for t in set(chandler) & set(ancient) if chandler[t] != ancient[t]}

    assert conflicts, "fixture no longer exercises a real Chandler/Modelski conflict"
    for t in conflicts:
        assert rome.estimates[t] == ancient[t]


def test_year_columns_count_back_from_the_2025_present(cities_normalise) -> None:
    assert cities_normalise._year_column_to_t("AD_2000") == 25.0
    assert cities_normalise._year_column_to_t("BC_100") == 2125.0
    with pytest.raises(cities_normalise.CitiesFormatError):
        cities_normalise._year_column_to_t("garbage")


def _record(cities_normalise, estimates: dict[float, int]):
    return cities_normalise._MergedRecord(
        name="Test City",
        country="Testland",
        lat=0.0,
        lon=0.0,
        certainty=FeatureCertainty.HIGH,
        estimates=estimates,
        source="chandler",
    )


def test_an_erratum_corrects_only_its_target_reading(cities_normalise) -> None:
    t = cities_normalise._year_column_to_t("AD_1375")
    record = _record(cities_normalise, {t - 1.0: 111_000, t: 1_250_000})

    cities_normalise._apply_population_errata({"delhi-india": record})

    assert record.estimates == {t - 1.0: 111_000, t: 125_000}


def test_an_erratum_whose_expected_wrong_value_is_absent_raises(cities_normalise) -> None:
    t = cities_normalise._year_column_to_t("AD_2000")
    record = _record(cities_normalise, {t: 1_330_300})

    with pytest.raises(cities_normalise.CitiesErratumError):
        cities_normalise._apply_population_errata({"montevideo-uruguay": record})
    assert record.estimates[t] == 1_330_300
