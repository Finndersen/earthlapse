"""The published manifest and layer data, mirrored from the web side. NORMATIVE on the web side.

`Manifest` mirrors web/src/types/manifest.ts; the layer data models mirror the JSON shapes that
web/src/data/curated.ts parses. Field names are snake_case here and camelCase on the wire.
Optional manifest fields are omitted when absent, because the viewer rejects `null` for them;
layer data keeps its explicit `null`s, because curated.ts expects them.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from pipeline.prompts import PlateType, Shot
from pipeline.scenes import MAX_PORTRAIT_ZOOM, SoundMode
from pipeline.shapes import (
    POINT_EFFECT_KINDS,
    ArrivalKind,
    EventKind,
    EventTag,
    FeatureCertainty,
    GeoTime,
    GlobeEffectKind,
    Interpolation,
)


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
    FEATURES = "features"  # ADR-034
    TERRITORIES = "territories"  # ADR-059


class SceneSound(_WireModel):
    """Mirrors `pipeline.scenes.SceneSound` (ADR-023). `mode` reuses
    `pipeline.scenes.SoundMode` directly, the same way `TimelineEvent.kind` reuses
    `pipeline.shapes.EventKind` rather than a re-declared synonym."""

    stem: str
    mode: SoundMode
    gain: float = Field(gt=0.0, le=1.0)


class SceneLocationCoordinates(_WireModel):
    lat: float
    lon: float


class SceneLocation(_WireModel):
    """A scene's real-world place (ADR-034). `present_day` is always the curated coordinates
    from `pipeline.scenes.SceneLocation`, published alongside the reconstruction so it stays
    auditable. `marker` is what the globe should actually plot: identical to `present_day` for
    a scene inside the human-era basemap domain (`t <= 2,580,000`, ADR-030), a plate-
    reconstructed paleo position for an older one, or -- when no plate model covers that
    scene's `t`, or reconstruction genuinely isn't feasible -- `None`, so the globe shows no
    marker rather than a wrong one."""

    label: str
    present_day: SceneLocationCoordinates
    marker: SceneLocationCoordinates | None = None


class SceneFraming(_WireModel):
    """Mirrors `pipeline.scenes.SceneFraming` (ADR-045): the viewer's crop focus (image
    fractions, origin top-left), drift pan direction (degrees, 0 = right, 90 = down) and portrait
    zoom (ADR-047), which is omitted at its default of 1."""

    focus: tuple[float, float]
    pan: float = Field(ge=0.0, lt=360.0)
    portrait_zoom: float | None = Field(default=None, gt=1.0, le=MAX_PORTRAIT_ZOOM)


class Scene(_WireModel):
    id: str
    t: GeoTime
    chapter_id: str
    image: str
    # A small (`pipeline.transcode.THUMBNAIL_SIZE`-square) derivative of `image`, published
    # alongside it, backing the timeline checkpoint pip's hover preview
    # (`ScrubTrack.module.css`'s `.pipThumb`) -- never `image` itself, which would fetch every
    # scene's full still on first load to back a 44px circular preview almost nobody hovers.
    # Always emitted, like `image` -- every published scene gets one.
    thumbnail: str
    depth: str | None = None  # deferred by ADR-009
    shot: Shot
    # Short heading for the UI, distinct from `caption` below. Always emitted, required on every
    # scene -- unlike the additive fields below, it has no "absent" meaning to fall back to.
    title: str
    caption: str
    # events-core event ids this scene visually anchors to (ADR-022). Always emitted, unlike the
    # single-value additive fields below -- an empty list is already a complete "no links".
    events: tuple[str, ...] = ()
    # Optional ambience stem this scene plays (ADR-023). Additive: absent on every manifest
    # published before this field existed, and on any scene with no associated sound.
    sound: SceneSound | None = None
    # This scene's real-world place, if it depicts one (ADR-034). Additive: absent on every
    # manifest published before this field existed, and on any scene with no specific location.
    location: SceneLocation | None = None
    # Crop focus and drift direction (ADR-045). Additive: absent on every manifest published
    # before this field existed, and on any scene framed by the default centred crop.
    framing: SceneFraming | None = None
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
    (docs/GLOBE.md §6, ADR-013): the eight "point" kinds, each with at most one fixed anchor.
    `kind='arrival'` is `ArrivalEffect` instead (ADR-032) — a required origin/destination pair,
    not this shape's optional single anchor. `kind` reuses `pipeline.shapes.GlobeEffectKind`
    directly, not a re-declared wire enum: its values already are the wire values, so
    re-declaring it would be a synonym that could silently drift from the pipeline-side enum."""

    kind: Literal[*POINT_EFFECT_KINDS]
    anchor: GlobeEffectAnchor | None = None
    windows: tuple[GlobeEffectWindow, ...] = Field(min_length=1)


class ArrivalEffect(_WireModel):
    """Mirrors `pipeline.shapes.ArrivalEffect` and `web/src/types/layer.ts`'s
    `ArrivalGlobeEffect` (ADR-032): a schematic human-dispersal arrival arc, origin ->
    destination, that persists to the present. `established` is the best-estimate date the
    arc turns solid (dashed before it) — independent of the owning event's own `kind`/`t`,
    since some owning events are `kind='period'` with no single instant of their own.
    `arrival_kind` reuses `pipeline.shapes.ArrivalKind` directly, the same way `kind` reuses
    `GlobeEffectKind`: `peopling` (first settlement of previously uninhabited land, leaves a
    persistent inhabited marker) vs. `migration` (a later movement into already-inhabited or
    previously-settled land, transient arc only). Required, not defaulted."""

    kind: Literal[GlobeEffectKind.ARRIVAL]
    arrival_kind: ArrivalKind
    origin: GlobeEffectAnchor
    destination: GlobeEffectAnchor
    established: GeoTime
    windows: tuple[GlobeEffectWindow, ...] = Field(min_length=1)


AnyGlobeEffect = Annotated[GlobeEffect | ArrivalEffect, Field(discriminator="kind")]


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
    effect: AnyGlobeEffect | None = Field(default=None, exclude_if=lambda value: value is None)


class AudioLoop(_WireModel):
    """The span of a clip a looping player repeats (`pipeline.audio.LoopRegion`)."""

    start_seconds: float = Field(ge=0.0)
    end_seconds: float = Field(gt=0.0)


class AudioStem(_WireModel):
    """One published stem (ADR-023). Mirrors `pipeline.audio.StemManifest` plus the file's
    published path; `duration_seconds`/`loop_safe`/`loop` are the same curator-attested values,
    passed through unchanged. Every stem is independently credited here (`title`, `author`,
    `licence`, `source_url`) rather than through `Manifest.credits`, which stays one entry per
    `sources/<name>/` directory -- a stems collection bundles several independently-licensed
    files under one source directory, so per-file credit has to live on the stem itself."""

    id: str
    file: str
    title: str
    author: str
    licence: str
    source_url: str
    duration_seconds: float = Field(gt=0.0)
    loop_safe: bool
    # Additive (ADR-023 amendment "stem levels"): dB the engine applies on top of every curve
    # or scene gain so all stems reach the mix at their reference loudness.
    level_trim_db: float
    # Absent: the whole clip loops (or the stem is a one-shot, which never loops).
    loop: AudioLoop | None = Field(default=None, exclude_if=lambda value: value is None)
    # Absent: a one-shot starts at 0 (`pipeline.audio.StemManifest.start_seconds`).
    start_seconds: float | None = Field(default=None, exclude_if=lambda value: value is None)


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
    # The ambience stem catalogue (ADR-023). Always emitted, like `events` -- an empty list is
    # already a complete "no stems published yet", not an absent field.
    audio_stems: tuple[AudioStem, ...] = ()
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


class SeriesGap(_WireModel):
    """Mirrors `pipeline.shapes.Gap` (ADR-027): an open interval with no data, spanning
    exactly one pair of adjacent samples (`toIndex == fromIndex + 1`, post-sort)."""

    from_index: int
    to_index: int


class SeriesData(_WireModel):
    id: str
    unit: str
    interpolation: Interpolation
    samples: tuple[SeriesSample, ...] = Field(min_length=1)
    # Additive (ADR-027): omitted entirely when the series declares no gap, so layer files
    # from before this field existed stay byte-identical.
    gaps: tuple[SeriesGap, ...] = Field(default=(), exclude_if=lambda value: not value)


class RasterFrameData(_WireModel):
    t: GeoTime
    ref: str


class RasterEncoding(_WireModel):
    """How a `RasterSequence`'s texture bytes decode to a real physical quantity, additive:
    absent for a colour-only raster (`paleodem`, the two `basemap` tiers,
    `plates_neoproterozoic`, `hyde_cleared_land`) and on every layer file published before this
    field existed. ADR-031 amendment ("population density"): a single 8-bit channel, log10-
    scaled between 0 and `dMax` -- mirrors `pipeline.density_encoding.encode_log_density`
    exactly, the one place the formula itself is written out:

        pixel = round(255 * clamp(log10(1 + value) / log10(1 + dMax), 0, 1))
        value = 10 ** (pixel / 255 * log10(1 + dMax)) - 1
    """

    channel: Literal["r", "g", "b"]
    unit: str
    d_max: float = Field(gt=0.0)


class RasterData(_WireModel):
    id: str
    frames: tuple[RasterFrameData, ...] = Field(min_length=1)
    encoding: RasterEncoding | None = Field(default=None, exclude_if=lambda value: value is None)


class TreeNodeData(_WireModel):
    id: str
    parent: str | None
    label: str
    t_divergence: GeoTime
    representative: str | None
    note: str | None
    citation: str | None


class PortraitExposureData(_WireModel):
    """How publish normalised a plate's exposure (ADR-015).

    `highlight` is the pinned original's subject highlight as a luma code, None when no subject
    stands out; `gain` is the linear-light gain applied (pipeline/exposure.py). The published
    image is always a WebP transcode of the pinned file (pipeline/transcode.py); at gain 1 no
    exposure gain was applied on top of that.
    """

    highlight: int | None = Field(ge=0, le=255)
    gain: float = Field(ge=1)


class PortraitPlateData(_WireModel):
    """A pinned ancestor portrait (ADR-015), keyed by the lineage node it portrays. `pinned` names
    the pinned original; `image` is that original after `exposure`."""

    node_id: str
    image: str
    plate: PlateType
    pinned: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    exposure: PortraitExposureData


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


class FeatureEstimateData(_WireModel):
    """Mirrors `pipeline.shapes.PopulationEstimate` (ADR-034)."""

    t: GeoTime
    population: int = Field(gt=0)


class FeatureData(_WireModel):
    """Mirrors `pipeline.shapes.Feature` (ADR-034). `certainty` reuses
    `pipeline.shapes.FeatureCertainty` directly, the same way `TimelineEvent.kind` reuses
    `EventKind` — its values already are the wire values."""

    id: str
    name: str
    country: str
    lat: float
    lon: float
    certainty: FeatureCertainty
    estimates: tuple[FeatureEstimateData, ...] = Field(min_length=1)


class FeatureSetData(_WireModel):
    """A `FeatureSet` published as its own layer file (ADR-034) — e.g. `cities`. Mirrors
    `pipeline.shapes.FeatureSet`."""

    id: str
    features: tuple[FeatureData, ...] = Field(min_length=1)


class TerritoryMemberData(_WireModel):
    """One polity of a lineage: its display label and English Wikipedia article title."""

    label: str
    wikipedia: str | None


class TerritoryLineageData(_WireModel):
    """One empire lineage (ADR-059). `colour_slot` indexes the web's empire palette; `events`
    are ids of published events that concern it; `members` are in roster order."""

    id: str
    name: str
    colour_slot: int = Field(ge=0, le=7)
    description: str = Field(min_length=1, max_length=320)
    events: tuple[str, ...]
    members: tuple[TerritoryMemberData, ...] = Field(min_length=1)


class TerritorySnapshotData(_WireModel):
    """One territory snapshot, active for `t_end < t <= t_start`. `id` keys its polygons in the
    geometry file; `lat`/`lon` anchor its label; `member` indexes its lineage's `members`."""

    id: str
    lineage: str
    member: int = Field(ge=0)
    label: str
    t_start: GeoTime
    t_end: GeoTime
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    area_km2: float = Field(gt=0.0)

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> Self:
        if self.t_end >= self.t_start:
            raise ValueError(f"{self.id}: t_end {self.t_end} is not newer than {self.t_start}")
        return self


class TerritoryData(_WireModel):
    """The historical-empires layer (ADR-059). `geometry` is the media path, relative to the
    asset base, of the file holding every snapshot's polygons; the web fetches it lazily."""

    id: str
    geometry: str
    lineages: tuple[TerritoryLineageData, ...] = Field(min_length=1)
    snapshots: tuple[TerritorySnapshotData, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _snapshots_name_known_lineages_and_members(self) -> Self:
        members = {lineage.id: len(lineage.members) for lineage in self.lineages}
        unknown = sorted({s.lineage for s in self.snapshots} - members.keys())
        if unknown:
            raise ValueError(f"snapshots name unknown lineage(s): {', '.join(unknown)}")
        out_of_range = [s.id for s in self.snapshots if s.member >= members[s.lineage]]
        if out_of_range:
            raise ValueError(
                f"snapshots name no member of their lineage: {', '.join(out_of_range)}"
            )
        return self


LayerData = SeriesData | RasterData | TreeData | EventsData | FeatureSetData | TerritoryData


def dump_layer_data(data: LayerData) -> str:
    return data.model_dump_json(by_alias=True, indent=2) + "\n"
