"""`earthlapse publish`: data/media/manifest.json plus the media it references. Local only.

Everything is assembled and validated in memory first (`prepare_publication`) and only then
written (`write_publication`), so a refused publish leaves data/media/ as it was. All world
data comes through `WorldModel` (ADR-002). `write_publication` also prunes `data/media/scenes/`
and `data/media/portraits/` down to exactly what this publish wrote (`_prune_stale_media`), so a
scene or portrait whose published filename changes -- a format change, or no longer being pinned
at all -- never leaves an orphaned file behind.
"""

from __future__ import annotations

import math
import shutil
import tomllib
from collections import Counter
from dataclasses import dataclass, replace
from itertools import groupby, pairwise
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from pipeline.audio import WEBKIT_DECODABLE_FORMATS, StemBook, load_stem_book
from pipeline.databuild import discover_sources
from pipeline.density_encoding import POPULATION_DENSITY_D_MAX
from pipeline.exposure import ExposedPlate, ExposureError, erase_scale_bar, expose_plate
from pipeline.generators.image import ImageInfo, asset_digest, sniff_image
from pipeline.graph import digest_of
from pipeline.manifest import (
    AnyGlobeEffect,
    ArrivalEffect,
    AudioLoop,
    AudioStem,
    Chapter,
    Credit,
    EventsData,
    FeatureData,
    FeatureEstimateData,
    FeatureSetData,
    GlobeEffect,
    GlobeEffectAnchor,
    GlobeEffectWindow,
    LayerData,
    LayerDataKind,
    LayerManifest,
    LayerSurface,
    Manifest,
    PortraitExposureData,
    PortraitMorphData,
    PortraitPlateData,
    PortraitSetData,
    RasterData,
    RasterEncoding,
    RasterFrameData,
    Scene,
    SceneFraming,
    SceneLocationCoordinates,
    SceneSound,
    SeriesData,
    SeriesGap,
    SeriesSample,
    TimelineEvent,
    TreeData,
    TreeNodeData,
    dump_layer_data,
    dump_manifest,
)
from pipeline.manifest import SceneLocation as SceneLocationEntry
from pipeline.models import WorldModel
from pipeline.paleogeography import PlateModelUnavailable, Reconstructor, load_reconstructor
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
from pipeline.scenes import SceneBook, ScenePin, SceneRecord, SoundMode
from pipeline.scenes import SceneFraming as SceneFramingRecord
from pipeline.scenes import SceneLocation as SceneLocationRecord
from pipeline.scenes import SceneSound as SceneSoundRecord
from pipeline.shapes import EARTH_FORMATION, Event, EventSet, FeatureSet, GeoTime, Interpolation
from pipeline.shapes import ArrivalEffect as CuratedArrivalEffect
from pipeline.shapes import Feature as CuratedFeature
from pipeline.shapes import GlobeEffect as CuratedGlobeEffect
from pipeline.transcode import (
    PORTRAIT_WEBP_QUALITY,
    SCENE_WEBP_QUALITY,
    THUMBNAIL_SIZE,
    THUMBNAIL_WEBP_QUALITY,
    TranscodeError,
    to_thumbnail_webp,
    to_webp,
)

# Matches the committed stub's "/stub": web/src/shell/manifest.ts joins `${assetBase}/${data}`
# for layer files, so a trailing slash would request "/media//layers/...".
#
# Only a default for a consumer that reads the manifest off disk: the viewer overwrites this with
# the base it fetched the manifest from (web/src/shell/manifest.ts), since media and manifest are
# always published together and so always share an origin.
ASSET_BASE = "/media"
MANIFEST_NAME = "manifest.json"
EVENTS_ID = "events-core"
AUDIO_STEMS_SOURCE = "audio-stems"
# docs/GLOBE.md §6: the pre-1 Ga regimes, an EventSet with no timeline presence — it never
# reaches Manifest.events (see _events below), only manifest.layers as an ordinary
# dataKind="events" layer, so the timeline never lists it.
GLOBE_REGIMES_ID = "globe-regimes"
PLATES_NEOPROTEROZOIC_SOURCE = "plates-neoproterozoic"

HUMAN_ERA_BASEMAP_DOMAIN_END: GeoTime = 2_580_000.0
"""years BP -- the Gelasian/Quaternary-Pleistocene boundary, matching
`sources/basemap/normalise.py`'s `PLEISTOCENE_START` (ADR-030): the globe's present-day-terrain
basemap covers `t <= 2,580,000`, so a scene's `location` at or inside that domain (ADR-034)
publishes its present-day coordinates as the marker directly, with no plate reconstruction.
Duplicated here rather than imported -- `pipeline/` never statically imports a `sources/<name>`
module (sources are loaded dynamically, `pipeline.databuild.load_source_module`); if the two
constants ever need to move together, that import boundary is the seam to reconsider."""


class PublishRefused(RuntimeError):
    """The publication would be wrong or incomplete. Nothing has been written."""


@dataclass(frozen=True)
class LayerSpec:
    curated_id: str
    name: str
    surface: LayerSurface
    source: str  # sources/<name>/, matched to a Credit
    chartable: bool
    # Additive (ADR-031 amendment "population density"): how to decode this raster's texture
    # bytes into a real physical quantity. None for every colour-only raster layer -- the vast
    # majority, and every one published before this field existed.
    raster_encoding: RasterEncoding | None = None


SCALAR_LAYERS = (
    LayerSpec("co2", "Atmospheric CO₂", LayerSurface.HUD, "co2-o2", chartable=True),
    LayerSpec("day_length", "Day length", LayerSurface.HUD, "astronomy", chartable=False),
    # ADR-031 amendment "global population total": HYDE 3.2's derived world-population-total
    # series, from the same source as the population-density globe overlay. chartable=True
    # (unlike day_length) -- this is the one HUD number the readout column has nothing else
    # covering, so it earns a sparkline/chart the way co2's own does.
    LayerSpec("population", "Global population", LayerSurface.HUD, "hyde", chartable=True),
    # LR04-derived (sources/lr04): drive the globe's ice-age caps and shelf exposure, not the HUD.
    LayerSpec("ice_volume", "Ice volume (LGM = 1)", LayerSurface.GLOBE, "lr04", chartable=False),
    LayerSpec("sea_level", "Sea level", LayerSurface.GLOBE, "lr04", chartable=False),
)
NODE_LAYERS = (LayerSpec("lineage", "Your ancestor", LayerSurface.HUD, "lineage", chartable=False),)
RASTER_LAYERS = (
    LayerSpec("paleodem", "Paleogeography", LayerSurface.GLOBE, "paleodem", chartable=False),
    # docs/GLOBE.md §4.1 (G7): Merdith et al. 2021 continents, 1000-540 Ma, stylised relief.
    # Crossfades against "paleodem" across a 540-550 Ma seam band -- a web-side concern
    # (buildLayers.ts selecting raster layers by id, ADR-013's noted follow-up), not this spec.
    LayerSpec(
        "plates_neoproterozoic",
        "Neoproterozoic continents",
        LayerSurface.GLOBE,
        "plates-neoproterozoic",
        chartable=False,
    ),
    # ADR-030: the human-era globe base (Natural Earth II), replacing "paleodem" once
    # continental drift is imperceptible. Two resolution tiers, each its own curated id
    # (sources/basemap/normalise.py "Why two curated ids"). The product crossfades this
    # against "paleodem" across a 300-400 ka band -- entirely a web-side concern
    # (`BASEMAP_CROSSFADE_BAND`, same pattern as the seam band above), not this spec; this
    # source's own published time domain is a different, independently-justified number (the
    # Pleistocene start), not the crossfade band itself -- see sources/basemap/normalise.py's
    # `PLEISTOCENE_START`.
    LayerSpec(
        "basemap_t0", "Human-era basemap (orb)", LayerSurface.GLOBE, "basemap", chartable=False
    ),
    LayerSpec(
        "basemap_t1",
        "Human-era basemap (expanded)",
        LayerSurface.GLOBE,
        "basemap",
        chartable=False,
    ),
    # Cleared land (HYDE 3.2), the alternative to population density in the globe's one-of-N
    # overlay selector -- only one raster overlay paints at a time. Colour-only, so no
    # `raster_encoding`: the three channels carry plain cell fractions (R cropland, G pasture plus
    # converted rangeland, B natural rangeland), which the web collapses into a single
    # human-modification scalar rather than decoding to a physical quantity.
    LayerSpec(
        "hyde_cleared_land",
        "Cleared land",
        LayerSurface.GLOBE,
        "hyde",
        chartable=False,
    ),
    # ADR-031 amendment: population density, from the same HYDE 3.2 deposit. R channel only
    # (people per km^2, 8-bit log-scale encoded -- see sources/hyde/README.md "Population
    # density encoding" for how D_MAX was chosen and pipeline/density_encoding.py for the exact
    # formula, shared with sources/hyde/normalise.py so the two can never disagree). The decode
    # parameters are published in this layer's own RasterData.encoding so the web can recover
    # an exact density, not just a relative shade.
    LayerSpec(
        "hyde_population_density",
        "Population density",
        LayerSurface.GLOBE,
        "hyde",
        chartable=False,
        raster_encoding=RasterEncoding(
            channel="r", unit="people_per_km2", d_max=POPULATION_DENSITY_D_MAX
        ),
    ),
)
EVENT_LAYERS = (
    LayerSpec(
        GLOBE_REGIMES_ID, "Globe regimes", LayerSurface.GLOBE, GLOBE_REGIMES_ID, chartable=False
    ),
)
CITIES_ID = "cities"
# ADR-035: major historical cities (Reba, Reitsma & Seto 2016), published as a `FeatureSet`
# layer. `surface` is "globe" like the point-anchored GlobeEffect kinds -- rendering (hover
# tooltips, markers) is out of this pass's scope, but the surface a future renderer would use
# is already the right one to declare.
FEATURE_LAYERS = (
    LayerSpec(CITIES_ID, "Major cities", LayerSurface.GLOBE, CITIES_ID, chartable=False),
)
CITIES_ROSTER_FILENAME = "roster.toml"
"""ADR-038: `sources/cities/roster.toml`, relative to that source's own directory -- a
hand-curated significance roster (imperial/national capitals, great trading ports, religious
centres, famous ancient sites, modern megacities) that replaces ADR-035's population-rank
notability filter. See `load_city_roster`/`apply_city_roster` below and
`sources/cities/README.md` "Significance roster"."""


class CityRosterEntry(BaseModel):
    """One curated roster entry (ADR-038): `id` names a `Feature.id` in the curated `cities`
    `FeatureSet` (`data/curated/cities.parquet`) -- the same slug `sources/cities/normalise.py`
    assigns (e.g. `uruk-iraq`) -- and `reason` is a short, human-written note on why this city
    made the cut, kept so the roster stays reviewable as prose, not just a bare id list."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class CityRoster(BaseModel):
    """Every roster entry, loaded from `sources/cities/roster.toml` (ADR-038)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    cities: tuple[CityRosterEntry, ...] = Field(min_length=1)


class CityRosterError(ValueError):
    """`roster.toml` is malformed (a duplicate `id`), or names a city absent from the curated
    `cities` `FeatureSet` -- both are authoring mistakes in the roster itself, not something a
    publish should silently work around (`docs/DATA_SOURCES.md` "if something is unusable, stop
    and report")."""


def load_city_roster(path: Path) -> CityRoster:
    with path.open("rb") as handle:
        document = tomllib.load(handle)
    roster = CityRoster.model_validate(document)
    duplicates = sorted(
        id_ for id_, count in Counter(entry.id for entry in roster.cities).items() if count > 1
    )
    if duplicates:
        raise CityRosterError(f"{path}: duplicate roster id(s): {', '.join(duplicates)}")
    return roster


def apply_city_roster(feature_set: FeatureSet, roster: CityRoster) -> FeatureSet:
    """The published `cities` layer (ADR-038): every curated feature the roster names, in
    roster order's underlying set -- `FeatureSet`'s own validator re-sorts by id. Strict at the
    boundary: a roster entry with no matching curated feature raises, naming every offending
    entry at once, rather than silently dropping it (a roster typo should fail loudly, not
    quietly shrink the published globe)."""
    by_id = {feature.id: feature for feature in feature_set.features}
    missing = [entry.id for entry in roster.cities if entry.id not in by_id]
    if missing:
        raise CityRosterError(
            f"{feature_set.id}: roster names {len(missing)} cit"
            f"{'y' if len(missing) == 1 else 'ies'} absent from the curated dataset: "
            f"{', '.join(missing)}"
        )
    kept = [by_id[entry.id] for entry in roster.cities]
    return FeatureSet(id=feature_set.id, features=kept)


@dataclass(frozen=True)
class MediaCopy:
    source: Path
    published: str  # relative to the media directory


@dataclass(frozen=True)
class MediaBytes:
    """A published file derived in memory rather than copied: an exposure-normalised, WebP-
    transcoded portrait plate, or a WebP-transcoded scene still."""

    data: bytes
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
    files: tuple[MediaBytes | MediaCopy, ...]  # exposed plates, then copied morph fields
    unpinned: tuple[str, ...]
    missing_morphs: tuple[
        MorphKey, ...
    ]  # consecutive pinned pairs `earthlapse morph` has not run for
    dissolved_morphs: tuple[MorphKey, ...]  # computed but too incoherent to trust (ADR-015):
    # `earthlapse morph` judged these fine to skip, not to rerun; the viewer crossfades them
    # exactly as it would an ungenerated pair


@dataclass(frozen=True)
class Publication:
    manifest: Manifest
    scene_files: tuple[
        MediaBytes, ...
    ]  # WebP-transcoded, in memory from the pin (pipeline.transcode)
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


def validated_asset_base(value: str) -> str:
    """The origin (or absolute path) the manifest's media paths are joined onto.

    Rejects a trailing slash rather than normalising one away: the join is a bare f-string in the
    viewer, and a doubled slash produces a 404 that only shows up at runtime.
    """
    if value.endswith("/"):
        raise PublishRefused(f"asset base must not end in '/': {value!r}")
    if not value.startswith(("/", "https://")):
        raise PublishRefused(f"asset base must be an absolute path or https:// origin: {value!r}")
    return value


def prepare_publication(
    book: SceneBook,
    world: WorldModel,
    sources_dir: Path,
    root: Path,
    portraits: PortraitInputs | None,
    asset_base: str = ASSET_BASE,
) -> Publication:
    """Pinned scenes only; the caller decides whether unpinned ones are acceptable."""
    asset_base = validated_asset_base(asset_base)
    pinned = [scene for scene in book.scenes if scene.pin is not None]
    if not pinned:
        raise PublishRefused("no scene is pinned; pick candidates with `earthlapse review pick`")
    _validate_scene_events(book, world.events.get(EVENTS_ID))
    stem_book = load_stem_book(sources_dir / AUDIO_STEMS_SOURCE / "stems.toml")
    _validate_scene_sound(book, stem_book)
    # Only load the roster when there is a curated `cities` FeatureSet to filter -- a project
    # with no cities data (every test fixture short of a full build, and any future build that
    # simply hasn't run `databuild --only cities` yet) has no need of one, and shouldn't have to
    # ship a `sources/cities/roster.toml` it will never read.
    city_roster = (
        load_city_roster(sources_dir / CITIES_ID / CITIES_ROSTER_FILENAME)
        if world.features.get(CITIES_ID) is not None
        else None
    )
    reconstructor = _load_reconstructor_if_needed(pinned, root)
    scene_entries = [_scene_entry(scene, root, reconstructor) for scene in pinned]
    published_chapters = {scene.chapter for scene in pinned}
    chapters = tuple(c for c in chapter_spans(book) if c.id in published_chapters)
    portrait_publication = (
        None if portraits is None else _portrait_publication(portraits, world, root)
    )
    layer_files, layers = _layers(
        world,
        None if portrait_publication is None else portrait_publication.data,
        city_roster,
    )
    events = _events(world)
    audio_stems = _audio_stems(stem_book, root)
    credits = tuple(
        _credit(source.path / "manifest.toml") for source in discover_sources(sources_dir)
    )
    content = {
        "scenes": [entry.model_dump(mode="json") for entry, _ in scene_entries],
        "chapters": [c.model_dump(mode="json") for c in chapters],
        "layers": [layer.model_dump(mode="json") for layer in layers],
        "layer_data": {f.published: f.data.model_dump(mode="json") for f in layer_files},
        "events": [e.model_dump(mode="json") for e in events],
        "audio_stems": [a.model_dump(mode="json") for a in audio_stems],
        "credits": [c.model_dump(mode="json") for c in credits],
    }
    manifest = Manifest(
        schema_version=1,
        build_id=digest_of(content),
        asset_base=asset_base,
        scenes=tuple(entry for entry, _ in scene_entries),
        chapters=chapters,
        layers=layers,
        events=events,
        audio_stems=audio_stems,
        credits=credits,
    )
    return Publication(
        manifest=manifest,
        scene_files=tuple(media for _, files in scene_entries for media in files),
        layer_files=layer_files,
        portraits=portrait_publication,
    )


def _prune_stale_media(directory: Path, keep: frozenset[str]) -> tuple[str, ...]:
    """Removes every file directly in `directory` (non-recursive: a subdirectory, e.g.
    `portraits/morphs/`, is left alone) whose name is not in `keep`. Returns what was removed.

    A publish is otherwise purely additive (this module's own docstring covers the in-memory-
    then-written half, not this): without this, a scene or portrait whose published filename
    changes -- a format change (the WebP transcode, `pipeline.transcode`), or the scene/portrait
    no longer being pinned at all -- leaves its previous file sitting in `data/media/` forever,
    silently growing it on every publish. Safe by ADR-005: this only ever touches derived output
    under `data/media/`, never `data/candidates/` -- deleting all of `data/media/` and
    republishing always reproduces it from the pins.
    """
    if not directory.is_dir():
        return ()
    removed = sorted(
        entry.name for entry in directory.iterdir() if entry.is_file() and entry.name not in keep
    )
    for name in removed:
        (directory / name).unlink()
    return tuple(removed)


def write_publication(publication: Publication, media_dir: Path) -> Path:
    portrait_files = () if publication.portraits is None else publication.portraits.files
    for media in (*publication.scene_files, *portrait_files):
        target = media_dir / media.published
        target.parent.mkdir(parents=True, exist_ok=True)
        match media:
            case MediaCopy(source=source):
                shutil.copyfile(source, target)
            case MediaBytes(data=data):
                target.write_bytes(data)
    _prune_stale_media(
        media_dir / "scenes", frozenset(Path(m.published).name for m in publication.scene_files)
    )
    if publication.portraits is not None:
        # Top-level plate files only -- `portraits/morphs/` is a directory, not a file, so
        # `_prune_stale_media`'s own `is_file()` check already leaves it (and everything in it)
        # alone regardless.
        plate_names = frozenset(
            Path(m.published).name
            for m in publication.portraits.files
            if Path(m.published).parent.name == "portraits"
        )
        _prune_stale_media(media_dir / "portraits", plate_names)
    for layer in publication.layer_files:
        target = media_dir / layer.published
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dump_layer_data(layer.data))
    manifest_path = media_dir / MANIFEST_NAME
    manifest_path.write_text(dump_manifest(publication.manifest))
    return manifest_path


def chapter_spans(book: SceneBook) -> tuple[Chapter, ...]:
    """Chapter *runs* tiling [present, Earth's formation], each boundary at the midpoint in
    log1p(t) between the runs' facing scenes: where web/src/scene dissolves across that
    boundary. A chapter may recur as several non-adjacent runs (ADR-020): `groupby` here groups
    by adjacency, not by id, so a recurring chapter id yields one `Chapter` entry per run, each
    with its own span — the manifest's `chapters` array is therefore a list of runs, not a
    deduplicated-by-id list of chapters."""
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


def _verified_pin(subject_id: str, pin: ScenePin, root: Path) -> tuple[bytes, ImageInfo]:
    """The pin's own bytes, verified against its recorded digest, plus its sniffed format/size.

    Every publish-time derivative (WebP transcode, exposure normalisation) must be built from
    these bytes -- computed fresh here, in memory, for this publish -- never from a file already
    written under `data/media/`. See `pipeline.transcode`'s module docstring for why."""
    source = root / pin.path
    if not source.is_file():
        raise PublishRefused(f"{subject_id}: pinned image {pin.path} does not exist")
    data = source.read_bytes()
    if asset_digest(data) != pin.asset_digest:
        raise PublishRefused(
            f"{subject_id}: {pin.path} no longer matches pinned digest {pin.asset_digest}"
        )
    return data, sniff_image(data)


def _to_webp(subject_id: str, data: bytes, quality: int) -> bytes:
    """`data` (already decoded from a pin, or an in-memory derivative of one, for this publish)
    as WebP, or a refusal naming `subject_id` if it cannot be decoded."""
    try:
        return to_webp(data, quality)
    except TranscodeError as err:
        raise PublishRefused(f"{subject_id}: {err}") from err


def _to_thumbnail_webp(subject_id: str, data: bytes) -> bytes:
    """`data` (the pinned original's own bytes, never a previously published derivative --
    `pipeline.transcode`'s module docstring) as a `THUMBNAIL_SIZE`-square WebP thumbnail, or a
    refusal naming `subject_id` if it cannot be decoded."""
    try:
        return to_thumbnail_webp(data, THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY)
    except TranscodeError as err:
        raise PublishRefused(f"{subject_id}: {err}") from err


def _validate_scene_events(book: SceneBook, event_set: EventSet | None) -> None:
    """Every scene->event link (ADR-022) must name a real events-core event id. Checked here,
    against the whole book, rather than in SceneBook's own validator: parsing scenes.yaml has no
    curated event data to check against (pipeline/scenes.py), and every other cross-file check
    in this module (e.g. `_verified_pin`) already lives at publish time."""
    known = frozenset(e.id for e in event_set.events) if event_set is not None else frozenset()
    for scene in book.scenes:
        unknown = [event_id for event_id in scene.events if event_id not in known]
        if unknown:
            raise PublishRefused(
                f"{scene.id}: unknown event id(s) {unknown} -- not in {EVENTS_ID!r}"
            )


def _validate_scene_sound(book: SceneBook, stem_book: StemBook) -> None:
    """Every scene->stem link (ADR-023) must name a real audio-stems catalogue id. Checked
    here, against the whole book, rather than in SceneBook's own validator -- the same
    reasoning `_validate_scene_events` gives for `scene.events`: parsing scenes.yaml has no
    stem catalogue to check against.

    A `loop`-mode sound must also name a loop-safe stem: a one-shot (`loop_safe = false`) gets
    no looping player in the web engine, so the loop would publish and then play nothing."""
    stems = {s.id: s for s in stem_book.stems}
    for scene in book.scenes:
        if scene.sound is None:
            continue
        stem = stems.get(scene.sound.stem)
        if stem is None:
            raise PublishRefused(
                f"{scene.id}: unknown stem id {scene.sound.stem!r} -- not in {AUDIO_STEMS_SOURCE!r}"
            )
        if scene.sound.mode is SoundMode.LOOP and not stem.loop_safe:
            raise PublishRefused(
                f"{scene.id}: stem {stem.id!r} is a one-shot (loop_safe = false) and cannot be "
                f"a loop-mode scene sound -- use mode: once"
            )


def _scene_sound(sound: SceneSoundRecord | None) -> SceneSound | None:
    if sound is None:
        return None
    return SceneSound(stem=sound.stem, mode=sound.mode, gain=sound.gain)


def _scene_framing(framing: SceneFramingRecord | None) -> SceneFraming | None:
    if framing is None:
        return None
    return SceneFraming(
        focus=framing.focus,
        pan=framing.pan,
        portrait_zoom=None if framing.portrait_zoom == 1.0 else framing.portrait_zoom,
    )


def _load_reconstructor_if_needed(pinned: list[SceneRecord], root: Path) -> Reconstructor | None:
    """Most publishes need no plate reconstruction at all: no scene has a `location`, or every
    located scene sits inside the human-era basemap domain. Loading the Merdith model parses two
    GPML files, so it's skipped entirely unless some pinned scene's `location` actually needs
    it (ADR-034), and built at most once per publish, then reused for every such scene."""
    needs_reconstruction = any(
        scene.location is not None and scene.t > HUMAN_ERA_BASEMAP_DOMAIN_END for scene in pinned
    )
    if not needs_reconstruction:
        return None
    raw_dir = root / "data" / "raw" / PLATES_NEOPROTEROZOIC_SOURCE
    try:
        return load_reconstructor(raw_dir)
    except PlateModelUnavailable as err:
        raise PublishRefused(f"scene location reconstruction unavailable: {err}") from err


def _scene_location(
    t: GeoTime, location: SceneLocationRecord | None, reconstructor: Reconstructor | None
) -> SceneLocationEntry | None:
    """ADR-034. `present_day` always publishes the curated coordinates, so the reconstruction
    stays auditable. `marker` -- what the globe should actually plot -- is `present_day`
    unchanged for a scene at or inside the human-era basemap domain (`t <=
    HUMAN_ERA_BASEMAP_DOMAIN_END`, ADR-030: real geography at that scale, no reconstruction
    needed), the plate-reconstructed position for an older one the model covers, or `None` when
    it doesn't -- a genuine gap (e.g. no Merdith continental polygon under the Isthmus of
    Panama) published as "no marker" rather than a silently wrong present-day guess (CLAUDE.md
    "if something is unusable, stop and report")."""
    if location is None:
        return None
    present_day = SceneLocationCoordinates(lat=location.lat, lon=location.lon)
    if t <= HUMAN_ERA_BASEMAP_DOMAIN_END:
        marker = present_day
    else:
        assert reconstructor is not None, "prepare_publication loads one whenever needed"
        reconstructed = reconstructor.reconstruct(location.lat, location.lon, t)
        marker = (
            None
            if reconstructed is None
            else SceneLocationCoordinates(lat=reconstructed[0], lon=reconstructed[1])
        )
    return SceneLocationEntry(label=location.label, present_day=present_day, marker=marker)


def _audio_stems(stem_book: StemBook, root: Path) -> tuple[AudioStem, ...]:
    """Published stem files are not copied here -- `sources/audio-stems/normalise.py`'s
    `write_outputs()` already placed them, content-hashed (ADR-023 amendment "on-demand
    loading"), at their final `data/media/audio/` location as part of `make data`, the same way
    `paleodem`'s globe textures are placed directly rather than staged and copied at publish
    time. This discovers each catalogued stem's actual published filename -- `write_outputs()`
    names it `<id>-<hash>.<format>` from its own content, so the hash is not re-derived here --
    and refuses if it is missing, or if more than one candidate exists (a stale file
    `write_outputs()` should have cleared; re-running `make data` fixes it). Also refuses a stem
    whose declared format is not WebKit-decodable (`pipeline.audio.WEBKIT_DECODABLE_FORMATS`) --
    catches a future OGG- or WAV-only source before it ships silently and fails to decode on
    Safari/iOS."""
    stems = []
    audio_dir = root / "data" / "media" / "audio"
    for stem in stem_book.stems:
        if stem.format not in WEBKIT_DECODABLE_FORMATS:
            raise PublishRefused(
                f"stem {stem.id}: format {stem.format!r} is not decodable on Safari/iOS "
                f"(WebKit) -- publishable stem formats are "
                f"{sorted(f.value for f in WEBKIT_DECODABLE_FORMATS)}; re-source {stem.id} as "
                f"one of those instead"
            )
        matches = sorted(audio_dir.glob(f"{stem.id}-*.{stem.format}"))
        if not matches:
            raise PublishRefused(
                f"stem {stem.id}: no published file matching "
                f"data/media/audio/{stem.id}-*.{stem.format} -- run `make data` "
                f"(sources/audio-stems/normalise.py write_outputs)"
            )
        if len(matches) > 1:
            names = ", ".join(m.name for m in matches)
            raise PublishRefused(
                f"stem {stem.id}: {len(matches)} published files match "
                f"data/media/audio/{stem.id}-*.{stem.format} ({names}) -- re-run `make data` "
                f"to clear the stale one(s)"
            )
        published = f"audio/{matches[0].name}"
        stems.append(
            AudioStem(
                id=stem.id,
                file=published,
                title=stem.title,
                author=stem.author,
                licence=stem.licence,
                source_url=stem.url,
                duration_seconds=stem.duration_seconds,
                loop_safe=stem.loop_safe,
                level_trim_db=stem.level_trim_db,
                loop=None
                if stem.loop is None
                else AudioLoop(
                    start_seconds=stem.loop.start_seconds, end_seconds=stem.loop.end_seconds
                ),
                start_seconds=stem.start_seconds,
            )
        )
    return tuple(stems)


def _scene_entry(
    scene: SceneRecord, root: Path, reconstructor: Reconstructor | None
) -> tuple[Scene, tuple[MediaBytes, MediaBytes]]:
    assert scene.pin is not None, scene.id
    data, info = _verified_pin(scene.id, scene.pin, root)
    published = f"scenes/{scene.id}.webp"
    thumbnail_published = f"scenes/{scene.id}-thumb.webp"
    webp = _to_webp(scene.id, data, SCENE_WEBP_QUALITY)
    # Always derived from `data` (the pin's own bytes) -- never from `webp` above, which would
    # be a lossy encode of a lossy encode (this module's own docstring; `pipeline.transcode`'s).
    thumbnail_webp = _to_thumbnail_webp(scene.id, data)
    entry = Scene(
        id=scene.id,
        t=scene.t,
        chapter_id=scene.chapter,
        image=published,
        thumbnail=thumbnail_published,
        shot=scene.shot,
        title=scene.title,
        caption=scene.caption,
        events=scene.events,
        sound=_scene_sound(scene.sound),
        location=_scene_location(scene.t, scene.location, reconstructor),
        framing=_scene_framing(scene.framing),
        pinned=scene.pin.asset_digest,
        width=info.width,
        height=info.height,
    )
    return entry, (
        MediaBytes(data=webp, published=published),
        MediaBytes(data=thumbnail_webp, published=thumbnail_published),
    )


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
        data, info = _verified_pin(record.id, record.pin, root)
        exposed = _exposed_plate(record.id, data)
        published = f"portraits/{record.id}.webp"
        plates.append(
            PortraitPlateData(
                node_id=record.id,
                image=published,
                plate=record.plate,
                pinned=record.pin.asset_digest,
                width=info.width,
                height=info.height,
                exposure=PortraitExposureData(
                    highlight=exposed.exposure.highlight, gain=exposed.exposure.gain
                ),
            )
        )
        files.append(MediaBytes(data=exposed.data, published=published))
    morphs, morph_files, missing, dissolved = _portrait_morphs(pinned, inputs.morph_cache)
    return PortraitPublication(
        data=PortraitSetData(plates=tuple(plates), morphs=morphs) if plates else None,
        files=(*files, *morph_files),
        unpinned=tuple(record.id for record in ordered if record.pin is None),
        missing_morphs=missing,
        dissolved_morphs=dissolved,
    )


def _exposed_plate(node_id: str, data: bytes) -> ExposedPlate:
    """The plate as published: `data` (the pin's own bytes, for this publish -- see
    `_verified_pin`), exposure-normalised, scale-bar-erased and WebP-transcoded, all in memory
    (ADR-015; WebP transcode, `pipeline.transcode`). The pinned file itself is never rewritten
    (ADR-005), and morph fields stay computed from it: none of these steps change geometry."""
    try:
        exposed = expose_plate(data)
        erased_data = erase_scale_bar(exposed.data)
    except ExposureError as err:
        raise PublishRefused(f"{node_id}: {err}") from err
    return replace(exposed, data=_to_webp(node_id, erased_data, PORTRAIT_WEBP_QUALITY))


def _portrait_morphs(
    pinned: list[PortraitRecord], cache: Path
) -> tuple[
    tuple[PortraitMorphData, ...], tuple[MediaCopy, ...], tuple[MorphKey, ...], tuple[MorphKey, ...]
]:
    """`pinned` is youngest first, so each pairwise step is (younger, older). Returns
    (morphs, files, missing, dissolved): `dissolved` pairs are computed but too incoherent to
    trust (ADR-015 amendment), published as if no morph existed so the viewer crossfades them."""
    morphs, files, missing, dissolved = [], [], [], []
    for younger, older in pairwise(pinned):
        key = MorphKey.between(older, younger)
        record = load_morph(cache, key)
        if record is None:
            missing.append(key)
            continue
        if record.fallback_dissolve:
            dissolved.append(key)
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
    return tuple(morphs), tuple(files), tuple(missing), tuple(dissolved)


def _layers(
    world: WorldModel,
    portraits: PortraitSetData | None,
    city_roster: CityRoster | None = None,
) -> tuple[tuple[LayerFile, ...], tuple[LayerManifest, ...]]:
    """`city_roster` is `None` by default only for tests exercising the other layer kinds --
    the real `prepare_publication` call site always loads and passes one (ADR-038). It has no
    effect unless `world.features` actually holds a `cities` `FeatureSet`."""
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
            gaps=tuple(
                SeriesGap(from_index=g.from_index, to_index=g.to_index) for g in series.gaps
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
            encoding=spec.raster_encoding,
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        entries.append(_layer_entry(spec, LayerDataKind.RASTER, raster.domain, None, None))
    for spec in EVENT_LAYERS:
        event_set = world.events.get(spec.curated_id)
        if event_set is None:
            continue
        data = EventsData(
            id=event_set.id, events=tuple(_timeline_event(e) for e in event_set.events)
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        entries.append(_layer_entry(spec, LayerDataKind.EVENTS, event_set.domain, None, None))
    for spec in FEATURE_LAYERS:
        feature_set = world.features.get(spec.curated_id)
        if feature_set is None:
            continue
        # The curated FeatureSet keeps every normalised record; only "cities" is filtered down
        # to the hand-curated significance roster before publishing (ADR-038, superseding
        # ADR-035's population-rank notability filter) -- the same "special-case one entry in
        # an otherwise-generic loop" pattern NODE_LAYERS already uses for portraits
        # (`if spec.curated_id == LINEAGE_TREE_ID`).
        if spec.curated_id == CITIES_ID and city_roster is not None:
            feature_set = apply_city_roster(feature_set, city_roster)
        data = FeatureSetData(
            id=feature_set.id, features=tuple(_feature(f) for f in feature_set.features)
        )
        files.append(LayerFile(published=_layer_path(spec), data=data))
        entries.append(_layer_entry(spec, LayerDataKind.FEATURES, feature_set.domain, None, None))
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
    return tuple(_timeline_event(e) for e in event_set.events)


def _feature(f: CuratedFeature) -> FeatureData:
    return FeatureData(
        id=f.id,
        name=f.name,
        country=f.country,
        lat=f.lat,
        lon=f.lon,
        certainty=f.certainty,
        estimates=tuple(FeatureEstimateData(t=e.t, population=e.population) for e in f.estimates),
    )


def _timeline_event(e: Event) -> TimelineEvent:
    return TimelineEvent(
        id=e.id,
        label=e.label,
        kind=e.kind,
        t_min=e.t_min,
        t_max=e.t_max,
        t=e.t,
        tags=e.tags,
        importance=e.importance,
        description=e.description,
        citation=e.citation,
        effect=_effect(e.effect),
    )


def _effect(effect: CuratedGlobeEffect | CuratedArrivalEffect | None) -> AnyGlobeEffect | None:
    if effect is None:
        return None
    windows = tuple(GlobeEffectWindow(t_min=w.t_min, t_max=w.t_max) for w in effect.windows)
    if isinstance(effect, CuratedArrivalEffect):
        return ArrivalEffect(
            kind=effect.kind,
            arrival_kind=effect.arrival_kind,
            origin=GlobeEffectAnchor(lat=effect.origin.lat, lon=effect.origin.lon),
            destination=GlobeEffectAnchor(lat=effect.destination.lat, lon=effect.destination.lon),
            established=effect.established,
            windows=windows,
        )
    return GlobeEffect(
        kind=effect.kind,
        anchor=None
        if effect.anchor is None
        else GlobeEffectAnchor(lat=effect.anchor.lat, lon=effect.anchor.lon),
        windows=windows,
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
