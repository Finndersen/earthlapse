"""sources/hyde against its committed fixture: real HYDE 0 CE and 1700 CE grids, block-summed
40:1 down to 108x54. Synthetic ASCII grids cover the pixel-level encoding checks."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline.density_encoding import POPULATION_DENSITY_D_MAX, encode_log_density
from pipeline.shapes import Interpolation, RasterSequence, TimeSeries
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


def test_normalise_emits_cleared_land_population_density_and_a_log_linear_total(
    hyde_normalise,
) -> None:
    shapes = {s.id: s for s in hyde_normalise.normalise(fixture_dir("hyde"))}

    assert shapes.keys() == {"hyde_cleared_land", "hyde_population_density", "population"}
    for raster_id in ("hyde_cleared_land", "hyde_population_density"):
        raster = shapes[raster_id]
        assert isinstance(raster, RasterSequence)
        assert {f.t: f.ref for f in raster.frames} == {
            2025.0: f"textures/{raster_id}/0AD.webp",
            325.0: f"textures/{raster_id}/1700AD.webp",
        }
    population = shapes["population"]
    assert isinstance(population, TimeSeries)
    assert (population.unit, population.interpolation) == ("people", Interpolation.LOG_LINEAR)
    # The fixture is block-summed, so its totals are the real full-resolution world totals.
    assert {s.t: s.value for s in population.samples} == {
        2025.0: pytest.approx(232_124_272, rel=0.01),
        325.0: pytest.approx(591_722_989, rel=0.01),
    }


def test_timestep_tags_count_back_from_the_2025_present(hyde_normalise) -> None:
    assert hyde_normalise._tag_to_t("2015AD") == 10.0
    assert hyde_normalise._tag_to_t("10000BC") == 12025.0


def test_normalise_raises_when_a_timestep_is_missing_one_variable(
    hyde_normalise, tmp_path: Path
) -> None:
    for variable in hyde_normalise.LAND_USE_VARIABLES:
        (tmp_path / f"{variable}0AD.asc").write_bytes(b"")
    for variable in hyde_normalise.LAND_USE_VARIABLES[:-1]:
        (tmp_path / f"{variable}1700AD.asc").write_bytes(b"")

    with pytest.raises(ValueError, match="missing at least one of"):
        hyde_normalise.normalise(tmp_path)


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


def test_render_textures_writes_both_texture_sets_and_clears_stale_files(
    hyde_normalise, tmp_path: Path
) -> None:
    for name in ("hyde_population_density", "hyde_cleared_land"):
        stale_dir = tmp_path / "textures" / name
        stale_dir.mkdir(parents=True)
        (stale_dir / "9999BC.webp").write_bytes(b"stale")

    hyde_normalise.render_textures(fixture_dir("hyde"), tmp_path)

    for name in ("hyde_population_density", "hyde_cleared_land"):
        out_dir = tmp_path / "textures" / name
        assert sorted(p.name for p in out_dir.iterdir()) == ["0AD.webp", "1700AD.webp"]
        with Image.open(out_dir / "0AD.webp") as image:
            assert (image.size, image.mode) == (hyde_normalise.TEXTURE_SIZE, "RGB")


def test_row_cell_area_km2_uses_the_header_not_a_hardcoded_pole(hyde_normalise) -> None:
    """A regional grid (yllcorner=10, nrows=5, 1 degree cells) has its north edge at 15 degrees,
    so row 0 is the 14-15 degree band, not a polar one."""
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

    assert row_area[0] == pytest.approx(_band_area(15.0, 14.0))
    assert row_area[4] == pytest.approx(_band_area(11.0, 10.0))
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
