"""sources/cliopatria against its committed fixture and fixture roster: twelve real features
exercising the Type filter (a LEADER row), the parenthesis merge (Han Dynasty pairs), the
exclusion list (Greek Dark Ages), the roster filter (Himyarite Kingdom is not on it), the area
floor (Han Dynasty 6-13 CE) and the 1900 CE cutoff (Montenegro).
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from types import ModuleType

import pytest
from shapely.geometry import box

from pipeline.audio import content_hashed_filename
from pipeline.shapes import FeatureSet
from tests.sources.support import fixture_dir, load_source_module

GEOMETRY = {"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]}


@pytest.fixture(scope="module")
def cliopatria_normalise() -> ModuleType:
    return load_source_module("cliopatria", "normalise")


@pytest.fixture(scope="module")
def roster(cliopatria_normalise: ModuleType):
    return cliopatria_normalise.load_roster(fixture_dir("cliopatria") / "roster.toml")


@pytest.fixture(scope="module")
def feature_set(cliopatria_normalise: ModuleType, roster) -> FeatureSet:
    (shape,) = cliopatria_normalise.normalise_with(fixture_dir("cliopatria"), roster)
    assert isinstance(shape, FeatureSet)
    return shape


def test_normalise_keeps_roster_polities_over_half_open_spans_to_the_cutoff(
    feature_set: FeatureSet,
) -> None:
    spans = {f.id: (f.name, f.estimates[0].t, f.estimates[0].t_end) for f in feature_set.features}

    assert feature_set.id == "cliopatria_polities"
    assert spans == {
        "han-dynasty-202bce": ("Han Dynasty", 2025.0 + 202, 2025.0 + 197),
        # 6-13 CE is a 143 km^2 sliver, absent; 224-237 exists only parenthesised.
        "han-dynasty-224ce": ("Han Dynasty", 2025.0 - 224, 2025.0 - 238),
        "goguryeo-612ce": ("Goguryeo", 2025.0 - 612, 2025.0 - 617),
        # Abutting windows share a boundary; 1885-1910 is clipped to end with 1900.
        "montenegro-1880ce": ("Montenegro", 145.0, 140.0),
        "montenegro-1885ce": ("Montenegro", 140.0, 124.0),
    }
    for feature in feature_set.features:
        assert feature.estimates[0].area_km2 is not None


def test_a_roster_anchor_replaces_the_representative_point_as_the_label_anchor(
    feature_set: FeatureSet,
) -> None:
    anchors = {f.id: (f.lat, f.lon) for f in feature_set.features}

    assert anchors["goguryeo-612ce"] == (39.02, 125.75)
    # Without an anchor, the label sits on the territory's representative point.
    assert 18.0 < anchors["han-dynasty-202bce"][0] < 45.0
    assert 95.0 < anchors["han-dynasty-202bce"][1] < 125.0


def test_a_roster_naming_unknown_polities_is_refused_naming_each_one(
    cliopatria_normalise: ModuleType, roster
) -> None:
    lineage = roster.lineages[0]
    bad_members = (
        *lineage.members,
        cliopatria_normalise.RosterMember(polity="Atlantis"),
        cliopatria_normalise.RosterMember(polity="Greek Dark Ages"),
    )
    bad = roster.model_copy(
        update={"lineages": (lineage.model_copy(update={"members": bad_members}),)}
    )

    with pytest.raises(cliopatria_normalise.EmpireRosterError, match="Atlantis, Greek Dark Ages"):
        cliopatria_normalise.normalise_with(fixture_dir("cliopatria"), bad)


def test_a_roster_clamp_trims_a_members_windows(cliopatria_normalise: ModuleType, roster) -> None:
    han = cliopatria_normalise.RosterMember(polity="Han Dynasty", to=230)
    lineage = roster.lineages[0].model_copy(update={"members": (han,)})
    clamped = roster.model_copy(update={"lineages": (lineage,)})

    (shape,) = cliopatria_normalise.normalise_with(fixture_dir("cliopatria"), clamped)

    assert [f.estimates[0].t_end for f in shape.features] == [2025.0 + 197, 2025.0 - 231]


def _window(module: ModuleType, years: tuple[int, int], *, paren: bool, width: float = 10.0):
    return module._Window(
        polity="P",
        from_year=years[0],
        to_year=years[1],
        area_km2=1.0,
        seshat_id="",
        parenthesised=paren,
        geometry=box(0.0, 0.0, width, 10.0),
    )


def test_resolution_prefers_a_bare_window_and_fills_gaps_from_parenthesised_ones(
    cliopatria_normalise: ModuleType,
) -> None:
    paren = _window(cliopatria_normalise, (100, 199), paren=True)
    bare = _window(cliopatria_normalise, (120, 149), paren=False)
    later_paren = _window(cliopatria_normalise, (180, 219), paren=True)

    segments = cliopatria_normalise._resolve_years([paren, bare, later_paren])

    assert [(s.from_year, s.to_year, s.window) for s in segments] == [
        (100, 119, paren),
        (120, 149, bare),
        (150, 179, paren),
        (180, 219, later_paren),
    ]


def test_thinning_merges_small_changes_and_keeps_large_ones_and_gaps(
    cliopatria_normalise: ModuleType,
) -> None:
    segment = cliopatria_normalise._Segment
    base = _window(cliopatria_normalise, (0, 9), paren=False, width=10.0)
    nudged = _window(cliopatria_normalise, (10, 19), paren=False, width=10.5)  # IoU 0.95
    after_gap = _window(cliopatria_normalise, (30, 39), paren=False, width=10.0)
    grown = _window(cliopatria_normalise, (40, 49), paren=False, width=13.0)  # IoU 0.77
    wide = _window(cliopatria_normalise, (50, 59), paren=False, width=90.0)
    # IoU 0.97, but ~370,000 km^2 changes hands.
    wider = _window(cliopatria_normalise, (60, 69), paren=False, width=93.0)
    windows = (base, nudged, after_gap, grown, wide, wider)

    snapshots = cliopatria_normalise._thin([segment(w.from_year, w.to_year, w) for w in windows])

    assert [(s.from_year, s.to_year) for s in snapshots] == [
        (0, 19),
        (30, 39),
        (40, 49),
        (50, 59),
        (60, 69),
    ]
    assert snapshots[0].geometry is base.geometry


def test_write_geometry_writes_one_hashed_file_of_flat_rings_keyed_by_feature_id(
    cliopatria_normalise: ModuleType, roster, feature_set: FeatureSet, tmp_path: Path
) -> None:
    vectors = tmp_path / "vectors"
    vectors.mkdir()
    (vectors / "cliopatria_territories-0123456789.json").write_text("stale")

    path = cliopatria_normalise.write_geometry(fixture_dir("cliopatria"), tmp_path, roster)

    data = path.read_bytes()
    assert list(vectors.iterdir()) == [path]
    assert path.name == content_hashed_filename("cliopatria_territories", "json", data)
    document = json.loads(data)
    assert document["precision"] == 0.01
    assert document["snapshots"].keys() == {f.id for f in feature_set.features}
    for polygons in document["snapshots"].values():
        for rings in polygons:
            for ring in rings:
                assert len(ring) >= 6 and len(ring) % 2 == 0
                assert all(round(v, 2) == v for v in ring)


def test_canonical_name_strips_only_a_wrapping_paren_and_applies_aliases(
    cliopatria_normalise: ModuleType,
) -> None:
    canonical = cliopatria_normalise._canonical_name
    assert canonical("(Han Dynasty)") == "Han Dynasty"
    assert canonical("Kingdom of Naples (Napoleonic)") == "Kingdom of Naples (Napoleonic)"
    assert canonical("(British Empire)") == "British Colonial Empire"


def test_dedupe_prefers_the_bare_row_of_an_aliased_pair(cliopatria_normalise: ModuleType) -> None:
    row = cliopatria_normalise._RawPolityRow
    bare = row("British Colonial Empire", 1709, 1712, 227184.71, "gb_british_emp_1", GEOMETRY)
    paren = row("(British Empire)", 1709, 1712, 568662.13, "gb_british_emp_1", GEOMETRY)

    deduped = cliopatria_normalise._dedupe_rows([paren, bare])

    assert deduped.keys() == {("British Colonial Empire", 1709, 1712)}
    assert deduped[("British Colonial Empire", 1709, 1712)].area_km2 == pytest.approx(227184.71)


def test_extract_geojson_unpacks_the_doubly_nested_zip(tmp_path: Path) -> None:
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

    load_source_module("cliopatria", "fetch")._extract_geojson(outer_path, raw_dir)

    assert (raw_dir / "cliopatria.geojson").read_bytes() == geojson_bytes
