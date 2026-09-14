"""The hypsometric colour map shared by every globe `RasterSequence` texture.

One fixed set of control points, elevation (metres) -> RGB, used by every source that
renders a globe raster (`sources/paleodem`, `sources/plates-neoproterozoic`) so the globe's
cross-fade -- within a source's own frames, and across the 540 Ma seam between sources
(docs/GLOBE.md §4.1) -- blends colour continuously rather than jumping between differently
tuned palettes. Lives in `pipeline/` rather than either source because it is a shared
invariant between them, not something either one owns.
"""

from __future__ import annotations

import numpy as np

SEA_STOPS: tuple[tuple[float, tuple[int, int, int]], ...] = (
    (-11000.0, (8, 12, 48)),
    (-6000.0, (10, 25, 90)),
    (-3000.0, (18, 60, 140)),
    (-1000.0, (30, 100, 180)),
    (-200.0, (60, 140, 200)),
    (0.0, (110, 180, 220)),
)
LAND_STOPS: tuple[tuple[float, tuple[int, int, int]], ...] = (
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
never blended across the coastline."""


def _interp_stops(
    z: np.ndarray, stops: tuple[tuple[float, tuple[int, int, int]], ...]
) -> np.ndarray:
    elevations = np.array([stop[0] for stop in stops])
    channels = [np.interp(z, elevations, [stop[1][c] for stop in stops]) for c in range(3)]
    return np.stack(channels, axis=-1)


def elevation_to_rgb(z: np.ndarray) -> np.ndarray:
    """Hypsometric colour map: elevation in metres, any shape -> uint8 RGB, shape + (3,).

    Pure and deterministic: the same elevation always maps to the same colour, independent
    of which source, epoch or pixel it came from -- required so every globe raster shares
    one map (module docstring) and cross-fades blend smoothly, including across sources.
    """
    z_clamped = np.clip(z, SEA_STOPS[0][0], LAND_STOPS[-1][0])
    is_land = z_clamped > 0
    rgb = np.where(
        is_land[..., None],
        _interp_stops(z_clamped, LAND_STOPS),
        _interp_stops(z_clamped, SEA_STOPS),
    )
    return np.clip(rgb, 0, 255).astype(np.uint8)
