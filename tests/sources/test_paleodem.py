"""Offline validator for sources/paleodem, run against the committed fixture only.

The fixture is a real, deliberately sparse slice: just the 0 Ma and 540 Ma (oldest) grids,
re-encoded to compact int16 netCDF (see sources/paleodem/fixture/ and README.md "Fixture").
normalise() emits one frame per raw epoch, so the fixture yields a 2-frame RasterSequence by
the same code path the real build uses for all 109.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from pathlib import Path

import httpx
import numpy as np
import pytest
import xarray as xr
from PIL import Image

from pipeline.fetching import FetchIntegrityError
from pipeline.shapes import Interpolation, RasterSequence, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

EXPECTED_LAT_SIZE = 181
EXPECTED_LON_SIZE = 361

# The real Earth's cos(latitude)-area-weighted land fraction is often quoted as ~29% (a
# per-unit-longitude grid-cell count, not area-weighted, happens to land almost exactly on
# that figure). The *area-weighted* value measured directly off this dataset's own 0 Ma
# grid (verified while building this package, not assumed) is ~0.275 -- lower, because
# area-weighting discounts high-latitude land (much of Antarctica, northern Eurasia/Canada)
# relative to a flat per-cell count. 0.03 covers that real gap between the two conventions
# without being wide enough to pass a badly broken weighting (e.g. an unweighted count,
# which would land at ~0.29 -- inside this tolerance too, so this test pins the *value*,
# not just "some weighting was applied") or a sign error (which would give ~0.72).
LAND_FRACTION_0MA_EXPECTED = 0.29
LAND_FRACTION_TOLERANCE = 0.03


@pytest.fixture(scope="module")
def paleodem_shapes() -> tuple[RasterSequence, TimeSeries]:
    normalise = load_source_module("paleodem", "normalise")
    shapes = normalise.normalise(fixture_dir("paleodem"))
    assert len(shapes) == 2
    raster, series = shapes
    assert isinstance(raster, RasterSequence)
    assert isinstance(series, TimeSeries)
    return raster, series


@pytest.fixture(scope="module")
def paleodem_normalise():
    return load_source_module("paleodem", "normalise")


def test_fixture_grids_are_181x361(paleodem_normalise) -> None:
    """CONFIRM (docs/DATA_SOURCES.md's VERIFY item): dims are lat 181 x lon 361."""
    for path in sorted(fixture_dir("paleodem").glob("*.nc")):
        with xr.open_dataset(path) as ds:
            assert ds.sizes["lat"] == EXPECTED_LAT_SIZE
            assert ds.sizes["lon"] == EXPECTED_LON_SIZE
            assert "z" in ds.variables


def test_shape_ids_and_metadata(paleodem_shapes) -> None:
    raster, series = paleodem_shapes
    assert raster.id == "paleodem"
    assert series.id == "land_fraction"
    assert series.unit == "fraction"
    assert series.interpolation == Interpolation.LINEAR


def test_frames_are_sorted_by_t(paleodem_shapes) -> None:
    raster, _ = paleodem_shapes
    ts = [f.t for f in raster.frames]
    assert ts == sorted(ts)


def test_frame_refs_are_well_formed(paleodem_shapes) -> None:
    """Every ref is a relative `textures/paleodem/<NNN.N>Ma.webp` path -- resolved against the
    manifest's assetBase at runtime, never absolute or reaching outside its own subtree."""
    raster, _ = paleodem_shapes
    assert [frame.ref for frame in raster.frames] == [
        "textures/paleodem/000.0Ma.webp",
        "textures/paleodem/540.0Ma.webp",
    ]


def test_frame_ref_keeps_the_real_age_of_off_grid_boundary_epochs(paleodem_normalise) -> None:
    """385.2 and 390.5 Ma are real epochs in the full archive; rounding them to 385/390 would
    name a texture after an age that doesn't exist."""
    assert paleodem_normalise._frame_ref(385.2) == "textures/paleodem/385.2Ma.webp"
    assert paleodem_normalise._frame_ref(5.0) == "textures/paleodem/005.0Ma.webp"


def test_one_frame_per_raw_epoch(paleodem_shapes) -> None:
    """No frame may claim an age the raw grids don't contain, and none may be skipped."""
    raster, _ = paleodem_shapes
    assert [f.t for f in raster.frames] == [0.0, 540.0 * 1e6]


def test_land_fraction_has_one_sample_per_raw_file(paleodem_shapes) -> None:
    _, series = paleodem_shapes
    raw_file_count = len(list(fixture_dir("paleodem").glob("*.nc")))
    assert len(series.samples) == raw_file_count


def test_render_textures_writes_one_webp_per_epoch_and_removes_stale_files(
    paleodem_normalise, tmp_path
) -> None:
    out_dir = tmp_path / "textures" / "paleodem"
    out_dir.mkdir(parents=True)
    (out_dir / "000Ma.png").write_bytes(b"texture from an older naming scheme")

    paleodem_normalise.render_textures(fixture_dir("paleodem"), tmp_path)

    assert sorted(p.name for p in out_dir.iterdir()) == ["000.0Ma.webp", "540.0Ma.webp"]
    for path in out_dir.iterdir():
        with Image.open(path) as image:
            assert (image.format, image.mode, image.size) == ("WEBP", "RGB", (1024, 512))


def test_render_textures_names_match_frame_refs(
    paleodem_normalise, paleodem_shapes, tmp_path
) -> None:
    raster, _ = paleodem_shapes
    paleodem_normalise.render_textures(fixture_dir("paleodem"), tmp_path)
    for frame in raster.frames:
        assert (tmp_path / frame.ref).is_file()
    assert all(re.fullmatch(r"textures/paleodem/\d{3}\.\dMa\.webp", f.ref) for f in raster.frames)


def test_land_fraction_at_0ma_is_approximately_point_29(paleodem_shapes) -> None:
    _, series = paleodem_shapes
    value = series.sample(0.0)
    assert value is not None
    assert value == pytest.approx(LAND_FRACTION_0MA_EXPECTED, abs=LAND_FRACTION_TOLERANCE)


def test_land_fraction_is_a_fraction_at_every_sample(paleodem_shapes) -> None:
    _, series = paleodem_shapes
    for sample in series.samples:
        assert 0.0 <= sample.value <= 1.0


def test_land_fraction_at_540ma_differs_from_0ma(paleodem_shapes) -> None:
    """Sanity guard against a bug that returns the same (e.g. always-0-Ma) grid regardless
    of which file was opened -- Pangaea-adjacent 540 Ma geography is not identical to
    today's, so the two land fractions must differ."""
    _, series = paleodem_shapes
    v0 = series.sample(0.0)
    v540 = series.sample(540.0 * 1e6)
    assert v0 is not None
    assert v540 is not None
    assert v0 != pytest.approx(v540, abs=1e-9)


def test_domain_reaches_540ma(paleodem_shapes) -> None:
    raster, series = paleodem_shapes
    assert raster.domain == (0.0, 540.0 * 1e6)
    assert series.domain == (0.0, 540.0 * 1e6)


# --------------------------------------------------------------------------- colour map


def test_colour_map_maps_sea_and_land_to_distinct_colours(paleodem_normalise) -> None:
    sea = paleodem_normalise.elevation_to_rgb(np.array([-4000.0]))[0]
    land = paleodem_normalise.elevation_to_rgb(np.array([2000.0]))[0]
    assert tuple(sea) != tuple(land)
    # blue channel should dominate at depth, and not dominate on land -- the map should
    # read as "sea" and "land", not just "two arbitrary different colours"
    assert sea[2] > sea[1]  # sea: blue > green
    assert land[1] >= land[2]  # land: green/brown, not blue-dominant


def test_colour_map_is_deterministic(paleodem_normalise) -> None:
    z = np.array([-8000.0, -100.0, 0.0, 1.0, 500.0, 9000.0])
    first = paleodem_normalise.elevation_to_rgb(z)
    second = paleodem_normalise.elevation_to_rgb(z)
    assert np.array_equal(first, second)


def test_colour_map_output_is_uint8_rgb_shaped(paleodem_normalise) -> None:
    z = np.zeros((4, 5))
    rgb = paleodem_normalise.elevation_to_rgb(z)
    assert rgb.shape == (4, 5, 3)
    assert rgb.dtype == np.uint8


def test_colour_map_is_continuous_across_the_land_sea_boundary_within_each_side(
    paleodem_normalise,
) -> None:
    """Neighbouring elevations just below vs. just above 0 differ by the deliberate sea/land
    jump (this is the point of the contrast), but two elevations *on the same side* close
    together should be close in colour -- otherwise the hypsometric ramp isn't actually a
    ramp."""
    close_sea = paleodem_normalise.elevation_to_rgb(np.array([-100.0, -101.0])).astype(int)
    assert np.abs(close_sea[0] - close_sea[1]).max() <= 2
    close_land = paleodem_normalise.elevation_to_rgb(np.array([500.0, 501.0])).astype(int)
    assert np.abs(close_land[0] - close_land[1]).max() <= 2


def test_colour_map_extreme_values_are_clamped_not_erroring(paleodem_normalise) -> None:
    z = np.array([-50000.0, 50000.0])
    rgb = paleodem_normalise.elevation_to_rgb(z)
    assert rgb.shape == (2, 3)
    assert (rgb >= 0).all() and (rgb <= 255).all()


# ----------------------------------------------------------------------------------- fetch
#
# fetch()'s own manifest.toml is swapped for a tmp_path fixture the test controls, and only
# the HTTP layer -- httpx.get, the single call `_download` makes -- is faked. Everything
# else (ensure_verified_artefact's reuse/verify logic and the zip extraction) runs for real.


def _write_manifest(path: Path, *, url: str, sha256: str) -> None:
    path.write_text(
        f'name = "paleodem"\nurl = "{url}"\nsha256 = "{sha256}"\n'
        'licence = "test"\ncitation = "test"\ntime_domain = [0, 0]\n'
        'output_shape = "RasterSequence + TimeSeries"\ninterpolation = "linear"\n'
        'volume_bytes = 0\nstorage_tier = "git"\n'
    )


def _make_zip(*, nc_name: str = "Map01_PALEOMAP_1deg_Holocene_0Ma.nc") -> bytes:
    """A minimal zip with one `.nc` member (content is arbitrary -- fetch()/`_extract_grids`
    only filters by extension, it never parses netCDF) and one non-`.nc` member that must be
    dropped by extraction, mirroring the real archive's `License.txt`."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(f"Scotese_Wright_2018_v2/{nc_name}", b"fake netcdf bytes")
        archive.writestr("Scotese_Wright_2018_v2/License.txt", b"licence text")
    return buffer.getvalue()


@pytest.fixture
def fetch_module(tmp_path, monkeypatch):
    module = load_source_module("paleodem", "fetch")
    monkeypatch.setattr(module, "_MANIFEST", tmp_path / "manifest.toml")
    return module


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_reuses_an_already_verified_zip_without_calling_httpx_get_and_still_extracts(
    fetch_module, tmp_path, monkeypatch
) -> None:
    zip_bytes = _make_zip()
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/paleodem.zip",
        sha256=hashlib.sha256(zip_bytes).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / fetch_module._ZIP_FILENAME).write_bytes(zip_bytes)

    def _must_not_be_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.get must not be called when the cached zip already verifies")

    monkeypatch.setattr(httpx, "get", _must_not_be_called)

    fetch_module.fetch(raw_dir)

    assert (raw_dir / fetch_module._ZIP_FILENAME).read_bytes() == zip_bytes
    assert (raw_dir / "Map01_PALEOMAP_1deg_Holocene_0Ma.nc").is_file()
    assert not (raw_dir / "License.txt").exists()


def test_fetch_downloads_the_zip_and_extracts_only_nc_members_when_none_is_cached(
    fetch_module, tmp_path, monkeypatch
) -> None:
    zip_bytes = _make_zip()
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/paleodem.zip",
        sha256=hashlib.sha256(zip_bytes).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    calls = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse(zip_bytes)

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(raw_dir)

    assert calls == ["https://example.invalid/paleodem.zip"]
    assert (raw_dir / fetch_module._ZIP_FILENAME).read_bytes() == zip_bytes
    assert (raw_dir / "Map01_PALEOMAP_1deg_Holocene_0Ma.nc").is_file()
    assert not (raw_dir / "License.txt").exists()


def test_fetch_raises_and_writes_nothing_on_a_sha256_mismatch(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_manifest(
        tmp_path / "manifest.toml", url="https://example.invalid/paleodem.zip", sha256="0" * 64
    )
    raw_dir = tmp_path / "raw"
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(b"corrupt"))

    with pytest.raises(FetchIntegrityError):
        fetch_module.fetch(raw_dir)

    assert not (raw_dir / fetch_module._ZIP_FILENAME).exists()
