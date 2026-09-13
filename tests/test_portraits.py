"""Ancestor portraits end to end against a temporary project (ADR-015). Offline: fake generator only."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import numpy as np
import pytest
from pydantic import ValidationError

from pipeline.curated import load_world, write_shape
from pipeline.flowfield import encode_flow
from pipeline.generators.gemini import MODEL_ID, PRICES, estimate_usd
from pipeline.generators.image import ImageRequest
from pipeline.paths import ProjectPaths
from pipeline.portraits import (
    BACKWARD_FLOW_NAME,
    FORWARD_FLOW_NAME,
    MORPH_ALGORITHM_VERSION,
    MORPH_RECORD_NAME,
    MorphKey,
    MorphRecord,
    build_portrait_graph,
    load_portrait_book,
    parse_portrait_book,
)
from pipeline.prompts import PORTRAIT_STYLE
from pipeline.shapes import Tree, TreeNode
from pipeline.spend import Ledger
from pipeline.store import CandidateStore
from tests.test_generators import _generator, _image_body, _png
from tests.test_pipeline import (
    CO2,
    DAY_LENGTH,
    ESTIMATE_USD,
    EVENTS,
    FORBIDDEN_IN_PROMPTS,
    PALEODEM,
    REPO_ROOT,
    SCENES_YAML,
    SOLAR_LUMINOSITY,
    SOURCE_MANIFESTS,
    FakeBackend,
    _build_and_pick_all,
    _run,
)

STYLE_GATE = ("leca", "bilateria", "tetrapodomorpha", "homo-erectus")

LINEAGE = Tree(
    id="lineage",
    nodes=[
        TreeNode(id="luca", parent=None, label="LUCA", t_divergence=4.0e9),
        TreeNode(id="tetrapod", parent="luca", label="Tetrapoda", t_divergence=3.75e8),
        TreeNode(id="human", parent="tetrapod", label="Homo sapiens", t_divergence=3.0e5),
    ],
)

PORTRAITS_YAML = """\
# A comment the pin writer must keep.
portraits:
  - id: luca
    plate: MICROSCOPE
    evidence: reconstruction
    sources: ["Moody 2024"]
    gaps: []
    subject:
      organism: "A reconstruction of LUCA"
      anatomy: "one small cell"
      surface: "translucent"
      size: null
      absent: ["a nucleus"]
    pin: null

  - id: tetrapod
    plate: SPECIMEN
    evidence: fossil
    sources: ["Coates & Clack 1990"]
    gaps: ["colour"]
    subject:
      organism: "Acanthostega gunnari"
      anatomy: "eight digits on each forelimb"
      surface: "no source gives its colour"
      size: "about 60 cm long"
      absent: ["claws"]
    pin: null

  - id: human
    plate: SPECIMEN
    evidence: fossil
    sources: ["Hublin 2017"]
    gaps: []
    subject:
      organism: "Early Homo sapiens"
      anatomy: "a modern face and a long braincase"
      surface: "natural appearance"
      size: null
      absent: ["clothing"]
    pin: null
"""


@pytest.fixture
def root(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    paths = ProjectPaths(project)
    paths.scenes.parent.mkdir(parents=True)
    paths.scenes.write_text(SCENES_YAML)
    paths.portraits.write_text(PORTRAITS_YAML)
    for shape in (CO2, DAY_LENGTH, SOLAR_LUMINOSITY, LINEAGE, PALEODEM, EVENTS):
        write_shape(shape, paths.curated)
    for name, (title, citation, licence, url) in SOURCE_MANIFESTS.items():
        source = paths.sources / name
        source.mkdir(parents=True)
        (source / "manifest.toml").write_text(
            f'name = "{name}"\ntitle = "{title}"\ncitation = "{citation}"\n'
            f'licence = "{licence}"\nurl = "{url}"\n'
        )
    return project.resolve()


def _build_and_pick_portraits(backend: FakeBackend, root: Path) -> None:
    code, output = _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")
    assert code == 0, output
    for node_id in ("luca", "tetrapod", "human"):
        assert _run(backend, root, "review", "portraits", "pick", node_id, "1")[0] == 0


# -- the committed portrait book ------------------------------------------------------------


def test_committed_portraits_cover_the_lineage_as_square_1k_plates_naming_no_provider() -> None:
    paths = ProjectPaths(REPO_ROOT)
    tree = load_world(paths.curated).trees["lineage"]
    graph = build_portrait_graph(load_portrait_book(paths.portraits), tree, FakeBackend())

    ids = [a.record.id for a in graph.assets]
    assert len(ids) >= 40
    assert set(STYLE_GATE) <= set(ids)
    assert "deuterostomia" not in ids  # its representative is no longer a deuterostome
    assert [a.node.t_divergence for a in graph.assets] == sorted(
        a.node.t_divergence for a in graph.assets
    )
    for assets in graph.assets:
        assert assets.image.config == {"aspect_ratio": "1:1", "image_size": "1K"}
        prompt = assets.image.inputs["prompt"]
        assert prompt.startswith(PORTRAIT_STYLE)
        lowered = prompt.lower()
        assert [term for term in FORBIDDEN_IN_PROMPTS if term.lower() in lowered] == []


def test_a_reconstruction_must_say_so_in_its_organism_text() -> None:
    text = PORTRAITS_YAML.replace('"A reconstruction of LUCA"', '"LUCA"')

    with pytest.raises(ValidationError, match="requires the organism text to say 'reconstruction'"):
        parse_portrait_book(text)


def test_portraits_of_nodes_missing_from_the_lineage_are_refused() -> None:
    book = parse_portrait_book(PORTRAITS_YAML.replace("id: human", "id: neanderthal"))

    with pytest.raises(ValueError, match="absent from tree 'lineage': neanderthal"):
        build_portrait_graph(book, LINEAGE, FakeBackend())


def test_a_portrait_request_is_square_at_1k_and_costs_what_a_2k_scene_costs(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_image_body(_png(1024, 1024)))

    graph = build_portrait_graph(parse_portrait_book(PORTRAITS_YAML), LINEAGE, FakeBackend())
    node = graph.assets[0].image

    image = _generator(handler, tmp_path / "spend.json").render(node)

    (request,) = seen
    assert json.loads(request.content)["generationConfig"] == {
        "responseModalities": ["TEXT", "IMAGE"],
        "imageConfig": {"aspectRatio": "1:1", "imageSize": "1K"},
    }
    assert (image.info.width, image.info.height) == (1024, 1024)
    portrait = ImageRequest.from_node(node)
    scene_sized = portrait.model_copy(update={"aspect_ratio": "16:9", "image_size": "2K"})
    price = PRICES[MODEL_ID]
    assert estimate_usd(portrait, price) == estimate_usd(scene_sized, price)


# -- plan and build -------------------------------------------------------------------------


def test_plan_lists_every_portrait_with_its_estimate_and_spends_nothing(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(backend, root, "plan")

    assert code == 0, output
    assert "3 scenes: 0 pinned, 0 awaiting review, 3 stale" in output
    rows = [line.split() for line in output.splitlines() if line.split()[:1] == ["luca"]]
    assert rows == [["luca", "4.00", "Ga", "MICROSCOPE", "reconstruction", "stale", "0", "$0.10"]]
    assert "3 portraits: 0 pinned, 0 awaiting review, 3 stale" in output
    assert "estimate to build stale portraits: 3 x 1 candidates = 3 images, $0.30" in output
    assert (backend.opened, backend.rendered) == (0, [])


def test_plan_without_a_portrait_book_says_so(root: Path) -> None:
    ProjectPaths(root).portraits.unlink()

    code, output = _run(FakeBackend(), root, "plan")

    assert code == 0, output
    assert "portraits: data/portraits.yaml not present" in output


def test_build_portraits_writes_square_candidates_to_the_portrait_store(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(
        backend, root, "build", "--max-spend", "10", "--only", "portraits", "--candidates", "2"
    )

    assert code == 0, output
    assert backend.rendered == [
        "portrait.human.image",
        "portrait.human.image",
        "portrait.tetrapod.image",
        "portrait.tetrapod.image",
        "portrait.luca.image",
        "portrait.luca.image",
    ]
    assert "built: 6 candidates across 3 portraits" in output
    paths = ProjectPaths(root)
    store = CandidateStore(paths.portrait_candidates)
    assert [len(store.candidates(n)) for n in ("luca", "tetrapod", "human")] == [2, 2, 2]
    assert not CandidateStore(paths.candidates).has(store.candidates("human")[0].record.node_digest)
    assert Ledger.load(paths.ledger).spent == pytest.approx(6 * ESTIMATE_USD)
    assert "3 portraits: 0 pinned, 3 awaiting review, 0 stale" in _run(backend, root, "plan")[1]


def test_build_restricts_to_named_nodes(root: Path) -> None:
    backend = FakeBackend()

    code, output = _run(
        backend, root, "build", "--max-spend", "10", "--only", "portraits", "--node", "luca"
    )

    assert code == 0, output
    assert backend.rendered == ["portrait.luca.image"]


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (("--only", "portraits", "--scene", "city"), "REFUSED: --scene selects scenes"),
        (("--node", "luca"), "REFUSED: --node selects portraits"),
        (("--only", "portraits", "--node", "dodo"), "no portrait for lineage node(s): dodo"),
        (("--only", "portraits"), "REFUSED: estimate $0.30 exceeds the $0.20 remaining"),
    ],
)
def test_build_refuses_what_it_cannot_do_without_spending(
    root: Path, args: tuple[str, ...], message: str
) -> None:
    backend = FakeBackend()

    code, output = _run(backend, root, "build", "--max-spend", "0.2", *args)

    assert code == 1
    assert message in output
    assert (backend.opened, backend.rendered) == (0, [])


def test_a_pinned_portrait_survives_a_subject_change_and_is_not_regenerated(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0
    assert _run(backend, root, "review", "portraits", "pick", "human", "1")[0] == 0
    paths = ProjectPaths(root)
    pin = load_portrait_book(paths.portraits).portrait("human").pin
    paths.portraits.write_text(
        paths.portraits.read_text()
        .replace("a modern face and a long braincase", "a modern face")
        .replace("eight digits on each forelimb", "eight webbed digits")
    )
    backend.rendered.clear()

    code, output = _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")

    assert code == 0, output
    assert backend.rendered == ["portrait.tetrapod.image"]
    assert load_portrait_book(paths.portraits).portrait("human").pin == pin


# -- review ---------------------------------------------------------------------------------


def test_review_portraits_lists_each_between_its_older_and_younger_neighbours(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0

    code, output = _run(backend, root, "review", "portraits")

    assert code == 0, output
    tetrapod = output.split("\n\n")[1].splitlines()
    assert tetrapod[:3] == [
        "[2/3] tetrapod  375 Ma  plate SPECIMEN  awaiting-review",
        "  older:   luca (4.00 Ga, unpinned)",
        "  younger: human (300 ka, unpinned)",
    ]
    assert len(tetrapod) == 4


def test_review_portraits_pick_writes_one_pin_line_and_clear_restores_the_file(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0
    paths = ProjectPaths(root)
    original = paths.portraits.read_text()
    chosen = CandidateStore(paths.portrait_candidates).candidates("tetrapod")[0]

    code, output = _run(backend, root, "review", "portraits", "pick", "tetrapod", "1")

    assert code == 0, output
    changed = [
        (old, new)
        for old, new in zip(
            original.splitlines(), paths.portraits.read_text().splitlines(), strict=True
        )
        if old != new
    ]
    path = chosen.image_path.relative_to(root).as_posix()
    assert changed == [
        (
            "    pin: null",
            f'    pin: {{asset_digest: "{chosen.record.asset_digest}", path: "{path}"}}',
        )
    ]
    assert (
        "already pinned" in _run(backend, root, "review", "portraits", "pick", "tetrapod", "1")[1]
    )

    assert _run(backend, root, "review", "portraits", "clear", "tetrapod")[0] == 0
    assert paths.portraits.read_text() == original


def test_review_portraits_sheet_writes_neighbour_sheets_and_a_lineage_overview(root: Path) -> None:
    backend = FakeBackend()
    assert _run(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0

    code, output = _run(backend, root, "review", "portraits", "sheet")

    assert code == 0, output
    review_dir = ProjectPaths(root).portrait_review
    assert sorted(p.name for p in review_dir.iterdir()) == [
        "01-luca.jpg",
        "02-tetrapod.jpg",
        "03-human.jpg",
        "overview.jpg",
    ]


# -- publish --------------------------------------------------------------------------------


def _cache_morph(root: Path, older: str, younger: str) -> MorphRecord:
    paths = ProjectPaths(root)
    book = load_portrait_book(paths.portraits)
    key = MorphKey.between(book.portrait(older), book.portrait(younger))
    field = np.zeros((4, 4, 2), dtype=np.float32)
    field[0, 0] = [0.1, -0.05]
    encoded = encode_flow(field)
    directory = key.directory(paths.portrait_morphs)
    directory.mkdir(parents=True)
    (directory / FORWARD_FLOW_NAME).write_bytes(encoded.png)
    (directory / BACKWARD_FLOW_NAME).write_bytes(encoded.png)
    record = MorphRecord(
        key=key,
        algorithm_version=MORPH_ALGORITHM_VERSION,
        size=encoded.size,
        forward_range=encoded.range,
        backward_range=encoded.range,
    )
    (directory / MORPH_RECORD_NAME).write_text(record.model_dump_json())
    return record


def test_publish_adds_plates_and_cached_morphs_to_the_lineage_layer(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    _build_and_pick_portraits(backend, root)
    morph = _cache_morph(root, "tetrapod", "human")
    paths = ProjectPaths(root)
    book = load_portrait_book(paths.portraits)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    assert "portraits: 3 plates, 1 morphs, 0 unpinned skipped" in output
    assert "WARNING: no morph for luca -> tetrapod; run `earthtime morph`" in output
    lineage = json.loads((paths.media / "layers" / "lineage.json").read_text())
    assert lineage["portraits"] == {
        "plates": [
            _plate(book, "human", "SPECIMEN"),
            _plate(book, "tetrapod", "SPECIMEN"),
            _plate(book, "luca", "MICROSCOPE"),
        ],
        "morphs": [
            {
                "older": "tetrapod",
                "younger": "human",
                "forward": "portraits/morphs/tetrapod--human.forward.png",
                "backward": "portraits/morphs/tetrapod--human.backward.png",
                "forwardRange": morph.forward_range,
                "backwardRange": morph.backward_range,
                "size": 4,
            }
        ],
    }
    for node_id in ("luca", "tetrapod", "human"):
        pin = book.portrait(node_id).pin
        assert pin is not None
        published = paths.media / "portraits" / f"{node_id}.png"
        assert published.read_bytes() == (root / pin.path).read_bytes()
    directory = morph.key.directory(paths.portrait_morphs)
    assert (paths.media / "portraits" / "morphs" / "tetrapod--human.forward.png").read_bytes() == (
        directory / FORWARD_FLOW_NAME
    ).read_bytes()


def _plate(book: object, node_id: str, plate: str) -> dict[str, object]:
    assert hasattr(book, "portrait")
    pin = book.portrait(node_id).pin
    assert pin is not None
    return {
        "nodeId": node_id,
        "image": f"portraits/{node_id}.png",
        "plate": plate,
        "pinned": pin.asset_digest,
        "width": 16,
        "height": 9,
    }


def test_publish_skips_unpinned_portraits_and_omits_the_block_when_none_is_pinned(
    root: Path,
) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)

    code, output = _run(backend, root, "publish")

    assert code == 0, output
    assert "portraits: 0 plates, 0 morphs, 3 unpinned skipped" in output
    lineage = json.loads((ProjectPaths(root).media / "layers" / "lineage.json").read_text())
    assert "portraits" not in lineage


def test_publish_refuses_a_portrait_whose_pinned_file_no_longer_matches(root: Path) -> None:
    backend = FakeBackend()
    _build_and_pick_all(backend, root)
    _build_and_pick_portraits(backend, root)
    pin = load_portrait_book(ProjectPaths(root).portraits).portrait("tetrapod").pin
    assert pin is not None
    (root / pin.path).write_bytes(b"\x89PNG\r\n\x1a\n")

    code, output = _run(backend, root, "publish")

    assert code == 1
    assert f"tetrapod: {pin.path} no longer matches pinned digest {pin.asset_digest}" in output
    assert not ProjectPaths(root).media.exists()
