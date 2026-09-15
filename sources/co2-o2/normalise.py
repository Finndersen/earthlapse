"""Normalise data/raw/co2-o2/ into data/curated/co2.parquet as one spliced TimeSeries.

Three segments, newest first (README.md § Splice policy):

1. NOAA GML Mauna Loa annual means, AD 1959 -> present.
2. Bereiter et al. 2015 Antarctic ice-core composite, ~806 ka -> AD 2001.
3. GEOCARB III (Berner & Kothavala 2001), 570 Ma -> 0 Ma, 10 Myr spacing.

Each segment contributes only samples strictly older than everything in the segments before
it, so the spliced series is disjoint in `t` by construction: instrumental years win over the
ice core's youngest firn/ice rows, and ice-core measurements win over GEOCARB's model value at
0 Ma (a pre-industrial baseline with no fossil-fuel forcing).

The ice-core segment's oldest row and GEOCARB's oldest-surviving row are ~9.2 Myr apart with no
data between them -- not sparse coverage, no source at all. The series declares this as a `Gap`
(ADR-027) rather than let `TimeSeries.sample` bridge it log-linearly, which would read as a
glacial low across most of the Pliocene (README.md § Known gaps).

TRAP #1 -- three time conventions, one output. `t` is years before the fixed AD 2025 present
(the convention data/events.yaml and ADR-024 use):
- Mauna Loa `year` is a CE year: `t = 2025 - year`. A year after 2025 raises rather than
  producing negative `t`; moving the present is a project-wide decision, not a re-pin.
- Ice-core `age_gas_calBP` is years before **AD 1950**: `t = age + 75`. Skipping the offset
  shifts the whole ice-core record 75 years young, which near the present is most of the
  industrial rise.
- GEOCARB `Time(Ma)` is negative Myr: `t = abs(Ma) * 1e6`. The 75-year re-basing is far below
  the model's 10 Myr resolution and is not applied.

TRAP #2 -- GEOCARB `RCO2` is a dimensionless ratio to 280 ppm, not ppm:
`co2_ppm = RCO2 * 280`.

TRAP #3 -- the ice-core file starts with a UTF-8 BOM and uses CRLF line endings.

Uncertainty comes from each file's own column (Mauna Loa `unc`, ice-core `co2_1s_ppm`) as a
symmetric +/- band. GEOCARB III ships none, so its samples keep `lower`/`upper` None rather
than an invented band.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Gap, Interpolation, Sample, TimeSeries

PRESENT_CE_YEAR = 2025
"""The fixed present `t = 0` refers to (data/events.yaml, ADR-024)."""

BP_REFERENCE_CE_YEAR = 1950
"""Radiocarbon-convention "present" the ice-core ages are counted back from."""

ICE_CORE_AGE_OFFSET_YEARS = PRESENT_CE_YEAR - BP_REFERENCE_CE_YEAR

PREINDUSTRIAL_CO2_PPM = 280.0
"""RCO2 is expressed relative to this baseline (Berner & Kothavala 2001, GEOCARB III)."""

MA_TO_YEARS = 1e6

INSTRUMENTAL_FILENAME = "co2_annmean_mlo.txt"
ICE_CORE_FILENAME = "antarctica2015co2composite.txt"
MODEL_FILENAME = "phanerozoic_co2.txt"
RAW_FILENAMES = (INSTRUMENTAL_FILENAME, ICE_CORE_FILENAME, MODEL_FILENAME)

_NUMBER = r"-?\d+(?:\.\d+)?"
_THREE_COLUMN_ROW = re.compile(rf"^\s*({_NUMBER})\s+({_NUMBER})\s+({_NUMBER})\s*$")
_ICE_CORE_HEADER = ("age_gas_calBP", "co2_ppm", "co2_1s_ppm")
_MODEL_DATA_SECTION_MARKER = "DATA:"
_MODEL_ROW = re.compile(rf"^\s*({_NUMBER})\s+({_NUMBER})\s*$")


@dataclass(frozen=True)
class _Segment:
    name: str
    samples: tuple[Sample, ...]

    @property
    def oldest_t(self) -> float:
        return max(s.t for s in self.samples)


def _data_lines(text: str) -> Iterator[str]:
    for line in text.splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            yield line


def _three_floats(line: str, filename: str) -> tuple[float, float, float]:
    match = _THREE_COLUMN_ROW.match(line)
    if match is None:
        raise ValueError(f"{filename}: unparseable data row {line!r}")
    return float(match.group(1)), float(match.group(2)), float(match.group(3))


def _with_sigma(t: float, value: float, sigma: float) -> Sample:
    return Sample(t=t, value=value, lower=value - sigma, upper=value + sigma)


def _segment(name: str, samples: list[Sample]) -> _Segment:
    if not samples:
        raise ValueError(f"{name}: no data rows parsed")
    times = [s.t for s in samples]
    if len(set(times)) != len(times):
        raise ValueError(f"{name}: duplicate t values")
    return _Segment(name=name, samples=tuple(samples))


def _parse_instrumental(text: str) -> _Segment:
    samples = []
    for line in _data_lines(text):
        year, mean, unc = _three_floats(line, INSTRUMENTAL_FILENAME)
        if year > PRESENT_CE_YEAR:
            raise ValueError(
                f"{INSTRUMENTAL_FILENAME}: year {year:g} is after the fixed AD {PRESENT_CE_YEAR} "
                "present; t would be negative"
            )
        samples.append(_with_sigma(PRESENT_CE_YEAR - year, mean, unc))
    return _segment(INSTRUMENTAL_FILENAME, samples)


def _parse_ice_core(text: str) -> _Segment:
    lines = _data_lines(text.removeprefix("﻿"))
    header = tuple(next(lines, "").split())
    if header != _ICE_CORE_HEADER:
        raise ValueError(f"{ICE_CORE_FILENAME}: expected header {_ICE_CORE_HEADER}, got {header}")
    samples = []
    for line in lines:
        age_bp_1950, co2_ppm, sigma = _three_floats(line, ICE_CORE_FILENAME)
        samples.append(_with_sigma(age_bp_1950 + ICE_CORE_AGE_OFFSET_YEARS, co2_ppm, sigma))
    return _segment(ICE_CORE_FILENAME, samples)


def _parse_model(text: str) -> _Segment:
    lines = text.splitlines()
    data_start = next(
        i for i, line in enumerate(lines) if line.strip() == _MODEL_DATA_SECTION_MARKER
    )
    samples = []
    for line in lines[data_start + 1 :]:
        match = _MODEL_ROW.match(line)
        if match is None:
            continue
        ma, rco2 = float(match.group(1)), float(match.group(2))
        samples.append(Sample(t=abs(ma) * MA_TO_YEARS, value=rco2 * PREINDUSTRIAL_CO2_PPM))
    return _segment(MODEL_FILENAME, samples)


def _splice(newest_first: Sequence[_Segment]) -> tuple[list[Sample], list[int]]:
    """Each segment keeps only samples strictly older than every sample of the segments
    before it, however many of those survived their own trim.

    Returns the flat, not-yet-sorted sample list (`TimeSeries` sorts on construction) plus
    each segment's kept-row count, in the same order as `newest_first`. Because every kept
    segment's `t` range lies strictly above the one before it (`s.t > boundary`, `boundary`
    non-decreasing), the eventual ascending sort groups samples by segment in this same
    order -- so a caller can locate the boundary between any two segments in the sorted
    series from these counts alone, without re-deriving it from ages.
    """
    spliced: list[Sample] = []
    kept_counts: list[int] = []
    boundary = -math.inf
    for segment in newest_first:
        kept = [s for s in segment.samples if s.t > boundary]
        if not kept:
            raise ValueError(f"{segment.name}: no samples older than t={boundary:g}")
        spliced.extend(kept)
        kept_counts.append(len(kept))
        boundary = max(boundary, segment.oldest_t)
    return spliced, kept_counts


def _read(raw_dir: Path, filename: str) -> str:
    return (raw_dir / filename).read_text(encoding="utf-8")


def normalise(raw_dir: Path) -> list[CuratedShape]:
    instrumental = _parse_instrumental(_read(raw_dir, INSTRUMENTAL_FILENAME))
    ice_core = _parse_ice_core(_read(raw_dir, ICE_CORE_FILENAME))
    model = _parse_model(_read(raw_dir, MODEL_FILENAME))
    samples, kept_counts = _splice((instrumental, ice_core, model))
    # ADR-027: the ice-core composite and GEOCARB III are ten million years apart in
    # resolution, not merely sparse -- nothing observed or modelled CO2 in between (README §
    # Known gaps). Declared as a Gap spanning the ice-core segment's last kept row and the
    # model segment's first, located from the real kept counts rather than a hard-coded age,
    # so a re-pinned ice core or a narrower splice moves the gap with it.
    ice_core_end = kept_counts[0] + kept_counts[1] - 1
    return [
        TimeSeries(
            id="co2",
            unit="ppm",
            interpolation=Interpolation.LOG_LINEAR,
            samples=samples,
            gaps=[Gap(from_index=ice_core_end, to_index=ice_core_end + 1)],
        )
    ]


def main(raw_dir: Path, curated_dir: Path) -> None:
    for shape in normalise(raw_dir):
        write_shape(shape, curated_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    main(REPO_ROOT / "data" / "raw" / "co2-o2", REPO_ROOT / "data" / "curated")
