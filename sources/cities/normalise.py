"""Normalise data/raw/cities/ into data/curated/cities.parquet: one `FeatureSet` (ADR-035),
one record per city, merged from three raw CSVs (Chandler, Modelski Ancient, Modelski Modern --
README.md "Dedupe policy" for the full account of why and how).

Every raw row is `(City, OtherName, Country, Latitude, Longitude, Certainty, <one column per
dated population estimate>)`, sparse (most year columns blank for most rows). Chandler and
Modelski Ancient overlap in the ancient period (their own set of matching (city, country)
records); Chandler and Modelski Modern overlap in the modern period. The paper's own stated
policy for the ancient overlap ("we selected Modelski's values, as his work focused on this
ancient time period ... The final dataset retains both ... values for users to select at their
discretion") is the precedent this source follows for *both* overlaps: Chandler is the base
layer (it alone spans the full 2250 BC - AD 1975 range), and each Modelski file is merged in
*on top*, overwriting any exact-year estimate the two datasets disagree on and replacing the
merged record's own coordinates/certainty with Modelski's.

The merged, *full* dataset (every city that survives the merge, no matter how minor) is what
this module's `normalise()` curates -- ADR-035's own coordinator direction is explicit that the
curated data keeps everything; only the *published* layer (`pipeline/publish.py`'s
`FEATURE_LAYERS`, via `pipeline.notability.notable_features`) is filtered down to notable
cities.
"""

from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path

from pipeline.curated import write_shape
from pipeline.databuild import load_source_module
from pipeline.shapes import CuratedShape, Feature, FeatureCertainty, FeatureSet, PopulationEstimate

_fetch = load_source_module(Path(__file__).resolve().parent, "fetch")

CURATED_ID = "cities"

PRESENT_CE_YEAR = 2025
"""t = years before this fixed calendar present, matching sources/hyde's and sources/co2-o2's
own convention ("years before the AD 2025 present")."""

_METADATA_COLUMNS = ("City", "OtherName", "Country", "Latitude", "Longitude", "Certainty")

_CERTAINTY_BY_CODE: dict[str, FeatureCertainty] = {
    "1": FeatureCertainty.HIGH,
    "2": FeatureCertainty.MEDIUM,
    "3": FeatureCertainty.LOW,
}

_YEAR_COLUMN_RE = re.compile(r"^(BC|AD)_(\d+)$")


class CitiesFormatError(ValueError):
    """A raw CSV's schema or a value in it did not match what this source expects."""


def _year_column_to_t(column: str) -> float:
    match = _YEAR_COLUMN_RE.match(column)
    if match is None:
        raise CitiesFormatError(f"cities: unrecognised year column {column!r}")
    era, year_text = match.groups()
    year = int(year_text)
    return float(PRESENT_CE_YEAR - year if era == "AD" else PRESENT_CE_YEAR + year)


def _read_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    """Chandler/Modelski's own CSVs are latin-1 encoded, not UTF-8 (confirmed directly --
    decoding as UTF-8 raises on several accented place names)."""
    with path.open(encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise CitiesFormatError(f"{path}: no header row")
        missing = [c for c in _METADATA_COLUMNS if c not in reader.fieldnames]
        if missing:
            raise CitiesFormatError(f"{path}: missing column(s) {missing}")
        year_columns = [c for c in reader.fieldnames if c not in _METADATA_COLUMNS]
        rows = list(reader)
    return rows, year_columns


def _row_key(row: dict[str, str]) -> tuple[str, str]:
    return row["City"].strip().lower(), row["Country"].strip().lower()


def _row_estimates(row: dict[str, str], year_columns: list[str]) -> dict[float, int]:
    estimates: dict[float, int] = {}
    for column in year_columns:
        raw = row.get(column, "").strip()
        if not raw:
            continue
        try:
            population = int(float(raw))
        except ValueError as err:
            raise CitiesFormatError(
                f"cities: {row['City']!r} {column}={raw!r} is not numeric"
            ) from err
        if population > 0:  # a handful of rows use 0 to mean "no estimate", not "zero people"
            estimates[_year_column_to_t(column)] = population
    return estimates


class _MergedRecord:
    __slots__ = ("certainty", "country", "estimates", "lat", "lon", "name", "sources")

    def __init__(
        self,
        name: str,
        country: str,
        lat: float,
        lon: float,
        certainty: FeatureCertainty,
        estimates: dict[float, int],
        source: str,
    ) -> None:
        self.name = name
        self.country = country
        self.lat = lat
        self.lon = lon
        self.certainty = certainty
        self.estimates = estimates
        self.sources = {source}


class MergeCounts:
    """Reported by `merge_datasets` -- see README.md "Dedupe policy" for what each figure means."""

    def __init__(self) -> None:
        self.rows_seen = 0
        self.dropped_no_coordinates = 0
        self.dropped_no_estimates = 0
        self.merged_pairs = 0  # a (dataset, city) row folded into an already-seen record
        self.kept_cities = 0


def merge_datasets(
    raw_dir: Path,
) -> tuple[list[_MergedRecord], MergeCounts]:
    """Chandler first (the base layer -- the only one spanning the full range), then each
    Modelski file merged on top, overwriting matching years/coordinates/certainty for any
    (city, country) the two datasets share -- the paper's own stated precedent for the
    Chandler/Modelski ancient-period overlap, applied uniformly to both Modelski files."""
    counts = MergeCounts()
    merged: dict[tuple[str, str], _MergedRecord] = {}

    def merge_in(filename: str, source: str, *, overwrite: bool) -> None:
        rows, year_columns = _read_rows(raw_dir / filename)
        for row in rows:
            counts.rows_seen += 1
            try:
                lat, lon = float(row["Latitude"]), float(row["Longitude"])
            except (TypeError, ValueError):
                counts.dropped_no_coordinates += 1
                continue
            estimates = _row_estimates(row, year_columns)
            if not estimates:
                counts.dropped_no_estimates += 1
                continue
            certainty = _CERTAINTY_BY_CODE[row["Certainty"].strip()]
            key = _row_key(row)
            existing = merged.get(key)
            if existing is None:
                merged[key] = _MergedRecord(
                    name=row["City"].strip(),
                    country=row["Country"].strip(),
                    lat=lat,
                    lon=lon,
                    certainty=certainty,
                    estimates=dict(estimates),
                    source=source,
                )
                continue
            counts.merged_pairs += 1
            existing.sources.add(source)
            if overwrite:
                existing.estimates.update(estimates)  # Modelski wins any exact-year conflict
                existing.lat, existing.lon, existing.certainty = lat, lon, certainty
            else:
                for t, population in estimates.items():
                    existing.estimates.setdefault(t, population)

    merge_in("chandlerV2.csv", "chandler", overwrite=False)
    merge_in("modelskiAncientV2.csv", "modelski-ancient", overwrite=True)
    merge_in("modelskiModernV2.csv", "modelski-modern", overwrite=True)

    counts.kept_cities = len(merged)
    return list(merged.values()), counts


def _slug(text: str) -> str:
    """ASCII, lowercase, hyphen-joined -- a stable id derived from a name that never changes
    once assigned (this source has no external stable id to key off, unlike e.g. Wikidata QIDs
    elsewhere in this project)."""
    normalised = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalised.lower()).strip("-")
    return slug or "x"


def _feature_id(record: _MergedRecord, seen: dict[str, tuple[str, str]]) -> str:
    base = f"{_slug(record.name)}-{_slug(record.country)}"
    slug = base
    n = 2
    key = (record.name, record.country)
    while slug in seen and seen[slug] != key:
        slug = f"{base}-{n}"
        n += 1
    seen[slug] = key
    return slug


def normalise(raw_dir: Path) -> list[CuratedShape]:
    records, _counts = merge_datasets(raw_dir)
    seen: dict[str, tuple[str, str]] = {}
    features = [
        Feature(
            id=_feature_id(record, seen),
            name=record.name,
            country=record.country,
            lat=record.lat,
            lon=record.lon,
            certainty=record.certainty,
            estimates=[
                PopulationEstimate(t=t, population=population)
                for t, population in record.estimates.items()
            ],
        )
        for record in records
    ]
    return [FeatureSet(id=CURATED_ID, features=features)]


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "cities"
    _records, counts = merge_datasets(raw_dir)
    print(
        f"cities: {counts.rows_seen} raw rows across 3 datasets -> "
        f"{counts.dropped_no_coordinates} dropped (no coordinates), "
        f"{counts.dropped_no_estimates} dropped (no estimates), "
        f"{counts.merged_pairs} rows merged into an already-seen city, "
        f"{counts.kept_cities} distinct cities kept"
    )
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
