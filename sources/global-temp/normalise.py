"""Normalise data/raw/global-temp/ into data/curated/mean_temp.parquet as one spliced TimeSeries
of absolute global mean surface temperature, in °C.

Three segments, newest first (README.md § Splice policy):

1. HadCRUT5 global annual means, AD 1850 -> present: anomalies against 1961-1990, made absolute
   with that period's 14.0 °C mean (Jones et al. 1999).
2. The Last Glacial Maximum Reanalysis (Osman et al. 2021), 24 ka -> 0 ka in 200-year bins,
   already absolute.
3. PhanDA (Judd et al. 2024), one absolute value per geological stage, 485 Ma -> the Holocene.

Each segment contributes only samples strictly older than everything in the segments before it,
so the series is disjoint in `t` by construction: measurements win over the reanalysis, and the
reanalysis's glacial cycle wins over PhanDA's stage averages.

TRAP #1 -- three time conventions, one output. `t` is years before the fixed AD 2025 present:
- HadCRUT5 `Time` is a CE year: `t = 2025 - year`. Its newest row is the running mean of the
  current, incomplete year; rows after AD 2025 lie past `t = 0` and are dropped.
- LGMR `age` is years before AD 1950: `t = age + 75`.
- PhanDA `AverageAge` is the stage's midpoint in Ma: `t = Ma * 1e6`, not re-based; 75 years is
  far below a stage's length.

TRAP #2 -- the bands are each file's own, at roughly matching coverage: HadCRUT5's 2.5-97.5%
limits, LGMR's ensemble mean ± 1.96 standard deviations, PhanDA's 5th-95th percentiles.

TRAP #3 -- LGMR ships as netCDF4/HDF5, read through the optional `data` extra (xarray); the
other two segments parse with the standard library alone.
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries

PRESENT_CE_YEAR = 2025
"""The fixed present `t = 0` refers to (data/events.yaml, ADR-024)."""

BP_REFERENCE_CE_YEAR = 1950
"""Radiocarbon-convention "present" the LGMR ages are counted back from."""

HADCRUT_BASELINE_ABSOLUTE_C = 14.0
"""Global mean surface temperature over 1961-1990, HadCRUT's anomaly baseline (Jones et al.
1999, Reviews of Geophysics 37:173)."""

LGMR_BAND_SIGMAS = 1.96
"""Ensemble standard deviations either side of the mean: a 95% band, matching HadCRUT5's."""

MA_TO_YEARS = 1e6

DECIMALS = 2
"""Every input reports to at least this precision; finer digits are float noise."""

INSTRUMENTAL_FILENAME = "HadCRUT.5.2.0.0.analysis.summary_series.global.annual.csv"
REANALYSIS_FILENAME = "LGMR_GMST_climo.nc"
PHANEROZOIC_FILENAME = "PhanDA_GMSTandCO2_percentiles.csv"
RAW_FILENAMES = (INSTRUMENTAL_FILENAME, REANALYSIS_FILENAME, PHANEROZOIC_FILENAME)

_HADCRUT_COLUMNS = (
    "Time",
    "Anomaly (deg C)",
    "Lower confidence limit (2.5%)",
    "Upper confidence limit (97.5%)",
)
_PHANDA_COLUMNS = ("AverageAge", "GMST_05", "GMST_50", "GMST_95")


@dataclass(frozen=True)
class Segment:
    name: str
    samples: tuple[Sample, ...]

    @property
    def oldest_t(self) -> float:
        return max(s.t for s in self.samples)


def _sample(t: float, value: float, lower: float, upper: float) -> Sample:
    return Sample(
        t=t,
        value=round(value, DECIMALS),
        lower=round(lower, DECIMALS),
        upper=round(upper, DECIMALS),
    )


def _segment(name: str, samples: list[Sample]) -> Segment:
    if not samples:
        raise ValueError(f"{name}: no data rows parsed")
    times = [s.t for s in samples]
    if len(set(times)) != len(times):
        raise ValueError(f"{name}: duplicate t values")
    return Segment(name=name, samples=tuple(samples))


def _csv_rows(text: str, required: Sequence[str], filename: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in required if c not in (reader.fieldnames or ())]
    if missing:
        raise ValueError(f"{filename}: missing columns {missing}")
    return list(reader)


def parse_instrumental(text: str) -> Segment:
    samples = []
    for row in _csv_rows(text, _HADCRUT_COLUMNS, INSTRUMENTAL_FILENAME):
        year, anomaly, lower, upper = (float(row[c]) for c in _HADCRUT_COLUMNS)
        if year > PRESENT_CE_YEAR:
            continue
        samples.append(
            _sample(
                PRESENT_CE_YEAR - year,
                HADCRUT_BASELINE_ABSOLUTE_C + anomaly,
                HADCRUT_BASELINE_ABSOLUTE_C + lower,
                HADCRUT_BASELINE_ABSOLUTE_C + upper,
            )
        )
    return _segment(INSTRUMENTAL_FILENAME, samples)


def parse_reanalysis(path: Path) -> Segment:
    import xarray as xr

    with xr.open_dataset(path) as ds:
        ages = ds["age"].values.tolist()
        means = ds["gmst"].values.tolist()
        sigmas = ds["gmst_std"].values.tolist()
    samples = []
    for age_bp_1950, mean, sigma in zip(ages, means, sigmas, strict=True):
        if not (math.isfinite(mean) and math.isfinite(sigma)):
            raise ValueError(f"{REANALYSIS_FILENAME}: missing value at {age_bp_1950} BP")
        half = LGMR_BAND_SIGMAS * sigma
        t = age_bp_1950 + PRESENT_CE_YEAR - BP_REFERENCE_CE_YEAR
        samples.append(_sample(t, mean, mean - half, mean + half))
    return _segment(REANALYSIS_FILENAME, samples)


def parse_phanerozoic(text: str) -> Segment:
    samples = []
    for row in _csv_rows(text, _PHANDA_COLUMNS, PHANEROZOIC_FILENAME):
        ma, p05, p50, p95 = (float(row[c]) for c in _PHANDA_COLUMNS)
        samples.append(_sample(ma * MA_TO_YEARS, p50, p05, p95))
    return _segment(PHANEROZOIC_FILENAME, samples)


def splice(newest_first: Sequence[Segment]) -> list[Sample]:
    """Each segment keeps only samples strictly older than every sample of the segments before
    it, however many of those survived their own trim."""
    spliced: list[Sample] = []
    boundary = -math.inf
    for segment in newest_first:
        kept = [s for s in segment.samples if s.t > boundary]
        if not kept:
            raise ValueError(f"{segment.name}: no samples older than t={boundary:g}")
        spliced.extend(kept)
        boundary = max(boundary, segment.oldest_t)
    return spliced


def normalise(raw_dir: Path) -> list[CuratedShape]:
    segments = (
        parse_instrumental((raw_dir / INSTRUMENTAL_FILENAME).read_text(encoding="utf-8")),
        parse_reanalysis(raw_dir / REANALYSIS_FILENAME),
        parse_phanerozoic((raw_dir / PHANEROZOIC_FILENAME).read_text(encoding="utf-8")),
    )
    return [
        TimeSeries(
            id="mean_temp",
            unit="°C",
            interpolation=Interpolation.LINEAR,
            samples=splice(segments),
        )
    ]


def main(raw_dir: Path, curated_dir: Path) -> None:
    for shape in normalise(raw_dir):
        write_shape(shape, curated_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    main(REPO_ROOT / "data" / "raw" / "global-temp", REPO_ROOT / "data" / "curated")
