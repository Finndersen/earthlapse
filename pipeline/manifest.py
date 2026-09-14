"""The published manifest and layer data, mirrored from the web side. NORMATIVE on the web side.

`Manifest` mirrors web/src/types/manifest.ts; the layer data models mirror the JSON shapes that
web/src/data/curated.ts parses. Field names are snake_case here and camelCase on the wire.
Optional manifest fields are omitted when absent, because the viewer rejects `null` for them;
layer data keeps its explicit `null`s, because curated.ts expects them.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from pipeline.prompts import PlateType, Shot
from pipeline.shapes import EventKind, EventTag, GeoTime, GlobeEffectKind, Interpolation


class _WireModel(BaseModel):
    model_config = ConfigDict(
        frozen=True, extra="forbid", alias_generator=to_camel, populate_by_name=True
    )


class LayerSurface(StrEnum):
    GLOBE = "globe"
    TIMELINE_LANE = "timeline-lane"
    HUD = "hud"
    SCENE_OVERLAY = "scene-overlay"


class LayerDataKind(StrEnum):
    SCALAR = "scalar"
    EVENTS = "events"
    RASTER = "raster"
    NODE = "node"


class Scene(_WireModel):
    id: str
    t: GeoTime
    chapter_id: str
    image: str
    depth: str | None = None  # deferred by ADR-009
    shot: Shot
    caption: str
    # events-core event ids this scene visually anchors to (ADR-022). Always emitted, unlike the
    # single-value additive fields below -- an empty list is already a complete "no links".
    events: tuple[str, ...] = ()
    pinned: str | None = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class Chapter(_WireModel):
    id: str
    label: str
    t_start: GeoTime  # nearer the present
    t_end: GeoTime  # further into the past
    anchor_image: str | None = None  # unused since ADR-010

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.t_start > self.t_end:
            raise ValueError(f"chapter {self.id}: tStart {self.t_start} > tEnd {self.t_end}")
        return self


class LayerManifest(_WireModel):
    id: str
    name: str
    surface: LayerSurface
    data_kind: LayerDataKind
    time_domain: tuple[GeoTime, GeoTime]  # [newest, oldest]
    source: str
    chartable: bool
    unit: str | None = None
    interpolation: Interpolation | None = None
    data: str

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        newest, oldest = self.time_domain
        if newest > oldest:
            raise ValueError(f"layer {self.id}: timeDomain must be [newest, oldest]")
        return self


class GlobeEffectAnchor(_WireModel):
    lat: float
    lon: float


class GlobeEffectWindow(_WireModel):
    t_min: GeoTime
    t_max: GeoTime


class GlobeEffect(_WireModel):
    """Mirrors `pipeline.shapes.GlobeEffect` and `web/src/types/layer.ts`'s `GlobeEffect`
    (docs/GLOBE.md §6, ADR-013). `kind` is `pipeline.shapes.GlobeEffectKind` directly, not a
    re-declared wire enum: its values already are the wire values, so re-declaring it would
    be a synonym that could silently drift from the pipeline-side enum."""

    kind: GlobeEffectKind
    anchor: GlobeEffectAnchor | None = None
    windows: tuple[GlobeEffectWindow, ...] = Field(min_length=1)


class TimelineEvent(_WireModel):
    """Mirrors `pipeline.shapes.Event` (ADR-022). `kind`/`tags` reuse the shapes-side enums
    directly, the same way `effect`'s `GlobeEffectKind` already does, rather than re-declaring
    synonyms that could drift."""

    id: str
    label: str
    kind: EventKind
    t_min: GeoTime
    t_max: GeoTime
    # Best-estimate instant for a moment; absent for a period, and additive (docs/GLOBE.md §6
    # pattern): absent on every event published before this field existed.
    t: GeoTime | None = Field(default=None, exclude_if=lambda value: value is None)
    tags: tuple[EventTag, ...] = Field(min_length=1)
    importance: float = Field(ge=0.0, le=1.0)
    description: str
    citation: str
    # Additive (docs/GLOBE.md §6): absent on every event published before this field existed,
    # and on any event with no globe visual of its own.
    effect: GlobeEffect | None = Field(default=None, exclude_if=lambda value: value is None)


class Credit(_WireModel):
    source_id: str
    title: str
    citation: str
    licence: str
    url: str


class Manifest(_WireModel):
    schema_version: Literal[1]
    build_id: str = Field(min_length=1)
    asset_base: str
    scenes: tuple[Scene, ...]
    chapters: tuple[Chapter, ...]
    layers: tuple[LayerManifest, ...]
    events: tuple[TimelineEvent, ...]
    credits: tuple[Credit, ...]

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        ts = [scene.t for scene in self.scenes]
        if ts != sorted(set(ts)):
            raise ValueError("scenes must be strictly ascending in t (web/src/scene sceneAt)")
        chapter_ids = {chapter.id for chapter in self.chapters}
        for scene in self.scenes:
            if scene.chapter_id not in chapter_ids:
                raise ValueError(f"scene {scene.id}: unknown chapter {scene.chapter_id!r}")
        return self


def dump_manifest(manifest: Manifest) -> str:
    return manifest.model_dump_json(by_alias=True, exclude_none=True, indent=2) + "\n"


# ------------------------------------------------------------------ layer data (curated.ts)


class SeriesSample(_WireModel):
    t: GeoTime
    value: float
    lower: float | None
    upper: float | None


class SeriesData(_WireModel):
    id: str
    unit: str
    interpolation: Interpolation
    samples: tuple[SeriesSample, ...] = Field(min_length=1)


class RasterFrameData(_WireModel):
    t: GeoTime
    ref: str


class RasterData(_WireModel):
    id: str
    frames: tuple[RasterFrameData, ...] = Field(min_length=1)


class TreeNodeData(_WireModel):
    id: str
    parent: str | None
    label: str
    t_divergence: GeoTime
    representative: str | None
    note: str | None
    citation: str | None


class PortraitPlateData(_WireModel):
    """A pinned ancestor portrait (ADR-015), keyed by the lineage node it portrays."""

    node_id: str
    image: str
    plate: PlateType
    pinned: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class PortraitMorphData(_WireModel):
    """Flow fields between two consecutive published plates, as PNG data textures.

    `forward` sits on the older plate's grid and `backward` on the younger's; a byte b decodes to
    (b - 128) / 127 * range in plate UV, v pointing down the image (pipeline/flowfield.py).
    """

    older: str
    younger: str
    forward: str
    backward: str
    forward_range: float = Field(gt=0)
    backward_range: float = Field(gt=0)
    size: int = Field(gt=0)


class PortraitSetData(_WireModel):
    plates: tuple[PortraitPlateData, ...] = Field(min_length=1)
    morphs: tuple[PortraitMorphData, ...]

    @model_validator(mode="after")
    def _morphs_join_consecutive_plates(self) -> Self:
        order = [plate.node_id for plate in self.plates]
        if len(set(order)) != len(order):
            raise ValueError("portrait plates must name each lineage node once")
        adjacent = set(zip(order[1:], order[:-1], strict=True))
        for morph in self.morphs:
            if (morph.older, morph.younger) not in adjacent:
                raise ValueError(f"morph {morph.older} -> {morph.younger} joins no adjacent plates")
        return self


class TreeData(_WireModel):
    id: str
    nodes: tuple[TreeNodeData, ...] = Field(min_length=1)
    # Additive (ADR-015): omitted entirely when no portrait is published, so layer files from
    # before portraits existed stay byte-identical.
    portraits: PortraitSetData | None = Field(default=None, exclude_if=lambda value: value is None)


class EventsData(_WireModel):
    """A non-timeline `EventSet` published as its own layer file (docs/GLOBE.md §6) — e.g.
    `globe-regimes`, which `Manifest.events` never lists (that field is `events-core` only,
    the timeline's own event set). Mirrors `TimelineEvent` per event, effect included."""

    id: str
    events: tuple[TimelineEvent, ...] = Field(min_length=1)


LayerData = SeriesData | RasterData | TreeData | EventsData


def dump_layer_data(data: LayerData) -> str:
    return data.model_dump_json(by_alias=True, indent=2) + "\n"
