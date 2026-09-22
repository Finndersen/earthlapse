"""Normalise data/raw/lr04/ into three curated `TimeSeries`, 0-5.32 Ma.

- `benthic_d18o` -- the LR04 stack itself (Lisiecki & Raymo 2005), per mil, with the stack's
  own one-standard-error band.
- `sea_level` -- an approximate global mean sea-level anomaly relative to present, in metres.
- `ice_volume` -- a normalised ice-volume scalar: 0 at present, 1 at the Last Glacial Maximum.

The two derived series are one linear scaling of d18O, calibrated on two points of the stack
itself (README.md § Calibration): its present-day value maps to 0, and its mean over the EPILOG
LGM chronozone (19-23 ka; Mix, Bard & Schneider 2001) maps to Lambeck et al. 2014's LGM global
mean sea level, -134 m. Benthic d18O mixes ice volume with deep-water temperature, so this is a
rough reading, adequate for the globe's schematic ice caps and shelf exposure, not a sea-level
reconstruction. The derived series carry no uncertainty band: the calibration's own error
dominates the stack's standard error, and propagating only the latter would understate it.

LR04 ages are thousands of years before AD 1950; `t` is years before the fixed AD 2025 present
(ADR-024), so `t = age_ka * 1000 + 75`, as for the co2-o2 ice core.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries

RAW_FILENAME = "lisiecki2005-d18o-stack-noaa.txt"
DATA_HEADER = ("age_calkaBP", "d18O_benthic", "d18O_error")

AGE_OFFSET_YEARS = 2025 - 1950
"""LR04's "present" is AD 1950; the project's is AD 2025."""

LGM_CHRONOZONE_KA = (19.0, 23.0)
"""EPILOG's Last Glacial Maximum chronozone (Mix, Bard & Schneider 2001, QSR 20:627-657)."""

LGM_SEA_LEVEL_M = -134.0
"""Global mean sea level at the LGM relative to present (Lambeck et al. 2014, PNAS 111:15296)."""

D18O_ID = "benthic_d18o"
SEA_LEVEL_ID = "sea_level"
ICE_VOLUME_ID = "ice_volume"


@dataclass(frozen=True)
class StackRow:
    age_ka: float
    d18o: float
    error: float


@dataclass(frozen=True)
class Calibration:
    """The linear d18O -> ice-volume map, fixed by two anchor values of the stack.

    Outputs are rounded to 1e-4 of LGM ice and 0.1 m: the stack reports d18O to 0.01 per mil,
    about 0.8 m of sea level, so finer digits would be noise."""

    present_d18o: float
    lgm_d18o: float

    def __post_init__(self) -> None:
        if self.lgm_d18o <= self.present_d18o:
            raise ValueError(
                f"LGM d18O {self.lgm_d18o} is not heavier than present {self.present_d18o}"
            )

    def _lgm_fraction(self, d18o: float) -> float:
        return (d18o - self.present_d18o) / (self.lgm_d18o - self.present_d18o)

    def ice_volume(self, d18o: float) -> float:
        return round(self._lgm_fraction(d18o), 4) + 0.0  # + 0.0 folds -0.0 into 0.0

    def sea_level_m(self, d18o: float) -> float:
        return round(LGM_SEA_LEVEL_M * self._lgm_fraction(d18o), 1) + 0.0


def parse_stack(text: str) -> list[StackRow]:
    """Rows of the NOAA template file's data table: every line after the tab-separated
    `DATA_HEADER` that is not a `#` comment. Ages must strictly increase."""
    lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
    if not lines or tuple(lines[0].split("\t")) != DATA_HEADER:
        found = lines[0] if lines else "nothing"
        raise ValueError(f"{RAW_FILENAME}: expected header {DATA_HEADER}, got {found!r}")
    rows: list[StackRow] = []
    for line in lines[1:]:
        fields = line.split("\t")
        if len(fields) != len(DATA_HEADER):
            raise ValueError(f"{RAW_FILENAME}: unparseable data row {line!r}")
        row = StackRow(*(float(field) for field in fields))
        if rows and row.age_ka <= rows[-1].age_ka:
            raise ValueError(f"{RAW_FILENAME}: age {row.age_ka:g} ka does not increase")
        rows.append(row)
    if not rows:
        raise ValueError(f"{RAW_FILENAME}: no data rows")
    return rows


def calibrate(rows: Sequence[StackRow]) -> Calibration:
    if rows[0].age_ka != 0.0:
        raise ValueError(f"{RAW_FILENAME}: first row is {rows[0].age_ka:g} ka, not the present")
    youngest_ka, oldest_ka = LGM_CHRONOZONE_KA
    lgm = [row.d18o for row in rows if youngest_ka <= row.age_ka <= oldest_ka]
    if not lgm:
        raise ValueError(f"{RAW_FILENAME}: no rows inside the LGM chronozone {LGM_CHRONOZONE_KA}")
    return Calibration(present_d18o=rows[0].d18o, lgm_d18o=statistics.fmean(lgm))


def _t(row: StackRow) -> float:
    return row.age_ka * 1000.0 + AGE_OFFSET_YEARS


def normalise(raw_dir: Path) -> list[CuratedShape]:
    rows = parse_stack((raw_dir / RAW_FILENAME).read_text(encoding="utf-8"))
    calibration = calibrate(rows)
    return [
        TimeSeries(
            id=D18O_ID,
            unit="‰",
            interpolation=Interpolation.LINEAR,
            samples=[
                Sample(
                    t=_t(r),
                    value=r.d18o,
                    lower=round(r.d18o - r.error, 2),
                    upper=round(r.d18o + r.error, 2),
                )
                for r in rows
            ],
        ),
        TimeSeries(
            id=SEA_LEVEL_ID,
            unit="m",
            interpolation=Interpolation.LINEAR,
            samples=[Sample(t=_t(r), value=calibration.sea_level_m(r.d18o)) for r in rows],
        ),
        TimeSeries(
            id=ICE_VOLUME_ID,
            unit="LGM = 1",
            interpolation=Interpolation.LINEAR,
            samples=[Sample(t=_t(r), value=calibration.ice_volume(r.d18o)) for r in rows],
        ),
    ]


def main(raw_dir: Path, curated_dir: Path) -> None:
    for shape in normalise(raw_dir):
        write_shape(shape, curated_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    main(REPO_ROOT / "data" / "raw" / "lr04", REPO_ROOT / "data" / "curated")
