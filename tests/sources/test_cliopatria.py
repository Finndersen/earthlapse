"""Offline validator for sources/cliopatria, run against the committed fixture only.

The fixture (`sources/cliopatria/fixture/cliopatria.geojson`) is thirteen real, unmodified
features from the real dataset (README.md "Fixture"):

- `Han Dynasty` (-202,-198) and (6,13), plus `(Han Dynasty)` at the identical two windows --
  real, confirmed-identical duplicate pairs (README.md "Duplicate aggregate entries"), to
  exercise the parenthesis-merge dedupe;
- `(Han Dynasty)` (224,237) -- a paren-only window with no bare counterpart, `SeshatID` blank;
- `Himyarite Kingdom` (534,576) -- a small, simple `Polygon`, `SeshatID` blank;
- `Goguryeo` (612,616) -- a `MultiPolygon`, `SeshatID` present;
- `Atropates` (LEADER, not POLITY) -- must be dropped by the `Type` filter entirely;
- `Kingdom of Monaco` (1815,1847), (1848,1935), (1936,1938), (1939,1939) -- real windows
  exercising all three `_apply_cutoff` cases against the 1900 domain cutoff (ADR-037 amendment,
  2026-09-18): entirely before, straddling, and entirely after;
- `Greek Dark Ages` (-1100,-1001) -- a real row for the non-polity exclusion list
  (`_EXCLUDED_NAMES`), added by the same amendment.

Every one of the fixture's surviving canonical windows lands in its own 100-year bucket (no two
distinct polities compete), so all of them clear the real `TOP_N`/`BUCKET_YEARS` subset rule
trivially -- this file tests the mechanics (Type filtering, dedupe, schema, rasterisation, the
1900 cutoff, the exclusion list), not the subset rule's own ranking behaviour, which
`tests/sources/test_cliopatria_subset.py` covers with synthetic data built specifically to
exercise exclusion.
"""

from __future__ import annotations

import io
import re
import tomllib
import zipfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline.shapes import Feature, FeatureCertainty, FeatureSet, RasterSequence
from tests.sources.support import fixture_dir, load_source_module


@pytest.fixture(scope="module")
def cliopatria_normalise():
    return load_source_module("cliopatria", "normalise")


@pytest.fixture(scope="module")
def shapes(cliopatria_normalise):
    return cliopatria_normalise.normalise(fixture_dir("cliopatria"))


@pytest.fixture(scope="module")
def raster(shapes) -> RasterSequence:
    (raster,) = (s for s in shapes if isinstance(s, RasterSequence))
    return raster


@pytest.fixture(scope="module")
def feature_set(shapes) -> FeatureSet:
    (feature_set,) = (s for s in shapes if isinstance(s, FeatureSet))
    return feature_set


def _features_named(feature_set: FeatureSet, name: str) -> list[Feature]:
    return [f for f in feature_set.features if f.name == name]


# --------------------------------------------------------------------------------- normalise


def test_normalise_returns_exactly_one_raster_and_one_feature_set(shapes) -> None:
    assert len(shapes) == 2
    assert isinstance(shapes[0], RasterSequence) or isinstance(shapes[1], RasterSequence)
    assert isinstance(shapes[0], FeatureSet) or isinstance(shapes[1], FeatureSet)


def test_shape_ids(raster: RasterSequence, feature_set: FeatureSet) -> None:
    assert raster.id == "cliopatria_extent"
    assert feature_set.id == "cliopatria_polities"


def test_type_filter_drops_the_leader_feature(feature_set: FeatureSet) -> None:
    assert _features_named(feature_set, "Atropates") == []


def test_dedupe_collapses_the_two_identical_han_dynasty_windows(feature_set: FeatureSet) -> None:
    """Five raw `Han Dynasty`/`(Han Dynasty)` POLITY rows in the fixture -- two identical
    (bare, paren) pairs plus one paren-only window -- collapse to exactly three surviving
    windows, all under the canonical (bare) name."""
    han = _features_named(feature_set, "Han Dynasty")
    assert len(han) == 3
    assert {f.name for f in han} == {"Han Dynasty"}  # canonicalised, never "(Han Dynasty)"


def test_the_paren_only_window_survives_with_its_own_data(feature_set: FeatureSet) -> None:
    """(224, 237) exists only under the parenthesised label in the fixture -- it must still
    survive dedupe (nothing to prefer over it) and carry its own area/certainty."""
    (window,) = (
        f
        for f in _features_named(feature_set, "Han Dynasty")
        if f.estimates[0].t_end == 2025.0 - 237
    )
    assert window.estimates[0].area_km2 == pytest.approx(788999.0, rel=1e-6)
    assert window.certainty == FeatureCertainty.MEDIUM  # this window's own SeshatID is blank


def test_all_seven_surviving_windows_are_present(feature_set: FeatureSet) -> None:
    """Five pre-existing windows (Han Dynasty x3, Himyarite Kingdom, Goguryeo) plus two
    surviving Kingdom of Monaco windows (the 1936/1939 windows are dropped entirely by the 1900
    cutoff -- see the cutoff-specific tests below) plus zero Greek Dark Ages windows (excluded
    entirely -- see the exclusion-specific tests below)."""
    assert len(feature_set.features) == 7
    assert {f.name for f in feature_set.features} == {
        "Han Dynasty",
        "Himyarite Kingdom",
        "Goguryeo",
        "Kingdom of Monaco",
    }


# ------------------------------------------------------------------------------------- schema


def test_every_feature_has_exactly_one_estimate_with_area_but_no_population(
    feature_set: FeatureSet,
) -> None:
    for feature in feature_set.features:
        assert len(feature.estimates) == 1
        estimate = feature.estimates[0]
        assert estimate.population is None
        assert estimate.area_km2 is not None and estimate.area_km2 > 0
        assert estimate.t_end is not None and estimate.t_end <= estimate.t


def test_every_feature_has_no_country_and_plausible_coordinates(feature_set: FeatureSet) -> None:
    for feature in feature_set.features:
        assert feature.country == ""
        assert -90.0 <= feature.lat <= 90.0
        assert -180.0 <= feature.lon <= 180.0


def test_feature_ids_are_url_safe_slugs(feature_set: FeatureSet) -> None:
    for feature in feature_set.features:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", feature.id), feature.id


def test_certainty_is_high_exactly_when_seshatid_is_present(feature_set: FeatureSet) -> None:
    """Goguryeo's one fixture window has a real SeshatID -> HIGH. Himyarite Kingdom's and the
    paren-only Han Dynasty window's do not -> MEDIUM. Never LOW -- this source has no third,
    lower-confidence signal to map (README.md "Certainty")."""
    (goguryeo,) = _features_named(feature_set, "Goguryeo")
    (himyarite,) = _features_named(feature_set, "Himyarite Kingdom")
    assert goguryeo.certainty == FeatureCertainty.HIGH
    assert himyarite.certainty == FeatureCertainty.MEDIUM
    assert all(f.certainty != FeatureCertainty.LOW for f in feature_set.features)


# ------------------------------------------------------------------------------------ dedupe


def test_canonical_name_strips_a_wrapping_paren_pair(cliopatria_normalise) -> None:
    assert cliopatria_normalise._canonical_name("(Han Dynasty)") == "Han Dynasty"
    assert cliopatria_normalise._canonical_name("Han Dynasty") == "Han Dynasty"


def test_canonical_name_strips_a_parenthesised_name_with_no_bare_counterpart_too(
    cliopatria_normalise,
) -> None:
    """ADR-037 amendment (2026-09-18): unlike the pre-amendment rule, a parenthesised name is
    stripped unconditionally, not only when a bare counterpart exists elsewhere in the dataset
    -- the parenthesis was never part of the polity's own name (README.md "Duplicate aggregate
    entries and label normalisation")."""
    assert (
        cliopatria_normalise._canonical_name("(Spring and Autumn States)")
        == "Spring and Autumn States"
    )


def test_canonical_name_leaves_a_partial_paren_alone(cliopatria_normalise) -> None:
    """`"Kingdom of Naples (Napoleonic)"` -- a real raw Name -- has parentheses that do not wrap
    the whole string, so it must not be touched by the paren-stripping rule."""
    assert (
        cliopatria_normalise._canonical_name("Kingdom of Naples (Napoleonic)")
        == "Kingdom of Naples (Napoleonic)"
    )


def test_canonical_name_applies_the_british_empire_alias_before_stripping(
    cliopatria_normalise,
) -> None:
    """`"(British Empire)"` and `"British Colonial Empire"` are the same real-world empire under
    two literal Names that do not share a bare form -- paren-stripping alone would produce
    `"British Empire"`, a third string, so `_NAME_ALIASES` maps it directly (README.md
    "Duplicate aggregate entries and label normalisation")."""
    assert cliopatria_normalise._canonical_name("(British Empire)") == "British Colonial Empire"
    assert (
        cliopatria_normalise._canonical_name("British Colonial Empire") == "British Colonial Empire"
    )


def test_greek_dark_ages_is_excluded(cliopatria_normalise) -> None:
    assert "Greek Dark Ages" in cliopatria_normalise._EXCLUDED_NAMES


def test_dedupe_rows_drops_an_excluded_name(cliopatria_normalise) -> None:
    row = cliopatria_normalise._RawPolityRow(
        name="Greek Dark Ages",
        from_year=-1100,
        to_year=-1001,
        area_km2=47688.2,
        seshat_id="",
        geometry={"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]},
    )
    assert cliopatria_normalise._dedupe_rows([row]) == {}


def test_dedupe_rows_merges_the_british_empire_alias_preferring_the_bare_row(
    cliopatria_normalise,
) -> None:
    """Both raw Names report the same window with genuinely different Area readings (real data,
    README.md "Duplicate aggregate entries and label normalisation") -- after aliasing, the
    existing "prefer the non-parenthesised row" dedupe convention keeps `British Colonial
    Empire`'s own reading and drops `(British Empire)`'s."""
    geometry = {"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]}
    bare = cliopatria_normalise._RawPolityRow(
        name="British Colonial Empire",
        from_year=1709,
        to_year=1712,
        area_km2=227184.71,
        seshat_id="gb_british_emp_1",
        geometry=geometry,
    )
    paren = cliopatria_normalise._RawPolityRow(
        name="(British Empire)",
        from_year=1709,
        to_year=1712,
        area_km2=568662.13,
        seshat_id="gb_british_emp_1",
        geometry=geometry,
    )
    deduped = cliopatria_normalise._dedupe_rows([paren, bare])
    assert deduped.keys() == {("British Colonial Empire", 1709, 1712)}
    assert deduped[("British Colonial Empire", 1709, 1712)].area_km2 == pytest.approx(227184.71)


# ------------------------------------------------------------------------------ domain cutoff


def test_cutoff_t_is_1900ce_against_the_fixed_present(cliopatria_normalise) -> None:
    assert cliopatria_normalise.CUTOFF_CE_YEAR == 1900
    assert cliopatria_normalise.CUTOFF_T == pytest.approx(125.0)


def test_apply_cutoff_keeps_a_window_entirely_before_the_cutoff_unchanged(
    cliopatria_normalise,
) -> None:
    row = cliopatria_normalise._RawPolityRow(
        name="Kingdom of Monaco",
        from_year=1815,
        to_year=1847,
        area_km2=234.95,
        seshat_id="",
        geometry={"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]},
    )
    assert cliopatria_normalise._apply_cutoff(row) == row


def test_apply_cutoff_truncates_a_straddling_window_to_end_at_1900(cliopatria_normalise) -> None:
    row = cliopatria_normalise._RawPolityRow(
        name="Kingdom of Monaco",
        from_year=1848,
        to_year=1935,
        area_km2=94.1,
        seshat_id="",
        geometry={"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]},
    )
    clipped = cliopatria_normalise._apply_cutoff(row)
    assert clipped is not None
    assert clipped.from_year == 1848
    assert clipped.to_year == cliopatria_normalise.CUTOFF_CE_YEAR == 1900


def test_apply_cutoff_drops_a_window_entirely_after_the_cutoff(cliopatria_normalise) -> None:
    row = cliopatria_normalise._RawPolityRow(
        name="Kingdom of Monaco",
        from_year=1936,
        to_year=1938,
        area_km2=47.04,
        seshat_id="",
        geometry={"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]},
    )
    assert cliopatria_normalise._apply_cutoff(row) is None


def test_greek_dark_ages_does_not_appear_in_the_feature_set(feature_set: FeatureSet) -> None:
    assert _features_named(feature_set, "Greek Dark Ages") == []


def test_kingdom_of_monaco_surviving_windows_respect_the_cutoff(feature_set: FeatureSet) -> None:
    """The fixture's real Kingdom of Monaco data carries four windows: (1815,1847) entirely
    before 1900 (kept unchanged), (1848,1935) straddling it (truncated to end at 1900), and
    (1936,1938)/(1939,1939) entirely after it (dropped). Exactly two windows should survive."""
    monaco = _features_named(feature_set, "Kingdom of Monaco")
    assert len(monaco) == 2
    by_t_end = {f.estimates[0].t_end: f for f in monaco}
    assert set(by_t_end) == {2025.0 - 1847, 2025.0 - 1900}
    unchanged = by_t_end[2025.0 - 1847]
    assert unchanged.estimates[0].t == pytest.approx(2025.0 - 1815)
    truncated = by_t_end[2025.0 - 1900]
    assert truncated.estimates[0].t == pytest.approx(2025.0 - 1848)


def test_no_feature_extends_newer_than_the_cutoff(feature_set: FeatureSet) -> None:
    assert min(f.estimates[0].t_end for f in feature_set.features) == pytest.approx(
        125.0
    )  # CUTOFF_T


# --------------------------------------------------------------------------- RasterSequence


def test_raster_frame_times_span_every_window_boundary(raster: RasterSequence) -> None:
    """Frame times: every surviving window's own t_start, plus every t_end not already some
    other window's t_start -- README.md "Rasterisation". Computed by hand from the fixture's
    seven surviving windows (years -> t = 2025 - year): Han Dynasty (-202,-198), (6,13),
    (224,237); Himyarite Kingdom (534,576); Goguryeo (612,616); Kingdom of Monaco (1815,1847)
    and (1848,1900 -- truncated by the cutoff from its real 1935 end). Greek Dark Ages
    contributes no frame at all (excluded), and Monaco's two post-cutoff windows contribute
    none either (dropped)."""
    expected_starts = {2025.0 - y for y in (-202, 6, 224, 534, 612, 1815, 1848)}
    expected_ends = {2025.0 - y for y in (-198, 13, 237, 576, 616, 1847, 1900)}
    expected = expected_starts | expected_ends  # every end already coincides with no start here
    assert {f.t for f in raster.frames} == expected
    assert len(raster.frames) == 14


def test_raster_domain_spans_the_oldest_to_the_newest_frame(
    raster: RasterSequence, cliopatria_normalise
) -> None:
    """The newest frame is the cutoff itself (Monaco's truncated window), not any window's own
    real end -- Greek Dark Ages, which would otherwise be the oldest, is excluded entirely, so
    the oldest surviving frame is Han Dynasty's (-202,-198) window."""
    assert raster.domain == (cliopatria_normalise.CUTOFF_T, 2025.0 - -202)


# ------------------------------------------------------------------------------ render_textures


def test_render_textures_writes_one_texture_per_frame(cliopatria_normalise, tmp_path) -> None:
    cliopatria_normalise.render_textures(fixture_dir("cliopatria"), tmp_path)
    out_dir = tmp_path / "textures" / "cliopatria_extent"
    files = sorted(out_dir.glob("*.webp"))
    assert len(files) == 14
    with Image.open(files[0]) as image:
        assert image.size == cliopatria_normalise.TEXTURE_SIZE
        assert image.mode == "RGB"


def test_render_textures_produces_nonzero_coverage_somewhere(
    cliopatria_normalise, tmp_path
) -> None:
    """A frame drawn while a real polygon is active must have *some* nonzero R pixel -- a
    regression guard against a silently-empty (all-black) rasterisation (wrong pixel mapping,
    an always-degenerate polygon, ...)."""
    cliopatria_normalise.render_textures(fixture_dir("cliopatria"), tmp_path)
    out_dir = tmp_path / "textures" / "cliopatria_extent"
    any_nonzero = False
    for path in out_dir.glob("*.webp"):
        with Image.open(path) as image:
            if np.asarray(image)[:, :, 0].max() > 0:
                any_nonzero = True
                break
    assert any_nonzero


def test_render_textures_clears_stale_files(cliopatria_normalise, tmp_path) -> None:
    out_dir = tmp_path / "textures" / "cliopatria_extent"
    out_dir.mkdir(parents=True)
    stale = out_dir / "t9999.webp"
    stale.write_bytes(b"stale")
    cliopatria_normalise.render_textures(fixture_dir("cliopatria"), tmp_path)
    assert not stale.exists()


# ------------------------------------------------------------------------------------ fetch.py


@pytest.fixture(scope="module")
def cliopatria_fetch():
    return load_source_module("cliopatria", "fetch")


def test_manifest_has_a_real_sha256_and_licence() -> None:
    manifest_path = Path(__file__).resolve().parents[2] / "sources" / "cliopatria" / "manifest.toml"
    with manifest_path.open("rb") as f:
        manifest = tomllib.load(f)
    assert len(manifest["sha256"]) == 64
    assert "CC BY" in manifest["licence"]


def test_extract_geojson_unpacks_the_doubly_nested_zip(cliopatria_fetch, tmp_path) -> None:
    """The real upstream artefact is a zip (the repo snapshot) containing a zip
    (`cliopatria.geojson.zip`) containing the actual `cliopatria.geojson` -- verified against a
    small synthetic double-zip rather than the real 49 MB download."""
    geojson_bytes = b'{"type": "FeatureCollection", "features": []}'
    inner_buffer = io.BytesIO()
    with zipfile.ZipFile(inner_buffer, "w") as inner:
        inner.writestr("cliopatria.geojson", geojson_bytes)

    outer_path = tmp_path / "cliopatria-v0.0.1.zip"
    with zipfile.ZipFile(outer_path, "w") as outer:
        outer.writestr("repo-abc123/LICENSE.md", b"CC BY 4.0")
        outer.writestr("repo-abc123/cliopatria.geojson.zip", inner_buffer.getvalue())

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    cliopatria_fetch._extract_geojson(outer_path, raw_dir)
    assert (raw_dir / "cliopatria.geojson").read_bytes() == geojson_bytes


def test_fetch_touches_no_network_when_everything_is_cached(
    cliopatria_fetch, tmp_path, monkeypatch
) -> None:
    def _boom(*_args, **_kwargs):
        raise AssertionError("fetch() attempted a network download despite a cached file")

    monkeypatch.setattr(cliopatria_fetch, "_download", _boom)
    monkeypatch.setattr(
        cliopatria_fetch,
        "ensure_verified_artefact",
        lambda raw_dir, filename, expected_sha256, download: tmp_path / filename,
    )
    monkeypatch.setattr(cliopatria_fetch, "_extract_geojson", lambda outer_zip_path, raw_dir: None)
    cliopatria_fetch.fetch(tmp_path)  # must not raise -- if it reaches _download(), _boom fires
