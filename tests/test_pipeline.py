"""`earthlapse` end to end against a temporary project. Offline: a fake image generator only."""

from __future__ import annotations

import itertools
import json
import math
import re
from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline.assets import build_scene_graph
from pipeline.audio import content_hashed_filename
from pipeline.curated import load_world, write_shape
from pipeline.density_encoding import POPULATION_DENSITY_D_MAX
from pipeline.generators.image import ImageRequest, PartKind, asset_digest
from pipeline.manifest import ArrivalEffect as WireArrivalEffect
from pipeline.manifest import (
    FeatureSetData,
    LayerDataKind,
    Manifest,
    RasterData,
    SeriesData,
    TerritoryData,
    TerritoryLineageData,
    TreeData,
)
from pipeline.manifest import SceneLocation as WireSceneLocation
from pipeline.models import WorldModel
from pipeline.paths import ProjectPaths
from pipeline.publish import (
    CityRoster,
    CityRosterEntry,
    CityRosterError,
    EmpireInputs,
    PublishRefused,
    _effect,
    _layers,
    _scene_location,
    apply_city_roster,
    chapter_spans,
)
from pipeline.scenes import (
    MAX_PORTRAIT_ZOOM,
    SceneBook,
    SceneFraming,
    SceneLocation,
    ScenePin,
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
from tests.support import (
    CO2,
    DAY_LENGTH,
    ESTIMATE_USD,
    EVENTS,
    FAKE_GENERATOR,
    FAKE_VERSION,
    PALEODEM,
    REPO_ROOT,
    SCENES_YAML,
    SOLAR_LUMINOSITY,
    SOURCE_MANIFESTS,
    FakeBackend,
    build_and_pick_all,
    fake_png,
    run_cli,
)

STUB_DIR = REPO_ROOT / "web" / "public" / "stub"


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


# -- plan ------------------------------------------------------------------------------------


def test_plan_prints_an_estimate_and_spends_nothing(root: Path) -> None:
    ledger_path = ProjectPaths(root).ledger
    Ledger(entries=[Entry(node_id="x", generator="g", n=1, estimated_usd=1.53)]).save(ledger_path)
    before = ledger_path.read_bytes()
    backend = FakeBackend()

    code, output = run_cli(backend, root, "plan")

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

    code, output = run_cli(backend, root, "build", "--only", "images")

    assert code == 2
    assert "Missing option '--max-spend'" in output
    assert backend.opened == 0
    assert not ProjectPaths(root).ledger.exists()


def test_build_refuses_when_the_estimate_exceeds_the_remaining_budget(root: Path) -> None:
    backend = FakeBackend()

    code, output = run_cli(backend, root, "build", "--max-spend", "0.5")

    assert code == 1
    assert "REFUSED: estimate $0.90 exceeds the $0.50 remaining" in output
    assert (backend.opened, backend.rendered) == (0, [])


def test_each_build_rewrites_the_stored_ceiling_with_its_own_max_spend(root: Path) -> None:
    backend = FakeBackend()
    ledger_path = ProjectPaths(root).ledger
    assert run_cli(backend, root, "build", "--max-spend", "10", "--scene", "city")[0] == 0
    assert json.loads(ledger_path.read_text())["ceiling_usd"] == 10.0

    code, output = run_cli(backend, root, "build", "--max-spend", "0.7", "--scene", "devonian")

    assert code == 0, output
    ledger = json.loads(ledger_path.read_text())
    assert ledger["ceiling_usd"] == 0.7
    assert len(ledger["entries"]) == 6


def test_build_writes_candidates_with_sidecars_then_awaits_review(root: Path) -> None:
    backend = FakeBackend()

    code, output = run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "2")

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

    _, plan_output = run_cli(backend, root, "plan")
    assert "3 scenes: 0 pinned, 3 awaiting review, 0 stale" in plan_output


def test_build_stops_cleanly_on_budget_exceeded_and_exits_non_zero(root: Path) -> None:
    # Each call costs five times its estimate, so the pre-build check passes and the ledger
    # has to stop the third call itself.
    backend = FakeBackend(actual_usd=0.5)

    code, output = run_cli(backend, root, "build", "--max-spend", "1.0", "--candidates", "1")

    assert code == 1
    assert backend.rendered == ["city.image", "devonian.image"]
    assert "STOPPED at hot-start: BudgetExceeded" in output
    assert "built: 2 candidates across 2 scenes" in output
    ledger = Ledger.load(ProjectPaths(root).ledger)
    assert ledger.spent == pytest.approx(1.0)
    assert len(ledger.entries) == 2


def test_a_failing_image_is_retried_once_then_its_scene_is_skipped(root: Path) -> None:
    backend = FakeBackend(failing=frozenset({"devonian.image"}))

    code, output = run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "1")

    assert code == 1
    assert backend.rendered == ["city.image", "devonian.image", "devonian.image", "hot-start.image"]
    assert "skipped devonian: failed 2 times: devonian.image: no image" in output
    store = CandidateStore(ProjectPaths(root).candidates)
    assert [len(store.candidates(s)) for s in ("city", "devonian", "hot-start")] == [1, 0, 1]


# -- pins ------------------------------------------------------------------------------------


def test_a_pinned_scene_survives_a_prompt_change_and_is_not_regenerated(root: Path) -> None:
    backend = FakeBackend()
    assert run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0
    assert run_cli(backend, root, "review", "pick", "devonian", "1")[0] == 0
    paths = ProjectPaths(root)
    pin = load_scene_book(paths.scenes).scene("devonian").pin
    digest_before = _image_digest(root, backend, "devonian")

    paths.scenes.write_text(
        paths.scenes.read_text()
        .replace("fauna: lobe-finned fishes", "fauna: eurypterids")
        .replace("fauna: gulls", "fauna: cormorants")
    )
    backend.rendered.clear()
    code, output = run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "1")

    assert code == 0, output
    assert _image_digest(root, backend, "devonian") != digest_before
    assert backend.rendered == ["city.image"]
    assert load_scene_book(paths.scenes).scene("devonian").pin == pin


def _image_digest(root: Path, backend: FakeBackend, scene_id: str) -> str:
    paths = ProjectPaths(root)
    graph = build_scene_graph(load_scene_book(paths.scenes), load_world(paths.curated), backend)
    return graph.resolver(CandidateStore(paths.candidates)).digest(f"{scene_id}.image")


def test_review_pick_copies_the_image_into_pins_and_clear_removes_both(root: Path) -> None:
    backend = FakeBackend()
    assert run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "2")[0] == 0
    paths = ProjectPaths(root)
    second = CandidateStore(paths.candidates).candidates("devonian")[1]
    original = paths.scenes.read_text()

    code, output = run_cli(backend, root, "review", "pick", "devonian", "2")

    assert code == 0, output
    digest = second.record.asset_digest
    expected = ScenePin(
        asset_digest=digest, path=f"data/pins/scenes/devonian/{digest}{second.image_path.suffix}"
    )
    assert load_scene_book(paths.scenes).scene("devonian").pin == expected
    assert (root / expected.path).read_bytes() == second.image_path.read_bytes()
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

    assert run_cli(backend, root, "review", "clear", "devonian")[0] == 0
    assert paths.scenes.read_text() == original
    assert not (paths.pins / "devonian").exists()
    assert second.image_path.is_file()


CURATION_ONLY_EDITS = {
    "title": ("title: A City", "title: A Wholly Different Heading"),
    "events": ("caption: A city.\n", "caption: A city.\n    events: [kpg]\n"),
    "location": (
        "caption: A city.\n",
        'caption: A city.\n    location: {lat: 29.9792, lon: 31.1342, label: "Giza, Egypt"}\n',
    ),
    "framing": (
        "caption: A city.\n",
        "caption: A city.\n    framing: {focus: [0.2, 0.7], pan: 180, portrait_zoom: 1.3}\n",
    ),
    "sound": (
        "caption: A city.\n",
        "caption: A city.\n    sound: {stem: wind, mode: loop, gain: 0.5}\n",
    ),
}


@pytest.mark.parametrize("field", CURATION_ONLY_EDITS)
def test_a_curation_only_field_never_makes_a_pinned_scene_stale(root: Path, field: str) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    old, new = CURATION_ONLY_EDITS[field]
    assert old in paths.scenes.read_text()

    paths.scenes.write_text(paths.scenes.read_text().replace(old, new, 1))

    _, plan_output = run_cli(backend, root, "plan")
    assert "3 scenes: 3 pinned, 0 awaiting review, 0 stale" in plan_output


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


def test_image_nodes_render_from_their_own_prompt_text_only(root: Path) -> None:
    paths = ProjectPaths(root)
    build_and_pick_all(FakeBackend(), root)
    graph = build_scene_graph(
        load_scene_book(paths.scenes), load_world(paths.curated), FakeBackend()
    )

    for assets in graph.assets:
        assert assets.pin is not None
        assert assets.image.inputs.keys() == {"prompt"}
        assert assets.image.depends_on == [assets.prompt.id]
        assert ImageRequest.from_node(assets.image).part_kinds == (PartKind.TEXT,)


def _with_interlude(scenes_yaml: str) -> str:
    """SCENES_YAML plus a molten scene between city and devonian, so both chapters recur as two
    non-adjacent runs: city (shore), interlude (molten), devonian (shore), hot-start (molten)."""
    hot_start = scenes_yaml.split("scenes:\n", 1)[1].split("\n\n  - id: devonian", 1)[0]
    interlude = (
        hot_start.replace("id: hot-start", "id: interlude")
        .replace("t: 4.5e9", "t: 1.0e5")
        .replace("title: Hot Start", "title: Interlude")
    )
    return f"{scenes_yaml}\n{interlude}\n"


def test_a_recurring_chapter_gets_one_span_per_run_tiling_the_whole_timeline() -> None:
    book = parse_scene_book(_with_interlude(SCENES_YAML))

    spans = chapter_spans(book)

    assert [s.chapter for s in book.scenes] == ["shore", "molten", "shore", "molten"]
    assert [(c.id, c.label) for c in spans] == [
        ("shore", "Shore"),
        ("molten", "Molten"),
        ("shore", "Shore"),
        ("molten", "Molten"),
    ]
    assert (spans[0].t_start, spans[-1].t_end) == (0.0, 4.567e9)
    for earlier, later in itertools.pairwise(spans):
        assert earlier.t_end == later.t_start


def test_scene_book_refuses_a_scene_whose_shot_differs_from_its_chapter() -> None:
    mismatched = SCENES_YAML.replace(
        "chapter: shore\n    shot: WATER_EDGE\n    title: Devonian",
        "chapter: shore\n    shot: SPLIT_LEVEL\n    title: Devonian",
    )
    assert mismatched != SCENES_YAML

    with pytest.raises(ValueError, match="devonian: shot SPLIT_LEVEL differs from chapter shore"):
        parse_scene_book(mismatched)


# -- publish ---------------------------------------------------------------------------------


def test_publish_refuses_while_any_scene_is_unpinned(root: Path) -> None:
    backend = FakeBackend()
    assert run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "1")[0] == 0
    assert run_cli(backend, root, "review", "pick", "devonian", "1")[0] == 0

    code, output = run_cli(backend, root, "publish")

    assert code == 1
    assert "REFUSED: unpinned scenes: hot-start, city" in output
    assert not ProjectPaths(root).media.exists()


def test_publish_emits_a_valid_manifest_and_layer_json_in_the_parser_formats(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    book = load_scene_book(paths.scenes)

    code, output = run_cli(backend, root, "publish")

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
            _published_scene(root, book, "city", 0.0, "shore", "WATER_EDGE", "A city."),
            _published_scene(root, book, "devonian", 3.75e8, "shore", "WATER_EDGE", "An estuary."),
            _published_scene(
                root, book, "hot-start", 4.5e9, "molten", "WIDE_RIDGE", "A molten world."
            ),
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
        image, thumbnail = _scene_files(root, book, scene.id)
        pinned = (root / scene.pin.path).read_bytes()
        assert (media / "scenes" / image).read_bytes() == to_webp(pinned, SCENE_WEBP_QUALITY)
        assert (media / "scenes" / thumbnail).read_bytes() == to_thumbnail_webp(
            pinned, THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY
        )

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


def test_republishing_prunes_stale_scene_files_and_transcodes_from_the_pin(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert run_cli(backend, root, "publish")[0] == 0
    scenes_dir = paths.media / "scenes"
    (scenes_dir / "no-longer-a-scene.jpg").write_bytes(b"orphaned from a previous publish")
    book = load_scene_book(paths.scenes)
    city_image, city_thumbnail = _scene_files(root, book, "city")
    (scenes_dir / city_image).write_bytes(b"corrupted previous output")
    (scenes_dir / city_thumbnail).write_bytes(b"corrupted previous output")

    assert run_cli(backend, root, "publish")[0] == 0

    assert sorted(p.name for p in scenes_dir.iterdir()) == sorted(
        name
        for scene in ("city", "devonian", "hot-start")
        for name in _scene_files(root, book, scene)
    )
    pin = book.scene("city").pin
    assert pin is not None
    pinned = (root / pin.path).read_bytes()
    assert (scenes_dir / city_image).read_bytes() == to_webp(pinned, SCENE_WEBP_QUALITY)
    assert (scenes_dir / city_thumbnail).read_bytes() == to_thumbnail_webp(
        pinned, THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY
    )


def test_publish_refuses_a_pinned_image_that_no_longer_matches_its_digest(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    pin = load_scene_book(ProjectPaths(root).scenes).scene("city").pin
    assert pin is not None
    (root / pin.path).write_bytes(fake_png(999))

    code, output = run_cli(backend, root, "publish")

    assert code == 1
    assert f"city: {pin.path} no longer matches pinned digest {pin.asset_digest}" in output
    assert not ProjectPaths(root).media.exists()


def _scene_files(root: Path, book: SceneBook, scene_id: str) -> tuple[str, str]:
    """The published image and thumbnail names: content-hashed from the pin's transcodes."""
    pin = book.scene(scene_id).pin
    assert pin is not None
    pinned = (root / pin.path).read_bytes()
    image = to_webp(pinned, SCENE_WEBP_QUALITY)
    thumbnail = to_thumbnail_webp(pinned, THUMBNAIL_SIZE, THUMBNAIL_WEBP_QUALITY)
    return (
        content_hashed_filename(scene_id, "webp", image),
        content_hashed_filename(f"{scene_id}-thumb", "webp", thumbnail),
    )


def _published_scene(
    root: Path,
    book: SceneBook,
    scene_id: str,
    t: float,
    chapter: str,
    shot: str,
    caption: str,
) -> dict[str, object]:
    pin = book.scene(scene_id).pin
    assert pin is not None
    image, thumbnail = _scene_files(root, book, scene_id)
    return {
        "id": scene_id,
        "t": t,
        "chapterId": chapter,
        "image": f"scenes/{image}",
        "thumbnail": f"scenes/{thumbnail}",
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


def _after_caption(text: str, caption: str, line: str) -> str:
    assert f"caption: {caption}\n" in text
    return text.replace(f"caption: {caption}\n", f"caption: {caption}\n    {line}\n", 1)


@pytest.mark.parametrize(
    "line", ["events: [not-a-real-event]", "sound: {stem: not-a-real-stem, mode: loop, gain: 0.5}"]
)
def test_a_refused_publish_leaves_published_media_untouched(root: Path, line: str) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    assert run_cli(backend, root, "publish")[0] == 0
    before = (paths.media / "manifest.json").read_bytes()

    paths.scenes.write_text(_after_caption(paths.scenes.read_text(), "A city.", line))

    code, output = run_cli(backend, root, "publish")
    assert code != 0
    assert "city" in output and "not-a-real" in output
    assert (paths.media / "manifest.json").read_bytes() == before


# -- scene location --------------------------------------------------------------------------


class FakeReconstructor:
    """A `Reconstructor` that never touches pygplates."""

    def __init__(self, result: tuple[float, float] | None) -> None:
        self.result = result
        self.calls: list[tuple[float, float, float]] = []

    def reconstruct(self, lat: float, lon: float, t: float) -> tuple[float, float] | None:
        self.calls.append((lat, lon, t))
        return self.result


def test_scene_location_publishes_the_reconstructed_marker_beside_present_day() -> None:
    location = SceneLocation(lat=57.33, lon=-3.22, label="Rhynie, Scotland")
    reconstructor = FakeReconstructor(result=(-21.6, -41.4))

    entry = _scene_location(4.07e8, location, reconstructor)

    assert entry == WireSceneLocation(
        label="Rhynie, Scotland",
        present_day={"lat": 57.33, "lon": -3.22},
        marker={"lat": -21.6, "lon": -41.4},
    )
    assert reconstructor.calls == [(57.33, -3.22, 4.07e8)]


def test_scene_location_publishes_no_marker_where_the_plate_model_has_no_coverage() -> None:
    location = SceneLocation(lat=9.08, lon=-79.68, label="Isthmus of Panama")

    entry = _scene_location(2.8e6, location, FakeReconstructor(result=None))

    assert entry == WireSceneLocation(
        label="Isthmus of Panama", present_day={"lat": 9.08, "lon": -79.68}, marker=None
    )


def test_publish_refuses_an_older_scene_location_without_the_plate_model(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    paths.scenes.write_text(
        _after_caption(
            paths.scenes.read_text(),
            "An estuary.",
            'location: {lat: 57.33, lon: -3.22, label: "Rhynie, Scotland"}',
        )
    )

    code, output = run_cli(backend, root, "publish")

    assert code != 0
    assert "scene location reconstruction unavailable" in output
    assert not (paths.media / "manifest.json").exists()


# -- scene framing ---------------------------------------------------------------------------


def test_scene_framing_normalises_pan_and_bounds_focus_and_portrait_zoom() -> None:
    assert SceneFraming(focus=(0.0, 1.0), pan=-90.0).pan == 270.0
    assert SceneFraming.model_validate({"focus": [0.5, 0.5], "pan": 0}).portrait_zoom == 1.0
    for bad in (
        {"focus": (1.01, 0.5), "pan": 0.0},
        {"focus": (0.5, 0.5), "pan": math.inf},
        {"focus": (0.5, 0.5), "pan": 0.0, "portrait_zoom": 0.99},
        {"focus": (0.5, 0.5), "pan": 0.0, "portrait_zoom": MAX_PORTRAIT_ZOOM + 0.01},
    ):
        with pytest.raises(ValidationError):
            SceneFraming.model_validate(bad)


def test_publish_emits_framing_with_portrait_zoom_only_when_it_zooms(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    text = _after_caption(
        paths.scenes.read_text(),
        "A city.",
        "framing: {focus: [0.2, 0.7], pan: 0, portrait_zoom: 1.4}",
    )
    text = _after_caption(
        text, "An estuary.", "framing: {focus: [0.5, 0.5], pan: 90, portrait_zoom: 1}"
    )
    paths.scenes.write_text(text)

    code, output = run_cli(backend, root, "publish")

    assert code == 0, output
    scenes = {s["id"]: s for s in json.loads((paths.media / "manifest.json").read_text())["scenes"]}
    assert scenes["city"]["framing"] == {"focus": [0.2, 0.7], "pan": 0.0, "portraitZoom": 1.4}
    assert scenes["devonian"]["framing"] == {"focus": [0.5, 0.5], "pan": 90.0}
    assert "framing" not in scenes["hot-start"]


# -- scene sound -----------------------------------------------------------------------------

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
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths)
    paths.scenes.write_text(
        _after_caption(
            paths.scenes.read_text(), "A city.", "sound: {stem: wind, mode: loop, gain: 0.5}"
        )
    )

    code, output = run_cli(backend, root, "publish")

    assert code == 0, output
    raw = json.loads((paths.media / "manifest.json").read_text())
    scenes = {s["id"]: s for s in raw["scenes"]}
    assert scenes["city"]["sound"] == {"stem": "wind", "mode": "loop", "gain": 0.5}
    assert "sound" not in scenes["devonian"]
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


@pytest.mark.parametrize(
    ("catalogue", "sound", "expected"),
    [
        ({"stem_id": "impact", "loop_safe": False}, "impact", "one-shot"),
        ({"format": "ogg", "publish_file": False}, None, "ogg"),
        ({"publish_file": False}, None, "wind"),
    ],
    ids=["loop-on-a-one-shot", "not-webkit-decodable", "published-file-missing"],
)
def test_publish_refuses_an_unplayable_stem(
    root: Path, catalogue: dict[str, object], sound: str | None, expected: str
) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    _write_stem_catalogue(paths, **catalogue)  # type: ignore[arg-type]
    if sound is not None:
        paths.scenes.write_text(
            _after_caption(
                paths.scenes.read_text(),
                "A city.",
                f"sound: {{stem: {sound}, mode: loop, gain: 1}}",
            )
        )

    code, output = run_cli(backend, root, "publish")

    assert code != 0
    assert expected in output


# -- layers and the web contract -------------------------------------------------------------


@pytest.mark.content
def test_the_committed_stub_manifest_and_layers_validate() -> None:
    manifest = Manifest.model_validate_json((STUB_DIR / "manifest.json").read_text())
    assert manifest.scenes
    for layer_id, model in (
        ("co2", SeriesData),
        ("day_length", SeriesData),
        ("lineage", TreeData),
        ("paleodem", RasterData),
    ):
        model.model_validate_json((STUB_DIR / "layers" / f"{layer_id}.json").read_text())


def test_layer_publishing_carries_a_series_gap_into_the_wire_data() -> None:
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

    files, _ = _layers(WorldModel(series={"co2": gappy_co2}), portraits=None)

    (co2_file,) = (f for f in files if f.data.id == "co2")
    assert isinstance(co2_file.data, SeriesData)
    assert [(g.from_index, g.to_index) for g in co2_file.data.gaps] == [(1, 2)]


def test_an_arrival_effect_publishes_as_the_wire_arrival_effect() -> None:
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
    assert (wire.origin.lat, wire.destination.lon, wire.established) == (8.0, 151.2, 5.0e4)


def test_the_population_density_raster_publishes_its_decode_metadata() -> None:
    population = RasterSequence(
        id="hyde_population_density",
        frames=[
            RasterFrame(t=10.0, ref="textures/hyde_population_density/2015AD.webp"),
            RasterFrame(t=12025.0, ref="textures/hyde_population_density/10000BC.webp"),
        ],
    )

    files, entries = _layers(
        WorldModel(rasters={"hyde_population_density": population}), portraits=None
    )

    (entry,) = (e for e in entries if e.id == "hyde_population_density")
    assert (entry.data_kind, entry.time_domain) == (LayerDataKind.RASTER, (10.0, 12025.0))
    (published,) = (f for f in files if f.data.id == "hyde_population_density")
    assert isinstance(published.data, RasterData) and published.data.encoding is not None
    assert (published.data.encoding.channel, published.data.encoding.unit) == (
        "r",
        "people_per_km2",
    )
    assert published.data.encoding.d_max == pytest.approx(POPULATION_DENSITY_D_MAX)


def _city(feature_id: str) -> Feature:
    return Feature(
        id=feature_id,
        name=feature_id,
        country="Testland",
        lat=0.0,
        lon=0.0,
        certainty=FeatureCertainty.HIGH,
        estimates=[
            PopulationEstimate(t=6700.0, population=14_000),
            PopulationEstimate(t=5700.0, population=40_000),
        ],
    )


def test_cities_publish_as_a_feature_layer_filtered_by_the_roster() -> None:
    cities = FeatureSet(id="cities", features=[_city("uruk-iraq"), _city("babylon-iraq")])
    roster = CityRoster(cities=(CityRosterEntry(id="uruk-iraq", reason="first city"),))

    files, entries = _layers(
        WorldModel(features={"cities": cities}), portraits=None, city_roster=roster
    )

    (entry,) = (e for e in entries if e.id == "cities")
    assert (entry.data_kind, entry.time_domain) == (LayerDataKind.FEATURES, (5700.0, 6700.0))
    (published,) = (f for f in files if f.data.id == "cities")
    assert isinstance(published.data, FeatureSetData)
    assert [f.id for f in published.data.features] == ["uruk-iraq"]
    assert [e.population for e in published.data.features[0].estimates] == [40_000, 14_000]


def test_a_roster_naming_absent_cities_is_refused_naming_each_one() -> None:
    feature_set = FeatureSet(id="cities", features=[_city("uruk-iraq")])
    roster = CityRoster(
        cities=(
            CityRosterEntry(id="uruk-iraq", reason="first city"),
            CityRosterEntry(id="atlantis-nowhere", reason="absent"),
            CityRosterEntry(id="el-dorado-nowhere", reason="absent"),
        )
    )

    with pytest.raises(CityRosterError, match="atlantis-nowhere.*el-dorado-nowhere"):
        apply_city_roster(feature_set, roster)


def _polity(feature_id: str, name: str, from_year: int, to_year: int) -> Feature:
    return Feature(
        id=feature_id,
        name=name,
        country="",
        lat=41.9,
        lon=12.5,
        certainty=FeatureCertainty.HIGH,
        estimates=[PopulationEstimate(t=2025.0 - from_year, area_km2=1e6, t_end=2024.0 - to_year)],
    )


def test_empires_publish_as_a_territories_layer_with_roster_lineages_and_labels() -> None:
    polities = FeatureSet(
        id="cliopatria_polities",
        features=[
            _polity("roman-empire-117ce", "Roman Empire", 117, 131),
            _polity("byzantine-empire-1400ce", "Byzantine Empire", 1400, 1453),
        ],
    )
    empires = EmpireInputs(
        lineages=(TerritoryLineageData(id="rome", name="Rome", colour_slot=3),),
        polities={
            "Roman Empire": ("rome", "Roman Empire"),
            "Byzantine Empire": ("rome", "Byzantium"),
        },
        geometry="vectors/cliopatria_territories-0123456789.json",
        geometry_ids=frozenset({"roman-empire-117ce", "byzantine-empire-1400ce"}),
    )
    world = WorldModel(features={"cliopatria_polities": polities})

    files, entries = _layers(world, portraits=None, empires=empires)

    (entry,) = (e for e in entries if e.id == "empires")
    assert (entry.data_kind, entry.time_domain) == (LayerDataKind.TERRITORIES, (571.0, 1908.0))
    assert (entry.data, entry.source) == ("layers/empires.json", "cliopatria")
    (published,) = (f for f in files if f.published == "layers/empires.json")
    assert isinstance(published.data, TerritoryData)
    wire = published.data.model_dump(mode="json", by_alias=True)
    assert wire["geometry"] == "vectors/cliopatria_territories-0123456789.json"
    assert wire["snapshots"][0] == {
        "id": "roman-empire-117ce",
        "lineage": "rome",
        "label": "Roman Empire",
        "tStart": 1908.0,
        "tEnd": 1893.0,
        "lat": 41.9,
        "lon": 12.5,
        "areaKm2": 1e6,
    }
    assert wire["snapshots"][1]["label"] == "Byzantium"

    unrostered = replace(empires, polities={"Roman Empire": ("rome", "Roman Empire")})
    with pytest.raises(PublishRefused, match="Byzantine Empire"):
        _layers(world, portraits=None, empires=unrostered)
    ungeometried = replace(empires, geometry_ids=frozenset({"roman-empire-117ce"}))
    with pytest.raises(PublishRefused, match="byzantine-empire-1400ce"):
        _layers(world, portraits=None, empires=ungeometried)
