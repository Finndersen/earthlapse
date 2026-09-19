"""Normalise data/raw/hyde/ into two curated `RasterSequence`s, one frame per real HYDE
timestep each (73, 10000 BCE - 2015 CE — README.md "Coverage"), plus one derived `TimeSeries`:

- `hyde_cleared_land.parquet` -- cropland/pasture/rangeland.
- `hyde_population_density.parquet` (ADR-031).
- `population.parquet` (ADR-031): the world total at each of the same 73 timesteps, a plain sum
  of the full-resolution `popc` grid (people per cell, so a sum over every valid cell *is* the
  world total -- no area weighting, unlike the density raster above). Named "population", not
  "hyde_population_total", to slot directly into `WorldModel.at()`'s existing
  `self._s("population", t)` lookup (`pipeline/models.py`) and `HumanState.population` -- the
  same "derived TimeSeries takes the plain semantic name, not a source-prefixed one" convention
  `sources/paleodem`'s own `land_fraction` already set.

Each cleared-land frame's texture encodes three fraction values in one RGB image (README.md
"Encoding"): **R = cropland fraction**, **G = (pasture + converted-rangeland) fraction**, **B =
(natural) rangeland fraction** — computed from four of HYDE's per-cell km² grids, each
converted to a fraction of the cell's true (not constant-area) surface area, computed
analytically from latitude (README.md "Cell area") — not from HYDE's own supplementary
`garea_cr.asc` grid, which this source deliberately never fetches (README.md "Why no General
files"). The three channels are `cropland`, `pasture` + `conv_rangeland`, and `rangeland` alone
(not HYDE's own `grazing` aggregate, which lumps all three together and would paint natural
rangeland the same mustard as cleared cropland) -- full account, including why
`conv_rangeland` joins the cleared channel rather than the natural one, in README.md "Which HYDE
variable is 'pasture'" and fetch.py's `LAND_USE_VARIABLES`. G sums `pasture` and
`conv_rangeland` clipped to 1 after summing, since each is independently clipped-then-summed
floats can exceed 1 at a coastal/rounding-edge cell.

Each population-density frame's texture encodes one 8-bit log-scale channel (README.md
"Population density encoding", `pipeline.density_encoding`): **R = encode_log_density(people
per km², D_MAX)**, G = B = 0. People per km² is computed from `popc` (population *count* per
cell, README.md "Schema") divided by the same analytically-computed true cell area the
cleared-land channels use, then downsampled to `TEXTURE_SIZE` *area-correctly* -- total people
divided by total area per output pixel's footprint, not a mean of already-computed per-cell
densities, which would silently under-weight the handful of small-area cells that hold most of
a dense city's population (README.md "Population density: why area-weighted, not a mean of
densities" has the full worked example).

TRAP -- HYDE's own `NODATA_value` (-9999) marks **ocean/undefined cells only, not "nothing
here"** (CONFIRMED by inspecting real data: a mid-Pacific cell reads exactly -9999, while many
real land cells legitimately read exactly 0, for both land-use and population grids). Folded to
0 (cropland/pasture/rangeland fraction, or population count) here (ADR-031: "pre-bake
ocean/no-data as 0"), so downstream code never needs to special-case either.

**World total sanity check** (README.md "Global population total" has the full table):
10,000 BCE ~4.4M, 1 CE ~232M, 1800 CE ~1.0B, 1900 CE ~1.6B, 2000 CE ~6.1B, 2015 CE ~7.3B --
monotonically increasing, matching published HYDE/UN order-of-magnitude figures at every
checkpoint.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.curated import write_shape
from pipeline.databuild import load_source_module
from pipeline.density_encoding import POPULATION_DENSITY_D_MAX, encode_log_density
from pipeline.shapes import (
    CuratedShape,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
)

_fetch = load_source_module(Path(__file__).resolve().parent, "fetch")
LAND_USE_VARIABLES = _fetch.LAND_USE_VARIABLES
"""`("cropland", "pasture", "rangeland", "conv_rangeland")` -- read from fetch.py, the one
place this list is written out, so the two modules can't silently drift on which files are
expected."""
POPULATION_VARIABLE = _fetch.POPULATION_VARIABLE
"""`"popc"` -- read from fetch.py, same reasoning as `LAND_USE_VARIABLES` above."""

CURATED_ID = "hyde_cleared_land"
POPULATION_CURATED_ID = "hyde_population_density"
POPULATION_TOTAL_CURATED_ID = "population"
"""Not `hyde_population_total` -- this is the plain semantic id `WorldModel.at()` already looks
up (`pipeline/models.py`'s `self._s("population", t)`) and `docs/DATA_SOURCES.md`'s five-shape
contract's own convention for a source's *derived* scalar series (`sources/paleodem`'s
`land_fraction` is the precedent)."""

_TAG_RE = re.compile(r"^(\d+)(BC|AD)$")

PRESENT_CE_YEAR = 2025
"""t = years before this fixed calendar present, matching sources/co2-o2's own convention
("years before the AD 2025 present") -- see README.md "Calendar year -> t"."""

EARTH_MEAN_RADIUS_KM = 6371.0
"""Same order of approximation sources/paleodem's own area-weighting makes (cos(latitude) on
a sphere, not a WGS84 ellipsoid) -- see README.md "Cell area"."""

TEXTURE_SIZE = (1024, 512)  # (width, height) -- matches sources/paleodem's own globe texture size
TEXTURE_EXTENSION = ".webp"
"""Lossless WebP: this is a data layer (cropland/grazing fraction, or population density),
which CONTRIBUTING.md holds to a higher accuracy bar than decorative imagery -- unlike
sources/paleodem's/sources/basemap's lossy WebP textures."""

_TEXTURE_SUBDIR = Path("textures") / CURATED_ID
_POPULATION_TEXTURE_SUBDIR = Path("textures") / POPULATION_CURATED_ID


class GridHeaderError(ValueError):
    """An .asc grid's header is missing an expected field or has an unexpected value."""


def _tag_to_t(tag: str) -> float:
    match = _TAG_RE.match(tag)
    if match is None:
        raise ValueError(f"hyde: cannot parse timestep tag {tag!r}")
    year, era = match.groups()
    year_n = int(year)
    return float(PRESENT_CE_YEAR - year_n if era == "AD" else PRESENT_CE_YEAR + year_n)


def _discover_raw_tags(raw_dir: Path) -> list[str]:
    """Every tag with *all four* of `cropland<tag>.asc`, `pasture<tag>.asc`,
    `rangeland<tag>.asc` and `conv_rangeland<tag>.asc` present."""
    tags_by_variable = {
        variable: {
            p.name.removeprefix(variable).removesuffix(".asc")
            for p in raw_dir.glob(f"{variable}*.asc")
        }
        for variable in LAND_USE_VARIABLES
    }
    tags = set.intersection(*tags_by_variable.values())
    if not tags:
        raise ValueError(
            f"hyde: no {'/'.join(f'{v}*.asc' for v in LAND_USE_VARIABLES)} triples found in "
            f"{raw_dir}"
        )
    incomplete = set.union(*tags_by_variable.values()) - tags
    if incomplete:
        raise ValueError(
            f"hyde: {len(incomplete)} timestep(s) are missing at least one of "
            f"{LAND_USE_VARIABLES} in {raw_dir}: {sorted(incomplete)} -- re-run fetch()"
        )
    return sorted(tags, key=_tag_to_t)


def _discover_population_tags(raw_dir: Path) -> list[str]:
    """Every tag with a `popc_<tag>.asc` present -- population's own filename convention puts
    an underscore before the tag (`fetch.py`'s `_local_filename`), unlike the land-use
    variables, so this can't reuse `_discover_raw_tags`' `removeprefix(variable)` directly."""
    prefix = f"{POPULATION_VARIABLE}_"
    tags = {
        p.name.removeprefix(prefix).removesuffix(".asc") for p in raw_dir.glob(f"{prefix}*.asc")
    }
    if not tags:
        raise ValueError(f"hyde: no {prefix}*.asc files found in {raw_dir}")
    return sorted(tags, key=_tag_to_t)


class _AsciiGrid:
    __slots__ = ("cellsize", "ncols", "nodata", "nrows", "values", "xllcorner", "yllcorner")

    def __init__(
        self,
        values: np.ndarray,
        ncols: int,
        nrows: int,
        xllcorner: float,
        yllcorner: float,
        cellsize: float,
        nodata: float,
    ) -> None:
        self.values = values
        self.ncols = ncols
        self.nrows = nrows
        self.xllcorner = xllcorner
        self.yllcorner = yllcorner
        self.cellsize = cellsize
        self.nodata = nodata


_HEADER_FIELDS = ("ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value")


def _parse_ascii_grid(path: Path) -> _AsciiGrid:
    """Arcmap ASCII grid format (docs from HYDE's own readme, `sources/hyde/README.md`
    "Schema"): a 6-line whitespace header, then `nrows` rows of `ncols` whitespace-separated
    floats, row 0 = the northernmost row (CONFIRMED: `yllcorner` is the grid's *south* edge,
    the ArcInfo ASCII convention, and HYDE's own values are consistent with row 0 = north --
    see README.md "Row order")."""
    with path.open() as f:
        header: dict[str, str] = {}
        for _ in range(6):
            line = f.readline()
            key, value = line.split()
            header[key.lower()] = value
        missing = [field for field in _HEADER_FIELDS if field not in header]
        if missing:
            raise GridHeaderError(f"{path}: missing header field(s) {missing}")
        values = np.loadtxt(f, dtype=np.float64)
    ncols, nrows = int(header["ncols"]), int(header["nrows"])
    if values.shape != (nrows, ncols):
        raise GridHeaderError(f"{path}: header declares {nrows}x{ncols}, data is {values.shape}")
    return _AsciiGrid(
        values=values,
        ncols=ncols,
        nrows=nrows,
        xllcorner=float(header["xllcorner"]),
        yllcorner=float(header["yllcorner"]),
        cellsize=float(header["cellsize"]),
        nodata=float(header["nodata_value"]),
    )


def _row_cell_area_km2(grid: _AsciiGrid) -> np.ndarray:
    """One value per row (north to south): the true surface area (km²) of a cell spanning
    `cellsize` degrees of latitude and longitude at that row's latitude band -- not a flat
    per-cell constant, and not read from HYDE's own `garea_cr.asc` (README.md "Cell area").

    `area = R² * Δlon_rad * (sin(lat_top) - sin(lat_bottom))`, the exact area of a
    latitude/longitude cell on a sphere (not a small-angle/cos(lat) approximation -- exact at
    every latitude, including near the poles where a cos(lat) approximation would drift).

    Row 0's north edge is derived from the header's own `yllcorner` (south edge) + `nrows` *
    `cellsize`, not hardcoded to 90.0 -- for the real global grid these agree exactly
    (`yllcorner=-90`, `nrows * cellsize = 180`), but hardcoding the pole would silently give
    the wrong latitude band for any differently-windowed or offset grid (a regional crop, say)
    that happens to share the same `cellsize`.
    """
    lat_north_edge = grid.yllcorner + grid.nrows * grid.cellsize
    row_index = np.arange(grid.nrows)  # 0 = north (row 0's *top* edge is the grid's north edge)
    lat_top_deg = lat_north_edge - row_index * grid.cellsize
    lat_bottom_deg = lat_top_deg - grid.cellsize
    lon_rad = np.deg2rad(grid.cellsize)
    area = (
        EARTH_MEAN_RADIUS_KM**2
        * lon_rad
        * (np.sin(np.deg2rad(lat_top_deg)) - np.sin(np.deg2rad(lat_bottom_deg)))
    )
    return area


def _fraction_grid(grid: _AsciiGrid) -> np.ndarray:
    """km² per cell -> fraction of that cell's own true area, with ocean/no-data (-9999) and
    any other invalid/negative reading folded to exactly 0 (ADR-031: "pre-bake ocean/no-data
    as 0"), and area-model rounding at coastal cells clipped to [0, 1]."""
    row_area = _row_cell_area_km2(grid)[:, np.newaxis]  # broadcast over columns
    raw = np.where(grid.values == grid.nodata, 0.0, grid.values)
    fraction = raw / row_area
    return np.clip(fraction, 0.0, 1.0)


def _resize_fraction(fraction: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resample a fraction grid to `size` (width, height), any direction (the real 4320x2160
    grids downsample to `TEXTURE_SIZE`; the small fixture grids upsample to it) -- bilinear,
    on a single-channel float image, so both directions degrade gracefully."""
    image = Image.fromarray(fraction.astype(np.float32), mode="F")
    resized = image.resize(size, Image.Resampling.BILINEAR)
    return np.asarray(resized, dtype=np.float32)


def _resize_mean(values: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resample `values` (any extensive-or-intensive per-cell quantity) to `size` via Pillow's
    BOX filter -- an exact, geometrically-weighted average of the source cells each output
    pixel covers (confirmed directly: a 2x2 block `[[100, 1], [1, 1]]` downsamples to exactly
    its arithmetic mean, 25.75, and upsampling degenerates to nearest-neighbour, both exact).
    Used, never on its own, but always in a *ratio* of two `_resize_mean` calls over the same
    footprint (`_population_density_grid` below) -- because both the numerator (people) and
    denominator (area) pass through the identical per-pixel geometric weights, the constant
    "divide by total weight" `BOX` applies to compute a mean cancels out of the ratio, leaving
    exactly sum(people) / sum(area) over each output pixel's real footprint -- not a mean of
    already-computed densities, which would treat a tiny high-density cell and a huge
    low-density cell as equally important instead of weighting by how much area each
    contributes. `_resize_fraction` above cannot be reused for this: it resamples a fraction
    (already intensive) with the same maths BOX would give for a mean, but bilinear rather than
    BOX, and this function is deliberately BOX for the exact area-weighting guarantee."""
    image = Image.fromarray(values.astype(np.float32), mode="F")
    resized = image.resize(size, Image.Resampling.BOX)
    return np.asarray(resized, dtype=np.float64)


def _texture_name(tag: str) -> str:
    return f"{tag}{TEXTURE_EXTENSION}"


def _frame_ref(tag: str) -> str:
    return (_TEXTURE_SUBDIR / _texture_name(tag)).as_posix()


def _population_frame_ref(tag: str) -> str:
    return (_POPULATION_TEXTURE_SUBDIR / _texture_name(tag)).as_posix()


def _world_population_total(raw_dir: Path, tag: str) -> float:
    """The world total at `tag`: a plain sum of the full-resolution `popc_<tag>.asc` grid
    (README.md "Global population total"). `popc` is people *per cell* already (not a density),
    so -- unlike `_population_density_grid`, which needs area weighting to combine per-cell
    densities correctly -- summing every valid cell directly *is* the world total, no area term
    involved. NODATA (-9999, ocean/undefined) folds to 0 people, and a handful of cells carrying
    small negative rounding noise are clipped to 0, matching `_population_density_grid`'s own
    two conventions exactly, so the two population outputs can never silently disagree about
    what counts as "no people here"."""
    grid = _parse_ascii_grid(raw_dir / f"{POPULATION_VARIABLE}_{tag}.asc")
    people = np.where(grid.values == grid.nodata, 0.0, grid.values)
    people = np.clip(people, 0.0, None)
    return float(np.sum(people))


def normalise(raw_dir: Path) -> list[CuratedShape]:
    tags = _discover_raw_tags(raw_dir)
    frames = [RasterFrame(t=_tag_to_t(tag), ref=_frame_ref(tag)) for tag in tags]
    population_tags = _discover_population_tags(raw_dir)
    population_frames = [
        RasterFrame(t=_tag_to_t(tag), ref=_population_frame_ref(tag)) for tag in population_tags
    ]
    population_total = TimeSeries(
        id=POPULATION_TOTAL_CURATED_ID,
        unit="people",
        # Population growth is multiplicative, not additive -- correct for the same reason
        # `Interpolation.LOG_LINEAR`'s own docstring names "populations" as a worked example
        # alongside CO2. Every sample below is a real HYDE timestep, so this only governs how a
        # `t` strictly between two timesteps is read, never a fabricated value.
        interpolation=Interpolation.LOG_LINEAR,
        samples=[
            Sample(t=_tag_to_t(tag), value=_world_population_total(raw_dir, tag))
            for tag in population_tags
        ],
    )
    return [
        RasterSequence(id=CURATED_ID, frames=frames),
        RasterSequence(id=POPULATION_CURATED_ID, frames=population_frames),
        population_total,
    ]


def _channel_fraction(raw_dir: Path, tag: str, variable: str) -> np.ndarray:
    grid = _parse_ascii_grid(raw_dir / f"{variable}{tag}.asc")
    return _resize_fraction(_fraction_grid(grid), TEXTURE_SIZE)


def _render_frame(raw_dir: Path, tag: str) -> Image.Image:
    """R = cropland, G = pasture + conv_rangeland (clipped to 1 after summing -- each is
    independently clipped to [0, 1] by `_fraction_grid`, so their sum can exceed 1 at a
    coastal/rounding-edge cell), B = rangeland (natural, non-forest-biome grazing land, HYDE's
    own "rangeland-natural") -- README.md "Encoding" for the full reasoning (Klein Goldewijk et
    al. 2017's own definition of `conv_rangeland` as forest-biome grazing land assumed cleared)."""
    cropland = _channel_fraction(raw_dir, tag, "cropland")
    pasture = _channel_fraction(raw_dir, tag, "pasture")
    conv_rangeland = _channel_fraction(raw_dir, tag, "conv_rangeland")
    rangeland = _channel_fraction(raw_dir, tag, "rangeland")
    cleared_grazing = np.clip(pasture + conv_rangeland, 0.0, 1.0)

    width, height = TEXTURE_SIZE
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[:, :, 0] = np.clip(cropland * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 1] = np.clip(cleared_grazing * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 2] = np.clip(rangeland * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def _population_density_grid(raw_dir: Path, tag: str) -> np.ndarray:
    """People per km² at `TEXTURE_SIZE`, area-correctly downsampled from the full-resolution
    `popc_<tag>.asc` grid (population count per cell): total people divided by total area per
    output pixel's footprint (`_resize_mean`'s own docstring has the derivation), not a mean of
    per-cell densities. NODATA (-9999, ocean/undefined -- same convention as the land-use
    grids) folds to 0 people, matching `_fraction_grid`'s own "pre-bake ocean/no-data as 0"."""
    grid = _parse_ascii_grid(raw_dir / f"{POPULATION_VARIABLE}_{tag}.asc")
    people = np.where(grid.values == grid.nodata, 0.0, grid.values)
    people = np.clip(people, 0.0, None)  # a handful of cells carry small negative rounding noise
    row_area = _row_cell_area_km2(grid)[:, np.newaxis]
    area = np.broadcast_to(row_area, people.shape)
    total_people = _resize_mean(people, TEXTURE_SIZE)
    total_area = _resize_mean(area, TEXTURE_SIZE)
    return total_people / total_area


def _render_population_frame(raw_dir: Path, tag: str) -> Image.Image:
    """R = `encode_log_density(people_per_km2, POPULATION_DENSITY_D_MAX)`, G = B = 0 --
    README.md "Population density encoding" for the exact formula and how `D_MAX` was chosen.
    A single populated channel, like every other HYDE texture's own RGB convention, rather than
    a single-channel image format, so a generic raster-texture loader needs no special case for
    this layer."""
    density = _population_density_grid(raw_dir, tag)
    encoded = encode_log_density(density, POPULATION_DENSITY_D_MAX)
    width, height = TEXTURE_SIZE
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[:, :, 0] = encoded
    return Image.fromarray(rgb, mode="RGB")


def render_textures(raw_dir: Path, media_dir: Path) -> None:
    """Write one lossless WebP per timestep into media_dir/textures/hyde_cleared_land/ and
    media_dir/textures/hyde_population_density/, and remove any other file in either directory.
    A side effect, deliberately kept out of normalise() (DESIGN.md's purity contract, project
    CLAUDE.md)."""
    _render_texture_set(
        _discover_raw_tags(raw_dir), media_dir / _TEXTURE_SUBDIR, _render_frame, raw_dir
    )
    _render_texture_set(
        _discover_population_tags(raw_dir),
        media_dir / _POPULATION_TEXTURE_SUBDIR,
        _render_population_frame,
        raw_dir,
    )


def _render_texture_set(
    tags: list[str], out_dir: Path, render: Callable[[Path, str], Image.Image], raw_dir: Path
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = {_texture_name(tag) for tag in tags}
    for existing in out_dir.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
    for tag in tags:
        image = render(raw_dir, tag)
        image.save(out_dir / _texture_name(tag), "WEBP", lossless=True, method=6)


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s optional post-normalise side-effect hook (CONTRIBUTING.md "Optional
    write_outputs hook"). Thin wrapper over `render_textures`, matching
    sources/paleodem/normalise.py's own `write_outputs`."""
    render_textures(raw_dir, repo_root / "data" / "media")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "hyde"
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")
    write_outputs(raw_dir, repo_root)
    print(f"wrote textures to {repo_root / 'data' / 'media' / _TEXTURE_SUBDIR}")
    print(f"wrote textures to {repo_root / 'data' / 'media' / _POPULATION_TEXTURE_SUBDIR}")


if __name__ == "__main__":
    main()
