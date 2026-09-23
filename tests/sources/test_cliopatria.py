"""sources/cliopatria against its committed fixture: thirteen real features chosen to exercise
the Type filter (a LEADER row), the parenthesis-merge dedupe (Han Dynasty pairs), the non-polity
exclusion list (Greek Dark Ages) and every case of the 1900 CE cutoff (Kingdom of Monaco).
Every surviving window lands in its own 100-year bucket, so the subset rule passes them all;
test_cliopatria_subset.py covers its ranking.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline.shapes import FeatureSet, RasterSequence
from tests.sources.support import fixture_dir, load_source_module

GEOMETRY = {"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]}


@pytest.fixture(scope="module")
def cliopatria_normalise():
    return load_source_module("cliopatria", "normalise")


@pytest.fixture(scope="module")
def shapes(cliopatria_normalise) -> tuple[RasterSequence, FeatureSet]:
    raster, feature_set = sorted(
        cliopatria_normalise.normalise(fixture_dir("cliopatria")),
        key=lambda s: not isinstance(s, RasterSequence),
    )
    assert isinstance(raster, RasterSequence) and isinstance(feature_set, FeatureSet)
    return raster, feature_set


def test_normalise_filters_dedupes_excludes_and_cuts_off_the_fixture(shapes) -> None:
    raster, feature_set = shapes

    assert (raster.id, feature_set.id) == ("cliopatria_extent", "cliopatria_polities")
    names = [f.name for f in feature_set.features]
    assert sorted(names) == sorted(
        ["Han Dynasty"] * 3 + ["Himyarite Kingdom", "Goguryeo"] + ["Kingdom of Monaco"] * 2
    )
    for feature in feature_set.features:
        (estimate,) = feature.estimates
        assert estimate.population is None and estimate.area_km2 is not None
    monaco = {
        (f.estimates[0].t, f.estimates[0].t_end)
        for f in feature_set.features
        if f.name == "Kingdom of Monaco"
    }
    assert monaco == {(2025.0 - 1815, 2025.0 - 1847), (2025.0 - 1848, 2025.0 - 1900)}


def test_raster_has_a_frame_at_every_surviving_window_boundary(
    shapes, cliopatria_normalise
) -> None:
    raster, _ = shapes

    assert len(raster.frames) == 14
    assert raster.domain == (cliopatria_normalise.CUTOFF_T, 2025.0 + 202)


def test_canonical_name_strips_only_a_wrapping_paren_and_applies_aliases(
    cliopatria_normalise,
) -> None:
    canonical = cliopatria_normalise._canonical_name
    assert canonical("(Han Dynasty)") == "Han Dynasty"
    assert canonical("Kingdom of Naples (Napoleonic)") == "Kingdom of Naples (Napoleonic)"
    assert canonical("(British Empire)") == "British Colonial Empire"


def test_dedupe_prefers_the_bare_row_of_an_aliased_pair(cliopatria_normalise) -> None:
    row = cliopatria_normalise._RawPolityRow
    bare = row("British Colonial Empire", 1709, 1712, 227184.71, "gb_british_emp_1", GEOMETRY)
    paren = row("(British Empire)", 1709, 1712, 568662.13, "gb_british_emp_1", GEOMETRY)

    deduped = cliopatria_normalise._dedupe_rows([paren, bare])

    assert deduped.keys() == {("British Colonial Empire", 1709, 1712)}
    assert deduped[("British Colonial Empire", 1709, 1712)].area_km2 == pytest.approx(227184.71)


def test_render_textures_draws_one_texture_per_frame_and_clears_stale_files(
    cliopatria_normalise, tmp_path: Path
) -> None:
    out_dir = tmp_path / "textures" / "cliopatria_extent"
    out_dir.mkdir(parents=True)
    (out_dir / "t9999.webp").write_bytes(b"stale")

    cliopatria_normalise.render_textures(fixture_dir("cliopatria"), tmp_path)

    files = sorted(out_dir.glob("*.webp"))
    assert len(files) == 14
    coverage = []
    for path in files:
        with Image.open(path) as image:
            assert image.size == cliopatria_normalise.TEXTURE_SIZE
            coverage.append(np.asarray(image)[:, :, 0].max())
    assert max(coverage) > 0


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
