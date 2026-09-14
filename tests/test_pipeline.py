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
from pipeline.cli import create_app
from pipeline.curated import load_world, write_shape
from pipeline.generators.gemini import MODEL_ID
from pipeline.generators.image import (
    GeneratedImage,
    GenerationFailed,
    ImageGenerator,
    asset_digest,
    sniff_image,
)
from pipeline.graph import AssetNode
from pipeline.manifest import Manifest, RasterData, SeriesData, TreeData
from pipeline.models import AtmosphereState, SkyState, WorldModel, WorldState
from pipeline.paths import ProjectPaths
from pipeline.prompts import UnsourcedConditions, render_conditions
from pipeline.publish import chapter_spans
from pipeline.scenes import (
    SceneBook,
    ScenePin,
    SceneSound,
    SoundMode,
    load_scene_book,
    parse_scene_book,
)
from pipeline.shapes import (
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventSet,
    EventTag,
    GlobeEffect,
    GlobeEffectKind,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
    Tree,
    TreeNode,
)
from pipeline.spend import Entry, Ledger
from pipeline.store import CandidateRecord, CandidateStore

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
        published = (media / "scenes" / f"{scene.id}.png").read_bytes()
        assert published == (root / scene.pin.path).read_bytes()

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


def _published_scene(
    book: SceneBook, scene_id: str, t: float, chapter: str, shot: str, caption: str
) -> dict[str, object]:
    pin = book.scene(scene_id).pin
    assert pin is not None
    return {
        "id": scene_id,
        "t": t,
        "chapterId": chapter,
        "image": f"scenes/{scene_id}.png",
        "shot": shot,
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


def _write_stem_catalogue(
    paths: ProjectPaths, stem_id: str = "wind", publish_file: bool = True
) -> None:
    source_dir = paths.sources / "audio-stems"
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "stems.toml").write_text(
        f'[[stems]]\nid = "{stem_id}"\ntitle = "Ridge Wind"\nauthor = "Test Author"\n'
        f'url = "https://example.invalid/{stem_id}"\nlicence = "CC0 1.0"\n'
        f'sha256 = "{"0" * 64}"\nraw_filename = "{stem_id}.wav"\nformat = "wav"\n'
        f"duration_seconds = 30.0\nloop_safe = true\n"
    )
    if publish_file:
        audio_dir = paths.media / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        (audio_dir / f"{stem_id}.wav").write_bytes(b"RIFF....WAVEfmt ")


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
            "file": "audio/wind.wav",
            "title": "Ridge Wind",
            "author": "Test Author",
            "licence": "CC0 1.0",
            "sourceUrl": "https://example.invalid/wind",
            "durationSeconds": 30.0,
            "loopSafe": True,
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


def test_publish_refuses_a_catalogued_stem_whose_published_file_is_missing(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, publish_file=False)

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
