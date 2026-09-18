"""Offline validator for sources/hyde, run against the committed fixture only.

The fixture is real downloaded HYDE 0 CE and 1700 CE cropland/pasture/rangeland grids,
decimated 40:1 in both axes (real sampled values, not synthetic) down to 108x54 -- see
sources/hyde/fixture/ and README.md "Fixture". Network access (`fetch.py`'s `_rangezip`-based
selective extraction) is never exercised here -- these tests only cover
`normalise()`/`render_textures()` against the already-extracted fixture files, the same split
sources/paleodem's own offline suite uses.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline.density_encoding import POPULATION_DENSITY_D_MAX, encode_log_density
from pipeline.shapes import CuratedShape, Interpolation, RasterSequence, TimeSeries
from tests.sources.support import fixture_dir, load_source_module


def _write_ascii_grid(
    path: Path,
    values: np.ndarray,
    *,
    xllcorner: float,
    yllcorner: float,
    cellsize: float,
    nodata: float = -9999.0,
) -> None:
    """A synthetic (not fixture-derived) Arcmap ASCII grid, for pixel-level tests that need
    exact control over where a non-zero value sits -- the real fixture's own values are real
    but not convenient to hand-derive an exact expected pixel from."""
    nrows, ncols = values.shape
    with path.open("w") as f:
        f.write(f"ncols         {ncols}\n")
        f.write(f"nrows         {nrows}\n")
        f.write(f"xllcorner     {xllcorner}\n")
        f.write(f"yllcorner     {yllcorner}\n")
        f.write(f"cellsize      {cellsize}\n")
        f.write(f"NODATA_value  {nodata}\n")
        np.savetxt(f, values, fmt="%.6g")


@pytest.fixture(scope="module")
def hyde_normalise():
    return load_source_module("hyde", "normalise")


@pytest.fixture(scope="module")
def normalised_shapes(hyde_normalise) -> list[CuratedShape]:
    shapes = hyde_normalise.normalise(fixture_dir("hyde"))
    assert len(shapes) == 3
    assert sum(isinstance(s, RasterSequence) for s in shapes) == 2
    assert sum(isinstance(s, TimeSeries) for s in shapes) == 1
    return shapes


@pytest.fixture(scope="module")
def raster(normalised_shapes: list[CuratedShape]) -> RasterSequence:
    (shape,) = (s for s in normalised_shapes if s.id == "hyde_cleared_land")
    assert isinstance(shape, RasterSequence)
    return shape


@pytest.fixture(scope="module")
def population_raster(normalised_shapes: list[CuratedShape]) -> RasterSequence:
    (shape,) = (s for s in normalised_shapes if s.id == "hyde_population_density")
    assert isinstance(shape, RasterSequence)
    return shape


@pytest.fixture(scope="module")
def population_series(normalised_shapes: list[CuratedShape]) -> TimeSeries:
    (shape,) = (s for s in normalised_shapes if s.id == "population")
    assert isinstance(shape, TimeSeries)
    return shape


def test_fixture_has_both_timesteps_all_land_use_variables(hyde_normalise) -> None:
    raw_dir = fixture_dir("hyde")
    for tag in ("0AD", "1700AD"):
        for variable in hyde_normalise.LAND_USE_VARIABLES:
            assert (raw_dir / f"{variable}{tag}.asc").is_file()


def test_fixture_has_both_timesteps_population(hyde_normalise) -> None:
    raw_dir = fixture_dir("hyde")
    for tag in ("0AD", "1700AD"):
        assert (raw_dir / f"popc_{tag}.asc").is_file()


def test_shape_id(raster: RasterSequence) -> None:
    assert raster.id == "hyde_cleared_land"


def test_frame_count(raster: RasterSequence) -> None:
    assert len(raster.frames) == 2


def test_frames_are_sorted_by_t(raster: RasterSequence) -> None:
    ts = [f.t for f in raster.frames]
    assert ts == sorted(ts)


@pytest.mark.parametrize(
    ("tag", "expected_t"),
    [
        ("0AD", 2025.0),
        ("1700AD", 325.0),
        ("2015AD", 10.0),
        ("1000BC", 3025.0),
        ("10000BC", 12025.0),
    ],
)
def test_tag_to_t(hyde_normalise, tag: str, expected_t: float) -> None:
    assert hyde_normalise._tag_to_t(tag) == expected_t


def test_normalise_raises_when_a_timestep_is_missing_one_variable(hyde_normalise, tmp_path) -> None:
    for variable in hyde_normalise.LAND_USE_VARIABLES:
        (tmp_path / f"{variable}0AD.asc").write_bytes(b"")
    for variable in hyde_normalise.LAND_USE_VARIABLES[:-1]:
        (tmp_path / f"{variable}1700AD.asc").write_bytes(b"")
    # 1700AD is missing hyde_normalise.LAND_USE_VARIABLES[-1] -- 0AD is a complete set of four
    # so the "nothing found at all" branch doesn't fire first, and 1700AD's missing fourth is
    # what's under test. normalise() checks land-use tags before population tags, so this
    # raises before ever looking for popc_*.asc.
    with pytest.raises(ValueError, match="missing at least one of"):
        hyde_normalise.normalise(tmp_path)


def test_normalise_raises_when_population_is_missing(hyde_normalise, tmp_path) -> None:
    for variable in hyde_normalise.LAND_USE_VARIABLES:
        (tmp_path / f"{variable}0AD.asc").write_bytes(b"")
    # every land-use variable present, but no popc_0AD.asc at all
    with pytest.raises(ValueError, match="no popc_\\*\\.asc files found"):
        hyde_normalise.normalise(tmp_path)


def test_normalise_raises_when_nothing_found(hyde_normalise, tmp_path) -> None:
    with pytest.raises(ValueError, match="no .*\\.asc triples found"):
        hyde_normalise.normalise(tmp_path)


def test_frame_refs_are_well_formed(raster: RasterSequence) -> None:
    refs = {f.t: f.ref for f in raster.frames}
    assert refs[2025.0] == "textures/hyde_cleared_land/0AD.webp"
    assert refs[325.0] == "textures/hyde_cleared_land/1700AD.webp"


# ------------------------------------------------------------- population density (ADR-031 amendment)


def test_population_shape_id(population_raster: RasterSequence) -> None:
    assert population_raster.id == "hyde_population_density"


def test_population_frame_count(population_raster: RasterSequence) -> None:
    assert len(population_raster.frames) == 2


def test_population_frame_refs_are_well_formed(population_raster: RasterSequence) -> None:
    refs = {f.t: f.ref for f in population_raster.frames}
    assert refs[2025.0] == "textures/hyde_population_density/0AD.webp"
    assert refs[325.0] == "textures/hyde_population_density/1700AD.webp"


# ---------------------------------------------------- global population total (ADR-031 amendment)


def test_population_series_id_unit_and_interpolation(population_series: TimeSeries) -> None:
    """Named "population", not "hyde_population_total" -- the plain semantic id
    `WorldModel.at()` already looks up (`pipeline/models.py`)."""
    assert population_series.id == "population"
    assert population_series.unit == "people"
    assert population_series.interpolation == Interpolation.LOG_LINEAR


def test_population_series_has_one_sample_per_fixture_timestep(
    population_series: TimeSeries,
) -> None:
    assert len(population_series.samples) == 2
    assert [s.t for s in population_series.samples] == sorted(
        s.t for s in population_series.samples
    )


def test_population_series_values_are_plain_sums_of_the_full_resolution_grid(
    hyde_normalise, population_series: TimeSeries
) -> None:
    """The fixture is a real, still-full-globe grid (decimated 40:1 by block-summing, README.md
    "Fixture") -- summing it directly reproduces (up to float rounding) the real full-resolution
    world totals README.md's own "Global population total" sanity table reports for these two
    timesteps (232,124,272 at 0 CE; 591,722,989 at 1700 CE): 0 CE ~232.1M, 1700 CE ~591.7M,
    monotonically increasing, and nowhere near a units/scale error (thousands or billions off)."""
    by_t = {s.t: s.value for s in population_series.samples}
    raw_dir = fixture_dir("hyde")
    assert by_t[2025.0] == pytest.approx(
        hyde_normalise._world_population_total(raw_dir, "0AD"), rel=1e-9
    )
    assert by_t[325.0] == pytest.approx(
        hyde_normalise._world_population_total(raw_dir, "1700AD"), rel=1e-9
    )
    assert by_t[2025.0] == pytest.approx(232_124_272, rel=0.01)
    assert by_t[325.0] == pytest.approx(591_722_989, rel=0.01)
    assert by_t[325.0] > by_t[2025.0]  # population grew between 0 CE and 1700 CE


def test_world_population_total_folds_nodata_to_zero_and_clips_negative_noise(
    hyde_normalise, tmp_path
) -> None:
    """-9999 (ocean/undefined) must not count as -9999 people, and the handful of cells with
    small negative rounding noise (README.md) must not count as negative people -- both would
    otherwise silently understate the real total. Two rows (not one): `np.loadtxt` collapses a
    single-row grid to 1-D, which `_parse_ascii_grid` rejects as a header/shape mismatch --
    `test_render_population_frame_encodes_r_channel_only` sidesteps the same quirk the same way."""
    _write_ascii_grid(
        tmp_path / "popc_2000AD.asc",
        np.array([[-9999.0, 0.0, 1000.0, -0.5], [0.0, 0.0, 0.0, 0.0]]),
        xllcorner=-180.0,
        yllcorner=-0.0833334,
        cellsize=0.0833333,
    )
    assert hyde_normalise._world_population_total(tmp_path, "2000AD") == pytest.approx(1000.0)


def test_resize_mean_preserves_total_mass_on_downsample(hyde_normalise) -> None:
    """The decisive check behind `_population_density_grid`'s "sum people / sum area" claim:
    downsampling an 8x8 array of arbitrary values to 2x2 (an exact 4x4-cells-per-output-pixel
    block reduction) and multiplying back by the block size must reproduce the original total
    exactly -- `_resize_mean` returns a *mean* per output pixel, so this is what "no mass
    created or destroyed by resampling" means for a mean-based resize."""
    rng = np.random.default_rng(0)
    values = rng.uniform(0, 1000, size=(8, 8))
    resized = hyde_normalise._resize_mean(values, (2, 2))
    cells_per_output_pixel = (8 * 8) / (2 * 2)
    assert resized.sum() * cells_per_output_pixel == pytest.approx(values.sum(), rel=1e-6)


def test_population_density_grid_is_area_weighted_not_a_mean_of_densities(hyde_normalise) -> None:
    """A synthetic 4-row, 1-column grid spanning the equator to 80N: `_row_cell_area_km2` makes
    the northernmost (poleward) row's area much smaller than the equatorial row's. All the
    population sits in the *equatorial* (largest-area) row; the other three (small-area,
    poleward) rows are empty. Downsampled to one output cell, the area-correct answer (total
    people / total area of the whole footprint) is close to the equatorial row's own density,
    because that row dominates the total area -- whereas a naive unweighted mean of the four
    rows' own independent densities would divide by 4 regardless of how much area each row
    actually represents, understating the true combined density by roughly that same factor."""
    cellsize = 20.0
    grid = hyde_normalise._AsciiGrid(
        values=np.array([[0.0], [0.0], [0.0], [1_000_000.0]]),  # row 3 = southernmost = equator
        ncols=1,
        nrows=4,
        xllcorner=-180.0,
        yllcorner=0.0,  # rows span 0..80 N -- row 3 (0-20N) is the equatorial, largest-area one
        cellsize=cellsize,
        nodata=-9999.0,
    )
    row_area = hyde_normalise._row_cell_area_km2(grid)
    equatorial_area = row_area[3]
    total_area = row_area.sum()
    expected_density = 1_000_000.0 / total_area

    people = grid.values
    area = np.broadcast_to(row_area[:, np.newaxis], people.shape)
    downsampled_people = hyde_normalise._resize_mean(people, (1, 1))
    downsampled_area = hyde_normalise._resize_mean(area, (1, 1))
    density = downsampled_people[0, 0] / downsampled_area[0, 0]

    mean_of_densities = np.mean([0.0, 0.0, 0.0, 1_000_000.0 / equatorial_area])

    assert density == pytest.approx(expected_density, rel=1e-6)
    # the naive mean divides by 4 regardless of how much area each row actually represents,
    # so it understates the area-correct density (real ratio here is ~1.39x) -- a real,
    # decisive discrepancy, not a rounding difference.
    assert density > mean_of_densities * 1.2
    assert density != pytest.approx(mean_of_densities, rel=0.05)


def test_population_density_folds_nodata_to_zero_people(hyde_normalise) -> None:
    grid = hyde_normalise._AsciiGrid(
        values=np.array([[-9999.0, 0.0, 1000.0]]),
        ncols=3,
        nrows=1,
        xllcorner=-180.0,
        yllcorner=-0.0416667,
        cellsize=0.0833333,
        nodata=-9999.0,
    )
    people = np.where(grid.values == grid.nodata, 0.0, grid.values)
    assert people[0, 0] == 0.0
    assert people[0, 1] == 0.0
    assert people[0, 2] == 1000.0


def test_render_population_frame_encodes_r_channel_only(hyde_normalise, tmp_path) -> None:
    """A synthetic 2x4 grid, one very dense cell and the rest empty: R must be non-zero only
    for the dense quarter, and G/B must be exactly 0 everywhere -- a single-channel encoding,
    per README.md "Population density". Small cells (`cellsize=0.5`, near the equator) so
    2,000,000 people in one of them produces a plausible, comfortably-above-zero-byte density
    (a 90-degree cell's own area is so large that even 50,000 people rounds to encoded byte 0)."""
    cellsize = 0.5
    yllcorner = -1.0  # 2 rows span -1..0 degrees -- small, near-equatorial cells
    grid_values = np.zeros((2, 4))
    grid_values[0, 0] = 2_000_000.0  # a very dense cell
    raw_dir = tmp_path
    raw_dir.mkdir(exist_ok=True)
    _write_ascii_grid(
        raw_dir / "popc_2000AD.asc",
        grid_values,
        xllcorner=-180.0,
        yllcorner=yllcorner,
        cellsize=cellsize,
    )

    image = hyde_normalise._render_population_frame(raw_dir, "2000AD")
    arr = np.asarray(image)
    assert arr.shape == (hyde_normalise.TEXTURE_SIZE[1], hyde_normalise.TEXTURE_SIZE[0], 3)
    assert (arr[:, :, 1] == 0).all()
    assert (arr[:, :, 2] == 0).all()
    # row 0 (north half of the 2-row grid) maps to the output's top half; col 0 (of 4) to the
    # output's first quarter of columns -- checking a strict subset of that region is enough.
    dense_area_r = arr[: arr.shape[0] // 4, : arr.shape[1] // 4, 0]
    empty_area_r = arr[arr.shape[0] // 2 :, arr.shape[1] // 2 :, 0]
    assert dense_area_r.max() > 0
    assert (empty_area_r == 0).all()

    grid = hyde_normalise._AsciiGrid(
        values=grid_values,
        ncols=4,
        nrows=2,
        xllcorner=-180.0,
        yllcorner=yllcorner,
        cellsize=cellsize,
        nodata=-9999.0,
    )
    cell_area = hyde_normalise._row_cell_area_km2(grid)[0]
    expected_byte = int(
        encode_log_density(np.array([2_000_000.0 / cell_area]), POPULATION_DENSITY_D_MAX)[0]
    )
    assert dense_area_r.max() == expected_byte


def test_render_textures_writes_population_density_textures(hyde_normalise, tmp_path) -> None:
    hyde_normalise.render_textures(fixture_dir("hyde"), tmp_path)
    out_dir = tmp_path / "textures" / "hyde_population_density"
    for tag in ("0AD", "1700AD"):
        path = out_dir / f"{tag}.webp"
        assert path.is_file()
        with Image.open(path) as image:
            assert image.size == hyde_normalise.TEXTURE_SIZE
            assert image.mode == "RGB"


def test_render_textures_clears_stale_population_files(hyde_normalise, tmp_path) -> None:
    out_dir = tmp_path / "textures" / "hyde_population_density"
    out_dir.mkdir(parents=True)
    stale = out_dir / "9999BC.webp"
    stale.write_bytes(b"stale")
    hyde_normalise.render_textures(fixture_dir("hyde"), tmp_path)
    assert not stale.exists()


def test_row_cell_area_km2_matches_the_equatorial_analytic_value(hyde_normalise) -> None:
    """A 0.0833333 degree cell at the equator: 1 degree of arc on Earth's mean-radius sphere is
    ~111.19 km, so a 5 arcmin square is ~9.27 km per side, ~85.9 km^2 -- matches the real data's
    own observed max cropland value (85.7069 km^2, a near-fully-cropped equatorial cell,
    README.md "Cell area")."""
    grid = hyde_normalise._AsciiGrid(
        values=np.zeros((2160, 4320)),
        ncols=4320,
        nrows=2160,
        xllcorner=-180.0,
        yllcorner=-90.0,
        cellsize=0.0833333,
        nodata=-9999.0,
    )
    row_area = hyde_normalise._row_cell_area_km2(grid)
    equator_row = 1080  # row 0 = north (90 deg); row 1080 sits at the equator
    assert row_area[equator_row] == pytest.approx(85.94, abs=0.1)


def test_row_cell_area_km2_uses_the_header_not_a_hardcoded_pole(hyde_normalise) -> None:
    """A non-global, offset grid (a regional window, not the real full-globe HYDE extent):
    yllcorner=10, nrows=5, cellsize=1 degree -> north edge at 10 + 5*1 = 15 degrees, NOT at 90.
    Regression test for the bug where `_row_cell_area_km2` hardcoded row 0's top edge to 90
    degrees regardless of `yllcorner`/`nrows` -- for this grid that would silently compute row
    0's area as if it sat at the pole (10-11 degrees, tiny) rather than at 14-15 degrees (its
    real band, much larger)."""
    grid = hyde_normalise._AsciiGrid(
        values=np.zeros((5, 3)),
        ncols=3,
        nrows=5,
        xllcorner=0.0,
        yllcorner=10.0,
        cellsize=1.0,
        nodata=-9999.0,
    )
    row_area = hyde_normalise._row_cell_area_km2(grid)

    def _band_area(lat_top: float, lat_bottom: float) -> float:
        return (
            hyde_normalise.EARTH_MEAN_RADIUS_KM**2
            * np.deg2rad(1.0)
            * (np.sin(np.deg2rad(lat_top)) - np.sin(np.deg2rad(lat_bottom)))
        )

    # row 0 = north edge of the grid = 15 deg (NOT 90); row 4 = south edge = 10 deg
    assert row_area[0] == pytest.approx(_band_area(15.0, 14.0))
    assert row_area[4] == pytest.approx(_band_area(11.0, 10.0))
    # a grid this far from the pole is nowhere near where the old (buggy) hardcoded-90-degree
    # computation would have placed it -- a decisive regression guard, not just a formula check
    assert row_area[0] != pytest.approx(_band_area(90.0, 89.0))


def test_fraction_grid_round_trips_a_known_fraction(hyde_normalise) -> None:
    """A single equatorial cell whose km^2 value is exactly half its own analytic cell area
    must come back as fraction 0.5, precisely -- not merely "some plausible fraction"."""
    cellsize = 1.0
    full_area = (
        hyde_normalise.EARTH_MEAN_RADIUS_KM**2
        * np.deg2rad(cellsize)
        * (np.sin(np.deg2rad(cellsize)) - np.sin(np.deg2rad(0.0)))
    )
    grid = hyde_normalise._AsciiGrid(
        values=np.array([[full_area / 2.0]]),
        ncols=1,
        nrows=1,
        xllcorner=0.0,
        yllcorner=0.0,
        cellsize=cellsize,
        nodata=-9999.0,
    )
    fraction = hyde_normalise._fraction_grid(grid)
    assert fraction[0, 0] == pytest.approx(0.5, rel=1e-9)


def test_fraction_grid_folds_nodata_and_zero_alike_to_zero(hyde_normalise) -> None:
    grid = hyde_normalise._AsciiGrid(
        values=np.array([[-9999.0, 0.0, 40.0]]),
        ncols=3,
        nrows=1,
        xllcorner=-180.0,
        yllcorner=-0.0416667,
        cellsize=0.0833333,
        nodata=-9999.0,
    )
    fraction = hyde_normalise._fraction_grid(grid)
    assert fraction[0, 0] == 0.0
    assert fraction[0, 1] == 0.0
    assert 0.0 < fraction[0, 2] <= 1.0


def test_fraction_grid_clips_to_one(hyde_normalise) -> None:
    grid = hyde_normalise._AsciiGrid(
        values=np.array([[1_000_000.0]]),  # far more than any real cell's own area
        ncols=1,
        nrows=1,
        xllcorner=-180.0,
        yllcorner=-0.0416667,
        cellsize=0.0833333,
        nodata=-9999.0,
    )
    fraction = hyde_normalise._fraction_grid(grid)
    assert fraction[0, 0] == 1.0


def test_render_frame_channel_mapping_orientation_and_g_sums_pasture_and_conv_rangeland(
    hyde_normalise, tmp_path
) -> None:
    """A synthetic 2x4 global grid (row 0 = north half, row 1 = south half; four 90-degree-wide
    longitude columns), each of its 8 cells holding a distinct, mutually exclusive combination
    of the four raw variables -- so a channel mix-up, a north/south flip, or G *not* summing
    `pasture` and `conv_rangeland` would each change which cell reads non-zero in which channel,
    or by how much:

    - (0, 0) cropland alone (half value)            -> tests R
    - (0, 1) pasture=quarter + conv_rangeland=quarter -> tests G *sums* the two (quarter+quarter
      renders the same byte as one variable alone at half value, at (0, 3) below -- if G only
      read one of the two, this cell would render at roughly half that brightness instead)
    - (0, 3) rangeland alone (half value)            -> tests B, and doubles as the "one full
      contribution" reference brightness for the summed cell above
    - (1, 0) nothing                                  -> orientation control, must read exactly
      zero (a north/south flip would move one of the above values here instead)

    Every non-empty *total* per cell is exactly half a cell's own area, so every non-zero
    channel byte should land near 127-128 regardless of hemisphere or how many raw variables
    contributed to it.
    """
    cellsize = 90.0
    xllcorner, yllcorner = -180.0, -90.0
    north_half_area = (
        hyde_normalise.EARTH_MEAN_RADIUS_KM**2
        * np.deg2rad(cellsize)
        * (np.sin(np.deg2rad(90.0)) - np.sin(np.deg2rad(0.0)))
    )
    half_value = north_half_area / 2.0
    quarter_value = north_half_area / 4.0

    cropland = np.zeros((2, 4))
    cropland[0, 0] = half_value  # (0, 0): cropland alone
    pasture = np.zeros((2, 4))
    pasture[0, 1] = quarter_value  # (0, 1): half of the summed-G cell
    conv_rangeland = np.zeros((2, 4))
    conv_rangeland[0, 1] = quarter_value  # (0, 1): the other half of the summed-G cell
    rangeland = np.zeros((2, 4))
    rangeland[0, 3] = half_value  # (0, 3): rangeland alone

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    for variable, grid in (
        ("cropland", cropland),
        ("pasture", pasture),
        ("conv_rangeland", conv_rangeland),
        ("rangeland", rangeland),
    ):
        _write_ascii_grid(
            raw_dir / f"{variable}2000AD.asc",
            grid,
            xllcorner=xllcorner,
            yllcorner=yllcorner,
            cellsize=cellsize,
        )

    image = hyde_normalise._render_frame(raw_dir, "2000AD")
    width, height = image.size

    def _cell_pixel(row: int, col: int) -> tuple[int, int, int]:
        x = int((col + 0.5) / 4 * width)
        y = int((row + 0.5) / 2 * height)
        return image.getpixel((x, y))

    cropland_cell = _cell_pixel(0, 0)
    summed_g_cell = _cell_pixel(0, 1)
    rangeland_cell = _cell_pixel(0, 3)
    empty_cell = _cell_pixel(1, 0)

    # channel mapping: R = cropland, B = rangeland
    assert cropland_cell == (pytest.approx(128, abs=5), 0, 0)
    assert rangeland_cell == (0, 0, pytest.approx(128, abs=5))

    # G *sums* pasture + conv_rangeland: two quarter-value contributions render the same
    # brightness as one half-value contribution (the rangeland_cell's own B byte, above) --
    # not half that brightness, which is what a "last write wins" or "only reads pasture" bug
    # would produce instead.
    assert summed_g_cell[1] == pytest.approx(rangeland_cell[2], abs=5)
    assert summed_g_cell[0] == 0
    assert summed_g_cell[2] == 0

    # north-up orientation: a cell with nothing in any of the four grids must read exactly
    # zero -- if the grid were rendered upside down or column-shifted, one of the values above
    # would land here instead.
    assert empty_cell == (0, 0, 0)


def test_render_textures_writes_one_lossless_webp_per_frame(hyde_normalise, tmp_path) -> None:
    hyde_normalise.render_textures(fixture_dir("hyde"), tmp_path)
    out_dir = tmp_path / "textures" / "hyde_cleared_land"
    for tag in ("0AD", "1700AD"):
        path = out_dir / f"{tag}.webp"
        assert path.is_file()
        with Image.open(path) as image:
            assert image.size == hyde_normalise.TEXTURE_SIZE
            assert image.mode == "RGB"


def test_render_textures_clears_stale_files(hyde_normalise, tmp_path) -> None:
    out_dir = tmp_path / "textures" / "hyde_cleared_land"
    out_dir.mkdir(parents=True)
    stale = out_dir / "9999BC.webp"
    stale.write_bytes(b"stale")
    hyde_normalise.render_textures(fixture_dir("hyde"), tmp_path)
    assert not stale.exists()
