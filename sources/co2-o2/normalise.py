"""Normalise data/raw/co2-o2/ into data/curated/co2.parquet as a TimeSeries.

TRAP #1 — units: column 2 of the source file (`RCO2`) is a dimensionless ratio of
atmospheric CO2 to the pre-industrial baseline, **not ppm**.
`co2_ppm = RCO2 * PREINDUSTRIAL_CO2_PPM`. Skipping this leaves values around 1.0 instead
of ~280 — wrong by 280x and still superficially plausible.

TRAP #2 — sign and units of time: column 1 (`Time(Ma)`) is millions of years, negative
into the past (e.g. -570 for 570 Ma). `t` (years BP) = abs(Ma) * 1e6.

GEOCARB III ships no uncertainty column, so `Sample.lower`/`Sample.upper` are left None
rather than inventing an error band. Coverage stops at 570 Ma (t = 5.7e8); `WorldState`
returns None beyond it via `TimeSeries.sample`'s domain check — there is no extrapolation.
"""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries

_RAW_FILENAME = "phanerozoic_co2.txt"
_DATA_SECTION_MARKER = "DATA:"
_DATA_ROW = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$")

PREINDUSTRIAL_CO2_PPM = 280.0
"""RCO2 is expressed relative to this baseline (Berner & Kothavala 2001, GEOCARB III)."""

MA_TO_YEARS = 1e6


def _parse_samples(text: str) -> list[Sample]:
    lines = text.splitlines()
    data_start = next(i for i, line in enumerate(lines) if line.strip() == _DATA_SECTION_MARKER)
    samples = []
    for line in lines[data_start + 1 :]:
        match = _DATA_ROW.match(line)
        if match is None:
            continue
        ma, rco2 = float(match.group(1)), float(match.group(2))
        t = abs(ma) * MA_TO_YEARS
        samples.append(Sample(t=t, value=rco2 * PREINDUSTRIAL_CO2_PPM))
    if not samples:
        raise ValueError(f"no data rows parsed from {_RAW_FILENAME}")
    return samples


def normalise(raw_dir: Path) -> list[CuratedShape]:
    text = (raw_dir / _RAW_FILENAME).read_text()
    samples = _parse_samples(text)
    return [
        TimeSeries(id="co2", unit="ppm", interpolation=Interpolation.LOG_LINEAR, samples=samples)
    ]


def main(raw_dir: Path, curated_dir: Path) -> None:
    for shape in normalise(raw_dir):
        write_shape(shape, curated_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    main(REPO_ROOT / "data" / "raw" / "co2-o2", REPO_ROOT / "data" / "curated")
