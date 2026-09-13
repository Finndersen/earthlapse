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

from pipeline.prompts import Shot
from pipeline.shapes import GeoTime, Interpolation


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


class TimelineEvent(_WireModel):
    id: str
    label: str
    t_min: GeoTime
    t_max: GeoTime
    importance: float = Field(ge=0.0, le=1.0)
    description: str
    citation: str


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


class TreeData(_WireModel):
    id: str
    nodes: tuple[TreeNodeData, ...] = Field(min_length=1)


LayerData = SeriesData | RasterData | TreeData


def dump_layer_data(data: LayerData) -> str:
    return data.model_dump_json(by_alias=True, indent=2) + "\n"
