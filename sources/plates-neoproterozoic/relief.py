"""Render one equirectangular WebP texture per `normalise.FRAME_AGES_MA` epoch, reconstructing
Merdith et al. 2021's `ContinentalPolygons` and `Cratons` with pygplates and colouring the
result with a stylised relief model (docs/GLOBE.md §4.1, G7).

Loaded only from `normalise.write_outputs()`, never imported at package-load time -- see that
module's docstring. `pygplates` (GPL-2.0) and `scipy` therefore only need to be installed
(the project's `geo` extra) to run a real build, never to run this source's tests.

Relief model
------------
No elevation data exists for 1000-540 Ma -- there is no DEM to downsample, unlike
sources/paleodem. Every value below is a stylised stand-in, chosen only to read correctly
through `pipeline.palette.elevation_to_rgb` (the same hypsometric map sources/paleodem uses,
so the two sources' textures cross-fade in colour, not palette) and labelled as such wherever
the globe shows it (that labelling is G2/G6's caption, not this file's job):

- **Land mask** -- a point is land if Merdith's `ContinentalPolygons`, reconstructed to the
  frame's age, contains it (`pygplates.PlatePartitioner.partition_point`).
- **Cratons raised** -- a land point additionally inside the `Cratons` layer (older, more
  stable continental crust) sits at `LAND_CRATON_ELEVATION_M`; other land sits at the lower
  `LAND_YOUNG_ELEVATION_M`. This is docs/GLOBE.md §4.1's "older interiors raised from the
  Cratons layer" read literally off the actual Cratons layer, not inferred from distance to
  coast.
- **Procedural noise, seeded per plate id** -- `_plate_relief_noise` adds a deterministic,
  low-frequency perturbation to land elevation. Frames are independent renders (no G4 plate-
  rotation warp -- this ticket explicitly excludes it), so "moves with the plate" is read as
  "the same plate id always gets the same noise pattern", which is what a fixed
  `numpy.random.default_rng(seed=plate_id)` per id gives regardless of which frame that plate
  appears in. Longitude uses integer-cycle harmonics (`sin(k * lon_radians)` for integer `k`)
  so the pattern is exactly periodic over 360° and never seams at the antimeridian.
- **Shelves from distance to coast** -- ocean elevation ramps linearly from
  `SHELF_NEAR_ELEVATION_M` at the coastline to the uniform `ABYSSAL_ELEVATION_M` over
  `SHELF_WIDTH_PX` pixels (~2° at this texture's width), via a Euclidean distance transform
  on the sea mask, padded with wraparound columns so the transform sees the antimeridian as
  contiguous.
- **Abyssal depth is uniform** beyond the shelf band, per docs/GLOBE.md §4.1 -- no ridges or
  trenches are asserted for a domain with no bathymetric data.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import pygplates
from PIL import Image
from scipy.ndimage import distance_transform_edt

from pipeline.palette import elevation_to_rgb

TEXTURE_WIDTH = 1024
TEXTURE_HEIGHT = 512
"""Matches sources/paleodem's globe texture size exactly (README.md "Texture encoding") --
same 2:1 equirectangular frame the globe shader expects for every raster layer."""

LAND_CRATON_ELEVATION_M = 600.0
LAND_YOUNG_ELEVATION_M = 150.0
LAND_NOISE_AMPLITUDE_M = 500.0
SHELF_NEAR_ELEVATION_M = -30.0
ABYSSAL_ELEVATION_M = -4000.0
"""Roughly today's global mean ocean depth (~3.8 km) -- a plausible uniform stand-in, not a
claim about Neoproterozoic bathymetry, which isn't reconstructed here."""
SHELF_WIDTH_PX = 6
"""~2° at TEXTURE_WIDTH=1024 -- continental-shelf-scale, not ocean-basin-scale."""

_NOISE_SEED = 20210221  # arbitrary, fixed -- determinism is what matters (module docstring)
_NOISE_OCTAVES = 3


def _grid_lat_lon(width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Cell-centre (lat, lon) in degrees for every pixel, shape (height, width) each. Row 0
    is the north pole (+90), so the resulting image is north-up with no flip needed --
    unlike sources/paleodem, whose source grid runs south-to-north and must be flipped."""
    lats = 90.0 - (np.arange(height) + 0.5) / height * 180.0
    lons = (np.arange(width) + 0.5) / width * 360.0 - 180.0
    return np.meshgrid(lats, lons, indexing="ij")


def _partition_plate_ids(
    partitioner: pygplates.PlatePartitioner, lat_grid: np.ndarray, lon_grid: np.ndarray
) -> np.ndarray:
    """Reconstruction plate id at every grid cell, -1 where no polygon contains it. One
    `partition_point` query per cell: pygplates indexes the partitioning polygons
    internally, so this is fast in practice despite being a plain Python loop (measured:
    ~1s for the full TEXTURE_WIDTH x TEXTURE_HEIGHT grid against a few hundred Merdith
    polygons)."""
    flat_lat = lat_grid.reshape(-1)
    flat_lon = lon_grid.reshape(-1)
    ids = np.full(flat_lat.shape, -1, dtype=np.int32)
    for i in range(flat_lat.shape[0]):
        hit = partitioner.partition_point((float(flat_lat[i]), float(flat_lon[i])))
        if hit is not None:
            ids[i] = hit.get_feature().get_reconstruction_plate_id()
    return ids.reshape(lat_grid.shape)


def _partition_mask(
    partitioner: pygplates.PlatePartitioner, lat_grid: np.ndarray, lon_grid: np.ndarray
) -> np.ndarray:
    """Boolean membership at every grid cell -- same query as `_partition_plate_ids`, kept
    separate because the Cratons layer only needs "inside or not", not which plate."""
    flat_lat = lat_grid.reshape(-1)
    flat_lon = lon_grid.reshape(-1)
    mask = np.zeros(flat_lat.shape, dtype=bool)
    for i in range(flat_lat.shape[0]):
        if partitioner.partition_point((float(flat_lat[i]), float(flat_lon[i]))) is not None:
            mask[i] = True
    return mask.reshape(lat_grid.shape)


def _distance_to_coast_px(land: np.ndarray, pad: int) -> np.ndarray:
    """Euclidean pixel distance from each ocean cell to the nearest land cell (0 on land).
    Padded with wraparound columns before the transform and cropped back after, so the
    antimeridian reads as contiguous rather than as a false coastline."""
    sea = ~land
    padded = np.pad(sea, ((0, 0), (pad, pad)), mode="wrap")
    distance = distance_transform_edt(padded)
    return distance[:, pad : distance.shape[1] - pad]


def _plate_relief_noise(
    lat_grid: np.ndarray, lon_grid: np.ndarray, plate_ids: np.ndarray
) -> np.ndarray:
    """Deterministic low-frequency elevation perturbation in [-1, 1], seeded per plate id --
    see the module docstring's "Procedural noise" paragraph. Ocean cells (plate_id -1) are
    left at 0; callers only apply this where `land` is True."""
    noise = np.zeros(lat_grid.shape, dtype=np.float64)
    for plate_id in np.unique(plate_ids):
        if plate_id < 0:
            continue
        mask = plate_ids == plate_id
        rng = np.random.default_rng(_NOISE_SEED + int(plate_id))
        lat_rad = np.radians(lat_grid[mask])
        lon_rad = np.radians(lon_grid[mask])
        value = np.zeros(mask.sum(), dtype=np.float64)
        amplitude_sum = 0.0
        for octave in range(_NOISE_OCTAVES):
            lon_harmonic = float(rng.integers(1, 6))  # integer cycles/revolution -> seamless wrap
            lat_frequency = rng.uniform(1.0, 4.0)
            phase = rng.uniform(0.0, 2 * np.pi)
            amplitude = 1.0 / (octave + 1)
            value += amplitude * np.sin(lat_rad * lat_frequency + lon_rad * lon_harmonic + phase)
            amplitude_sum += amplitude
        noise[mask] = value / amplitude_sum
    return noise


def _elevation_grid(
    land: np.ndarray,
    craton: np.ndarray,
    plate_ids: np.ndarray,
    lat_grid: np.ndarray,
    lon_grid: np.ndarray,
) -> np.ndarray:
    land_base = np.where(craton, LAND_CRATON_ELEVATION_M, LAND_YOUNG_ELEVATION_M)
    land_elevation = (
        land_base + _plate_relief_noise(lat_grid, lon_grid, plate_ids) * LAND_NOISE_AMPLITUDE_M
    )

    distance_to_coast = _distance_to_coast_px(land, pad=SHELF_WIDTH_PX + 1)
    shelf_factor = np.clip(distance_to_coast / SHELF_WIDTH_PX, 0.0, 1.0)
    ocean_elevation = (
        SHELF_NEAR_ELEVATION_M + (ABYSSAL_ELEVATION_M - SHELF_NEAR_ELEVATION_M) * shelf_factor
    )

    return np.where(land, land_elevation, ocean_elevation)


def _render_frame(
    age_ma: float,
    continents: pygplates.FeatureCollection,
    cratons: pygplates.FeatureCollection,
    rotation_model: pygplates.RotationModel,
    lat_grid: np.ndarray,
    lon_grid: np.ndarray,
) -> Image.Image:
    continent_partitioner = pygplates.PlatePartitioner(
        continents, rotation_model, reconstruction_time=age_ma
    )
    craton_partitioner = pygplates.PlatePartitioner(
        cratons, rotation_model, reconstruction_time=age_ma
    )
    plate_ids = _partition_plate_ids(continent_partitioner, lat_grid, lon_grid)
    craton_mask = _partition_mask(craton_partitioner, lat_grid, lon_grid)
    land = plate_ids >= 0

    elevation = _elevation_grid(land, craton_mask, plate_ids, lat_grid, lon_grid)
    rgb = elevation_to_rgb(elevation)
    return Image.fromarray(rgb, mode="RGB")


def render_textures(
    continents_path: Path,
    cratons_path: Path,
    rotations_path: Path,
    out_dir: Path,
    frame_ages_ma: Sequence[float],
    texture_name: Callable[[float], str],
    webp_quality: int,
) -> None:
    """Write one WebP per age in `frame_ages_ma` into `out_dir`, and remove any other file
    there -- the directory belongs to this source alone (mirrors
    sources/paleodem/normalise.py's `render_textures`)."""
    rotation_model = pygplates.RotationModel(str(rotations_path))
    continents = pygplates.FeatureCollection(str(continents_path))
    cratons = pygplates.FeatureCollection(str(cratons_path))

    out_dir.mkdir(parents=True, exist_ok=True)
    expected = {texture_name(age) for age in frame_ages_ma}
    for existing in out_dir.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()

    lat_grid, lon_grid = _grid_lat_lon(TEXTURE_WIDTH, TEXTURE_HEIGHT)
    for age_ma in frame_ages_ma:
        image = _render_frame(age_ma, continents, cratons, rotation_model, lat_grid, lon_grid)
        image.save(out_dir / texture_name(age_ma), "WEBP", quality=webp_quality, method=6)
