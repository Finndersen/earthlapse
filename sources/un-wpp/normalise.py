"""Normalise data/raw/un-wpp/ into data/curated/population_wpp.parquet: the world's total
population each year from 1950 to the AD 2025 present, in people.

Rows are the `World` location's `Medium` variant: estimates to 2023, the medium projection after.
`PopTotal` is in thousands. `Time` is a CE year (1 July), so `t = 2025 - year`; years after the
present are dropped.
"""

from __future__ import annotations

import csv
import gzip
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries

RAW_FILENAME = "WPP2024_TotalPopulationBySex.csv.gz"
CURATED_ID = "population_wpp"
PRESENT_CE_YEAR = 2025
_LOCATION = "World"
_VARIANT = "Medium"
_THOUSANDS = 1_000


def parse_world_total(path: Path) -> list[Sample]:
    samples = []
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["Location"] != _LOCATION or row["Variant"] != _VARIANT:
                continue
            year = int(row["Time"])
            if year <= PRESENT_CE_YEAR:
                samples.append(
                    Sample(
                        t=float(PRESENT_CE_YEAR - year), value=float(row["PopTotal"]) * _THOUSANDS
                    )
                )
    if not samples:
        raise ValueError(f"{path.name}: no {_LOCATION} {_VARIANT} rows")
    return samples


def normalise(raw_dir: Path) -> list[CuratedShape]:
    return [
        TimeSeries(
            id=CURATED_ID,
            unit="people",
            interpolation=Interpolation.LOG_LINEAR,
            samples=parse_world_total(raw_dir / RAW_FILENAME),
        )
    ]


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    curated_dir = REPO_ROOT / "data" / "curated"
    for shape in normalise(REPO_ROOT / "data" / "raw" / "un-wpp"):
        write_shape(shape, curated_dir)
