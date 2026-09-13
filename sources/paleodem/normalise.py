"""Normalise data/raw/paleodem/ into data/curated/{paleodem,land_fraction}.parquet.

Two curated shapes come out of the same raw grids (see README.md "Schema" for the file
layout):

- `RasterSequence` id "paleodem" -- ~12 epochs spread across 0-540 Ma, each frame a ref to
  a texture PNG that render_textures() (a side effect, called from main() only -- see
  below) writes separately.
- `TimeSeries` id "land_fraction" -- cos(latitude) area-weighted land fraction (z > 0),
  over *every* epoch the raw grids cover, not just the ~12 texture epochs.

TRAP -- age is not a variable inside the netCDF at all (CONFIRMED by opening the files):
there is no `time`/`age` coordinate or attribute. Each file's age in Ma is encoded only in
its filename, as a `_<Ma>Ma.nc` suffix (e.g. `..._Holocene_0Ma.nc`,
`..._Permo-Triassic Boundary_250Ma.nc` -- note real filenames do contain spaces).
`_discover_raw_files` is the one place that parses it.

TRAP -- epochs are not evenly spaced. Most of the 109 files are 5 Myr apart, but a handful
of boundary maps break that (4.5, 5.2, 5.3 Myr gaps -- see README.md "Timestep spacing").
`_select_frame_epochs` therefore picks the *available* epoch nearest each of the 12 target
ages rather than assuming an exact match exists, which also lets it degrade gracefully
against the fixture's sparse 2-epoch slice (see tests/sources/test_paleodem.py) instead of
raising on a fixture that can't possibly carry all 12.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image

from pipeline.curated import write_shape
from pipeline.shapes import (
    CuratedShape,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
)

_AGE_SUFFIX_RE = re.compile(r"_(\d+(?:\.\d+)?)Ma\.nc$")

_EXPECTED_LAT_SIZE = 181
_EXPECTED_LON_SIZE = 361

MA_TO_YEARS = 1e6

_TARGET_EPOCHS_MA: tuple[float, ...] = (
    0.0,
    50.0,
    100.0,
    150.0,
    200.0,
    250.0,
    300.0,
    350.0,
    400.0,
    450.0,
    500.0,
    540.0,
)
"""~12 epochs spread across 0-540 Ma, including 0, ~100/200/300/400/500 and the oldest
(540) -- exactly the coverage requested for the globe's texture sequence."""

TEXTURE_WIDTH = 1024
TEXTURE_HEIGHT = 512
"""2:1 equirectangular, bilinear-upsampled from the native 1x1 degree (181x361) grid."""

_TEXTURE_SUBDIR = Path("textures") / "paleodem"


class GridShapeError(ValueError):
    """A raw grid's dimensions don't match the documented 181x361 (1x1 degree) layout."""


def _discover_raw_files(raw_dir: Path) -> dict[float, Path]:
    """Every `*.nc` in raw_dir, keyed by the age (Ma) encoded in its filename suffix."""
    files: dict[float, Path] = {}
    for path in sorted(raw_dir.glob("*.nc")):
        match = _AGE_SUFFIX_RE.search(path.name)
        if match is None:
            raise ValueError(f"paleodem: cannot parse age (Ma) from filename {path.name!r}")
        age_ma = float(match.group(1))
        if age_ma in files:
            raise ValueError(
                f"paleodem: duplicate epoch {age_ma} Ma in {raw_dir} "
                f"({files[age_ma].name} vs {path.name})"
            )
        files[age_ma] = path
    if not files:
        raise ValueError(f"paleodem: no .nc files found in {raw_dir}")
    return files


def _validate_grid(ds: xr.Dataset, path: Path) -> None:
    lat_size, lon_size = ds.sizes.get("lat"), ds.sizes.get("lon")
    if lat_size != _EXPECTED_LAT_SIZE or lon_size != _EXPECTED_LON_SIZE:
        raise GridShapeError(
            f"paleodem: {path.name} has grid {lat_size}x{lon_size}, expected "
            f"{_EXPECTED_LAT_SIZE}x{_EXPECTED_LON_SIZE} (1x1 degree, node-registered)"
        )
    if "z" not in ds.variables:
        raise GridShapeError(f"paleodem: {path.name} has no 'z' variable")


def _select_frame_epochs(available: Sequence[float], targets: Sequence[float]) -> list[float]:
    """For each target age (Ma), the available age nearest it -- deduplicated and sorted.

    Never fabricates an epoch: every returned age is one that genuinely exists in
    `available`. A sparse source (the fixture's 2 epochs) degrades to fewer, still-real
    frames rather than raising; a full source (the real 109 epochs, which include all 12
    targets exactly) yields exactly the 12 targets.
    """
    chosen = {min(available, key=lambda age: abs(age - target)) for target in targets}
    return sorted(chosen)


def _frame_ref(age_ma: float) -> str:
    return str(_TEXTURE_SUBDIR / f"{round(age_ma):03d}Ma.png")


def _drop_duplicate_lon_column(z: np.ndarray) -> np.ndarray:
    """Drop the duplicate +180 longitude column (node-registered grids carry both -180
    and +180 as the same physical meridian -- see README.md "Projection"). Shared by
    every consumer that would otherwise double-count that one meridian: `_render_frame`
    (the seam isn't double-weighted in the texture) and `_land_fraction` (the seam isn't
    double-weighted in the area-weighted average either)."""
    return z[:, :-1]


def _land_fraction(z: np.ndarray, lat: np.ndarray) -> float:
    """cos(latitude) area-weighted fraction of the grid where z > 0 (land). Pure.

    Weight varies by row (latitude) only, so it is computed once per row and applied to
    that row's land-cell count rather than broadcast over the full 2D grid -- same result,
    fewer floats.
    """
    z = _drop_duplicate_lon_column(z)
    weight_per_row = np.cos(np.deg2rad(lat))
    land_cells_per_row = (z > 0).sum(axis=1)
    cells_per_row = z.shape[1]
    numerator = float((weight_per_row * land_cells_per_row).sum())
    denominator = float(weight_per_row.sum()) * cells_per_row
    return numerator / denominator


def normalise(raw_dir: Path) -> list[CuratedShape]:
    files_by_age = _discover_raw_files(raw_dir)

    frame_ages = _select_frame_epochs(list(files_by_age), _TARGET_EPOCHS_MA)
    frames = [RasterFrame(t=age * MA_TO_YEARS, ref=_frame_ref(age)) for age in frame_ages]
    paleodem = RasterSequence(id="paleodem", frames=frames)

    samples = []
    for age_ma in sorted(files_by_age):
        with xr.open_dataset(files_by_age[age_ma]) as ds:
            _validate_grid(ds, files_by_age[age_ma])
            frac = _land_fraction(ds["z"].values, ds["lat"].values)
        samples.append(Sample(t=age_ma * MA_TO_YEARS, value=frac))
    land_fraction = TimeSeries(
        id="land_fraction", unit="fraction", interpolation=Interpolation.LINEAR, samples=samples
    )

    return [paleodem, land_fraction]


# --------------------------------------------------------------------------- hypsometric colour map


_SEA_STOPS: tuple[tuple[float, tuple[int, int, int]], ...] = (
    (-11000.0, (8, 12, 48)),
    (-6000.0, (10, 25, 90)),
    (-3000.0, (18, 60, 140)),
    (-1000.0, (30, 100, 180)),
    (-200.0, (60, 140, 200)),
    (0.0, (110, 180, 220)),
)
_LAND_STOPS: tuple[tuple[float, tuple[int, int, int]], ...] = (
    (0.0, (30, 120, 60)),
    (200.0, (60, 150, 70)),
    (1000.0, (140, 160, 60)),
    (2000.0, (170, 140, 70)),
    (3500.0, (150, 100, 60)),
    (6000.0, (170, 170, 170)),
    (10500.0, (255, 255, 255)),
)
"""Hypsometric tint control points, (elevation metres, RGB). Sea (z <= 0) runs dark trench
navy to pale coastal blue; land (z > 0) runs coastal green through browns to snow-cap white.
The deliberate jump at z=0 (light blue -> green, not a shared midpoint) is what gives "clear
land/sea contrast" -- the two halves are interpolated independently and selected by sign,
never blended across the coastline. One map for every epoch (module docstring), so the
globe's cross-fade blends colour, not palette."""


def _interp_stops(
    z: np.ndarray, stops: tuple[tuple[float, tuple[int, int, int]], ...]
) -> np.ndarray:
    elevations = np.array([stop[0] for stop in stops])
    channels = [np.interp(z, elevations, [stop[1][c] for stop in stops]) for c in range(3)]
    return np.stack(channels, axis=-1)


def elevation_to_rgb(z: np.ndarray) -> np.ndarray:
    """Hypsometric colour map: elevation in metres, any shape -> uint8 RGB, shape + (3,).

    Pure and deterministic: the same elevation always maps to the same colour, independent
    of which epoch or which pixel it came from -- required so every epoch shares one map
    (module docstring) and the globe's cross-fade blends smoothly.
    """
    z_clamped = np.clip(z, _SEA_STOPS[0][0], _LAND_STOPS[-1][0])
    is_land = z_clamped > 0
    rgb = np.where(
        is_land[..., None],
        _interp_stops(z_clamped, _LAND_STOPS),
        _interp_stops(z_clamped, _SEA_STOPS),
    )
    return np.clip(rgb, 0, 255).astype(np.uint8)


def _render_frame(z: np.ndarray) -> Image.Image:
    """One elevation grid (lat ascending south->north, lon -180..180 including both edges)
    -> a north-up, lon -180..180 left-to-right equirectangular RGB PNG image, bilinear-
    upsampled to TEXTURE_WIDTHxTEXTURE_HEIGHT."""
    z_unique_lon = _drop_duplicate_lon_column(z)
    z_north_up = np.flipud(
        z_unique_lon
    )  # row 0 (index -90) -> row 0 must be +90 (north) at the top
    rgb = elevation_to_rgb(z_north_up)
    image = Image.fromarray(rgb, mode="RGB")
    return image.resize((TEXTURE_WIDTH, TEXTURE_HEIGHT), Image.Resampling.BILINEAR)


def render_textures(raw_dir: Path, media_dir: Path) -> None:
    """Write one equirectangular PNG per selected frame epoch into
    media_dir/textures/paleodem/. A side effect -- deliberately kept out of normalise()
    (module docstring, DESIGN.md's `Layer.sample()` purity contract, project CLAUDE.md),
    called only from main().
    """
    files_by_age = _discover_raw_files(raw_dir)
    frame_ages = _select_frame_epochs(list(files_by_age), _TARGET_EPOCHS_MA)
    out_dir = media_dir / _TEXTURE_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    for age_ma in frame_ages:
        path = files_by_age[age_ma]
        with xr.open_dataset(path) as ds:
            _validate_grid(ds, path)
            image = _render_frame(ds["z"].values)
        image.save(out_dir / f"{round(age_ma):03d}Ma.png")


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s optional post-normalise side-effect hook (see CONTRIBUTING.md
    "Optional write_outputs hook") -- called automatically after `normalise()` so `make
    data` / `pipeline.databuild` produces the globe textures too, not curated parquet only.
    Thin wrapper over `render_textures`, which keeps its own `(raw_dir, media_dir)` signature
    -- useful directly from `main()` and from tests -- while this one matches the hook's
    `(raw_dir, repo_root)` signature every source that defines one must use."""
    render_textures(raw_dir, repo_root / "data" / "media")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "paleodem"
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")
    write_outputs(raw_dir, repo_root)
    print(f"wrote textures to {repo_root / 'data' / 'media' / _TEXTURE_SUBDIR}")


if __name__ == "__main__":
    main()
