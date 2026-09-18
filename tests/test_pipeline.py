"""`earthtime` end to end against a temporary project. Offline: a fake image generator only."""

from __future__ import annotations

import io
import itertools
import json
import math
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError
from typer.testing import CliRunner

from pipeline.assets import build_scene_graph
from pipeline.audio import content_hashed_filename
from pipeline.cli import create_app
from pipeline.curated import load_world, write_shape
from pipeline.density_encoding import POPULATION_DENSITY_D_MAX
from pipeline.generators.gemini import MODEL_ID
from pipeline.generators.image import (
    GeneratedImage,
    GenerationFailed,
    ImageGenerator,
    asset_digest,
    sniff_image,
)
from pipeline.graph import AssetNode
from pipeline.manifest import ArrivalEffect as WireArrivalEffect
from pipeline.manifest import (
    FeatureSetData,
    LayerDataKind,
    LayerSurface,
    Manifest,
    RasterData,
    SeriesData,
    TreeData,
)
from pipeline.manifest import GlobeEffect as WireGlobeEffect
from pipeline.manifest import SceneLocation as WireSceneLocation
from pipeline.models import AtmosphereState, SkyState, WorldModel, WorldState
from pipeline.paths import ProjectPaths
from pipeline.prompts import UnsourcedConditions, render_conditions
from pipeline.publish import (
    FEATURE_LAYERS,
    HUMAN_ERA_BASEMAP_DOMAIN_END,
    RASTER_LAYERS,
    SCALAR_LAYERS,
    CityRoster,
    CityRosterEntry,
    CityRosterError,
    PublishRefused,
    _effect,
    _layers,
    _prune_stale_media,
    _scene_location,
    apply_city_roster,
    chapter_spans,
    load_city_roster,
    validated_asset_base,
)
from pipeline.scenes import (
    SceneBook,
    SceneLocation,
    ScenePin,
    SceneRecord,
    SceneSound,
    SoundMode,
    load_scene_book,
    parse_scene_book,
)
from pipeline.shapes import (
    ArrivalEffect,
    ArrivalKind,
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventSet,
    EventTag,
    Feature,
    FeatureCertainty,
    FeatureSet,
    Gap,
    GlobeEffect,
    GlobeEffectKind,
    Interpolation,
    PopulationEstimate,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
    Tree,
    TreeNode,
)
from pipeline.spend import Entry, Ledger
from pipeline.store import CandidateRecord, CandidateStore
from pipeline.transcode import (
    SCENE_WEBP_QUALITY,
    THUMBNAIL_SIZE,
    THUMBNAIL_WEBP_QUALITY,
    to_thumbnail_webp,
    to_webp,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
STUB_DIR = REPO_ROOT / "web" / "public" / "stub"

ESTIMATE_USD = 0.1
FAKE_GENERATOR = "fake-image"
FAKE_VERSION = "1"

SCENES_YAML = """\
# A comment the pin writer must keep.
chapters:
  - id: molten
    label: Molten
    shot: WIDE_RIDGE
    composition: ridge-vista
  - id: shore
    label: Shore
    shot: WATER_EDGE
    composition: water-edge-series

scenes:
  - id: hot-start
    t: 4.5e9
    chapter: molten
    shot: WIDE_RIDGE
    title: Hot Start
    caption: A molten world.
    unsourced:
      o2_percent: 0  # hand-written
      mean_temp_c: null
    subject:
      setting: A magma ocean
      left_mass: black crust
      vegetation: none
      fauna: none
      main_subject: a lava fountain
      ground: hot crust
      water: none
      far_bank: none
      sky_and_light: ash
      absent: [water]
    pin: null

  - id: devonian
    t: 3.75e8
    chapter: shore
    shot: WATER_EDGE
    title: Devonian Estuary
    caption: An estuary.
    unsourced:
      o2_percent: 18
      mean_temp_c: 24
    subject:
      setting: A Devonian estuary
      left_mass: Archaeopteris trees
      vegetation: Archaeopteris
      fauna: lobe-finned fishes
      main_subject: a tetrapodomorph
      ground: mud
      water: brackish
      far_bank: bare upland
      sky_and_light: clear
      absent: [flowers, grass]
    pin: null

  - id: city
    t: 0
    chapter: shore
    shot: WATER_EDGE
    title: A City
    caption: A city.
    unsourced:
      o2_percent: 21
      mean_temp_c: 15
    subject:
      setting: A waterfront
      left_mass: towers
      vegetation: street trees
      fauna: gulls
      main_subject: a ferry
      ground: an embankment
      water: a river
      far_bank: a skyline
      sky_and_light: haze
      absent: [flying cars]
    pin: null
"""

CO2 = TimeSeries(
    id="co2",
    unit="ppm",
    interpolation=Interpolation.LOG_LINEAR,
    samples=[Sample(t=0.0, value=280.0), Sample(t=5.7e8, value=4000.0)],
)
DAY_LENGTH = TimeSeries(
    id="day_length",
    unit="hours",
    interpolation=Interpolation.LINEAR,
    samples=[Sample(t=0.0, value=24.0), Sample(t=4.567e9, value=6.0, lower=5.0, upper=7.0)],
)
SOLAR_LUMINOSITY = TimeSeries(
    id="solar_luminosity",
    unit="relative",
    interpolation=Interpolation.LINEAR,
    samples=[Sample(t=0.0, value=1.0), Sample(t=4.567e9, value=0.7)],
)
LINEAGE = Tree(
    id="lineage",
    nodes=[
        TreeNode(id="luca", parent=None, label="LUCA", t_divergence=4.0e9, citation="Moody 2024"),
        TreeNode(
            id="human",
            parent="luca",
            label="Homo sapiens",
            t_divergence=3.0e5,
            representative="Homo sapiens",
        ),
    ],
)
PALEODEM = RasterSequence(
    id="paleodem",
    frames=[
        RasterFrame(t=0.0, ref="textures/paleodem/0.png"),
        RasterFrame(t=1e8, ref="textures/paleodem/100.png"),
    ],
)
EVENTS = EventSet(
    id="events-core",
    events=[
        Event(
            id="kpg",
            label="K-Pg impact",
            kind=EventKind.MOMENT,
            t_min=6.6e7,
            t_max=6.61e7,
            t=6.605e7,
            tags=[EventTag.CATASTROPHE, EventTag.LIFE],
            importance=0.95,
            description="Chicxulub.",
            citation="Renne et al. 2013",
            # docs/GLOBE.md §6: the additive effect field, exercised end to end through
            # publish here (see test_publish_emits_a_valid_manifest_and_layer_json_in_the_
            # parser_formats' exact-match manifest assertion).
            effect=GlobeEffect(
                kind=GlobeEffectKind.IMPACT_WINTER,
                anchor=EffectAnchor(lat=21.3, lon=-89.5),
                windows=[EffectWindow(t_min=6.6e7, t_max=6.61e7)],
            ),
        )
    ],
)
GLOBE_REGIMES = EventSet(
    id="globe-regimes",
    events=[
        Event(
            id="magma-ocean-regime",
            label="Magma ocean and newborn Moon",
            kind=EventKind.PERIOD,
            t_min=4.35e9,
            t_max=4.52e9,
            tags=[EventTag.EARTH_CLIMATE],
            importance=0.9,
            description="A cooling crust, a close Moon.",
            citation="Barboni et al. 2017",
            effect=GlobeEffect(
                kind=GlobeEffectKind.REGIME_MAGMA_OCEAN,
                windows=[EffectWindow(t_min=4.35e9, t_max=4.52e9)],
            ),
        )
    ],
)
SOURCE_MANIFESTS = {
    "astronomy": ("Analytic astronomy", "Laskar 2004", "n/a", "https://example.org/astro"),
    "co2-o2": ("GEOCARB III", "Berner 2001", "public domain", "https://example.org/co2"),
    "globe-regimes": (
        "Pre-1 Ga globe regimes",
        "Barboni et al. 2017",
        "n/a",
        "https://example.org/globe-regimes",
    ),
}


class FakeGenerator:
    """Reserves and settles in the real ledger, as every `ImageGenerator` must."""

    name = FAKE_GENERATOR
    version = FAKE_VERSION

    def __init__(self, backend: FakeBackend, ledger: Ledger, ledger_path: Path) -> None:
        self._backend = backend
        self._ledger = ledger
        self._ledger_path = ledger_path

    def estimate_usd(self, node: AssetNode) -> float:
        return ESTIMATE_USD

    def render(self, node: AssetNode) -> GeneratedImage:
        entry = self._ledger.reserve(node.id, self.name, 1, ESTIMATE_USD)
        self._ledger.save(self._ledger_path)
        self._backend.rendered.append(node.id)
        if node.id in self._backend.failing:
            self._ledger.settle(entry, 0.0)
            self._ledger.save(self._ledger_path)
            raise GenerationFailed(f"{node.id}: no image")
        self._ledger.settle(entry, self._backend.actual_usd)
        self._ledger.save(self._ledger_path)
        data = _png(len(self._backend.rendered))
        return GeneratedImage(
            data=data, info=sniff_image(data), usage=None, cost_usd=self._backend.actual_usd
        )


class FakeBackend:
    name = FAKE_GENERATOR
    version = FAKE_VERSION

    def __init__(self, actual_usd: float = ESTIMATE_USD, failing: frozenset[str] = frozenset()):
        self.actual_usd = actual_usd
        self.failing = failing
        self.rendered: list[str] = []
        self.opened = 0

    def estimate_usd(self, node: AssetNode) -> float:
        return ESTIMATE_USD

    @contextmanager
    def open(self, ledger: Ledger, ledger_path: Path, env_file: Path) -> Iterator[ImageGenerator]:
        self.opened += 1
        yield FakeGenerator(self, ledger, ledger_path)


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 9), (seed * 37 % 256, seed * 91 % 256, 128)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture
def root(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    paths = ProjectPaths(project)
    paths.scenes.parent.mkdir(parents=True)
    paths.scenes.write_text(SCENES_YAML)
    for shape in (CO2, DAY_LENGTH, SOLAR_LUMINOSITY, LINEAGE, PALEODEM, EVENTS, GLOBE_REGIMES):
        write_shape(shape, paths.curated)
    for name, (title, citation, licence, url) in SOURCE_MANIFESTS.items():
        source = paths.sources / name
        source.mkdir(parents=True)
        (source / "manifest.toml").write_text(
            f'name = "{name}"\ntitle = "{title}"\ncitation = "{citation}"\n'
            f'licence = "{licence}"\nurl = "{url}"\n'
        )
    return project.resolve()


def _run(backend: FakeBackend, root: Path, *args: str) -> tuple[int, str]:
    result = CliRunner().invoke(create_app(backend), ["--root", str(root), *args])
    if result.exception is not None and not isinstance(result.exception, SystemExit):
        raise result.exception
    return result.exit_code, result.output


def _build_and_pick_all(backend: FakeBackend, root: Path) -> None:
    code, _ = _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")
    assert code == 0
    for scene_id in ("hot-start", "devonian", "city"):
        assert _run(backend, root, "review", "pick", scene_id, "1")[0] == 0


# -- plan ------------------------------------------------------------------------------------


def test_plan_prints_an_estimate_and_spends_nothing(root: Path) -> None:
    ledger_path = ProjectPaths(root).ledger
    Ledger(entries=[Entry(node_id="x", generator="g", n=1, estimated_usd=1.53)]).save(ledger_path)
    before = ledger_path.read_bytes()
    backend = FakeBackend()

    code, output = _run(backend, root, "plan")

    assert code == 0
    assert "3 scenes: 0 pinned, 0 awaiting review, 3 stale" in output
    assert "estimate to build stale scenes: 3 x 3 candidates = 9 images, $0.90" in output
    assert "ledger spend.json: $1.53 spent so far" in output
    assert backend.opened == 0
    assert backend.rendered == []
    assert ledger_path.read_bytes() == before


# -- build -----------------------------------------------------------------------------------


def test_build_refuses_without_max_spend(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(backend, root, "build", "--only", "images")

    assert code == 2
    assert "Missing option '--max-spend'" in output
    assert backend.opened == 0
    assert not ProjectPaths(root).ledger.exists()


def test_build_refuses_when_the_estimate_exceeds_the_remaining_budget(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(backend, root, "build", "--max-spend", "0.5")

    assert code == 1
    assert "REFUSED: estimate $0.90 exceeds the $0.50 remaining" in output
    assert (backend.opened, backend.rendered) == (0, [])


def test_build_writes_candidates_with_sidecars_then_awaits_review(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(backend, root, "build", "--max-spend", "10", "--candidates", "2")

    assert code == 0, output
    assert backend.rendered == [
        "city.image",
        "city.image",
        "devonian.image",
        "devonian.image",
        "hot-start.image",
        "hot-start.image",
    ]
    paths = ProjectPaths(root)
    store = CandidateStore(paths.candidates)
    graph = build_scene_graph(load_scene_book(paths.scenes), load_world(paths.curated), backend)
    city = next(a for a in graph.assets if a.scene.id == "city")
    digest = graph.resolver(store).digest(city.image.id)
    first = store.candidates("city")[0]
    data = first.image_path.read_bytes()
    assert first.record == CandidateRecord(
        scene_id="city",
        node_id="city.image",
        node_digest=digest,
        asset_digest=asset_digest(data),
        file=first.image_path.name,
        prompt=city.image.inputs["prompt"],
        generator=FAKE_GENERATOR,
        generator_version=FAKE_VERSION,
        mime_type="image/png",
        width=16,
        height=9,
        usage=None,
        cost_usd=ESTIMATE_USD,
        attempts=1,
        created_at=first.record.created_at,
    )
    assert first.image_path.parent == paths.candidates / "city" / digest
    assert Ledger.load(paths.ledger).spent == pytest.approx(6 * ESTIMATE_USD)

    _, plan_output = _run(backend, root, "plan")
    assert "3 scenes: 0 pinned, 3 awaiting review, 0 stale" in plan_output


def test_build_stops_cleanly_on_budget_exceeded_and_exits_non_zero(root: Path) -> None:
    # Each call costs five times its estimate, so the pre-build check passes and the ledger
    # has to stop the third call itself.
    backend = FakeBackend(actual_usd=0.5)

    code, output = _run(backend, root, "build", "--max-spend", "1.0", "--candidates", "1")

    assert code == 1
    assert backend.rendered == ["city.image", "devonian.image"]
    assert "STOPPED at hot-start: BudgetExceeded" in output
    assert "built: 2 candidates across 2 scenes" in output
    ledger = Ledger.load(ProjectPaths(root).ledger)
    assert ledger.spent == pytest.approx(1.0)
    assert len(ledger.entries) == 2


def test_a_failing_image_is_retried_once_then_its_scene_is_skipped(root: Path) -> None:
    backend = FakeBackend(failing=frozenset({"devonian.image"}))

    code, output = _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")

    assert code == 1
    assert backend.rendered == ["city.image", "devonian.image", "devonian.image", "hot-start.image"]
    assert "skipped devonian: failed 2 times: devonian.image: no image" in output
    store = CandidateStore(ProjectPaths(root).candidates)
    assert [len(store.candidates(s)) for s in ("city", "devonian", "hot-start")] == [1, 0, 1]


# -- pins ------------------------------------------------------------------------------------


def test_a_pinned_scene_survives_a_prompt_change_and_is_not_regenerated(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0
    assert _run(backend, root, "review", "pick", "devonian", "1")[0] == 0
    paths = ProjectPaths(root)
    pin = load_scene_book(paths.scenes).scene("devonian").pin
    digest_before = _image_digest(root, backend, "devonian")

    paths.scenes.write_text(
        paths.scenes.read_text()
        .replace("fauna: lobe-finned fishes", "fauna: eurypterids")
        .replace("fauna: gulls", "fauna: cormorants")
    )
    backend.rendered.clear()
    code, output = _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")

    assert code == 0, output
    assert _image_digest(root, backend, "devonian") != digest_before
    assert backend.rendered == ["city.image"]
    assert load_scene_book(paths.scenes).scene("devonian").pin == pin
    assert "devonian" in output and re.search(r"devonian\s+375 Ma\s+shore\s+pinned", output)


def _image_digest(root: Path, backend: FakeBackend, scene_id: str) -> str:
    paths = ProjectPaths(root)
    graph = build_scene_graph(load_scene_book(paths.scenes), load_world(paths.curated), backend)
    return graph.resolver(CandidateStore(paths.candidates)).digest(f"{scene_id}.image")


def test_review_pick_writes_the_pin_and_clear_removes_it(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "2")[0] == 0
    paths = ProjectPaths(root)
    second = CandidateStore(paths.candidates).candidates("devonian")[1]
    original = paths.scenes.read_text()

    code, output = _run(backend, root, "review", "pick", "devonian", "2")

    assert code == 0, output
    expected = ScenePin(
        asset_digest=second.record.asset_digest,
        path=second.image_path.relative_to(root).as_posix(),
    )
    assert load_scene_book(paths.scenes).scene("devonian").pin == expected
    changed = [
        (old, new)
        for old, new in zip(
            original.splitlines(), paths.scenes.read_text().splitlines(), strict=True
        )
        if old != new
    ]
    assert changed == [
        (
            "    pin: null",
            f'    pin: {{asset_digest: "{expected.asset_digest}", path: "{expected.path}"}}',
        )
    ]

    assert _run(backend, root, "review", "clear", "devonian")[0] == 0
    assert paths.scenes.read_text() == original


def test_review_refuses_an_out_of_range_candidate(root: Path) -> None:
    code, output = _run(FakeBackend(), root, "review", "pick", "devonian", "1")

    assert code == 1
    assert "devonian has 0 candidate(s); no candidate 1" in output


def test_review_lists_each_scene_between_its_predecessor_and_successor(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0

    code, output = _run(backend, root, "review")

    assert code == 0
    devonian = output.split("\n\n")[1].splitlines()
    assert devonian[:3] == [
        "[2/3] devonian  375 Ma  chapter shore  awaiting-review",
        "  predecessor: hot-start (4.50 Ga, unpinned)",
        "  successor:   city (present, unpinned)",
    ]
    assert len(devonian) == 4


def test_review_sheet_writes_one_sheet_per_scene_and_an_overview(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "2")[0] == 0

    code, _ = _run(backend, root, "review", "sheet")

    assert code == 0
    review_dir = ProjectPaths(root).review
    assert sorted(p.name for p in review_dir.iterdir()) == [
        "01-hot-start.jpg",
        "02-devonian.jpg",
        "03-city.jpg",
        "overview.jpg",
    ]
    with Image.open(review_dir / "02-devonian.jpg") as sheet:
        assert sheet.width == 4 * 640  # previous | two candidates | next


# -- prompts and digests ---------------------------------------------------------------------


def test_the_prompt_digest_changes_only_where_world_state_changes(root: Path) -> None:
    paths = ProjectPaths(root)
    book = load_scene_book(paths.scenes)
    world = load_world(paths.curated)
    doubled = TimeSeries(
        id="co2",
        unit="ppm",
        interpolation=Interpolation.LOG_LINEAR,
        samples=[Sample(t=0.0, value=560.0), Sample(t=5.7e8, value=8000.0)],
    )
    richer = WorldModel(
        series={**world.series, "co2": doubled},
        rasters=world.rasters,
        events=world.events,
        trees=world.trees,
    )
    store = CandidateStore(paths.candidates)

    def digests(model: WorldModel) -> dict[str, tuple[str, str]]:
        graph = build_scene_graph(book, model, FakeBackend())
        resolver = graph.resolver(store)
        return {
            a.scene.id: (resolver.digest(a.prompt.id), resolver.digest(a.image.id))
            for a in graph.assets
        }

    base, changed = digests(world), digests(richer)

    assert digests(load_world(paths.curated)) == base
    assert changed["hot-start"] == base["hot-start"]  # 4.5 Ga lies beyond the CO2 record
    for scene_id in ("devonian", "city"):
        assert changed[scene_id][0] != base[scene_id][0]
        assert changed[scene_id][1] != base[scene_id][1]


def test_conditions_render_world_state_and_name_absent_values_rather_than_invent_them() -> None:
    known = WorldState(
        t=3.1e8,
        atmosphere=AtmosphereState(co2_ppm=351.14),
        sky=SkyState(day_length_hours=22.96, solar_luminosity_rel=0.9736),
    )
    unknown = WorldState(t=4.5e9)

    assert render_conditions(known, UnsourcedConditions(o2_percent=32, mean_temp_c=16)) == (
        "About 310 million years ago. "
        "Atmosphere: CO2 351 ppm, close to today's level; oxygen 32%, far richer than today's 21%. "
        "Global mean temperature about 16 °C, an icehouse world with ice at the poles, though the "
        "tropics stay hot. "
        "The Sun is 2.6% fainter than today; a day lasts 23.0 hours. "
        "Land area: no reconstruction for this time. "
        "No ancestor of humans is on record at this time."
    )
    assert render_conditions(unknown, UnsourcedConditions(o2_percent=None, mean_temp_c=None)) == (
        "About 4.5 billion years ago. "
        "Atmosphere: no CO2 record reaches this far back; no estimate of oxygen. "
        "Global mean temperature: no estimate. "
        "No record of the Sun's brightness at this time; no day-length record reaches this far "
        "back. "
        "Land area: no reconstruction for this time. "
        "No ancestor of humans is on record at this time."
    )


FORBIDDEN_IN_PROMPTS = (
    MODEL_ID,
    "gemini",
    "google",
    "nano banana",
    "imagen",
    "openai",
    "dall-e",
    "gpt",
    "flux",
    "midjourney",
    "stable diffusion",
    "black forest",
)


def test_committed_scene_prompts_name_no_model_or_provider() -> None:
    paths = ProjectPaths(REPO_ROOT)
    book = load_scene_book(paths.scenes)
    graph = build_scene_graph(book, load_world(paths.curated), FakeBackend())

    prompts = [a.image.inputs["prompt"] for a in graph.assets]

    assert len(prompts) == len(book.scenes) >= 12
    for prompt in prompts:
        lowered = prompt.lower()
        assert [term for term in FORBIDDEN_IN_PROMPTS if term.lower() in lowered] == []


def test_committed_scene_book_mostly_holds_compositions_across_neighbours() -> None:
    book = load_scene_book(ProjectPaths(REPO_ROOT).scenes)
    chapters = [s.chapter for s in book.chronological()]
    runs = [c for i, c in enumerate(chapters) if i == 0 or c != chapters[i - 1]]

    assert chapters[0] == "molten-earth"
    assert set(chapters) == {c.id for c in book.chapters}
    # Chapters may recur (ADR-020), but every change of chapter reads as a cut, so most scenes
    # still continue their neighbour's composition.
    assert len(runs) < len(chapters) / 2


# A chapter recurring as two non-adjacent runs (ADR-020): "shore" (city, ..., devonian) is
# interrupted by one "molten" scene, and "molten" itself recurs the same way around it. Scenes
# are ascending in `t` (present first, DESIGN §6/`pipeline/scenes.py`), so this reads as
# city (shore) -> interlude (molten) -> devonian (shore) -> hot-start (molten).
RECURRING_CHAPTER_SCENES_YAML = """\
chapters:
  - id: molten
    label: Molten
    shot: WIDE_RIDGE
    composition: ridge-vista
  - id: shore
    label: Shore
    shot: WATER_EDGE
    composition: water-edge-series

scenes:
  - id: city
    t: 0
    chapter: shore
    shot: WATER_EDGE
    title: A City
    caption: A city.
    unsourced:
      o2_percent: 21
      mean_temp_c: 15
    subject:
      setting: A waterfront
      left_mass: towers
      vegetation: street trees
      fauna: gulls
      main_subject: a ferry
      ground: an embankment
      water: a river
      far_bank: a skyline
      sky_and_light: haze
      absent: [flying cars]
    pin: null

  - id: interlude
    t: 1.0e5
    chapter: molten
    shot: WIDE_RIDGE
    title: Interlude
    caption: A stray molten interlude, for the test only.
    unsourced:
      o2_percent: 0
      mean_temp_c: null
    subject:
      setting: A magma ocean
      left_mass: black crust
      vegetation: none
      fauna: none
      main_subject: a lava fountain
      ground: hot crust
      water: none
      far_bank: none
      sky_and_light: ash
      absent: [water]
    pin: null

  - id: devonian
    t: 3.75e8
    chapter: shore
    shot: WATER_EDGE
    title: Devonian Estuary
    caption: An estuary.
    unsourced:
      o2_percent: 18
      mean_temp_c: 24
    subject:
      setting: A Devonian estuary
      left_mass: Archaeopteris trees
      vegetation: Archaeopteris
      fauna: lobe-finned fishes
      main_subject: a tetrapodomorph
      ground: mud
      water: brackish
      far_bank: bare upland
      sky_and_light: clear
      absent: [flowers, grass]
    pin: null

  - id: hot-start
    t: 4.5e9
    chapter: molten
    shot: WIDE_RIDGE
    title: Hot Start
    caption: A molten world.
    unsourced:
      o2_percent: 0
      mean_temp_c: null
    subject:
      setting: A magma ocean
      left_mass: black crust
      vegetation: none
      fauna: none
      main_subject: a lava fountain
      ground: hot crust
      water: none
      far_bank: none
      sky_and_light: ash
      absent: [water]
    pin: null
"""


def test_scene_book_allows_a_chapter_to_recur_as_non_adjacent_runs() -> None:
    book = parse_scene_book(RECURRING_CHAPTER_SCENES_YAML)

    # `scenes` is ascending in `t` (present first): city (shore) -> interlude (molten) ->
    # devonian (shore) -> hot-start (molten), so "shore" and "molten" each recur as two
    # non-adjacent runs. `chronological()` reverses that to oldest-first.
    assert [s.chapter for s in book.scenes] == ["shore", "molten", "shore", "molten"]
    assert [s.chapter for s in book.chronological()] == ["molten", "shore", "molten", "shore"]


def test_scene_book_still_refuses_a_chapter_with_no_scenes() -> None:
    unused = RECURRING_CHAPTER_SCENES_YAML.replace(
        "  - id: shore\n    label: Shore\n    shot: WATER_EDGE\n    composition: water-edge-series\n",
        "  - id: shore\n    label: Shore\n    shot: WATER_EDGE\n    composition: water-edge-series\n"
        "  - id: unused\n    label: Unused\n    shot: GROUND\n    composition: ridge-vista\n",
    )

    with pytest.raises(ValueError, match="chapters with no scenes: \\['unused'\\]"):
        parse_scene_book(unused)


def test_scene_book_refuses_a_scene_whose_shot_differs_from_its_chapter() -> None:
    # A split-level frame is its own chapter (ADR-025), never a second framing inside another.
    mismatched = RECURRING_CHAPTER_SCENES_YAML.replace(
        "  - id: devonian\n    t: 3.75e8\n    chapter: shore\n    shot: WATER_EDGE\n",
        "  - id: devonian\n    t: 3.75e8\n    chapter: shore\n    shot: SPLIT_LEVEL\n",
    )

    with pytest.raises(ValueError, match="devonian: shot SPLIT_LEVEL differs from chapter shore"):
        parse_scene_book(mismatched)


def test_chapter_spans_emits_one_span_per_run_for_a_recurring_chapter() -> None:
    book = parse_scene_book(RECURRING_CHAPTER_SCENES_YAML)

    spans = chapter_spans(book)

    assert [c.id for c in spans] == ["shore", "molten", "shore", "molten"]
    # Each run gets its own span, nearer-present first, tiling [present, Earth's formation]
    # with no gaps: every run's tEnd is the next run's tStart, and the whole book is covered.
    assert spans[0].t_start == 0.0
    assert spans[-1].t_end == 4.567e9
    for earlier, later in itertools.pairwise(spans):
        assert earlier.t_end == later.t_start
        assert earlier.t_start <= earlier.t_end
    # The two "shore" runs and the two "molten" runs each keep their chapter's own label, even
    # though they are unrelated stretches of the timeline.
    assert spans[0].label == spans[2].label == "Shore"
    assert spans[1].label == spans[3].label == "Molten"


# -- publish ---------------------------------------------------------------------------------


def test_publish_refuses_while_any_scene_is_unpinned(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0
    assert _run(backend, root, "review", "pick", "devonian", "1")[0] == 0

    code, output = _run(backend, root, "publish")

    assert code == 1
    assert "REFUSED: unpinned scenes: hot-start, city" in output
    assert not ProjectPaths(root).media.exists()


def test_publish_allow_unpinned_skips_them_with_a_warning(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0
    assert _run(backend, root, "review", "pick", "devonian", "1")[0] == 0

    code, output = _run(backend, root, "publish", "--allow-unpinned")

    assert code == 0, output
    assert "WARNING: skipping unpinned scenes: hot-start, city" in output
    manifest = Manifest.model_validate_json(
        (ProjectPaths(root).media / "manifest.json").read_text()
    )
    assert [s.id for s in manifest.scenes] == ["devonian"]
    assert [c.id for c in manifest.chapters] == ["shore"]


def test_publish_asset_base_moves_media_to_another_origin(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)

    code, output = _run(backend, root, "publish", "--asset-base", "https://media.example.org")

    assert code == 0, output
    raw = json.loads((ProjectPaths(root).media / "manifest.json").read_text())
    assert raw["assetBase"] == "https://media.example.org"


@pytest.mark.parametrize(
    "value", ["https://media.example.org/", "/media/", "media.example.org", "ftp://example.org"]
)
def test_publish_refuses_an_asset_base_that_would_build_broken_urls(value: str) -> None:
    with pytest.raises(PublishRefused):
        validated_asset_base(value)


def test_publish_emits_a_valid_manifest_and_layer_json_in_the_parser_formats(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    book = load_scene_book(paths.scenes)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    media = paths.media
    raw = json.loads((media / "manifest.json").read_text())
    Manifest.model_validate(raw)
    assert re.fullmatch(r"[0-9a-f]{16}", raw["buildId"])
    boundary = math.expm1((math.log1p(3.75e8) + math.log1p(4.5e9)) / 2)
    assert raw == {
        "schemaVersion": 1,
        "buildId": raw["buildId"],
        "assetBase": "/media",
        "scenes": [
            _published_scene(book, "city", 0.0, "shore", "WATER_EDGE", "A city."),
            _published_scene(book, "devonian", 3.75e8, "shore", "WATER_EDGE", "An estuary."),
            _published_scene(book, "hot-start", 4.5e9, "molten", "WIDE_RIDGE", "A molten world."),
        ],
        "chapters": [
            {"id": "shore", "label": "Shore", "tStart": 0.0, "tEnd": boundary},
            {"id": "molten", "label": "Molten", "tStart": boundary, "tEnd": 4.567e9},
        ],
        "layers": [
            {
                "id": "co2",
                "name": "Atmospheric CO₂",
                "surface": "hud",
                "dataKind": "scalar",
                "timeDomain": [0.0, 5.7e8],
                "source": "co2-o2",
                "chartable": True,
                "unit": "ppm",
                "interpolation": "log-linear",
                "data": "layers/co2.json",
            },
            {
                "id": "day_length",
                "name": "Day length",
                "surface": "hud",
                "dataKind": "scalar",
                "timeDomain": [0.0, 4.567e9],
                "source": "astronomy",
                "chartable": False,
                "unit": "hours",
                "interpolation": "linear",
                "data": "layers/day_length.json",
            },
            {
                "id": "lineage",
                "name": "Your ancestor",
                "surface": "hud",
                "dataKind": "node",
                "timeDomain": [0.0, 4.0e9],
                "source": "lineage",
                "chartable": False,
                "data": "layers/lineage.json",
            },
            {
                "id": "paleodem",
                "name": "Paleogeography",
                "surface": "globe",
                "dataKind": "raster",
                "timeDomain": [0.0, 1e8],
                "source": "paleodem",
                "chartable": False,
                "data": "layers/paleodem.json",
            },
            {
                "id": "globe-regimes",
                "name": "Globe regimes",
                "surface": "globe",
                "dataKind": "events",
                "timeDomain": [4.35e9, 4.52e9],
                "source": "globe-regimes",
                "chartable": False,
                "data": "layers/globe-regimes.json",
            },
        ],
        # docs/GLOBE.md §6: only events-core reaches Manifest.events — globe-regimes is a
        # manifest.layers entry instead (asserted below via _layer_json), never listed here.
        "events": [
            {
                "id": "kpg",
                "label": "K-Pg impact",
                "kind": "moment",
                "tMin": 6.6e7,
                "tMax": 6.61e7,
                "t": 6.605e7,
                "tags": ["catastrophe", "life"],
                "importance": 0.95,
                "description": "Chicxulub.",
                "citation": "Renne et al. 2013",
                "effect": {
                    "kind": "impact-winter",
                    "anchor": {"lat": 21.3, "lon": -89.5},
                    "windows": [{"tMin": 6.6e7, "tMax": 6.61e7}],
                },
            }
        ],
        "audioStems": [],
        "credits": [
            {
                "sourceId": "astronomy",
                "title": "Analytic astronomy",
                "citation": "Laskar 2004",
                "licence": "n/a",
                "url": "https://example.org/astro",
            },
            {
                "sourceId": "co2-o2",
                "title": "GEOCARB III",
                "citation": "Berner 2001",
                "licence": "public domain",
                "url": "https://example.org/co2",
            },
            {
                "sourceId": "globe-regimes",
                "title": "Pre-1 Ga globe regimes",
                "citation": "Barboni et al. 2017",
                "licence": "n/a",
                "url": "https://example.org/globe-regimes",
            },
        ],
    }
    for scene in book.scenes:
        assert scene.pin is not None
        published = (media / "scenes" / f"{scene.id}.webp").read_bytes()
        pinned = (root / scene.pin.path).read_bytes()
        assert published == to_webp(pinned, SCENE_WEBP_QUALITY)
        thumbnail = (media / "scenes" / f"{scene.id}-thumb.webp").read_bytes()
        assert thumbnail == to_thumbnail_webp(pinned, THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY)

    assert _layer_json(media, "co2") == {
        "id": "co2",
        "unit": "ppm",
        "interpolation": "log-linear",
        "samples": [
            {"t": 0.0, "value": 280.0, "lower": None, "upper": None},
            {"t": 5.7e8, "value": 4000.0, "lower": None, "upper": None},
        ],
    }
    assert _layer_json(media, "day_length") == {
        "id": "day_length",
        "unit": "hours",
        "interpolation": "linear",
        "samples": [
            {"t": 0.0, "value": 24.0, "lower": None, "upper": None},
            {"t": 4.567e9, "value": 6.0, "lower": 5.0, "upper": 7.0},
        ],
    }
    assert _layer_json(media, "lineage") == {
        "id": "lineage",
        "nodes": [
            {
                "id": "human",
                "parent": "luca",
                "label": "Homo sapiens",
                "tDivergence": 3.0e5,
                "representative": "Homo sapiens",
                "note": None,
                "citation": None,
            },
            {
                "id": "luca",
                "parent": None,
                "label": "LUCA",
                "tDivergence": 4.0e9,
                "representative": None,
                "note": None,
                "citation": "Moody 2024",
            },
        ],
    }
    assert _layer_json(media, "paleodem") == {
        "id": "paleodem",
        "frames": [
            {"t": 0.0, "ref": "textures/paleodem/0.png"},
            {"t": 1e8, "ref": "textures/paleodem/100.png"},
        ],
    }
    assert _layer_json(media, "globe-regimes") == {
        "id": "globe-regimes",
        "events": [
            {
                "id": "magma-ocean-regime",
                "label": "Magma ocean and newborn Moon",
                "kind": "period",
                "tMin": 4.35e9,
                "tMax": 4.52e9,
                "tags": ["earth-climate"],
                "importance": 0.9,
                "description": "A cooling crust, a close Moon.",
                "citation": "Barboni et al. 2017",
                "effect": {
                    "kind": "regime-magma-ocean",
                    "anchor": None,
                    "windows": [{"tMin": 4.35e9, "tMax": 4.52e9}],
                },
            }
        ],
    }
    for layer_id in ("co2", "day_length", "lineage", "paleodem"):
        assert _key_paths(_layer_json(media, layer_id)) == _key_paths(
            json.loads((STUB_DIR / "layers" / f"{layer_id}.json").read_text())
        )


def test_prune_stale_media_removes_only_files_not_in_keep(tmp_path: Path) -> None:
    directory = tmp_path / "scenes"
    directory.mkdir()
    (directory / "city.webp").write_bytes(b"new")
    (directory / "city.jpg").write_bytes(b"old format")
    (directory / "removed-scene.jpg").write_bytes(b"no longer pinned")
    (directory / "morphs").mkdir()  # a subdirectory must never be touched, only files
    (directory / "morphs" / "untouched.png").write_bytes(b"x")

    removed = _prune_stale_media(directory, frozenset({"city.webp"}))

    assert removed == ("city.jpg", "removed-scene.jpg")
    assert sorted(p.name for p in directory.iterdir()) == ["city.webp", "morphs"]
    assert (directory / "morphs" / "untouched.png").is_file()


def test_prune_stale_media_is_a_no_op_on_a_missing_directory(tmp_path: Path) -> None:
    assert _prune_stale_media(tmp_path / "does-not-exist", frozenset()) == ()


def test_publish_removes_a_scenes_stale_file_from_a_previous_format_or_a_dropped_scene(
    root: Path,
) -> None:
    """`write_publication` is otherwise purely additive; without `_prune_stale_media` a scene
    whose published extension changes (this WebP transcode) or that is no longer pinned at all
    would leave its old file in data/media/scenes/ forever, silently growing it on every publish."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert _run(backend, root, "publish")[0] == 0
    stale = paths.media / "scenes" / "no-longer-a-scene.jpg"
    stale.write_bytes(b"orphaned from a previous publish")

    assert _run(backend, root, "publish")[0] == 0

    assert not stale.exists()
    assert sorted(p.name for p in (paths.media / "scenes").iterdir()) == [
        "city-thumb.webp",
        "city.webp",
        "devonian-thumb.webp",
        "devonian.webp",
        "hot-start-thumb.webp",
        "hot-start.webp",
    ]


def test_publish_always_transcodes_scenes_from_the_pin_not_from_its_own_output(root: Path) -> None:
    """A publish must never read back its own previously published WebP and re-encode it: that
    would silently compound generation loss a little further on every single run, with nothing
    erroring (pipeline.transcode's module docstring). Proven directly, not just by determinism:
    corrupt a previously published scene file, republish, and confirm the new output is exactly
    the pin transcoded fresh -- untouched by the corruption that sat where the output goes."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert _run(backend, root, "publish")[0] == 0
    pin = load_scene_book(paths.scenes).scene("city").pin
    assert pin is not None
    published_path = paths.media / "scenes" / "city.webp"
    published_path.write_bytes(b"not a real image -- simulates a corrupted/stale previous output")

    assert _run(backend, root, "publish")[0] == 0

    assert published_path.read_bytes() == to_webp(
        (root / pin.path).read_bytes(), SCENE_WEBP_QUALITY
    )


def test_publish_always_transcodes_thumbnails_from_the_pin_not_from_its_own_output(
    root: Path,
) -> None:
    """The thumbnail's own version of the guard above: it must always be derived from the pin's
    own bytes, never from a previously published thumbnail (which would be a lossy encode of a
    lossy encode) nor from the full-resolution published WebP (a second, independent lossy
    generation on top of that). Corrupt a previously published thumbnail, republish, and confirm
    the new output is exactly the pin's own bytes transcoded fresh."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert _run(backend, root, "publish")[0] == 0
    pin = load_scene_book(paths.scenes).scene("city").pin
    assert pin is not None
    published_path = paths.media / "scenes" / "city-thumb.webp"
    published_path.write_bytes(b"not a real image -- simulates a corrupted/stale previous output")

    assert _run(backend, root, "publish")[0] == 0

    assert published_path.read_bytes() == to_thumbnail_webp(
        (root / pin.path).read_bytes(), THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY
    )


def _published_scene(
    book: SceneBook, scene_id: str, t: float, chapter: str, shot: str, caption: str
) -> dict[str, object]:
    pin = book.scene(scene_id).pin
    assert pin is not None
    return {
        "id": scene_id,
        "t": t,
        "chapterId": chapter,
        "image": f"scenes/{scene_id}.webp",
        "thumbnail": f"scenes/{scene_id}-thumb.webp",
        "shot": shot,
        "title": book.scene(scene_id).title,
        "caption": caption,
        "events": list(book.scene(scene_id).events),
        "pinned": pin.asset_digest,
        "width": 16,
        "height": 9,
    }


def _layer_json(media: Path, layer_id: str) -> dict[str, object]:
    loaded: dict[str, object] = json.loads((media / "layers" / f"{layer_id}.json").read_text())
    return loaded


def _key_paths(value: object, prefix: str = "") -> set[str]:
    """Every key path in a JSON value, list items collapsed, so two files' shapes compare."""
    if isinstance(value, dict):
        paths = set()
        for key, item in value.items():
            paths |= {f"{prefix}.{key}"} | _key_paths(item, f"{prefix}.{key}")
        return paths
    if isinstance(value, list):
        return set().union(*(_key_paths(item, f"{prefix}[]") for item in value))
    return set()


# -- scene titles (2026-09, ADR-028) -----------------------------------------------------------


def test_scene_title_is_required() -> None:
    data = parse_scene_book(SCENES_YAML).scene("city").model_dump()
    del data["title"]

    with pytest.raises(ValidationError, match="title"):
        SceneRecord.model_validate(data)


def test_scene_title_must_not_be_blank_or_whitespace_only() -> None:
    data = parse_scene_book(SCENES_YAML).scene("city").model_dump()

    with pytest.raises(ValidationError, match="title must not be blank"):
        SceneRecord.model_validate({**data, "title": "   "})


def test_scene_title_is_stripped_of_surrounding_whitespace() -> None:
    data = parse_scene_book(SCENES_YAML).scene("city").model_dump()

    record = SceneRecord.model_validate({**data, "title": "  A City  "})

    assert record.title == "A City"


def test_scene_title_has_a_max_length() -> None:
    data = parse_scene_book(SCENES_YAML).scene("city").model_dump()

    with pytest.raises(ValidationError, match="title"):
        SceneRecord.model_validate({**data, "title": "x" * 41})


def test_scene_book_refuses_duplicate_titles() -> None:
    duplicated = SCENES_YAML.replace("title: Devonian Estuary", "title: A City")

    with pytest.raises(ValueError, match="duplicate scene title: A City"):
        parse_scene_book(duplicated)


def test_scene_title_never_changes_the_prompt_or_image_node_digest(root: Path) -> None:
    """Like `events` (ADR-022) and `sound` (ADR-023), `title` is invisible to the asset graph
    (pipeline/assets.py never reads SceneRecord.title): retitling a scene must never change its
    prompt or image node's digest, or a rebuild would treat it as stale and clear its pin."""
    paths = ProjectPaths(root)
    world = load_world(paths.curated)
    store = CandidateStore(paths.candidates)

    def digests(book: SceneBook) -> dict[str, tuple[str, str]]:
        graph = build_scene_graph(book, world, FakeBackend())
        resolver = graph.resolver(store)
        return {
            a.scene.id: (resolver.digest(a.prompt.id), resolver.digest(a.image.id))
            for a in graph.assets
        }

    base = digests(load_scene_book(paths.scenes))

    retitled_text = paths.scenes.read_text().replace(
        "title: Devonian Estuary", "title: A Wholly Different Heading"
    )
    paths.scenes.write_text(retitled_text)
    retitled_book = load_scene_book(paths.scenes)
    assert retitled_book.scene("devonian").title == "A Wholly Different Heading"

    assert digests(retitled_book) == base


def test_publish_emits_each_scenes_title(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    book = load_scene_book(paths.scenes)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    raw = json.loads((paths.media / "manifest.json").read_text())
    titles_by_id = {s["id"]: s["title"] for s in raw["scenes"]}
    assert titles_by_id == {scene.id: scene.title for scene in book.scenes}


# -- scene -> event links (ADR-022) -----------------------------------------------------------


def _link_city_to(text: str, event_id: str) -> str:
    linked, count = re.subn(
        r"caption: A city\.\n", f"caption: A city.\n    events: [{event_id}]\n", text, count=1
    )
    assert count == 1, "city scene's caption line not found"
    return linked


def test_scene_event_links_survive_pinning_and_appear_in_the_manifest(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)

    paths.scenes.write_text(_link_city_to(paths.scenes.read_text(), "kpg"))

    # A scene's event links play no part in the asset graph (pipeline/assets.py never reads
    # SceneRecord.events), so every scene -- city included -- is still pinned, not stale.
    _, plan_output = _run(backend, root, "plan")
    assert "3 scenes: 3 pinned, 0 awaiting review, 0 stale" in plan_output

    code, output = _run(backend, root, "publish")
    assert code == 0, output
    raw = json.loads((paths.media / "manifest.json").read_text())
    scenes_by_id = {s["id"]: s for s in raw["scenes"]}
    assert scenes_by_id["city"]["events"] == ["kpg"]
    assert scenes_by_id["devonian"]["events"] == []
    assert scenes_by_id["hot-start"]["events"] == []


def test_publish_refuses_a_scene_linked_to_an_unknown_event_id(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)

    paths.scenes.write_text(_link_city_to(paths.scenes.read_text(), "not-a-real-event"))

    code, output = _run(backend, root, "publish")
    assert code != 0
    assert "city" in output and "not-a-real-event" in output


def test_publish_refuses_a_scene_linked_to_an_unknown_event_id_before_writing_media(
    root: Path,
) -> None:
    """A refused publish must leave data/media/ exactly as it was (module docstring)."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert _run(backend, root, "publish")[0] == 0
    before = (paths.media / "manifest.json").read_bytes()

    paths.scenes.write_text(_link_city_to(paths.scenes.read_text(), "not-a-real-event"))

    assert _run(backend, root, "publish")[0] != 0
    assert (paths.media / "manifest.json").read_bytes() == before


def test_scene_sound_gain_must_be_in_unit_interval() -> None:
    SceneSound(stem="wind", mode=SoundMode.LOOP, gain=1.0)  # boundary is inclusive, does not raise
    with pytest.raises(ValidationError, match="gain"):
        SceneSound(stem="wind", mode=SoundMode.LOOP, gain=0.0)
    with pytest.raises(ValidationError, match="gain"):
        SceneSound(stem="wind", mode=SoundMode.LOOP, gain=1.1)


def test_scene_sound_mode_is_a_closed_enum() -> None:
    with pytest.raises(ValidationError, match="mode"):
        SceneSound.model_validate({"stem": "wind", "mode": "fade", "gain": 0.5})


def test_scene_sound_stem_must_be_a_slug() -> None:
    with pytest.raises(ValidationError, match="stem"):
        SceneSound(stem="Not A Slug!", mode=SoundMode.LOOP, gain=0.5)


# -- scene location (ADR-034) -----------------------------------------------------------------


def test_scene_location_lat_lon_must_be_in_range() -> None:
    SceneLocation(lat=90.0, lon=180.0, label="A Place")  # boundaries are inclusive
    SceneLocation(lat=-90.0, lon=-180.0, label="A Place")
    with pytest.raises(ValidationError, match="lat"):
        SceneLocation(lat=90.1, lon=0.0, label="A Place")
    with pytest.raises(ValidationError, match="lon"):
        SceneLocation(lat=0.0, lon=180.1, label="A Place")


def test_scene_location_label_must_not_be_blank() -> None:
    with pytest.raises(ValidationError, match="label must not be blank"):
        SceneLocation(lat=0.0, lon=0.0, label="   ")


def test_scene_location_label_is_stripped_of_surrounding_whitespace() -> None:
    location = SceneLocation(lat=0.0, lon=0.0, label="  A Place  ")
    assert location.label == "A Place"


class FakeReconstructor:
    """A `Reconstructor` (pipeline.paleogeography) test double: never touches pygplates, so
    these tests stay offline and geo-extra-independent."""

    def __init__(self, result: tuple[float, float] | None) -> None:
        self.result = result
        self.calls: list[tuple[float, float, float]] = []

    def reconstruct(self, lat: float, lon: float, t: float) -> tuple[float, float] | None:
        self.calls.append((lat, lon, t))
        return self.result


def test_scene_location_is_none_when_the_scene_has_none() -> None:
    assert _scene_location(0.0, None, reconstructor=None) is None


def test_scene_location_marks_present_day_inside_the_human_era_basemap_domain() -> None:
    """ADR-030/ADR-034: at or inside `HUMAN_ERA_BASEMAP_DOMAIN_END`, no reconstruction is
    needed -- the marker is the curated present-day coordinates unchanged, and no reconstructor
    call is ever made."""
    location = SceneLocation(lat=29.9792, lon=31.1342, label="Giza, Egypt")
    reconstructor = FakeReconstructor(result=(999.0, 999.0))  # would prove a real call happened

    entry = _scene_location(HUMAN_ERA_BASEMAP_DOMAIN_END, location, reconstructor)

    assert entry == WireSceneLocation(
        label="Giza, Egypt",
        present_day={"lat": 29.9792, "lon": 31.1342},
        marker={"lat": 29.9792, "lon": 31.1342},
    )
    assert reconstructor.calls == []


def test_scene_location_reconstructs_an_older_scene(root: Path) -> None:
    """Older than the human-era basemap domain: the marker is whatever the plate model
    reconstructs, published alongside the unchanged present-day coordinates for audit."""
    location = SceneLocation(lat=57.33, lon=-3.22, label="Rhynie, Scotland")
    reconstructor = FakeReconstructor(result=(-21.6, -41.4))

    entry = _scene_location(4.07e8, location, reconstructor)

    assert entry == WireSceneLocation(
        label="Rhynie, Scotland",
        present_day={"lat": 57.33, "lon": -3.22},
        marker={"lat": -21.6, "lon": -41.4},
    )
    assert reconstructor.calls == [(57.33, -3.22, 4.07e8)]


def test_scene_location_publishes_no_marker_when_the_model_has_no_coverage() -> None:
    """CLAUDE.md "if something is unusable, stop and report": a model gap (e.g. no Merdith
    continental polygon under the Isthmus of Panama) publishes `marker: null`, never a
    present-day coordinate standing in for an unknown paleo position."""
    location = SceneLocation(lat=9.08, lon=-79.68, label="Isthmus of Panama")
    reconstructor = FakeReconstructor(result=None)

    entry = _scene_location(2.8e6, location, reconstructor)

    assert entry == WireSceneLocation(
        label="Isthmus of Panama", present_day={"lat": 9.08, "lon": -79.68}, marker=None
    )


def _add_location(text: str, caption_line: str, location_yaml: str) -> str:
    linked, count = re.subn(
        re.escape(caption_line) + r"\n",
        f"{caption_line}\n    location: {location_yaml}\n",
        text,
        count=1,
    )
    assert count == 1, f"{caption_line!r} not found"
    return linked


def test_scene_location_plays_no_part_in_the_asset_graph(root: Path) -> None:
    """A scene's location is invisible to the asset graph (pipeline/assets.py never reads it),
    the same guarantee ADR-022's `events` and ADR-023's `sound` have -- adding one must not make
    a pinned scene stale."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)

    located = _add_location(
        paths.scenes.read_text(),
        "caption: A city.",
        '{lat: 29.9792, lon: 31.1342, label: "Giza, Egypt"}',
    )
    paths.scenes.write_text(located)
    assert load_scene_book(paths.scenes).scene("city").location == SceneLocation(
        lat=29.9792, lon=31.1342, label="Giza, Egypt"
    )

    _, plan_output = _run(backend, root, "plan")
    assert "3 scenes: 3 pinned, 0 awaiting review, 0 stale" in plan_output


def test_publish_omits_location_for_a_scene_with_none(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    raw = json.loads((ProjectPaths(root).media / "manifest.json").read_text())
    scenes_by_id = {s["id"]: s for s in raw["scenes"]}
    assert "location" not in scenes_by_id["city"]


def test_publish_marks_present_day_for_a_human_era_scene_location(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    paths.scenes.write_text(
        _add_location(
            paths.scenes.read_text(),
            "caption: A city.",
            '{lat: 29.9792, lon: 31.1342, label: "Giza, Egypt"}',
        )
    )

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    raw = json.loads((paths.media / "manifest.json").read_text())
    scenes_by_id = {s["id"]: s for s in raw["scenes"]}
    assert scenes_by_id["city"]["location"] == {
        "label": "Giza, Egypt",
        "presentDay": {"lat": 29.9792, "lon": 31.1342},
        "marker": {"lat": 29.9792, "lon": 31.1342},
    }


def test_publish_refuses_an_older_scene_location_when_the_plate_model_is_unavailable(
    root: Path,
) -> None:
    """`devonian` (t = 3.75e8) is older than the human-era basemap domain, so publish needs the
    Merdith plate model (`pipeline.paleogeography`) to reconstruct it -- unavailable here since
    the test project has no `data/raw/plates-neoproterozoic` (CLAUDE.md "if something is
    unusable, stop and report": refuse, don't guess a present-day position)."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    paths.scenes.write_text(
        _add_location(
            paths.scenes.read_text(),
            "caption: An estuary.",
            '{lat: 57.33, lon: -3.22, label: "Rhynie, Scotland"}',
        )
    )

    code, output = _run(backend, root, "publish")

    assert code != 0
    assert "scene location reconstruction unavailable" in output
    assert not (paths.media / "manifest.json").exists()


# -- scene -> stem links (ADR-023) -------------------------------------------------------------


def _link_city_to_stem(text: str, stem_id: str, mode: str = "loop", gain: float = 0.5) -> str:
    linked, count = re.subn(
        r"caption: A city\.\n",
        f"caption: A city.\n    sound: {{stem: {stem_id}, mode: {mode}, gain: {gain}}}\n",
        text,
        count=1,
    )
    assert count == 1, "city scene's caption line not found"
    return linked


# A minimal byte string `pipeline.audio.sniff_audio` reads as MP3 (its own ID3-header check) --
# `_write_stem_catalogue`'s synthetic published file, standing in for a real audio-stems clip.
# WAV would sniff just as easily, but every publishable stem's `format` must now be
# WebKit-decodable (`pipeline.audio.WEBKIT_DECODABLE_FORMATS`, 2026-09-15 audio re-review item
# 7), and these tests exercise the scene->stem linking/publish-refusal machinery, not format
# choice, so their synthetic fixture should be a format publish actually accepts.
_FAKE_MP3_BYTES = b"ID3" + b"\x00" * 20


def _write_stem_catalogue(
    paths: ProjectPaths,
    stem_id: str = "wind",
    publish_file: bool = True,
    loop_safe: bool = True,
    format: str = "mp3",
) -> None:
    source_dir = paths.sources / "audio-stems"
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "stems.toml").write_text(
        f'[[stems]]\nid = "{stem_id}"\ntitle = "Ridge Wind"\nauthor = "Test Author"\n'
        f'url = "https://example.invalid/{stem_id}"\nlicence = "CC0 1.0"\n'
        f'sha256 = "{"0" * 64}"\nraw_filename = "{stem_id}.{format}"\nformat = "{format}"\n'
        f"duration_seconds = 30.0\nloop_safe = {str(loop_safe).lower()}\n"
        f"loudness_db = -30.0\npeak_dbfs = -6.0\n"
    )
    if publish_file:
        audio_dir = paths.media / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        (audio_dir / content_hashed_filename(stem_id, "mp3", _FAKE_MP3_BYTES)).write_bytes(
            _FAKE_MP3_BYTES
        )


def test_scene_stem_links_and_the_stem_catalogue_appear_in_the_manifest(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths)

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "wind"))

    code, output = _run(backend, root, "publish")
    assert code == 0, output
    raw = json.loads((paths.media / "manifest.json").read_text())
    scenes_by_id = {s["id"]: s for s in raw["scenes"]}
    assert scenes_by_id["city"]["sound"] == {"stem": "wind", "mode": "loop", "gain": 0.5}
    assert "sound" not in scenes_by_id["devonian"]
    assert raw["audioStems"] == [
        {
            "id": "wind",
            "file": f"audio/{content_hashed_filename('wind', 'mp3', _FAKE_MP3_BYTES)}",
            "title": "Ridge Wind",
            "author": "Test Author",
            "licence": "CC0 1.0",
            "sourceUrl": "https://example.invalid/wind",
            "durationSeconds": 30.0,
            "loopSafe": True,
            "levelTrimDb": 0.0,
        }
    ]


def test_publish_omits_audio_stems_when_no_catalogue_exists(root: Path) -> None:
    """No sources/audio-stems/stems.toml at all -- an ordinary project before any stem has
    been sourced -- publishes cleanly with an empty stem list, not an error."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    raw = json.loads((ProjectPaths(root).media / "manifest.json").read_text())
    assert raw["audioStems"] == []


def test_publish_refuses_a_scene_linked_to_an_unknown_stem_id(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "not-a-real-stem"))

    code, output = _run(backend, root, "publish")
    assert code != 0
    assert "city" in output and "not-a-real-stem" in output


def test_publish_refuses_a_loop_mode_scene_sound_naming_a_one_shot_stem(root: Path) -> None:
    """A one-shot gets no looping player in the web engine, so a loop would play nothing."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, stem_id="impact", loop_safe=False)

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "impact", mode="loop"))

    code, output = _run(backend, root, "publish")
    assert code != 0
    assert "city" in output and "impact" in output and "one-shot" in output


def test_publish_accepts_a_once_mode_scene_sound_naming_a_one_shot_stem(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, stem_id="impact", loop_safe=False)

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "impact", mode="once"))

    code, output = _run(backend, root, "publish")
    assert code == 0, output


def test_publish_refuses_a_stem_whose_format_is_not_webkit_decodable(root: Path) -> None:
    """OGG never decodes on Safari/iOS; WAV never ships as a real stem (2026-09-15 audio
    re-review item 7) -- either must be caught at publish time, before a future source ships
    silently and fails to decode for real users the way this exact gap once did."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, format="ogg", publish_file=False)

    code, output = _run(backend, root, "publish")

    assert code != 0
    assert "wind" in output and "ogg" in output


def test_publish_refuses_a_catalogued_stem_whose_published_file_is_missing(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, publish_file=False)

    code, output = _run(backend, root, "publish")
    assert code != 0
    assert "wind" in output


def test_publish_refuses_a_catalogued_stem_with_more_than_one_published_file(root: Path) -> None:
    """A stale file from a previous, since-changed source (content-hashed filenames, ADR-023
    amendment "on-demand loading") must be caught, not silently published alongside the
    current one or picked arbitrarily."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths)
    audio_dir = paths.media / "audio"
    (audio_dir / "wind-0000000000.mp3").write_bytes(b"ID3 stale")

    code, output = _run(backend, root, "publish")
    assert code != 0
    assert "wind" in output


def test_publish_refuses_a_scene_linked_to_an_unknown_stem_id_before_writing_media(
    root: Path,
) -> None:
    """A refused publish must leave data/media/ exactly as it was (module docstring)."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert _run(backend, root, "publish")[0] == 0
    before = (paths.media / "manifest.json").read_bytes()

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "not-a-real-stem"))

    assert _run(backend, root, "publish")[0] != 0
    assert (paths.media / "manifest.json").read_bytes() == before


def test_scene_sound_plays_no_part_in_the_asset_graph(root: Path) -> None:
    """A scene's sound is invisible to the asset graph (pipeline/assets.py never reads it),
    the same guarantee ADR-022 gives `scene.events` -- adding one must not make a pinned scene
    stale."""
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths)

    paths.scenes.write_text(_link_city_to_stem(paths.scenes.read_text(), "wind"))

    _, plan_output = _run(backend, root, "plan")
    assert "3 scenes: 3 pinned, 0 awaiting review, 0 stale" in plan_output


def test_publish_refuses_a_pinned_image_that_no_longer_matches_its_digest(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    pin = load_scene_book(ProjectPaths(root).scenes).scene("city").pin
    assert pin is not None
    (root / pin.path).write_bytes(_png(999))

    code, output = _run(backend, root, "publish")

    assert code == 1
    assert f"city: {pin.path} no longer matches pinned digest {pin.asset_digest}" in output
    assert not ProjectPaths(root).media.exists()


# -- the web contract ------------------------------------------------------------------------


def test_the_committed_stub_manifest_validates() -> None:
    manifest = Manifest.model_validate_json((STUB_DIR / "manifest.json").read_text())

    assert [s.id for s in manifest.scenes] == [
        "holocene-city",
        "carboniferous-swamp",
        "archean-shore",
    ]


@pytest.mark.parametrize(
    ("layer_id", "model"),
    [
        ("co2", SeriesData),
        ("day_length", SeriesData),
        ("lineage", TreeData),
        ("paleodem", RasterData),
    ],
)
def test_the_committed_stub_layer_data_validates(
    layer_id: str, model: type[SeriesData | TreeData | RasterData]
) -> None:
    model.model_validate_json((STUB_DIR / "layers" / f"{layer_id}.json").read_text())


def test_layer_publishing_carries_a_series_gap_into_the_wire_data() -> None:
    """ADR-027: `_layers` (pipeline/publish.py) mirrors `TimeSeries.gaps` onto `SeriesData`,
    unlike every other `WorldModel` field, which only surfaces sampled values."""
    gappy_co2 = TimeSeries(
        id="co2",
        unit="ppm",
        interpolation=Interpolation.LOG_LINEAR,
        samples=[
            Sample(t=0.0, value=420.0),
            Sample(t=805_743.87, value=222.0),
            Sample(t=1.0e7, value=277.0),
        ],
        gaps=[Gap(from_index=1, to_index=2)],
    )
    files, _entries = _layers(WorldModel(series={"co2": gappy_co2}), portraits=None)
    co2_file = next(f for f in files if f.data.id == "co2")
    assert isinstance(co2_file.data, SeriesData)
    assert [(g.from_index, g.to_index) for g in co2_file.data.gaps] == [(1, 2)]


# ------------------------------------------------------------------- ADR-032 arrival effect


def test_effect_publishes_a_point_effect_as_the_wire_globe_effect() -> None:
    """Contrast case for `test_effect_publishes_an_arrival_effect_as_the_wire_arrival_effect`
    below: an ordinary point effect (one of the eight `POINT_EFFECT_KINDS`) still round-trips
    through `_effect` as `pipeline.manifest.GlobeEffect`, not `ArrivalEffect`."""
    point = GlobeEffect(
        kind=GlobeEffectKind.IMPACT_WINTER,
        anchor=EffectAnchor(lat=21.3, lon=-89.5),
        windows=[EffectWindow(t_min=6.6e7, t_max=6.61e7)],
    )
    wire = _effect(point)
    assert isinstance(wire, WireGlobeEffect)
    assert wire.kind == GlobeEffectKind.IMPACT_WINTER
    assert wire.anchor is not None
    assert (wire.anchor.lat, wire.anchor.lon) == (21.3, -89.5)


def test_effect_publishes_an_arrival_effect_as_the_wire_arrival_effect() -> None:
    """ADR-032: `_effect` (pipeline/publish.py) dispatches `kind='arrival'` to the wire
    `ArrivalEffect` (origin/destination/established), not the ordinary `GlobeEffect` shape --
    the two-branch `isinstance` check this test pins."""
    arrival = ArrivalEffect(
        kind=GlobeEffectKind.ARRIVAL,
        arrival_kind=ArrivalKind.MIGRATION,
        origin=EffectAnchor(lat=8.0, lon=38.0),
        destination=EffectAnchor(lat=-33.9, lon=151.2),
        established=5.0e4,
        windows=[EffectWindow(t_min=0.0, t_max=6.5e4)],
    )
    wire = _effect(arrival)
    assert isinstance(wire, WireArrivalEffect)
    assert wire.kind == GlobeEffectKind.ARRIVAL
    assert wire.arrival_kind == ArrivalKind.MIGRATION
    assert (wire.origin.lat, wire.origin.lon) == (8.0, 38.0)
    assert (wire.destination.lat, wire.destination.lon) == (-33.9, 151.2)
    assert wire.established == 5.0e4
    assert [(w.t_min, w.t_max) for w in wire.windows] == [(0.0, 6.5e4)]


def test_arrival_effect_requires_exactly_one_window_at_t_min_zero() -> None:
    """The curated-side validator (pipeline/shapes.py): a second window also claiming t_min=0
    is rejected, not silently accepted as "at least one" would allow."""
    with pytest.raises(ValidationError, match="exactly one window"):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            origin=EffectAnchor(lat=8.0, lon=38.0),
            destination=EffectAnchor(lat=-33.9, lon=151.2),
            established=5.0e4,
            windows=[
                EffectWindow(t_min=0.0, t_max=6.5e4),
                EffectWindow(t_min=0.0, t_max=1.0e5),
            ],
        )


def test_arrival_effect_rejects_no_window_reaching_the_present() -> None:
    with pytest.raises(ValidationError, match="exactly one window"):
        ArrivalEffect(
            kind=GlobeEffectKind.ARRIVAL,
            arrival_kind=ArrivalKind.PEOPLING,
            origin=EffectAnchor(lat=8.0, lon=38.0),
            destination=EffectAnchor(lat=-33.9, lon=151.2),
            established=5.0e4,
            windows=[EffectWindow(t_min=1.0e3, t_max=6.5e4)],
        )


# --------------------------------------------------------------- RASTER_LAYERS (ADR-030/031)


def test_raster_layers_includes_the_human_era_globe_sources() -> None:
    """ADR-030 (basemap) and ADR-031 (hyde population density): both sources' curated ids are
    registered in `RASTER_LAYERS` alongside the pre-existing `paleodem`/`plates_neoproterozoic`
    entries, each matched to its own `sources/<name>/` credit directory. `hyde_cleared_land`
    stays curated (sources/hyde/normalise.py still produces it) but is no longer registered
    here -- the ADR-031 amendment unpublished it -- see `test_raster_layers_no_longer_publishes_
    cleared_land` below."""
    by_id = {spec.curated_id: spec for spec in RASTER_LAYERS}
    assert by_id["basemap_t0"].source == "basemap"
    assert by_id["basemap_t1"].source == "basemap"
    assert by_id["hyde_population_density"].source == "hyde"
    for curated_id in ("basemap_t0", "basemap_t1", "hyde_population_density"):
        assert by_id[curated_id].surface == LayerSurface.GLOBE
        assert by_id[curated_id].chartable is False


def test_raster_layers_no_longer_publishes_cleared_land() -> None:
    """ADR-031 amendment: the human found the cleared-land overlay not discernible on the
    globe. It stays curated (sources/hyde/normalise.py and its tests are untouched) but is no
    longer registered in `RASTER_LAYERS`, so `_layers` never publishes it even when
    `WorldModel.rasters` holds it (a fresh `make data` build still produces the parquet)."""
    assert "hyde_cleared_land" not in {spec.curated_id for spec in RASTER_LAYERS}
    hyde = RasterSequence(
        id="hyde_cleared_land",
        frames=[
            RasterFrame(t=10.0, ref="textures/hyde_cleared_land/2015AD.webp"),
            RasterFrame(t=12025.0, ref="textures/hyde_cleared_land/10000BC.webp"),
        ],
    )
    world = WorldModel(rasters={"hyde_cleared_land": hyde})
    files, entries = _layers(world, portraits=None)
    assert "hyde_cleared_land" not in {e.id for e in entries}
    assert "hyde_cleared_land" not in {f.data.id for f in files}


def test_layers_publishes_basemap_and_hyde_population_density_raster_entries() -> None:
    """`_layers` (pipeline/publish.py) treats these two sources exactly like any other
    `RasterSequence` in `WorldModel.rasters` -- no special-casing needed, the same generic
    path `paleodem`/`plates_neoproterozoic` already go through -- except that the population
    density layer also carries its `RasterEncoding` decode metadata (ADR-031 amendment)."""
    basemap_t0 = RasterSequence(
        id="basemap_t0",
        frames=[
            RasterFrame(t=0.0, ref="textures/basemap/basemap_t0.webp"),
            RasterFrame(t=2.58e6, ref="textures/basemap/basemap_t0.webp"),
        ],
    )
    population = RasterSequence(
        id="hyde_population_density",
        frames=[
            RasterFrame(t=10.0, ref="textures/hyde_population_density/2015AD.webp"),
            RasterFrame(t=12025.0, ref="textures/hyde_population_density/10000BC.webp"),
        ],
    )
    world = WorldModel(rasters={"basemap_t0": basemap_t0, "hyde_population_density": population})
    files, entries = _layers(world, portraits=None)

    entries_by_id = {e.id: e for e in entries}
    assert entries_by_id["basemap_t0"].data_kind == LayerDataKind.RASTER
    assert entries_by_id["basemap_t0"].time_domain == (0.0, 2.58e6)
    assert entries_by_id["hyde_population_density"].data_kind == LayerDataKind.RASTER
    assert entries_by_id["hyde_population_density"].time_domain == (10.0, 12025.0)

    files_by_id = {f.data.id: f for f in files}
    assert isinstance(files_by_id["basemap_t0"].data, RasterData)
    assert files_by_id["basemap_t0"].published == "layers/basemap_t0.json"
    assert files_by_id["basemap_t0"].data.encoding is None
    population_data = files_by_id["hyde_population_density"].data
    assert isinstance(population_data, RasterData)
    assert files_by_id["hyde_population_density"].published == "layers/hyde_population_density.json"
    assert population_data.encoding is not None
    assert population_data.encoding.channel == "r"
    assert population_data.encoding.unit == "people_per_km2"
    assert population_data.encoding.d_max == pytest.approx(POPULATION_DENSITY_D_MAX)


# ------------------------------------------------ SCALAR_LAYERS (ADR-031 amendment "global
# population total")


def test_scalar_layers_includes_global_population_total() -> None:
    by_id = {spec.curated_id: spec for spec in SCALAR_LAYERS}
    assert by_id["population"].source == "hyde"
    assert by_id["population"].surface == LayerSurface.HUD
    # Unlike day_length, this is chartable -- it is the readout column's own number, not just an
    # input the audio score reads, so it earns a sparkline/chart the way co2's own does.
    assert by_id["population"].chartable is True


def test_layers_publishes_population_scalar_entry() -> None:
    """`_layers` treats the "population" TimeSeries exactly like any other scalar layer in
    `WorldModel.series` -- no special-casing needed, the same generic path `co2`/`day_length`
    already go through."""
    population = TimeSeries(
        id="population",
        unit="people",
        interpolation=Interpolation.LOG_LINEAR,
        samples=[
            Sample(t=10.0, value=7_256_964_920.0, lower=None, upper=None),
            Sample(t=12025.0, value=4_432_265.0, lower=None, upper=None),
        ],
    )
    world = WorldModel(series={"population": population})
    files, entries = _layers(world, portraits=None)

    entries_by_id = {e.id: e for e in entries}
    assert entries_by_id["population"].data_kind == LayerDataKind.SCALAR
    assert entries_by_id["population"].time_domain == (10.0, 12025.0)
    assert entries_by_id["population"].unit == "people"
    assert entries_by_id["population"].interpolation == Interpolation.LOG_LINEAR

    files_by_id = {f.data.id: f for f in files}
    population_data = files_by_id["population"].data
    assert isinstance(population_data, SeriesData)
    assert files_by_id["population"].published == "layers/population.json"
    assert population_data.samples[0].value == pytest.approx(7_256_964_920.0)


# ------------------------------------------------------------------- FEATURE_LAYERS (ADR-034)


def test_feature_layers_registers_cities() -> None:
    by_id = {spec.curated_id: spec for spec in FEATURE_LAYERS}
    assert by_id["cities"].source == "cities"
    assert by_id["cities"].surface == LayerSurface.GLOBE
    assert by_id["cities"].chartable is False


def test_layers_publishes_cities_feature_entry() -> None:
    """`_layers` treats a `FeatureSet` exactly like any other curated shape in `WorldModel` --
    no special-casing beyond reading `world.features` instead of `world.rasters`/`world.events`."""
    cities = FeatureSet(
        id="cities",
        features=[
            Feature(
                id="uruk",
                name="Uruk",
                country="Iraq",
                lat=31.32,
                lon=45.64,
                certainty=FeatureCertainty.HIGH,
                estimates=[
                    PopulationEstimate(t=6700.0, population=14_000),
                    PopulationEstimate(t=5700.0, population=40_000),
                ],
            ),
        ],
    )
    world = WorldModel(features={"cities": cities})
    files, entries = _layers(world, portraits=None)

    entries_by_id = {e.id: e for e in entries}
    assert entries_by_id["cities"].data_kind == LayerDataKind.FEATURES
    assert entries_by_id["cities"].time_domain == (5700.0, 6700.0)

    files_by_id = {f.data.id: f for f in files}
    cities_data = files_by_id["cities"].data
    assert isinstance(cities_data, FeatureSetData)
    assert files_by_id["cities"].published == "layers/cities.json"
    assert len(cities_data.features) == 1
    assert cities_data.features[0].id == "uruk"
    assert [e.population for e in cities_data.features[0].estimates] == [40_000, 14_000]


# --------------------------------------------------------- city significance roster (ADR-038)


def _city(feature_id: str) -> Feature:
    return Feature(
        id=feature_id,
        name=feature_id,
        country="Testland",
        lat=0.0,
        lon=0.0,
        certainty=FeatureCertainty.HIGH,
        estimates=[PopulationEstimate(t=0.0, population=1_000)],
    )


def test_apply_city_roster_keeps_only_the_named_cities() -> None:
    feature_set = FeatureSet(
        id="cities", features=[_city("uruk-iraq"), _city("babylon-iraq"), _city("rome-italy")]
    )
    roster = CityRoster(
        cities=(
            CityRosterEntry(id="uruk-iraq", reason="first city"),
            CityRosterEntry(id="rome-italy", reason="imperial capital"),
        )
    )
    result = apply_city_roster(feature_set, roster)
    assert result.id == "cities"
    assert {f.id for f in result.features} == {"uruk-iraq", "rome-italy"}


def test_apply_city_roster_raises_naming_every_missing_entry() -> None:
    feature_set = FeatureSet(id="cities", features=[_city("uruk-iraq")])
    roster = CityRoster(
        cities=(
            CityRosterEntry(id="uruk-iraq", reason="first city"),
            CityRosterEntry(id="atlantis-nowhere", reason="does not exist in the dataset"),
            CityRosterEntry(id="el-dorado-nowhere", reason="also does not exist"),
        )
    )
    with pytest.raises(CityRosterError) as excinfo:
        apply_city_roster(feature_set, roster)
    assert "atlantis-nowhere" in str(excinfo.value)
    assert "el-dorado-nowhere" in str(excinfo.value)


def test_load_city_roster_parses_a_real_file(tmp_path: Path) -> None:
    path = tmp_path / "roster.toml"
    path.write_text(
        '[[cities]]\nid = "uruk-iraq"\nreason = "first city"\n\n'
        '[[cities]]\nid = "rome-italy"\nreason = "imperial capital"\n'
    )
    roster = load_city_roster(path)
    assert [entry.id for entry in roster.cities] == ["uruk-iraq", "rome-italy"]
    assert roster.cities[0].reason == "first city"


def test_load_city_roster_rejects_a_duplicate_id(tmp_path: Path) -> None:
    path = tmp_path / "roster.toml"
    path.write_text(
        '[[cities]]\nid = "uruk-iraq"\nreason = "first city"\n\n'
        '[[cities]]\nid = "uruk-iraq"\nreason = "duplicate entry"\n'
    )
    with pytest.raises(CityRosterError, match="uruk-iraq"):
        load_city_roster(path)


def test_layers_applies_the_city_roster_when_one_is_given() -> None:
    cities = FeatureSet(id="cities", features=[_city("uruk-iraq"), _city("babylon-iraq")])
    world = WorldModel(features={"cities": cities})
    roster = CityRoster(cities=(CityRosterEntry(id="uruk-iraq", reason="first city"),))
    files, _entries = _layers(world, portraits=None, city_roster=roster)
    files_by_id = {f.data.id: f for f in files}
    cities_data = files_by_id["cities"].data
    assert isinstance(cities_data, FeatureSetData)
    assert [f.id for f in cities_data.features] == ["uruk-iraq"]


def test_layers_leaves_cities_unfiltered_when_no_roster_is_given() -> None:
    """`city_roster` defaults to `None` for tests that don't care about cities at all -- when
    omitted, `_layers` publishes every curated feature, matching every other layer kind's
    default "no special-casing" behaviour."""
    cities = FeatureSet(id="cities", features=[_city("uruk-iraq"), _city("babylon-iraq")])
    world = WorldModel(features={"cities": cities})
    files, _entries = _layers(world, portraits=None)
    files_by_id = {f.data.id: f for f in files}
    cities_data = files_by_id["cities"].data
    assert isinstance(cities_data, FeatureSetData)
    assert {f.id for f in cities_data.features} == {"uruk-iraq", "babylon-iraq"}
