"""WorldState — the sole projection source. NORMATIVE (ADR-002).

Prompts, globe textures, layer values, captions and audio all derive from `WorldState`.
Nothing else reads `data/curated/` directly.

Two properties justify the indirection:

* **Prompt continuity is free.** Consecutive prompts render from consecutive states, so they
  differ only where the world differs. No chaining, no drift accumulation (ADR-004).
* **Transitions are explicit.** `diff(a, b)` says exactly what changed between two moments,
  so a caption or transition describes rather than infers.

Every field is `| None`. Deep time is patchy: HYDE starts at 12 ka, PBDB at 540 Ma, ice cores
at 800 ka. A field is None where no source covers `t`, and consumers must render the absence
rather than substitute a plausible number.
"""

from __future__ import annotations

from typing import Any, Self

from pydantic import BaseModel

from pipeline.shapes import (
    EventSet,
    GeoTime,
    RasterBlend,
    RasterSequence,
    TimeSeries,
    Tree,
    TreeNode,
)


class PlateSnapshot(BaseModel):
    """Continental configuration. Refs are texture paths, resolved via the manifest."""

    elevation: RasterBlend | None = None
    land_fraction: float | None = None
    supercontinent: str | None = None  # "Pangaea", "Rodinia", ... — labelling only


class ClimateState(BaseModel):
    mean_temp_c: float | None = None
    sea_level_m: float | None = None  # relative to present
    ice_extent_frac: float | None = None
    koppen: RasterBlend | None = None


class AtmosphereState(BaseModel):
    co2_ppm: float | None = None
    o2_percent: float | None = None
    ch4_ppb: float | None = None


class BiosphereState(BaseModel):
    genus_count: int | None = None
    dominant_clades: list[str] = []
    land_cover: str | None = None  # "barren" | "microbial" | "forest" | ...
    ancestor: TreeNode | None = None


class SkyState(BaseModel):
    """Analytic, not sourced — closed-form formulae, no dataset (see sources/astronomy)."""

    day_length_hours: float | None = None
    moon_distance_km: float | None = None
    solar_luminosity_rel: float | None = None  # relative to present
    obliquity_deg: float | None = None


class HumanState(BaseModel):
    population: float | None = None
    cropland_frac: float | None = None
    tech_era: str | None = None


class WorldState(BaseModel):
    """The state of the planet at one instant. Pure data — no I/O, no sources."""

    t: GeoTime
    plates: PlateSnapshot = PlateSnapshot()
    climate: ClimateState = ClimateState()
    atmosphere: AtmosphereState = AtmosphereState()
    biosphere: BiosphereState = BiosphereState()
    sky: SkyState = SkyState()
    anthropo: HumanState | None = None

    def diff(self, other: Self) -> dict[str, tuple[Any, Any]]:
        """What changed between two states, flattened to dotted keys.

        Feeds transition captions and the variant half of the style spec — the prompt can
        say "ice retreats, sea level rises 120 m" because this told it so.
        """
        out: dict[str, tuple[Any, Any]] = {}

        def walk(a: Any, b: Any, prefix: str) -> None:
            if isinstance(a, BaseModel) and isinstance(b, BaseModel):
                for name in type(a).model_fields:
                    walk(getattr(a, name), getattr(b, name), f"{prefix}.{name}" if prefix else name)
            elif a != b:
                out[prefix] = (a, b)

        for name in type(self).model_fields:
            if name == "t":
                continue
            walk(getattr(self, name), getattr(other, name), name)
        return out


class WorldModel:
    """Holds loaded curated data and produces a `WorldState` at any `t`.

    Deliberately a plain object rather than a module-level singleton: tests construct one
    from fixtures, and `earthtime` constructs one from `data/curated/`.

    Sources are registered by curated id, so a new source becomes one registration plus one
    line in `at()` — the whole cost of adding a field.
    """

    def __init__(
        self,
        series: dict[str, TimeSeries] | None = None,
        rasters: dict[str, RasterSequence] | None = None,
        events: dict[str, EventSet] | None = None,
        trees: dict[str, Tree] | None = None,
    ) -> None:
        self.series = series or {}
        self.rasters = rasters or {}
        self.events = events or {}
        self.trees = trees or {}

    # -- lookups tolerating an absent source, so a partial MVP still builds ------------

    def _s(self, key: str, t: GeoTime) -> float | None:
        s = self.series.get(key)
        return s.sample(t) if s else None

    def _r(self, key: str, t: GeoTime) -> RasterBlend | None:
        r = self.rasters.get(key)
        return r.sample(t) if r else None

    def _n(self, key: str, t: GeoTime) -> TreeNode | None:
        tr = self.trees.get(key)
        return tr.sample(t) if tr else None

    def at(self, t: GeoTime) -> WorldState:
        pop = self._s("population", t)
        return WorldState(
            t=t,
            plates=PlateSnapshot(
                elevation=self._r("paleodem", t),
                land_fraction=self._s("land_fraction", t),
            ),
            climate=ClimateState(
                mean_temp_c=self._s("mean_temp", t),
                sea_level_m=self._s("sea_level", t),
                ice_extent_frac=self._s("ice_extent", t),
                koppen=self._r("koppen", t),
            ),
            atmosphere=AtmosphereState(
                co2_ppm=self._s("co2", t),
                o2_percent=self._s("o2", t),
                ch4_ppb=self._s("ch4", t),
            ),
            biosphere=BiosphereState(
                genus_count=int(g) if (g := self._s("genus_count", t)) is not None else None,
                ancestor=self._n("lineage", t),
            ),
            sky=SkyState(
                day_length_hours=self._s("day_length", t),
                moon_distance_km=self._s("moon_distance", t),
                solar_luminosity_rel=self._s("solar_luminosity", t),
            ),
            anthropo=HumanState(
                population=pop,
                cropland_frac=self._s("cropland", t),
            )
            if pop is not None
            else None,
        )
