"""`select_notable_polities` (ADR-037): the era-relative top-N-by-area rule that picks
Cliopatria's notable subset. Synthetic windows only."""

from __future__ import annotations

from tests.sources.support import load_source_module

_subset = load_source_module("cliopatria", "subset")
PolityWindow = _subset.PolityWindow
select_notable_polities = _subset.select_notable_polities


def test_keeps_only_top_n_per_bucket() -> None:
    """Three polities share one era bucket (t midpoints 10/20/30, bucket_years=100 -> all
    bucket 0); only the top 2 by peak area survive."""
    windows = [
        PolityWindow(name="big", t_start=20.0, t_end=0.0, area_km2=1_000_000.0),
        PolityWindow(name="medium", t_start=30.0, t_end=10.0, area_km2=500_000.0),
        PolityWindow(name="small", t_start=40.0, t_end=20.0, area_km2=1_000.0),
    ]
    assert select_notable_polities(windows, bucket_years=100.0, top_n=2) == {"big", "medium"}


def test_an_ancient_small_polity_can_qualify_in_its_own_era_bucket() -> None:
    """Era-relative, not a global cutoff: a small Bronze Age polity qualifies if it tops its
    own era's bucket -- it never has to out-rank an unrelated, much larger, later empire."""
    windows = [
        PolityWindow(name="bronze-age-city-state", t_start=5050.0, t_end=4950.0, area_km2=2_000.0),
        PolityWindow(name="modern-empire", t_start=50.0, t_end=0.0, area_km2=30_000_000.0),
    ]
    result = select_notable_polities(windows, bucket_years=100.0, top_n=1)
    assert result == {"bronze-age-city-state", "modern-empire"}


def test_a_polity_qualifies_via_its_peak_window_not_its_first_or_last() -> None:
    """A polity's peak-in-bucket area is the largest across every window whose midpoint falls
    in that bucket, not whichever window happens to be first or last."""
    windows = [
        PolityWindow(name="waxed-and-waned", t_start=99.0, t_end=90.0, area_km2=10.0),
        PolityWindow(name="waxed-and-waned", t_start=60.0, t_end=40.0, area_km2=5_000_000.0),
        PolityWindow(name="waxed-and-waned", t_start=9.0, t_end=0.0, area_km2=20.0),
        PolityWindow(name="steady", t_start=55.0, t_end=45.0, area_km2=100_000.0),
    ]
    result = select_notable_polities(windows, bucket_years=100.0, top_n=1)
    assert result == {"waxed-and-waned"}
