"""The shipped city roster resolves against the committed curated dataset, the same strict check
`apply_city_roster` performs at publish time."""

from __future__ import annotations

import pytest

from pipeline.curated import read_shape
from pipeline.publish import apply_city_roster, load_city_roster
from pipeline.shapes import FeatureSet
from tests.sources.support import REPO_ROOT


@pytest.mark.content
def test_every_roster_entry_resolves_against_the_curated_dataset() -> None:
    curated = read_shape(REPO_ROOT / "data" / "curated" / "cities.parquet")
    assert isinstance(curated, FeatureSet)

    apply_city_roster(curated, load_city_roster(REPO_ROOT / "sources" / "cities" / "roster.toml"))
