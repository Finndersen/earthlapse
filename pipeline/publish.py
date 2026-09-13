"""`earthtime publish`: data/media/manifest.json plus the media it references. Local only.

Everything is assembled and validated in memory first (`prepare_publication`) and only then
written (`write_publication`), so a refused publish leaves data/media/ as it was. All world
data comes through `WorldModel` (ADR-002).
"""

from __future__ import annotations

import math
import shutil
import tomllib
from dataclasses import dataclass
from itertools import groupby, pairwise
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from pipeline.databuild import discover_sources
from pipeline.generators.image import ImageInfo, asset_digest, sniff_image
from pipeline.graph import digest_of
from pipeline.manifest import (
    Chapter,
    Credit,
    LayerData,
    LayerDataKind,
    LayerManifest,
    LayerSurface,
    Manifest,
    PortraitMorphData,
    PortraitPlateData,
    PortraitSetData,
    RasterData,
    RasterFrameData,
    Scene,
    SeriesData,
    SeriesSample,
    TimelineEvent,
    TreeData,
    TreeNodeData,
    dump_layer_data,
    dump_manifest,
)
from pipeline.models import WorldModel
from pipeline.portraits import (
    BACKWARD_FLOW_NAME,
    FORWARD_FLOW_NAME,
    LINEAGE_TREE_ID,
    MorphKey,
    PortraitBook,
    PortraitRecord,
    lineage_order,
    load_morph,
)
from pipeline.scenes import SceneBook, ScenePin, SceneRecord
from pipeline.shapes import EARTH_FORMATION, GeoTime, Interpolation

# Matches the committed stub's "/stub": web/src/shell/manifest.ts joins `${assetBase}/${data}`
# for layer files, so a trailing slash would request "/media//layers/...".
ASSET_BASE = "/media"
MANIFEST_NAME = "manifest.json"
EVENTS_ID = "events-core"


class PublishRefused(RuntimeError):
    """The publication would be wrong or incomplete. Nothing has been written."""


@dataclass(frozen=True)
class LayerSpec:
    curated_id: str
    name: str
    surface: LayerSurface
    source: str  # sources/<name>/, matched to a Credit
    chartable: bool


SCALAR_LAYERS = (
    LayerSpec("co2", "Atmospheric CO₂", LayerSurface.HUD, "co2-o2", chartable=True),
    LayerSpec("day_length", "Day length", LayerSurface.HUD, "astronomy", chartable=False),
)
NODE_LAYERS = (LayerSpec("lineage", "Your ancestor", LayerSurface.HUD, "lineage", chartable=False),)
RASTER_LAYERS = (
    LayerSpec("paleodem", "Paleogeography", LayerSurface.GLOBE, "paleodem", chartable=False),
)


@dataclass(frozen=True)
class MediaCopy:
    source: Path
    published: str  # relative to the media directory


@dataclass(frozen=True)
class LayerFile:
    published: str
    data: LayerData


@dataclass(frozen=True)
class PortraitInputs:
    book: PortraitBook
    morph_cache: Path


@dataclass(frozen=True)
class PortraitPublication:
    """Pinned portraits and the morphs between them (ADR-015). Portraits publish partially by
    design: plates arrive a few at a time, and the viewer shows the nearest older plate."""

    data: PortraitSetData | None  # None until at least one portrait is pinned
    files: tuple[MediaCopy, ...]
    unpinned: tuple[str, ...]
    missing_morphs: tuple[
        MorphKey, ...
    ]  # consecutive pinned pairs `earthtime morph` has not run for


@dataclass(frozen=True)
class Publication:
    manifest: Manifest
    scene_files: tuple[MediaCopy, ...]
    layer_files: tuple[LayerFile, ...]
    portraits: PortraitPublication | None  # None when the project has no data/portraits.yaml


class SourceManifest(BaseModel):
    """The credit-bearing fields of sources/<name>/manifest.toml."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    name: str
    title: str
    citation: str
    licence: str
    url: str


def unpinned_scene_ids(book: SceneBook) -> list[str]:
    return [scene.id for scene in book.chronological() if scene.pin is None]


def prepare_publication(
    book: SceneBook,
    world: WorldModel,
    sources_dir: Path,
    root: Path,
    portraits: PortraitInputs | None,
) -> Publication:
    """Pinned scenes only; the caller decides whether unpinned ones are acceptable."""
    pinned = [scene for scene in book.scenes if scene.pin is not None]
    if not pinned:
        raise PublishRefused("no scene is pinned; pick candidates with `earthtime review pick`")
    scene_entries = [_scene_entry(scene, root) for scene in pinned]
    published_chapters = {scene.chapter for scene in pinned}
    chapters = tuple(c for c in chapter_spans(book) if c.id in published_chapters)
    portrait_publication = (
        None if portraits is None else _portrait_publication(portraits, world, root)
    )
    layer_files, layers = _layers(
        world, None if portrait_publication is None else portrait_publication.data
    )
    events = _events(world)
    credits = tuple(
        _credit(source.path / "manifest.toml") for source in discover_sources(sources_dir)
    )
    content = {
        "scenes": [entry.model_dump(mode="json") for entry, _ in scene_entries],
        "chapters": [c.model_dump(mode="json") for c in chapters],
        "layers": [layer.model_dump(mode="json") for layer in layers],
        "layer_data": {f.published: f.data.model_dump(mode="json") for f in layer_files},
        "events": [e.model_dump(mode="json") for e in events],
        "credits": [c.model_dump(mode="json") for c in credits],
    }
    manifest = Manifest(
        schema_version=1,
        build_id=digest_of(content),
        asset_base=ASSET_BASE,
        scenes=tuple(entry for entry, _ in scene_entries),
        chapters=chapters,
        layers=layers,
        events=events,
        credits=credits,
    )
    return Publication(
        manifest=manifest,
        scene_files=tuple(copy for _, copy in scene_entries),
        layer_files=layer_files,
        portraits=portrait_publication,
    )


def write_publication(publication: Publication, media_dir: Path) -> Path:
    portrait_files = () if publication.portraits is None else publication.portraits.files
    for copy in (*publication.scene_files, *portrait_files):
        target = media_dir / copy.published
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(copy.source, target)
    for layer in publication.layer_files:
        target = media_dir / layer.published
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dump_layer_data(layer.data))
    manifest_path = media_dir / MANIFEST_NAME
    manifest_path.write_text(dump_manifest(publication.manifest))
    return manifest_path


def chapter_spans(book: SceneBook) -> tuple[Chapter, ...]:
    """Chapters tiling [present, Earth's formation], each boundary at the midpoint in log1p(t)
    between the chapters' facing scenes: where web/src/scene dissolves across that boundary."""
    runs = [
        (chapter_id, list(scenes))
        for chapter_id, scenes in groupby(book.scenes, lambda s: s.chapter)
    ]
    boundaries = [
        _log_midpoint(newer[-1].t, older[0].t) for (_, newer), (_, older) in pairwise(runs)
    ]
    starts = [0.0, *boundaries]
    ends = [*boundaries, max(EARTH_FORMATION, book.scenes[-1].t)]
    return tuple(
        Chapter(id=chapter_id, label=book.chapter(chapter_id).label, t_start=start, t_end=end)
        for (chapter_id, _), start, end in zip(runs, starts, ends, strict=True)
    )


def _log_midpoint(a: GeoTime, b: GeoTime) -> GeoTime:
    return math.expm1((math.log1p(a) + math.log1p(b)) / 2)


def _verified_pin(subject_id: str, pin: ScenePin, root: Path) -> tuple[Path, ImageInfo]:
    source = root / pin.path
    if not source.is_file():
        raise PublishRefused(f"{subject_id}: pinned image {pin.path} does not exist")
    data = source.read_bytes()
    if asset_digest(data) != pin.asset_digest:
        raise PublishRefused(
            f"{subject_id}: {pin.path} no longer matches pinned digest {pin.asset_digest}"
        )
    return source, sniff_image(data)


def _scene_entry(scene: SceneRecord, root: Path) -> tuple[Scene, MediaCopy]:
    assert scene.pin is not None, scene.id
    source, info = _verified_pin(scene.id, scene.pin, root)
    published = f"scenes/{scene.id}{info.extension}"
    entry = Scene(
        id=scene.id,
        t=scene.t,
        chapter_id=scene.chapter,
        image=published,
        shot=scene.shot,
        caption=scene.caption,
        pinned=scene.pin.asset_digest,
        width=info.width,
        height=info.height,
    )
    return entry, MediaCopy(source=source, published=published)


def _portrait_publication(
    inputs: PortraitInputs, world: WorldModel, root: Path
) -> PortraitPublication:
    tree = world.trees.get(LINEAGE_TREE_ID)
    if tree is None:
        raise PublishRefused(
            f"portraits need the curated {LINEAGE_TREE_ID!r} tree; run `make data`"
        )
    ordered = [record for record, _ in lineage_order(inputs.book, tree)]
    pinned = [record for record in ordered if record.pin is not None]
    plates, files = [], []
    for record in pinned:
        assert record.pin is not None, record.id
        source, info = _verified_pin(record.id, record.pin, root)
        published = f"portraits/{record.id}{info.extension}"
        plates.append(
            PortraitPlateData(
                node_id=record.id,
                image=published,
                plate=record.plate,
                pinned=record.pin.asset_digest,
                width=info.width,
                height=info.height,
            )
        )
        files.append(MediaCopy(source=source, published=published))
    morphs, morph_files, missing = _portrait_morphs(pinned, inputs.morph_cache)
    return PortraitPublication(
        data=PortraitSetData(plates=tuple(plates), morphs=morphs) if plates else None,
        files=(*files, *morph_files),
        unpinned=tuple(record.id for record in ordered if record.pin is None),
        missing_morphs=missing,
    )


def _portrait_morphs(
    pinned: list[PortraitRecord], cache: Path
) -> tuple[tuple[PortraitMorphData, ...], tuple[MediaCopy, ...], tuple[MorphKey, ...]]:
    """`pinned` is youngest first, so each pairwise step is (younger, older)."""
    morphs, files, missing = [], [], []
    for younger, older in pairwise(pinned):
        key = MorphKey.between(older, younger)
        record = load_morph(cache, key)
        if record is None:
            missing.append(key)
            continue
        directory = key.directory(cache)
        base = f"portraits/morphs/{older.id}--{younger.id}"
        copies = (
            MediaCopy(source=directory / FORWARD_FLOW_NAME, published=f"{base}.forward.png"),
            MediaCopy(source=directory / BACKWARD_FLOW_NAME, published=f"{base}.backward.png"),
        )
        for copy in copies:
            if not copy.source.is_file():
                raise PublishRefused(f"morph {older.id} -> {younger.id}: {copy.source} is missing")
        files.extend(copies)
        morphs.append(
            PortraitMorphData(
                older=older.id,
                younger=younger.id,
                forward=copies[0].published,
                backward=copies[1].published,
                forward_range=record.forward_range,
                backward_range=record.backward_range,
                size=record.size,
            )
        )
    return tuple(morphs), tuple(files), tuple(missing)


def _layers(
    world: WorldModel, portraits: PortraitSetData | None
) -> tuple[tuple[LayerFile, ...], tuple[LayerManifest, ...]]:
    files: list[LayerFile] = []
    entries: list[LayerManifest] = []
    for spec in SCALAR_LAYERS:
        series = world.series.get(spec.curated_id)
        if series is None:
            continue
        data = SeriesData(
            id=series.id,
            unit=series.unit,
            interpolation=series.interpolation,
            samples=tuple(
                SeriesSample(t=s.t, value=s.value, lower=s.lower, upper=s.upper)
                for s in series.samples
            ),
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        entries.append(
            _layer_entry(
                spec, LayerDataKind.SCALAR, series.domain, series.unit, series.interpolation
            )
        )
    for spec in NODE_LAYERS:
        tree = world.trees.get(spec.curated_id)
        if tree is None:
            continue
        data = TreeData(
            id=tree.id,
            portraits=portraits if spec.curated_id == LINEAGE_TREE_ID else None,
            nodes=tuple(
                TreeNodeData(
                    id=n.id,
                    parent=n.parent,
                    label=n.label,
                    t_divergence=n.t_divergence,
                    representative=n.representative,
                    note=n.note,
                    citation=n.citation,
                )
                for n in tree.nodes
            ),
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        # Tree.sample holds its youngest node through to the present, so the layer is defined
        # from t=0, not from that node's divergence date.
        entries.append(_layer_entry(spec, LayerDataKind.NODE, (0.0, tree.domain[1]), None, None))
    for spec in RASTER_LAYERS:
        raster = world.rasters.get(spec.curated_id)
        if raster is None:
            continue
        data = RasterData(
            id=raster.id,
            frames=tuple(RasterFrameData(t=f.t, ref=f.ref) for f in raster.frames),
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        entries.append(_layer_entry(spec, LayerDataKind.RASTER, raster.domain, None, None))
    return tuple(files), tuple(entries)


def _layer_path(spec: LayerSpec) -> str:
    return f"layers/{spec.curated_id}.json"


def _layer_entry(
    spec: LayerSpec,
    kind: LayerDataKind,
    domain: tuple[GeoTime, GeoTime],
    unit: str | None,
    interpolation: Interpolation | None,
) -> LayerManifest:
    return LayerManifest(
        id=spec.curated_id,
        name=spec.name,
        surface=spec.surface,
        data_kind=kind,
        time_domain=domain,
        source=spec.source,
        chartable=spec.chartable,
        unit=unit,
        interpolation=interpolation,
        data=_layer_path(spec),
    )


def _events(world: WorldModel) -> tuple[TimelineEvent, ...]:
    event_set = world.events.get(EVENTS_ID)
    if event_set is None:
        return ()
    return tuple(
        TimelineEvent(
            id=e.id,
            label=e.label,
            t_min=e.t_min,
            t_max=e.t_max,
            importance=e.importance,
            description=e.description,
            citation=e.citation,
        )
        for e in event_set.events
    )


def _credit(manifest_path: Path) -> Credit:
    with manifest_path.open("rb") as handle:
        source = SourceManifest.model_validate(tomllib.load(handle))
    if source.name != manifest_path.parent.name:
        raise PublishRefused(f"{manifest_path}: name {source.name!r} does not match its directory")
    return Credit(
        source_id=source.name,
        title=source.title,
        citation=source.citation,
        licence=source.licence,
        url=source.url,
    )
