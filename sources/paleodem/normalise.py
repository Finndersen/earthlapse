"""Normalise data/raw/paleodem/ into data/curated/{paleodem,land_fraction}.parquet.

Two curated shapes come out of the same raw grids (see README.md "Schema" for the file
layout):

- `RasterSequence` id "paleodem" -- one frame per raw epoch (all 109, 0-540 Ma), each frame a
  ref to a globe texture that render_textures() (a side effect, called from write_outputs()
  only -- see below) writes separately.
- `TimeSeries` id "land_fraction" -- cos(latitude) area-weighted land fraction (z > 0),
  over the same epochs.

TRAP -- age is not a variable inside the netCDF at all (CONFIRMED by opening the files):
there is no `time`/`age` coordinate or attribute. Each file's age in Ma is encoded only in
its filename, as a `_<Ma>Ma.nc` suffix (e.g. `..._Holocene_0Ma.nc`,
`..._Permo-Triassic Boundary_250Ma.nc` -- note real filenames do contain spaces).
`_discover_raw_files` is the one place that parses it.

TRAP -- epochs are not evenly spaced. Most of the 109 files are 5 Myr apart, but a handful
of boundary maps break that (385.2 and 390.5 Ma -- see README.md "Timestep spacing"). Frame
refs therefore keep one decimal place of the real age rather than rounding it away, and
nothing here assumes a regular grid.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image

from pipeline.curated import write_shape
from pipeline.palette import elevation_to_rgb
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

TEXTURE_WIDTH = 1024
TEXTURE_HEIGHT = 512
"""2:1 equirectangular, bilinear-upsampled from the native 1x1 degree (181x361) grid. The
source carries ~360 columns of real information, so a wider texture adds bytes, not detail."""

TEXTURE_EXTENSION = ".webp"
TEXTURE_WEBP_QUALITY = 90
"""Lossy WebP. Measured against the real grids (README.md "Texture encoding"): ~37 KB mean per
1024x512 frame, ~4 MB for all 109, PSNR 37-44 dB against the lossless render. The same frames
as optimised PNG average ~264 KB (~29.5 MB total). The hypsometric tint is smooth ramps plus
one coastline edge, which lossy WebP holds well; anything that must stay exact (a future
plate-id raster, docs/GLOBE.md) is a different file and must be lossless."""

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


def _texture_name(age_ma: float) -> str:
    """`000.0Ma.webp` .. `540.0Ma.webp`: zero-padded so a directory listing sorts
    chronologically, with one decimal so the off-grid boundary epochs (385.2, 390.5 Ma) keep
    their real age instead of colliding with or impersonating a rounded neighbour."""
    return f"{age_ma:05.1f}Ma{TEXTURE_EXTENSION}"


def _frame_ref(age_ma: float) -> str:
    return (_TEXTURE_SUBDIR / _texture_name(age_ma)).as_posix()


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
    ages = sorted(files_by_age)

    frames = [RasterFrame(t=age * MA_TO_YEARS, ref=_frame_ref(age)) for age in ages]
    paleodem = RasterSequence(id="paleodem", frames=frames)

    samples = []
    for age_ma in ages:
        with xr.open_dataset(files_by_age[age_ma]) as ds:
            _validate_grid(ds, files_by_age[age_ma])
            frac = _land_fraction(ds["z"].values, ds["lat"].values)
        samples.append(Sample(t=age_ma * MA_TO_YEARS, value=frac))
    land_fraction = TimeSeries(
        id="land_fraction", unit="fraction", interpolation=Interpolation.LINEAR, samples=samples
    )

    return [paleodem, land_fraction]


# --------------------------------------------------------------------------- hypsometric colour map
#
# `elevation_to_rgb` (control points, interpolation) now lives in `pipeline/palette.py`,
# shared with `sources/plates-neoproterozoic` so the 540 Ma seam between the two sources'
# textures (docs/GLOBE.md §4.1) blends colour, not palette. Re-imported above rather than
# re-exported here by name so `tests/sources/test_paleodem.py`'s
# `paleodem_normalise.elevation_to_rgb(...)` calls keep working unchanged.


def _render_frame(z: np.ndarray) -> Image.Image:
    """One elevation grid (lat ascending south->north, lon -180..180 including both edges)
    -> a north-up, lon -180..180 left-to-right equirectangular RGB image, bilinear-
    upsampled to TEXTURE_WIDTHxTEXTURE_HEIGHT."""
    z_unique_lon = _drop_duplicate_lon_column(z)
    z_north_up = np.flipud(
        z_unique_lon
    )  # row 0 (index -90) -> row 0 must be +90 (north) at the top
    rgb = elevation_to_rgb(z_north_up)
    image = Image.fromarray(rgb, mode="RGB")
    return image.resize((TEXTURE_WIDTH, TEXTURE_HEIGHT), Image.Resampling.BILINEAR)


def render_textures(raw_dir: Path, media_dir: Path) -> None:
    """Write one equirectangular WebP per raw epoch into media_dir/textures/paleodem/, and
    remove any other file there -- the directory belongs to this source alone, so a texture
    it no longer references (an older encoding or naming scheme) is stale, not someone
    else's. A side effect, deliberately kept out of normalise() (DESIGN.md's purity contract,
    project CLAUDE.md)."""
    files_by_age = _discover_raw_files(raw_dir)
    out_dir = media_dir / _TEXTURE_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = {_texture_name(age) for age in files_by_age}
    for existing in out_dir.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
    for age_ma, path in sorted(files_by_age.items()):
        with xr.open_dataset(path) as ds:
            _validate_grid(ds, path)
            image = _render_frame(ds["z"].values)
        image.save(out_dir / _texture_name(age_ma), "WEBP", quality=TEXTURE_WEBP_QUALITY, method=6)


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
