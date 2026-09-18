"""Normalise data/raw/cliopatria/cliopatria.geojson into two curated shapes (ADR-037):

- `cliopatria_extent.parquet` -- a `RasterSequence` of the notable subset's territorial
  coverage, one WebP texture per frame (README.md "Rasterisation").
- `cliopatria_polities.parquet` -- a `FeatureSet` of polity label anchors, one `Feature` per
  surviving *window* (attested map-year range), not one per polity (README.md "Doesn't fit
  cleanly" -- `FeatureSet` was built for `sources/cities`, where one Feature is one place with
  several population readings over time; a polity's *position* itself moves as its territory
  changes, which needs a `Feature` per window rather than per polity to express at all).

**Scope.** The raw GeoJSON covers ~1,600 political entities of five `Type`s (POLITY, LEADER,
GROUP, EVENT, ARMY); only `Type == "POLITY"` is a territorial extent at all, so every other
Type is dropped first. Of the resulting ~14,108 polity-window rows, only the windows belonging
to a polity `sources.cliopatria.subset.select_notable_polities` selects are kept -- an
objective, era-relative top-N-by-area rule (README.md "Subset rule"), not the full world
political map, which would be both unreadable on a globe and far too large to rasterise at
every one of the ~508 distinct map years.

**Duplicate aggregate entries and label normalisation (ADR-037 amendment, 2026-09-18).**
Cliopatria's own schema uses a parenthesised `Name` (e.g. `"(Roman Empire)"`) for two unrelated
things (README.md "Duplicate aggregate entries" has the full account): (a) an aggregate
spanning a named entity's own successive periods (`"(Roman Empire)"` and `"Roman Empire"`
carry *identical* geometry and area for every window they share -- confirmed directly), and
(b) a genuinely distinct multi-state grouping with no bare counterpart (`"(Spring and Autumn
States)"`, aggregating several simultaneously-existing named states). `_canonical_name` strips
*every* wrapping `"(...)"` pair unconditionally, not only when a bare counterpart exists: case
(a) becomes a merge (dedupe drops the duplicate reading for any window both report, preferring
the bare-labelled row's own data -- README.md has the exact rule) and case (b) becomes a plain
rename (nothing to merge into, but the parenthesis was never part of the polity's real name and
should not surface in a label). `_NAME_ALIASES` separately folds `"(British Empire)"` into
`"British Colonial Empire"` -- two literal raw `Name`s for the same real-world empire under
different area-accounting methodologies (README.md "Duplicate aggregate entries"), which
paren-stripping alone cannot unify since the two names do not share a bare form. `_EXCLUDED_NAMES`
drops `"Greek Dark Ages"`, a historical period Cliopatria carries as if it were a governing
polity, not an attested political entity.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry

from pipeline.curated import write_shape
from pipeline.databuild import load_source_module
from pipeline.shapes import (
    CuratedShape,
    Feature,
    FeatureCertainty,
    FeatureSet,
    GeoTime,
    PopulationEstimate,
    RasterFrame,
    RasterSequence,
)

_subset = load_source_module(Path(__file__).resolve().parent, "subset")
PolityWindow = _subset.PolityWindow
select_notable_polities = _subset.select_notable_polities

RASTER_ID = "cliopatria_extent"
FEATURE_SET_ID = "cliopatria_polities"

PRESENT_CE_YEAR = 2025
"""t = years before this fixed calendar present, matching sources/hyde's, sources/cities' and
sources/co2-o2's own convention. Cliopatria's `FromYear`/`ToYear` are already signed integers
(negative = BCE), so -- unlike sources/cities' `BC_<year>`/`AD_<year>` column-name parsing --
converting to t is one formula for every row: `t = PRESENT_CE_YEAR - year`."""

BUCKET_YEARS = 100.0
TOP_N = 6
"""The subset rule's own parameters (README.md "Subset rule" has the full sweep and the
resulting 121-polity list): era-relative top `TOP_N` by peak area within each `BUCKET_YEARS`
-wide bucket of t. Chosen empirically, the same way sources/cities' own
`CITIES_NOTABLE_BUCKET_YEARS`/`CITIES_NOTABLE_TOP_N` were -- the smallest top-N, at the same
100-year bucket width cities uses, that still spans every millennium from 3400 BCE to the
present without concentrating in one era or region."""

CUTOFF_CE_YEAR = 1900
"""Exclude any polity-window material after this calendar year. Ranking "largest by area" per
era bucket all the way to the present selects modern nation-states (Canada, the People's
Republic of China, Brazil, the Russian Federation, the USA) rather than the historical empires
this layer exists to show -- per-user direction, 2026-09-18 ("hmm yeh maybe stop at 1900 for
now and ill see what that looks like"). **Provisional**: the user will look at the layer at
this domain and may move or lift the cutoff later. A window that straddles it is truncated to
end here, not dropped -- a polity still alive in 1880 still appears, its extent simply stopping
at 1900 (`_apply_cutoff`)."""

CUTOFF_T: GeoTime = float(PRESENT_CE_YEAR - CUTOFF_CE_YEAR)
"""`CUTOFF_CE_YEAR` in years BP against the fixed `PRESENT_CE_YEAR` present -- 125.0."""

_NAME_ALIASES: dict[str, str] = {
    # Two raw Names for the same real-world empire under two different area-accounting
    # methodologies (both carry the same SeshatID pair, gb_british_emp_1/_2, across their full
    # 1706-1999 span; their Area readings diverge from 1709 on -- confirmed directly, README.md
    # "Duplicate aggregate entries"), not two distinct polities. Paren-stripping alone cannot
    # unify these -- "(British Empire)" strips to "British Empire", a third string, not
    # "British Colonial Empire" -- so this one pair is a small, explicit, hand-authored
    # mapping rather than a general rule (per-user direction, 2026-09-18). Aliased *before*
    # paren-stripping so the existing "prefer the non-parenthesised row's data" dedupe
    # convention still applies once both share one canonical name.
    "(British Empire)": "British Colonial Empire",
}

_EXCLUDED_NAMES: frozenset[str] = frozenset(
    {
        # A historical-period label (the Aegean's post-Mycenaean collapse, c. 1100-800 BCE),
        # not an attested governing polity with real borders -- Cliopatria carries it as a
        # POLITY row regardless. Presenting it as a named empire alongside e.g. "Neo-Assyrian
        # Empire" would misrepresent what it is (per-user direction, 2026-09-18). Checked
        # against every POLITY Name in the full raw dataset for the same pattern (README.md
        # "Duplicate aggregate entries"/"Non-polity entries"): no other Name reads as a period
        # rather than a polity.
        "Greek Dark Ages",
    }
)

_GEOJSON_FILENAME = "cliopatria.geojson"
_POLITY_TYPE = "POLITY"

TEXTURE_SIZE = (1024, 512)  # (width, height) -- matches sources/hyde's/sources/paleodem's own
_SUPERSAMPLE = 2
"""Rasterise at `_SUPERSAMPLE` x `TEXTURE_SIZE`, then downsample with a bilinear filter --
polygon fills are hard-edged at native resolution, and this gives smooth-ish coastline/border
edges the same way sources/hyde's `_resize_fraction` does for its own downsampled fractions,
without the cost of a much larger working canvas."""
TEXTURE_EXTENSION = ".webp"
"""Lossless WebP: this is a data layer (real territorial coverage, not decoration), the same
bar CONTRIBUTING.md holds sources/hyde's density textures to."""

_TEXTURE_SUBDIR = Path("textures") / RASTER_ID


class CliopatriaFormatError(ValueError):
    """The raw GeoJSON's schema did not match what this source expects."""


@dataclass(frozen=True)
class _RawPolityRow:
    name: str  # raw (possibly parenthesised) Name
    from_year: int
    to_year: int
    area_km2: float
    seshat_id: str
    geometry: dict  # raw GeoJSON geometry dict -- parsed to shapely only for surviving rows


@dataclass(frozen=True)
class _ActiveWindow:
    """One surviving polity-window: a canonical name plus everything needed to build both
    curated outputs for it."""

    canonical_name: str
    from_year: int
    to_year: int
    t_start: GeoTime  # years BP, older -- FromYear converted
    t_end: GeoTime  # years BP, nearer the present -- ToYear converted
    area_km2: float
    seshat_id: str
    geometry: BaseGeometry


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
    """A raw `Name`'s display/merge identity: `_NAME_ALIASES` first (a small, hand-authored
    synonym for the one pair paren-stripping can't unify -- see its own comment), then strip
    *any* wrapping `"(...)"` pair unconditionally. When the stripped form already names another
    row in the dataset this becomes a merge (the "same entity, temporal-succession aggregate"
    case, e.g. `"(Roman Empire)"` -> `"Roman Empire"` -- README.md "Duplicate aggregate
    entries"); when it doesn't, it's a plain rename (a genuinely distinct multi-state grouping
    with no bare counterpart, e.g. `"(Spring and Autumn States)"` -> `"Spring and Autumn
    States"` -- the parenthesis was never part of the polity's own name)."""
    aliased = _NAME_ALIASES.get(name)
    if aliased is not None:
        return aliased
    if name.startswith("(") and name.endswith(")"):
        return name[1:-1]
    return name


def _is_parenthesised(name: str) -> bool:
    return name.startswith("(") and name.endswith(")")


def _apply_cutoff(row: _RawPolityRow) -> _RawPolityRow | None:
    """Clip `row` to end at `CUTOFF_CE_YEAR`, or drop it entirely if it lies wholly after the
    cutoff -- `None` here is a legitimate "outside the domain" result, not an error (see
    `CUTOFF_CE_YEAR`'s own comment for why this cutoff exists and that it is provisional)."""
    if row.from_year > CUTOFF_CE_YEAR:
        return None
    if row.to_year > CUTOFF_CE_YEAR:
        return replace(row, to_year=CUTOFF_CE_YEAR)
    return row


def _dedupe_rows(rows: list[_RawPolityRow]) -> dict[tuple[str, int, int], _RawPolityRow]:
    """Group by (canonical name, FromYear, ToYear), dropping any row whose canonical name is in
    `_EXCLUDED_NAMES`. When both a bare-labelled and a parenthesised-aggregate row cover the
    *identical* window (confirmed identical geometry and area for every such pair checked
    directly -- README.md "Duplicate aggregate entries"), keep the bare-labelled one. A window
    only one of the two labels reports is kept regardless -- the same "fill gaps from whichever
    source has them" precedent sources/cities' own dedupe policy sets for the Chandler/Modelski
    overlap."""
    best: dict[tuple[str, int, int], _RawPolityRow] = {}
    best_is_paren: dict[tuple[str, int, int], bool] = {}
    for row in rows:
        canonical = _canonical_name(row.name)
        if canonical in _EXCLUDED_NAMES:
            continue
        key = (canonical, row.from_year, row.to_year)
        is_paren = _is_parenthesised(row.name)
        if key not in best or (best_is_paren[key] and not is_paren):
            best[key] = row
            best_is_paren[key] = is_paren
    return best


def _select_active_windows(raw_dir: Path) -> list[_ActiveWindow]:
    rows = _load_raw_rows(raw_dir)
    rows = [clipped for row in rows if (clipped := _apply_cutoff(row)) is not None]
    deduped = _dedupe_rows(rows)

    windows = [
        PolityWindow(
            name=canonical_name,
            t_start=float(PRESENT_CE_YEAR - row.from_year),
            t_end=float(PRESENT_CE_YEAR - row.to_year),
            area_km2=row.area_km2,
        )
        for (canonical_name, _from, _to), row in deduped.items()
    ]
    notable = select_notable_polities(windows, bucket_years=BUCKET_YEARS, top_n=TOP_N)

    active: list[_ActiveWindow] = []
    for (canonical_name, from_year, to_year), row in deduped.items():
        if canonical_name not in notable:
            continue
        geometry = _valid_geometry(row.geometry)
        active.append(
            _ActiveWindow(
                canonical_name=canonical_name,
                from_year=from_year,
                to_year=to_year,
                t_start=float(PRESENT_CE_YEAR - from_year),
                t_end=float(PRESENT_CE_YEAR - to_year),
                area_km2=row.area_km2,
                seshat_id=row.seshat_id,
                geometry=geometry,
            )
        )
    active.sort(key=lambda w: (w.canonical_name, w.t_start))
    return active


def _valid_geometry(raw_geometry: dict) -> BaseGeometry:
    geometry = shapely_shape(raw_geometry)
    if not geometry.is_valid:
        geometry = geometry.buffer(0)  # standard GIS fix for a self-intersecting polygon
    return geometry


# ------------------------------------------------------------------------------- FeatureSet


def _slug(text: str) -> str:
    normalised = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalised.lower()).strip("-")
    return slug or "x"


def _year_tag(year: int) -> str:
    return f"{-year}bce" if year < 0 else f"{year}ce"


def _feature_id(window: _ActiveWindow, seen: frozenset[str]) -> str:
    base = f"{_slug(window.canonical_name)}-{_year_tag(window.from_year)}"
    slug = base
    n = 2
    while slug in seen:
        slug = f"{base}-{n}"
        n += 1
    return slug


def _certainty(seshat_id: str) -> FeatureCertainty:
    """`HIGH` when this window's row carries a `SeshatID` -- cross-referenced with the Seshat
    Global History Databank's own expert-curated polity records, not just present in the
    geospatial layer -- `MEDIUM` otherwise (README.md "Certainty" explains why there is no
    `LOW` tier here, and carries the steppe/nomadic border-uncertainty caveat this signal does
    not capture)."""
    return FeatureCertainty.HIGH if seshat_id else FeatureCertainty.MEDIUM


def _build_features(active: list[_ActiveWindow]) -> list[Feature]:
    seen: set[str] = set()
    features: list[Feature] = []
    for window in active:
        point = window.geometry.representative_point()
        feature_id = _feature_id(window, frozenset(seen))
        seen.add(feature_id)
        features.append(
            Feature(
                id=feature_id,
                name=window.canonical_name,
                country="",  # a supra-national polity's centroid has no single modern country
                lat=max(-90.0, min(90.0, point.y)),
                lon=max(-180.0, min(180.0, point.x)),
                certainty=_certainty(window.seshat_id),
                estimates=[
                    PopulationEstimate(
                        t=window.t_start, area_km2=window.area_km2, t_end=window.t_end
                    )
                ],
            )
        )
    return features


# ----------------------------------------------------------------------------- RasterSequence


def _frame_times(active: list[_ActiveWindow]) -> list[GeoTime]:
    """Every window's own start, plus every window's own end *unless* some other selected
    window's start picks up exactly there (README.md "Rasterisation" -- this is what stops a
    fallen empire's territory silently persisting on screen past the last frame that actually
    drew it)."""
    starts = {w.t_start for w in active}
    times = set(starts)
    for w in active:
        if w.t_end not in starts:
            times.add(w.t_end)
    return sorted(times)


def _active_at(active: list[_ActiveWindow], t: GeoTime) -> list[_ActiveWindow]:
    return [w for w in active if w.t_end <= t <= w.t_start]


def _to_pixels(coords, width: int, height: int) -> list[tuple[float, float]]:
    return [((lon + 180.0) / 360.0 * width, (90.0 - lat) / 180.0 * height) for lon, lat in coords]


def _draw_geometry(
    draw: ImageDraw.ImageDraw, geometry: BaseGeometry, width: int, height: int
) -> None:
    polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    for polygon in polygons:
        if polygon.is_empty:
            continue
        draw.polygon(_to_pixels(polygon.exterior.coords, width, height), fill=255)
        for interior in polygon.interiors:
            draw.polygon(_to_pixels(interior.coords, width, height), fill=0)


def _render_frame(windows: list[_ActiveWindow]) -> Image.Image:
    width, height = TEXTURE_SIZE
    working_size = (width * _SUPERSAMPLE, height * _SUPERSAMPLE)
    canvas = Image.new("L", working_size, 0)
    draw = ImageDraw.Draw(canvas)
    for window in windows:
        _draw_geometry(draw, window.geometry, *working_size)
    coverage = canvas.resize(TEXTURE_SIZE, Image.Resampling.BILINEAR)
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[:, :, 0] = np.asarray(coverage, dtype=np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def _texture_name(t: GeoTime) -> str:
    return f"t{round(t)}{TEXTURE_EXTENSION}"


def _frame_ref(t: GeoTime) -> str:
    return (_TEXTURE_SUBDIR / _texture_name(t)).as_posix()


def render_textures(raw_dir: Path, media_dir: Path) -> None:
    """Write one lossless WebP per frame into media_dir/textures/cliopatria_extent/, and
    remove any other file there. A side effect, deliberately kept out of normalise() (DESIGN.md's
    purity contract, project CLAUDE.md)."""
    active = _select_active_windows(raw_dir)
    frame_times = _frame_times(active)
    out_dir = media_dir / _TEXTURE_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = {_texture_name(t) for t in frame_times}
    for existing in out_dir.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
    for t in frame_times:
        image = _render_frame(_active_at(active, t))
        image.save(out_dir / _texture_name(t), "WEBP", lossless=True, method=6)


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s optional post-normalise side-effect hook (CONTRIBUTING.md "Optional
    write_outputs hook"). Thin wrapper over `render_textures`, matching
    sources/hyde/normalise.py's own `write_outputs`."""
    render_textures(raw_dir, repo_root / "data" / "media")


def normalise(raw_dir: Path) -> list[CuratedShape]:
    active = _select_active_windows(raw_dir)
    frame_times = _frame_times(active)
    raster = RasterSequence(
        id=RASTER_ID, frames=[RasterFrame(t=t, ref=_frame_ref(t)) for t in frame_times]
    )
    feature_set = FeatureSet(id=FEATURE_SET_ID, features=_build_features(active))
    return [raster, feature_set]


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "cliopatria"
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")
    write_outputs(raw_dir, repo_root)
    print(f"wrote textures to {repo_root / 'data' / 'media' / _TEXTURE_SUBDIR}")


if __name__ == "__main__":
    main()
