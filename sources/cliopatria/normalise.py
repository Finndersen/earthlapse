"""Normalise data/raw/cliopatria/cliopatria.geojson into the historical-empires layer (ADR-059).

Two outputs, built from one list of snapshots so their ids cannot diverge:

- `cliopatria_polities.parquet` -- a `FeatureSet` with one `Feature` per kept snapshot: the
  polity's canonical name, a label anchor, and one estimate carrying the snapshot's area and its
  half-open span, active for `t_end < t <= t_start`.
- `data/media/vectors/cliopatria_territories-<hash>.json` -- the simplified territory of every
  snapshot, keyed by the same feature id (`write_outputs`).

**Scope.** Only `Type == "POLITY"` rows are territorial extents. Of those, only the polities the
empire roster (`roster.toml`) names are kept, each over its full lifespan up to `CUTOFF_CE_YEAR`.

**Duplicate aggregate entries.** Cliopatria uses a parenthesised `Name` (e.g. `"(Roman Empire)"`)
both for an aggregate of one entity's own successive periods and for a genuinely distinct
grouping with no bare counterpart (README.md "Duplicate aggregate entries"). `_canonical_name`
strips every wrapping pair, so the first case merges and the second is a plain rename.
`_NAME_ALIASES` folds `"(British Empire)"` into `"British Colonial Empire"`, which paren-stripping
alone cannot unify. `_EXCLUDED_NAMES` drops `"Greek Dark Ages"`, a period rather than a polity.

**One geometry per member per year.** A parenthesised window often spans different years from
the bare one and draws a different footprint (for colonial empires it is metropole plus
colonies), so a member's year is drawn from a bare window wherever one covers it, and from a
parenthesised one only in the gaps (`_resolve_years`). The resolved segments are then thinned
(`_thin`) so a snapshot is kept only where the territory changes meaningfully.
"""

from __future__ import annotations

import functools
import json
import math
import re
import tomllib
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from itertools import pairwise
from pathlib import Path
from typing import Self

import numpy as np
import shapely
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.coords import CoordinateSequence
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry

from pipeline.audio import content_hashed_filename
from pipeline.curated import write_shape
from pipeline.shapes import (
    CuratedShape,
    Feature,
    FeatureCertainty,
    FeatureSet,
    GeoTime,
    PopulationEstimate,
)

FEATURE_SET_ID = "cliopatria_polities"

PRESENT_CE_YEAR = 2025
"""t = years before this fixed calendar present, matching sources/hyde's, sources/cities' and
sources/co2-o2's own convention. `FromYear`/`ToYear` are signed integers (negative = BCE)."""

CUTOFF_CE_YEAR = 1900
"""Exclude any polity-window material after this calendar year: past it, Cliopatria is dominated
by modern nation-states rather than the historical empires this layer exists to show
(README.md "Domain cutoff"). A window that straddles it is truncated to end here
(`_apply_cutoff`)."""

MIN_AREA_KM2 = 500.0
"""A window smaller than this counts as absent. Cliopatria carries degenerate slivers inside
otherwise good series (Han Dynasty 6-13 CE at 143 km^2, Safavid 1727-37 at ~100 km^2); the
smallest genuine roster window, the early Roman Republic, is ~900 km^2."""

IOU_KEEP = 0.9
"""Thinning: a segment whose IoU with the last kept snapshot is at least this merges into it."""

SYMDIFF_KEEP_KM2 = 250_000.0
"""Thinning: a segment whose symmetric difference with the last kept snapshot exceeds this
starts a new snapshot even when the IoU is high -- a 5% change to a very large empire (the
Ottoman losses of 1699, Russia's sale of Alaska) is still a change a viewer would notice."""

SIMPLIFY_TOLERANCE_DEG = 0.1
"""About one pixel of the 4096-wide equirectangular canvas the web rasterises into."""

PRECISION_DEG = 0.01
"""Grid the simplified coordinates snap to, which is also every published coordinate's
decimal precision."""

_EARTH_RADIUS_KM = 6371.0088

GEOMETRY_STEM = "cliopatria_territories"
_VECTOR_SUBDIR = Path("vectors")

ROSTER_PATH = Path(__file__).resolve().parent / "roster.toml"

_NAME_ALIASES: dict[str, str] = {
    # Two raw Names for the same real-world empire under two different area-accounting
    # methodologies (both carry the SeshatID pair gb_british_emp_1/_2 across 1706-1999). Aliased
    # before paren-stripping, since "(British Empire)" strips to a third string.
    "(British Empire)": "British Colonial Empire",
}

_EXCLUDED_NAMES: frozenset[str] = frozenset(
    {
        # The Aegean's post-Mycenaean collapse, c. 1100-800 BCE: a period, not a polity with real
        # borders, though Cliopatria carries it as a POLITY row.
        "Greek Dark Ages",
    }
)

_GEOJSON_FILENAME = "cliopatria.geojson"
_POLITY_TYPE = "POLITY"


class CliopatriaFormatError(ValueError):
    """The raw GeoJSON's schema did not match what this source expects."""


class EmpireRosterError(ValueError):
    """`roster.toml` names a polity the data cannot supply."""


# ----------------------------------------------------------------------------------- roster


class _RosterModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)


class RosterMember(_RosterModel):
    """One Cliopatria polity in a lineage. `from_year`/`to_year` clamp its windows (inclusive
    CE years); `label` is the text the globe shows for its snapshots."""

    polity: str = Field(min_length=1)
    from_year: int | None = Field(default=None, alias="from")
    to_year: int | None = Field(default=None, alias="to")
    label: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _clamp_is_ordered(self) -> Self:
        lo, hi = self.from_year, self.to_year
        if lo is not None and hi is not None and lo > hi:
            raise ValueError(f"{self.polity}: from {self.from_year} is after to {self.to_year}")
        return self

    @property
    def display_label(self) -> str:
        return self.label if self.label is not None else self.polity


class RosterLineage(_RosterModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1)
    colour_slot: int = Field(ge=0, le=7)
    reason: str = Field(min_length=1)
    members: tuple[RosterMember, ...] = Field(min_length=1)


class EmpireRoster(_RosterModel):
    lineages: tuple[RosterLineage, ...] = Field(min_length=1, alias="lineage")

    @model_validator(mode="after")
    def _ids_and_polities_unique(self) -> Self:
        for what, values in (
            ("lineage id", [lineage.id for lineage in self.lineages]),
            ("polity", [member.polity for _, member in self.members()]),
        ):
            duplicates = sorted(v for v, n in Counter(values).items() if n > 1)
            if duplicates:
                raise ValueError(f"duplicate {what}(s): {', '.join(duplicates)}")
        return self

    def members(self) -> list[tuple[RosterLineage, RosterMember]]:
        return [(lineage, member) for lineage in self.lineages for member in lineage.members]


def load_roster(path: Path) -> EmpireRoster:
    with path.open("rb") as handle:
        return EmpireRoster.model_validate(tomllib.load(handle))


# ---------------------------------------------------------------------------- raw windows


@dataclass(frozen=True)
class _RawPolityRow:
    name: str  # raw (possibly parenthesised) Name
    from_year: int
    to_year: int
    area_km2: float
    seshat_id: str
    geometry: dict  # raw GeoJSON geometry dict -- parsed to shapely only for roster rows


def _load_raw_rows(raw_dir: Path) -> list[_RawPolityRow]:
    path = raw_dir / _GEOJSON_FILENAME
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features")
    if not isinstance(features, list):
        raise CliopatriaFormatError(f"{path}: no top-level 'features' list")
    rows: list[_RawPolityRow] = []
    for feature in features:
        props = feature.get("properties", {})
        if props.get("Type") != _POLITY_TYPE:
            continue
        missing = [k for k in ("Name", "FromYear", "ToYear", "Area") if k not in props]
        if missing:
            raise CliopatriaFormatError(f"{path}: POLITY feature missing {missing}: {props}")
        rows.append(
            _RawPolityRow(
                name=props["Name"],
                from_year=int(props["FromYear"]),
                to_year=int(props["ToYear"]),
                area_km2=float(props["Area"]),
                seshat_id=str(props.get("SeshatID", "")).strip(),
                geometry=feature["geometry"],
            )
        )
    return rows


def _canonical_name(name: str) -> str:
    """`_NAME_ALIASES` first, then strip any wrapping `"(...)"` pair: a merge when the bare form
    names another row (`"(Roman Empire)"`), a plain rename when it does not
    (`"(Spring and Autumn States)"`)."""
    aliased = _NAME_ALIASES.get(name)
    if aliased is not None:
        return aliased
    if _is_parenthesised(name):
        return name[1:-1]
    return name


def _is_parenthesised(name: str) -> bool:
    return name.startswith("(") and name.endswith(")")


def _apply_cutoff(row: _RawPolityRow) -> _RawPolityRow | None:
    """Clip `row` to end at `CUTOFF_CE_YEAR`, or `None` when it lies wholly after it."""
    if row.from_year > CUTOFF_CE_YEAR:
        return None
    if row.to_year > CUTOFF_CE_YEAR:
        return replace(row, to_year=CUTOFF_CE_YEAR)
    return row


def _dedupe_rows(rows: list[_RawPolityRow]) -> dict[tuple[str, int, int], _RawPolityRow]:
    """Group by (canonical name, FromYear, ToYear), dropping `_EXCLUDED_NAMES`. When a bare and a
    parenthesised row cover the identical window (identical geometry and area for every such
    pair checked), keep the bare one. The kept row's raw `name` still says which it was."""
    best: dict[tuple[str, int, int], _RawPolityRow] = {}
    for row in rows:
        canonical = _canonical_name(row.name)
        if canonical in _EXCLUDED_NAMES:
            continue
        key = (canonical, row.from_year, row.to_year)
        held = best.get(key)
        if held is None or (_is_parenthesised(held.name) and not _is_parenthesised(row.name)):
            best[key] = row
    return best


def _polity_rows(raw_dir: Path) -> dict[str, list[_RawPolityRow]]:
    """Every surviving window, by canonical polity name, oldest first."""
    rows = [
        clipped for row in _load_raw_rows(raw_dir) if (clipped := _apply_cutoff(row)) is not None
    ]
    by_polity: dict[str, list[_RawPolityRow]] = defaultdict(list)
    for (canonical, _from, _to), row in _dedupe_rows(rows).items():
        by_polity[canonical].append(row)
    for windows in by_polity.values():
        windows.sort(key=lambda row: (row.from_year, row.to_year))
    return dict(by_polity)


# ------------------------------------------------------------------------ roster windows


@dataclass(frozen=True)
class _Window:
    """One window of a roster member, clamped to that member's `from`/`to`."""

    polity: str
    from_year: int
    to_year: int
    area_km2: float
    seshat_id: str
    parenthesised: bool
    geometry: BaseGeometry


def _valid_geometry(raw_geometry: dict) -> BaseGeometry:
    geometry = shapely_shape(raw_geometry)
    if not geometry.is_valid:
        geometry = geometry.buffer(0)  # standard GIS fix for a self-intersecting polygon
    return geometry


def _member_windows(rows: list[_RawPolityRow], member: RosterMember) -> list[_Window]:
    """`rows` clamped to the member's years, with windows under `MIN_AREA_KM2` treated as
    absent."""
    lo = member.from_year if member.from_year is not None else -math.inf
    hi = member.to_year if member.to_year is not None else math.inf
    windows: list[_Window] = []
    for row in rows:
        from_year, to_year = max(row.from_year, lo), min(row.to_year, hi)
        if from_year > to_year or row.area_km2 < MIN_AREA_KM2:
            continue
        windows.append(
            _Window(
                polity=member.polity,
                from_year=int(from_year),
                to_year=int(to_year),
                area_km2=row.area_km2,
                seshat_id=row.seshat_id,
                parenthesised=_is_parenthesised(row.name),
                geometry=_valid_geometry(row.geometry),
            )
        )
    return windows


def _roster_windows(
    by_polity: dict[str, list[_RawPolityRow]], roster: EmpireRoster
) -> list[list[_Window]]:
    """Each roster member's windows, in roster order. Refuses, naming every offender at once,
    a member whose polity matches no window, and one left with no window after its clamp and
    the area floor."""
    unknown = [m.polity for _, m in roster.members() if m.polity not in by_polity]
    if unknown:
        raise EmpireRosterError(
            f"roster names {len(unknown)} polit{'y' if len(unknown) == 1 else 'ies'} with no "
            f"Cliopatria window up to {CUTOFF_CE_YEAR} CE: {', '.join(unknown)}"
        )
    per_member = [_member_windows(by_polity[m.polity], m) for _, m in roster.members()]
    empty = [m.polity for (_, m), ws in zip(roster.members(), per_member, strict=True) if not ws]
    if empty:
        raise EmpireRosterError(
            f"roster members left with no window of at least {MIN_AREA_KM2:g} km^2 inside "
            f"their from/to: {', '.join(empty)}"
        )
    return per_member


# ------------------------------------------------------------------ resolution and thinning


@dataclass(frozen=True)
class _Segment:
    """A run of years `[from_year, to_year]` (inclusive) drawn from one window."""

    from_year: int
    to_year: int
    window: _Window


def _resolve_years(windows: list[_Window]) -> list[_Segment]:
    """One window per year of one member: a bare window wherever one covers the year, a
    parenthesised one only where none does; among several, the latest `from_year` wins (then the
    earliest `to_year`). Consecutive years drawn from the same window merge into one segment."""
    bounds = sorted({w.from_year for w in windows} | {w.to_year + 1 for w in windows})
    segments: list[_Segment] = []
    for start, stop in pairwise(bounds):
        covering = [w for w in windows if w.from_year <= start and stop - 1 <= w.to_year]
        if not covering:
            continue
        bare = [w for w in covering if not w.parenthesised]
        pick = max(bare or covering, key=lambda w: (w.from_year, -w.to_year))
        last = segments[-1] if segments else None
        if last is not None and last.window is pick and last.to_year == start - 1:
            segments[-1] = replace(last, to_year=stop - 1)
        else:
            segments.append(_Segment(start, stop - 1, pick))
    return segments


@dataclass(frozen=True)
class Snapshot:
    """One kept territory of one polity over `[from_year, to_year]` (inclusive CE years),
    active for `t_end < t <= t_start`."""

    polity: str
    from_year: int
    to_year: int
    area_km2: float
    seshat_id: str
    geometry: BaseGeometry

    @property
    def t_start(self) -> GeoTime:
        return float(PRESENT_CE_YEAR - self.from_year)

    @property
    def t_end(self) -> GeoTime:
        return float(PRESENT_CE_YEAR - (self.to_year + 1))


def _equal_area(geometry: BaseGeometry) -> BaseGeometry:
    """Lambert cylindrical equal-area projection in km, so planar areas are real areas. Floating
    point can make a valid input touch itself once projected, hence the repair."""

    def project(coords: np.ndarray) -> np.ndarray:
        radians = np.radians(coords)
        return np.column_stack(
            (_EARTH_RADIUS_KM * radians[:, 0], _EARTH_RADIUS_KM * np.sin(radians[:, 1]))
        )

    projected = shapely.transform(geometry, project)
    return projected if projected.is_valid else projected.buffer(0)


def _changed(kept: BaseGeometry, candidate: BaseGeometry) -> bool:
    """Whether `candidate` differs enough from `kept` (both equal-area) to be its own snapshot."""
    union = kept.union(candidate).area
    intersection = kept.intersection(candidate).area
    iou = intersection / union if union else 1.0
    return iou < IOU_KEEP or union - intersection > SYMDIFF_KEEP_KM2


def _thin(segments: list[_Segment]) -> list[Snapshot]:
    """Walk one member's segments in time order, starting a new snapshot after a gap or where
    the territory has `_changed` from the last kept one; otherwise extend that snapshot over the
    segment. A snapshot keeps its first window's geometry, area and SeshatID."""
    snapshots: list[Snapshot] = []
    kept_projected: BaseGeometry | None = None
    projected: dict[int, BaseGeometry] = {}
    for segment in segments:
        window = segment.window
        candidate = projected.setdefault(id(window), _equal_area(window.geometry))
        if snapshots and kept_projected is not None:
            last = snapshots[-1]
            contiguous = segment.from_year <= last.to_year + 1
            if contiguous and not _changed(kept_projected, candidate):
                snapshots[-1] = replace(last, to_year=segment.to_year)
                continue
        snapshots.append(
            Snapshot(
                polity=window.polity,
                from_year=segment.from_year,
                to_year=segment.to_year,
                area_km2=window.area_km2,
                seshat_id=window.seshat_id,
                geometry=window.geometry,
            )
        )
        kept_projected = candidate
    return snapshots


def roster_snapshots(raw_dir: Path, roster: EmpireRoster) -> list[tuple[str, Snapshot]]:
    """Every kept snapshot of every roster member with its feature id, sorted by id. Parses the
    raw file once per (file version, roster), so `normalise` and `write_outputs` share it."""
    path = raw_dir / _GEOJSON_FILENAME
    stat = path.stat()
    return list(_cached_snapshots(path.resolve(), stat.st_mtime_ns, stat.st_size, roster))


@functools.lru_cache(maxsize=2)
def _cached_snapshots(
    path: Path, _mtime_ns: int, _size: int, roster: EmpireRoster
) -> tuple[tuple[str, Snapshot], ...]:
    by_polity = _polity_rows(path.parent)
    snapshots = [
        snapshot
        for windows in _roster_windows(by_polity, roster)
        for snapshot in _thin(_resolve_years(windows))
    ]
    return tuple(sorted(_with_ids(snapshots), key=lambda pair: pair[0]))


# ------------------------------------------------------------------------------- FeatureSet


def _slug(text: str) -> str:
    normalised = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalised.lower()).strip("-")
    return slug or "x"


def _year_tag(year: int) -> str:
    return f"{-year}bce" if year < 0 else f"{year}ce"


def _with_ids(snapshots: list[Snapshot]) -> list[tuple[str, Snapshot]]:
    """`<polity slug>-<from year>`, suffixed `-2`, `-3`... on a collision."""
    seen: set[str] = set()
    identified: list[tuple[str, Snapshot]] = []
    for snapshot in sorted(snapshots, key=lambda s: (s.polity, s.from_year)):
        base = f"{_slug(snapshot.polity)}-{_year_tag(snapshot.from_year)}"
        feature_id, n = base, 2
        while feature_id in seen:
            feature_id, n = f"{base}-{n}", n + 1
        seen.add(feature_id)
        identified.append((feature_id, snapshot))
    return identified


def _certainty(seshat_id: str) -> FeatureCertainty:
    """`HIGH` when the window carries a `SeshatID` -- cross-referenced with the Seshat Global
    History Databank's expert-curated polity records -- `MEDIUM` otherwise (README.md
    "Certainty")."""
    return FeatureCertainty.HIGH if seshat_id else FeatureCertainty.MEDIUM


def _feature(feature_id: str, snapshot: Snapshot) -> Feature:
    point = snapshot.geometry.representative_point()
    return Feature(
        id=feature_id,
        name=snapshot.polity,
        country="",  # a supra-national polity's anchor has no single modern country
        lat=max(-90.0, min(90.0, point.y)),
        lon=max(-180.0, min(180.0, point.x)),
        certainty=_certainty(snapshot.seshat_id),
        estimates=[
            PopulationEstimate(t=snapshot.t_start, area_km2=snapshot.area_km2, t_end=snapshot.t_end)
        ],
    )


def normalise_with(raw_dir: Path, roster: EmpireRoster) -> list[CuratedShape]:
    features = [_feature(fid, snapshot) for fid, snapshot in roster_snapshots(raw_dir, roster)]
    return [FeatureSet(id=FEATURE_SET_ID, features=features)]


def normalise(raw_dir: Path) -> list[CuratedShape]:
    return normalise_with(raw_dir, load_roster(ROSTER_PATH))


# ---------------------------------------------------------------------------- geometry file


def _simplified_polygons(geometry: BaseGeometry) -> list[Polygon]:
    """Simplified, snapped to `PRECISION_DEG` (which keeps it valid), exteriors
    counter-clockwise and holes clockwise, so a nonzero fill of several members in one path
    unions them while still cutting the holes."""
    simplified = shapely.simplify(geometry, SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    snapped = shapely.orient_polygons(shapely.set_precision(simplified, PRECISION_DEG))
    parts = getattr(snapped, "geoms", [snapped])
    polygons: list[Polygon] = []
    for part in parts:
        if isinstance(part, Polygon) and not part.is_empty:
            polygons.append(part)
        elif isinstance(part, MultiPolygon):
            polygons.extend(p for p in part.geoms if not p.is_empty)
    return polygons


def _coordinate(value: float) -> float | int:
    rounded = round(value, 2)
    return int(rounded) if rounded.is_integer() else rounded


def _flat_ring(coords: CoordinateSequence) -> list[float | int]:
    """lon,lat,lon,lat,... without repeating the closing point."""
    points = list(coords)[:-1]
    return [_coordinate(v) for point in points for v in point[:2]]


def territory_geometry(identified: list[tuple[str, Snapshot]]) -> bytes:
    """The geometry file: `{"precision", "snapshots": {id: [polygon, ...]}}`, a polygon being a
    list of flat rings, exterior first. Refuses a snapshot that simplifies away entirely."""
    snapshots: dict[str, list[list[list[float | int]]]] = {}
    for feature_id, snapshot in identified:
        polygons = _simplified_polygons(snapshot.geometry)
        if not polygons:
            raise ValueError(f"{feature_id}: territory is empty after simplification")
        snapshots[feature_id] = [
            [_flat_ring(p.exterior.coords), *(_flat_ring(r.coords) for r in p.interiors)]
            for p in polygons
        ]
    document = {"precision": PRECISION_DEG, "snapshots": snapshots}
    return json.dumps(document, separators=(",", ":")).encode()


def write_geometry(raw_dir: Path, media_dir: Path, roster: EmpireRoster) -> Path:
    """Write the content-hashed geometry file under media_dir/vectors/ and remove any other
    `GEOMETRY_STEM` file there."""
    data = territory_geometry(roster_snapshots(raw_dir, roster))
    out_dir = media_dir / _VECTOR_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / content_hashed_filename(GEOMETRY_STEM, "json", data)
    for stale in out_dir.glob(f"{GEOMETRY_STEM}-*.json"):
        if stale != target:
            stale.unlink()
    target.write_bytes(data)
    return target


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s post-normalise hook (CONTRIBUTING.md "Optional write_outputs hook")."""
    write_geometry(raw_dir, repo_root / "data" / "media", load_roster(ROSTER_PATH))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "cliopatria"
    for shape in normalise(raw_dir):
        print(f"wrote {write_shape(shape, repo_root / 'data' / 'curated')}")
    print(
        f"wrote {write_geometry(raw_dir, repo_root / 'data' / 'media', load_roster(ROSTER_PATH))}"
    )


if __name__ == "__main__":
    main()
