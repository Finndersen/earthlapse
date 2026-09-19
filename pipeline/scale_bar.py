"""Where the portrait plates' scale bar sits, shared by the two places that need to know
(ADR-015).

The generator no longer draws a bar (`pipeline/prompts.py` `PORTRAIT_STYLE`), but the 40 already
generated and pinned plates still carry one (ADR-005: a pin is never regenerated), so both:

  - `pipeline.morph`, computing optical flow from the pinned candidates, which still must not let
    the bar corrupt correspondence or warp into a hook or squiggle;
  - `pipeline.exposure`, erasing it from the *published* derivative so the viewer never shows it;

need the same "known-layout band below the subject" anchor, calibrated once, by the same
constants and the same subject-extent finder -- not a contrast or shape detector to *locate* the
bar, which ADR-015 found unreliable on this corpus. `box_from_mask`, `scale_bar_band` and the
constants below are that one place; a caller never touches a pixel a correctly-anchored search
would call subject, so an imprecise extent only ever costs band precision, not anatomy.

OpenCV (`opencv-python-headless`) and numpy are core dependencies of this project (ADR-015):
`pipeline.exposure`, which `earthtime publish` always runs, needs them directly for the erase
below, so they can no longer be the optional `morph` extra's alone to provide.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

# See pipeline/morph.py's own module docstring for the full rationale (the "above" margin and the
# right-hand cutoff were each calibrated against the pinned corpus by ADR-015).
SCALE_BAR_BAND_ABOVE = 0.10  # how far above the extent's bottom the excluded band starts
# `pipeline.exposure`'s publish-time erase needs to reach the bar every time, not just often enough
# that the flow field's own subject clip (never touch a pixel the extent's mask calls subject)
# hides an occasional miss, which is all `pipeline.morph` ever needed. Measured directly against
# all 40 pinned plates (the bar's own row, found by the same brightness-above-local-backdrop
# statistic `pipeline.exposure.subject_mask` already uses, restricted to below each plate's own
# subject extent): 37 plates need at most 0.10 below the extent's bottom, matching the original
# margin's own reasoning; three microscope plates -- `opisthokonta` (0.188), `eumetazoa` (0.195),
# `gnathostomata` (0.230) -- sit well past it, their subjects framed unusually small relative to
# how far below them the bar was drawn. 0.32 gives every plate's bar comfortable clearance,
# including from the erase's own feathered edge. Harmless to widen: nothing inside the band is
# erased unless it also passes `pipeline.exposure`'s own line-shape and colour tests, and the
# subject is separately protected regardless of the band's size, so a wider search band only ever
# looks at more backdrop, never risks more anatomy.
SCALE_BAR_BAND_BELOW = 0.32
SCALE_BAR_BAND_RIGHT_MARGIN = 0.2  # how far past the subject's own centre it reaches

# `box_from_mask`'s "detached part vs. noise" rule: a companion at least this fraction of the
# largest component's area is kept as part of the subject extent; a smaller one -- a fleck of
# noise the 3x3 opening did not already remove -- is not. Applies identically to
# `pipeline.morph.detect_subject_box`'s own mask and to `bar_search_extent`'s; moving here does
# not change either's numeric output (see this module's own docstring).
COMPANION_AREA_FRACTION = 0.1


class SubjectExtent(Protocol):
    """Anything with a subject's bounding box in plate UV. `pipeline.flowfield.SubjectBox`
    satisfies this structurally, so this module never has to import it."""

    left: float
    top: float
    right: float
    bottom: float


@dataclass(frozen=True)
class Extent:
    """A concrete `SubjectExtent`."""

    left: float
    top: float
    right: float
    bottom: float


@dataclass(frozen=True)
class ScaleBarBand:
    """A generous band, in plate UV, that brackets the plate's scale bar. Never empty: a valid
    `SubjectExtent` always has `bottom <= 1.0` and `left < right`, so `top < bottom` and
    `right > 0.0` hold here too."""

    left: float
    top: float
    right: float
    bottom: float


def scale_bar_band(box: SubjectExtent) -> ScaleBarBand:
    """A band below `box` that brackets the plate's scale bar (see the module comment on the
    `SCALE_BAR_BAND_*` constants). A purely geometric function: `box` should be a vignette-robust
    subject extent, not a plain frame-corner-threshold box, but this function does not care which
    it is given."""
    centre_u = (box.left + box.right) / 2
    top = max(0.0, box.bottom - SCALE_BAR_BAND_ABOVE)
    bottom = min(1.0, box.bottom + SCALE_BAR_BAND_BELOW)
    right = min(1.0, centre_u + SCALE_BAR_BAND_RIGHT_MARGIN)
    return ScaleBarBand(left=0.0, top=top, right=right, bottom=bottom)


def band_pixels(band: ScaleBarBand, width: int, height: int) -> tuple[slice, slice]:
    """`band`, in plate UV, as row/column slices of a `width`x`height` pixel grid."""
    top = int(band.top * height)
    bottom = min(height, -int(-band.bottom * height))  # ceil without importing math
    left = int(band.left * width)
    right = min(width, -int(-band.right * width))
    return slice(top, bottom), slice(left, right)


def box_from_mask(mask: NDArray[np.uint8], size: int) -> Extent | None:
    """The bounding box of `mask`'s significant components against a `size`x`size` grid: the
    largest connected component and any companion at least `COMPANION_AREA_FRACTION` of its area
    (a detached part of one subject -- a tentacle, a trailing flagellum -- is kept; a speck of
    noise is not), after a 3x3 opening. None when nothing survives -- callers with a fallback
    should use it; `pipeline.morph.detect_subject_box` has none, so it raises instead.

    Shared, byte-for-byte, by `pipeline.morph`'s own subject-box and scale-bar-extent finders and
    by `pipeline.exposure`'s publish-time erase: one connected-component technique, not a second
    copy that could drift from the first and change what either module treats as "the subject".
    """
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), dtype=np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    if count < 2:
        return None
    components = stats[1:]
    largest = int(components[:, cv2.CC_STAT_AREA].max())
    kept = components[components[:, cv2.CC_STAT_AREA] >= COMPANION_AREA_FRACTION * largest]
    left = int(kept[:, cv2.CC_STAT_LEFT].min())
    top = int(kept[:, cv2.CC_STAT_TOP].min())
    right = int((kept[:, cv2.CC_STAT_LEFT] + kept[:, cv2.CC_STAT_WIDTH]).max())
    bottom = int((kept[:, cv2.CC_STAT_TOP] + kept[:, cv2.CC_STAT_HEIGHT]).max())
    return Extent(left=left / size, top=top / size, right=right / size, bottom=bottom / size)
