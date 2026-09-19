"""Shared 8-bit log-scale density encoding.

Factored out for the same reason `pipeline.palette` was factored out of `sources/paleodem`
(the hypsometric colour ramp `sources/plates-neoproterozoic` also needs, so the two can't
silently drift apart): a raster layer that publishes a real physical quantity per pixel, not
plain colour, needs the exact same encode formula and `D_MAX` constant wherever it is written
(`sources/<name>/normalise.py`, baking a byte into every pixel) and wherever it is described to
a consumer (`pipeline/publish.py`, writing the layer's own published decode metadata) -- one
place, so those two can never disagree about the formula or the calibration constant.

Currently used by `sources/hyde`'s `hyde_population_density` (ADR-031). The formula:

    v = round(255 * clamp(log10(1 + d) / log10(1 + D_MAX), 0, 1))

A log scale, not linear, because population density spans many orders of magnitude in one
frame (open ocean/desert at ~0 next to a mega-city core at 10^4-10^5 people/km^2) -- a linear
8-bit encoding would waste almost its entire range on values indistinguishable from zero.
`D_MAX` caps the scale at a real, data-derived ceiling (see `POPULATION_DENSITY_D_MAX`'s own
docstring for how it was chosen) rather than the theoretical maximum a single grid cell could
ever reach, so the encoding stays useful (spreads real, populated values across the byte range)
instead of clipping to protect against a value that essentially never occurs at this
resolution.
"""

from __future__ import annotations

import math

import numpy as np

POPULATION_DENSITY_D_MAX: float = 15_000.0
"""People per km^2 that decodes to the top of the 8-bit range (255). Chosen from the real,
published quantity -- the *downsampled* (1024x512, area-correctly averaged) density, not the
raw 4320x2160 grid (whose own single-cell maximum reaches ~48,600/km^2 in 2015, over a Hong
Kong/Manila/Dhaka-sized footprint that gets diluted into its neighbours by the ~4.2x4.2 block
average well before it ever reaches this D_MAX): measured across all 73 published frames
(`sources/hyde/README.md` "Population density encoding" has the exact measurement script and
figures), the global maximum after downsampling is 13,779.5 people/km^2, at 2015AD.
15,000 rounds that up to a clean figure with a small (~9%) margin, rather than clipping the
very frame that motivated the choice, while keeping the 8-bit range's precision concentrated
in the densities the published texture actually contains. Values above it (none observed in
this dataset) clamp to 255 rather than raising: an encoding ceiling is a documented lossy-range
decision, not a data error."""


def encode_log_density(value_people_per_km2: np.ndarray, d_max: float) -> np.ndarray:
    """`value_people_per_km2` (any shape, must be >= 0) -> the same shape, dtype uint8."""
    if np.any(value_people_per_km2 < 0):
        raise ValueError("density values must be >= 0")
    log_max = math.log10(1.0 + d_max)
    unit = np.log10(1.0 + value_people_per_km2) / log_max
    return np.clip(np.round(unit * 255.0), 0, 255).astype(np.uint8)


def decode_log_density(byte: int, d_max: float) -> float:
    """Inverse of `encode_log_density`, for one byte at a time -- exercised directly by tests
    and mirrored (not called) by the web-side TypeScript decoder in `web/src/data/curated.ts`,
    which must produce the same numbers from the same published `dMax`."""
    log_max = math.log10(1.0 + d_max)
    return math.pow(10.0, (byte / 255.0) * log_max) - 1.0
