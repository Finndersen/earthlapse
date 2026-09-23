"""sources/hyde/fetch.py's local logic: timestep tag filtering, the pinned expected-members
file and the already-cached check. The HTTP Range machinery runs only in a real fetch."""

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
        ("2015AD_lu", "2015AD"),
        ("2016AD_lu", None),  # beyond MAX_YEAR_CE
        ("0AD_pop", None),  # tags are discovered from the _lu directory only
    ],
)
def test_timestep_tag_filters_by_max_year_ce_and_suffix(
    hyde_fetch, dirname: str, expected_tag: str | None
) -> None:
    assert hyde_fetch._timestep_tag(dirname) == expected_tag


def test_expected_members_file_pins_every_variable_for_73_valid_tags(hyde_fetch) -> None:
    members = hyde_fetch._load_expected_members()

    assert len(members) == 73
    for tag, per_variable in members.items():
        assert hyde_fetch._timestep_tag(f"{tag}_lu") == tag
        assert set(per_variable) == set(hyde_fetch.VARIABLES), tag


def test_member_path_uses_the_pop_directory_and_underscore_for_population(hyde_fetch) -> None:
    assert hyde_fetch._member_path("0AD", "popc") == "baseline/asc/0AD_pop/popc_0AD.asc"
    assert hyde_fetch._member_path("0AD", "cropland") == "baseline/asc/0AD_lu/cropland0AD.asc"


def test_already_cached_only_when_every_file_matches_its_pinned_crc(hyde_fetch, tmp_path) -> None:
    contents = {variable: f"{variable}-bytes".encode() for variable in hyde_fetch.VARIABLES}
    for variable, data in contents.items():
        (tmp_path / hyde_fetch._local_filename("0AD", variable)).write_bytes(data)
    expected = {variable: zlib.crc32(data) for variable, data in contents.items()}

    assert hyde_fetch._already_cached(tmp_path, "0AD", expected)
    assert not hyde_fetch._already_cached(tmp_path, "0AD", {**expected, "rangeland": 1})


def test_fetch_touches_no_network_when_everything_is_cached(
    hyde_fetch, tmp_path, monkeypatch
) -> None:
    members = hyde_fetch._load_expected_members()
    for tag, per_variable in members.items():
        for variable in per_variable:
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

    hyde_fetch.fetch(tmp_path)
