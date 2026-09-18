"""Offline validator for sources/hyde/fetch.py's pure/local-only logic: the timestep tag
parser/filter (`_timestep_tag`, `MAX_YEAR_CE`), the pinned expected-members file, and the
already-cached check. No network -- `fetch()`'s own HTTP Range machinery is exercised only by
a real fetch, never in this suite.
"""

from __future__ import annotations

import zlib

import pytest

from tests.sources.support import load_source_module


@pytest.fixture(scope="module")
def hyde_fetch():
    return load_source_module("hyde", "fetch")


@pytest.mark.parametrize(
    ("dirname", "expected_tag"),
    [
        ("10000BC_lu", "10000BC"),
        ("0AD_lu", "0AD"),
        ("2015AD_lu", "2015AD"),
        ("2016AD_lu", None),  # beyond MAX_YEAR_CE -- the real deposit ships this, we don't want it
        ("2017AD_lu", None),
        ("0AD_pop", None),  # tags are discovered from the _lu directory only, see _timestep_tag
        ("0AD_png", None),
        ("garbageAD_lu", None),  # doesn't match the tag regex at all
    ],
)
def test_timestep_tag_filters_by_max_year_ce_and_suffix(
    hyde_fetch, dirname: str, expected_tag: str | None
) -> None:
    assert hyde_fetch._timestep_tag(dirname) == expected_tag


def test_max_year_ce_is_2015(hyde_fetch) -> None:
    assert hyde_fetch.MAX_YEAR_CE == 2015


def test_expected_members_file_has_73_tags_none_beyond_2015ad(hyde_fetch) -> None:
    members = hyde_fetch._load_expected_members()
    assert len(members) == 73
    for tag in members:
        assert hyde_fetch._timestep_tag(f"{tag}_lu") == tag  # every pinned tag is still valid


def test_land_use_variables_is_cropland_pasture_rangeland_conv_rangeland(hyde_fetch) -> None:
    """Regression guard for two sequential fixes -- README.md "Which HYDE variable is
    'pasture'": (1) `grazing` (= pasture + rangeland + conv_rangeland) painted natural
    rangeland as cleared land, so it was replaced by its narrower parts; (2) `conv_rangeland`
    (forest-biome grazing land, assumed cleared per Klein Goldewijk et al. 2017) was initially
    left unfetched entirely, then added once its definition was confirmed against the primary
    source."""
    assert hyde_fetch.LAND_USE_VARIABLES == ("cropland", "pasture", "rangeland", "conv_rangeland")


def test_variables_adds_population_count(hyde_fetch) -> None:
    """ADR-031 amendment "population density": `popc` is fetched alongside the four land-use
    variables, not instead of them."""
    assert hyde_fetch.VARIABLES == (*hyde_fetch.LAND_USE_VARIABLES, "popc")
    assert hyde_fetch.POPULATION_VARIABLE == "popc"


def test_member_path_uses_the_pop_directory_and_underscore_for_population(hyde_fetch) -> None:
    """Confirmed directly against the real archive's own central directory: population members
    live under `<tag>_pop/`, not `<tag>_lu/`, and their filename puts an underscore before the
    tag (`popc_0AD.asc`), unlike the land-use members' `cropland0AD.asc` convention."""
    assert hyde_fetch._member_path("0AD", "popc") == "baseline/asc/0AD_pop/popc_0AD.asc"
    assert hyde_fetch._member_path("0AD", "cropland") == "baseline/asc/0AD_lu/cropland0AD.asc"


def test_local_filename_matches_member_path_basename(hyde_fetch) -> None:
    assert hyde_fetch._local_filename("0AD", "popc") == "popc_0AD.asc"
    assert hyde_fetch._local_filename("0AD", "cropland") == "cropland0AD.asc"


def test_expected_members_every_tag_has_all_variables(hyde_fetch) -> None:
    members = hyde_fetch._load_expected_members()
    for tag, per_variable in members.items():
        assert set(per_variable) == set(hyde_fetch.VARIABLES), tag


def test_already_cached_false_when_file_missing(hyde_fetch, tmp_path) -> None:
    assert not hyde_fetch._already_cached(
        tmp_path,
        "0AD",
        {"cropland": 1, "pasture": 2, "rangeland": 3, "conv_rangeland": 4, "popc": 5},
    )


def test_already_cached_false_when_crc_mismatches(hyde_fetch, tmp_path) -> None:
    for variable in hyde_fetch.VARIABLES:
        (tmp_path / hyde_fetch._local_filename("0AD", variable)).write_bytes(b"data")
    real_crc = zlib.crc32(b"data")
    expected = dict.fromkeys(hyde_fetch.VARIABLES, real_crc)
    expected["rangeland"] = real_crc + 1  # deliberately wrong
    assert not hyde_fetch._already_cached(tmp_path, "0AD", expected)


def test_already_cached_true_when_all_files_match(hyde_fetch, tmp_path) -> None:
    contents = {variable: f"{variable}-bytes".encode() for variable in hyde_fetch.VARIABLES}
    for variable, data in contents.items():
        (tmp_path / hyde_fetch._local_filename("0AD", variable)).write_bytes(data)
    expected = {variable: zlib.crc32(data) for variable, data in contents.items()}
    assert hyde_fetch._already_cached(tmp_path, "0AD", expected)


def test_baseline_url_is_read_from_manifest_toml(hyde_fetch) -> None:
    assert hyde_fetch.baseline_url() == (
        "https://archaeology.datastations.nl/api/access/datafile/5490328"
    )


def test_fetch_touches_no_network_when_everything_is_cached(
    hyde_fetch, tmp_path, monkeypatch
) -> None:
    """The offline `make data` guarantee (README.md "Fetch strategy"): if every expected file
    is already on disk and CRC-verified, `fetch()` must return without opening an `httpx.Client`
    at all. Verified here by making `httpx.Client.__init__` raise if it's ever called."""
    members = hyde_fetch._load_expected_members()
    for tag, per_variable in members.items():
        for variable in per_variable:
            # Bytes whose crc32 matches the pinned value would require a preimage search;
            # instead, monkeypatch crc32 to always agree with whatever's pinned, so any content
            # "verifies" -- this test is only about whether the network path is reached at all.
            (tmp_path / hyde_fetch._local_filename(tag, variable)).write_bytes(b"x")

    monkeypatch.setattr(hyde_fetch.zlib, "crc32", lambda _data: 0)
    monkeypatch.setattr(
        hyde_fetch,
        "_load_expected_members",
        lambda: {t: dict.fromkeys(v, 0) for t, v in members.items()},
    )

    def _boom(*_args, **_kwargs):
        raise AssertionError("fetch() opened an httpx.Client despite everything being cached")

    monkeypatch.setattr(hyde_fetch.httpx, "Client", _boom)

    hyde_fetch.fetch(tmp_path)  # must not raise -- if it reaches httpx.Client(), _boom fires
