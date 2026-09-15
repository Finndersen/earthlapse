"""Normalise sources/astronomy into 4 TimeSeries (day_length, moon_distance,
solar_luminosity, obliquity).

This source has no data/raw/ input. Per docs/DATA_SOURCES.md Tier 3, astronomy is
"computed, not sourced": every value below is either a closed-form formula or one of
a handful of *cited* published point estimates ("checkpoints"). `normalise()` ignores
`raw_dir` entirely -- see fetch.py and README.md for why.

Formulae and checkpoints are pure functions/data (no I/O) so they can be unit tested
directly against the checkpoint values in fixture/checkpoints.json.

Domains are deliberately restricted to where a citation actually constrains the
value -- e.g. day_length stops at 2.46 Ga (Lantink et al. 2022) rather than
extrapolating into the Hadean where no constraint exists. TimeSeries.sample()
already returns None outside a series' domain (pipeline/shapes.py), so no
extrapolation logic is needed here; building each domain from its own checkpoints'
min/max t is what makes that guarantee correct.

TRAP -- lunar recession is NOT linear. The Moon's present recession rate (~3.8 cm/yr,
from lunar laser ranging) cannot be extrapolated backward in time: doing so puts the
Moon at Earth's surface only ~1.5 Gyr ago, contradicting its ~4.5 Gyr age (the
"lunar time problem" -- Walker & Zahnle 1986). The resolution is that tidal
dissipation is dominated by shallow-sea resonances that depend on continental
configuration, so the historical *average* rate has been well below today's
anomalously high one. moon_distance_km() below reflects this: it interpolates
between cited paleo-distance estimates, never the present rate.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Final

from pipeline.curated import write_shape
from pipeline.shapes import (
    EARTH_FORMATION,
    CuratedShape,
    GeoTime,
    Interpolation,
    Sample,
    TimeSeries,
)

# --------------------------------------------------------------------- checkpoint model

_SAMPLES_PER_SERIES: Final = 200
"""Grid density for every series (see _dense_samples). For the two checkpoint-curve
series this is deliberately more points than the handful of checkpoints strictly
need -- since the curve between checkpoints is linear, the extra points are exact
restatements of the same line, not new information. They are emitted anyway so all
4 series share one sampling code path (_dense_samples) and so a future series whose
checkpoint curve is *not* piecewise-linear needs no code change here. Cost is
negligible: even at this density the whole source is tens of KB (see README.md
"Measured volume")."""


@dataclass(frozen=True)
class Checkpoint:
    """One published point estimate. `t` is years BP; `value` is in the series' unit;
    `lower`/`upper` are the *literature's own* uncertainty bounds, left `None` when
    the source gives none (never invented here)."""

    t: GeoTime
    value: float
    citation: str
    lower: float | None = None
    upper: float | None = None


@dataclass(frozen=True)
class Estimate:
    """A value plus optional bounds, interpolated from Checkpoints or read off a
    closed-form formula that has no bounds to give."""

    value: float
    lower: float | None = None
    upper: float | None = None


def _blend_optional(a: float | None, b: float | None, f: float) -> float | None:
    if a is None or b is None:
        return None
    return a + (b - a) * f


def interpolate_checkpoints(checkpoints: Sequence[Checkpoint], t: GeoTime) -> Estimate | None:
    """Piecewise-linear interpolation across checkpoints sorted by t, bounds blended
    the same way as the value. Returns None outside [checkpoints[0].t,
    checkpoints[-1].t] -- deliberately: the literature gives no constraint there, and
    returning a value would be extrapolation dressed up as data.

    A `t` that lands exactly on a checkpoint returns that checkpoint's own value and
    bounds directly, rather than going through the pairwise blend below. Blending
    would otherwise silently drop a checkpoint's own published bounds whenever its
    *neighbour* in the chosen bracketing pair happens to have none (e.g. day_length's
    620 Ma Williams bound blended against the unbounded present-day anchor at t=0) --
    the value comes out right at f=1.0, since a None-free blend, but
    `_blend_optional` still refuses to blend a None bound even at f=1.0, discarding a
    real, cited uncertainty range at the very point it was measured."""
    ordered = sorted(checkpoints, key=lambda c: c.t)
    lo, hi = ordered[0].t, ordered[-1].t
    if not lo <= t <= hi:
        return None
    for c in ordered:
        if c.t == t:
            return Estimate(value=c.value, lower=c.lower, upper=c.upper)
    for a, b in pairwise(ordered):
        if a.t <= t <= b.t:
            f = (t - a.t) / (b.t - a.t)
            return Estimate(
                value=a.value + (b.value - a.value) * f,
                lower=_blend_optional(a.lower, b.lower, f),
                upper=_blend_optional(a.upper, b.upper, f),
            )
    raise AssertionError(f"unreachable: t={t} within [{lo}, {hi}] but no bracketing pair found")


# --------------------------------------------------------------------------- day_length

DAY_LENGTH_CHECKPOINTS: Final[tuple[Checkpoint, ...]] = (
    Checkpoint(
        t=0.0,
        value=24.0,
        citation="Present mean solar day; 24 h by definition of the civil hour.",
    ),
    Checkpoint(
        t=6.20e8,
        value=21.9,
        lower=21.5,
        upper=22.3,
        citation=(
            "Williams, G.E. (2000), 'Geological constraints on the Precambrian "
            "history of Earth's rotation and the Moon's orbit', Reviews of "
            "Geophysics 38(1), 37-59 -- Elatina-Reynella tidal rhythmites, South "
            "Australia, ~620 Ma: length of day 21.9 +/- 0.4 h."
        ),
    ),
    Checkpoint(
        t=1.0e9,
        value=19.0,
        lower=18.0,
        upper=20.0,
        citation=(
            "Mitchell, R.N. & Kirscher, U. (2023), 'Mid-Proterozoic day length "
            "stalled by tidal resonance', Nature Geoscience 16, 567-569 -- day "
            "length held at ~19 h for roughly 1 Gyr (lunar oceanic tidal torque "
            "and solar atmospheric thermal tidal torque nearly cancelling); stall "
            "end, ~1.0 Ga."
        ),
    ),
    Checkpoint(
        t=2.0e9,
        value=19.0,
        lower=18.0,
        upper=20.0,
        citation="Mitchell & Kirscher (2023), as above -- stall start, ~2.0 Ga.",
    ),
    Checkpoint(
        t=2.46e9,
        value=16.9,
        lower=16.7,
        upper=17.1,
        citation=(
            "Lantink, M.L., Davies, J.H.F.L., Ovtcharova, M. & Hilgen, F.J. "
            "(2022), 'Milankovitch cycles in banded iron formations constrain "
            "the Earth-Moon system 2.46 billion years ago', PNAS 119(40), "
            "e2117146119 -- Joffre Member BIF cyclostratigraphy, U-Pb dated: "
            "day length 16.9 +/- 0.2 h at 2.46 Ga. The oldest reliable geological "
            "constraint on Earth-Moon dynamics, which is why the domain stops here "
            "rather than extrapolating into the Hadean/early Archean."
        ),
    ),
)
DAY_LENGTH_DOMAIN: Final[tuple[GeoTime, GeoTime]] = (
    DAY_LENGTH_CHECKPOINTS[0].t,
    DAY_LENGTH_CHECKPOINTS[-1].t,
)


def day_length_hours(t: GeoTime) -> Estimate | None:
    return interpolate_checkpoints(DAY_LENGTH_CHECKPOINTS, t)


# ------------------------------------------------------------------------ moon_distance

MOON_DISTANCE_CHECKPOINTS: Final[tuple[Checkpoint, ...]] = (
    Checkpoint(
        t=0.0,
        value=384_400.0,
        citation="Present mean Earth-Moon distance (semi-major axis); IAU / lunar laser ranging.",
    ),
    Checkpoint(
        t=6.20e8,
        value=370_900.0,
        lower=369_000.0,
        upper=372_800.0,
        citation=(
            "Williams (2000), as cited under day_length -- the same Elatina-"
            "Reynella rhythmite record gives a lunar semimajor axis of "
            "58.16 +/- 0.30 Earth radii at 620 Ma, i.e. (3.709 +/- 0.019)e8 m."
        ),
    ),
    Checkpoint(
        t=2.46e9,
        value=321_800.0,
        lower=315_300.0,
        upper=328_300.0,
        citation=(
            "Lantink et al. (2022), as cited under day_length -- Earth-Moon "
            "distance 321,800 +/- 6,500 km at 2.46 Ga."
        ),
    ),
)
MOON_DISTANCE_DOMAIN: Final[tuple[GeoTime, GeoTime]] = (
    MOON_DISTANCE_CHECKPOINTS[0].t,
    MOON_DISTANCE_CHECKPOINTS[-1].t,
)


def moon_distance_km(t: GeoTime) -> Estimate | None:
    return interpolate_checkpoints(MOON_DISTANCE_CHECKPOINTS, t)


# --------------------------------------------------------------------- solar_luminosity

SOLAR_AGE_YEARS: Final = 4.57e9
"""t_sun in Gough (1981): the Sun's age today, i.e. time since it reached the
zero-age main sequence. Deliberately distinct from pipeline.shapes.EARTH_FORMATION
(4.567e9) -- the Sun's main-sequence age and Earth's accretion age are independently
measured and differ by a few Myr; this module keeps both as given rather than forcing
them equal."""


def solar_luminosity_rel(t: GeoTime) -> float:
    """L(t)/L0 -- Gough, D.O. (1981), 'Solar interior structure and luminosity
    variations', Solar Physics 74, 21-34:

        L/L0 = 1 / (1 + 0.4 * (1 - age/t_sun)),  age = t_sun - t

    At t=0 (today), age=t_sun and L/L0=1 exactly. At t=t_sun (the Sun's birth),
    L/L0 = 1/1.4 ~= 0.714 -- the canonical "faint young Sun" ~30% deficit. Exact
    closed form: no uncertainty bounds to carry.
    """
    age = SOLAR_AGE_YEARS - t
    return 1.0 / (1.0 + 0.4 * (1.0 - age / SOLAR_AGE_YEARS))


SOLAR_LUMINOSITY_DOMAIN: Final[tuple[GeoTime, GeoTime]] = (0.0, EARTH_FORMATION)
"""Per spec: 0 to 4.567e9 (Earth's formation) -- the formula is valid over the Sun's
main-sequence lifetime so far, which covers the whole of Earth's history."""


# ---------------------------------------------------------------------------- obliquity

_LASKAR_2004_CITATION: Final = (
    "Laskar, J., Robutel, P., Joutel, F., Gastineau, M., Correia, A.C.M. & "
    "Levrard, B. (2004), 'A long-term numerical solution for the insolation "
    "quantities of the Earth', Astronomy & Astrophysics 428, 261-285 -- the La2004 "
    "solution, numerically reliable over roughly the last 250 Myr (chaotic "
    "divergence dominates beyond that). Obliquity is carried here at its long-term "
    "mean (~23.3 deg) with the ~22.1-24.5 deg Milankovitch-cycle amplitude as "
    "bounds, rather than modelling the ~41 kyr cycle itself: at this project's grid "
    "spacing the true cycle would alias into noise, and a claimed cycle *phase* "
    "hundreds of Myr back is not something La2004 (or any solution) actually "
    "supports. See README.md for the reasoning."
)

OBLIQUITY_CHECKPOINTS: Final[tuple[Checkpoint, ...]] = (
    Checkpoint(t=0.0, value=23.3, lower=22.1, upper=24.5, citation=_LASKAR_2004_CITATION),
    Checkpoint(t=2.5e8, value=23.3, lower=22.1, upper=24.5, citation=_LASKAR_2004_CITATION),
)
OBLIQUITY_DOMAIN: Final[tuple[GeoTime, GeoTime]] = (
    OBLIQUITY_CHECKPOINTS[0].t,
    OBLIQUITY_CHECKPOINTS[-1].t,
)


def mean_obliquity_deg(t: GeoTime) -> Estimate | None:
    return interpolate_checkpoints(OBLIQUITY_CHECKPOINTS, t)


# ------------------------------------------------------------------------- dense grid


def log_spaced_grid(hi: GeoTime, n: int) -> list[GeoTime]:
    """`n` points covering [0, hi] inclusive, log-spaced above a tiny floor so the
    grid is dense near the present and coarser in deep time -- every domain in this
    module starts at 0.0 (present), which is the only case this needs to handle."""
    if n < 3:
        raise ValueError(
            f"n must be >= 3 to include both endpoints plus an interior point, got {n}"
        )
    if hi <= 0.0:
        raise ValueError(f"hi must be positive, got {hi}")
    floor = hi * 1e-6
    interior = n - 2
    log_span = math.log(hi / floor)
    points = [0.0]
    points.extend(floor * math.exp(log_span * i / interior) for i in range(interior))
    points.append(hi)
    return points


def _dense_samples(
    curve: Callable[[GeoTime], float | Estimate | None],
    domain: tuple[GeoTime, GeoTime],
    n: int,
    checkpoint_ts: Sequence[GeoTime] = (),
) -> list[Sample]:
    """Evaluate `curve` on a dense log-spaced grid over `domain`, plus any
    `checkpoint_ts` merged in so a checkpoint-curve's kinks (e.g. the day_length
    stall boundaries) land on an exact stored sample rather than being rounded off
    by whichever grid point happens to be nearest."""
    lo, hi = domain
    assert lo == 0.0, "log_spaced_grid assumes every domain here starts at 0.0"
    grid = sorted({*log_spaced_grid(hi, n), *checkpoint_ts})
    samples: list[Sample] = []
    for t in grid:
        result = curve(t)
        if result is None:
            continue
        if isinstance(result, Estimate):
            samples.append(Sample(t=t, value=result.value, lower=result.lower, upper=result.upper))
        else:
            samples.append(Sample(t=t, value=result))
    return samples


# ------------------------------------------------------------------------------- build


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Sample all 4 formulae/checkpoint curves onto dense grids and return them as
    TimeSeries. `raw_dir` is unused: this source has no data/raw/ input."""
    return [
        TimeSeries(
            id="day_length",
            unit="h",
            interpolation=Interpolation.LINEAR,
            samples=_dense_samples(
                day_length_hours,
                DAY_LENGTH_DOMAIN,
                _SAMPLES_PER_SERIES,
                checkpoint_ts=[c.t for c in DAY_LENGTH_CHECKPOINTS],
            ),
        ),
        TimeSeries(
            id="moon_distance",
            unit="km",
            interpolation=Interpolation.LINEAR,
            samples=_dense_samples(
                moon_distance_km,
                MOON_DISTANCE_DOMAIN,
                _SAMPLES_PER_SERIES,
                checkpoint_ts=[c.t for c in MOON_DISTANCE_CHECKPOINTS],
            ),
        ),
        TimeSeries(
            id="solar_luminosity",
            unit="relative",
            interpolation=Interpolation.LINEAR,
            samples=_dense_samples(
                solar_luminosity_rel, SOLAR_LUMINOSITY_DOMAIN, _SAMPLES_PER_SERIES
            ),
        ),
        TimeSeries(
            id="obliquity",
            unit="deg",
            interpolation=Interpolation.LINEAR,
            samples=_dense_samples(
                mean_obliquity_deg,
                OBLIQUITY_DOMAIN,
                _SAMPLES_PER_SERIES,
                checkpoint_ts=[c.t for c in OBLIQUITY_CHECKPOINTS],
            ),
        ),
    ]


def main(raw_dir: Path, curated_dir: Path) -> None:
    for shape in normalise(raw_dir):
        write_shape(shape, curated_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    main(REPO_ROOT / "data" / "raw" / "astronomy", REPO_ROOT / "data" / "curated")
