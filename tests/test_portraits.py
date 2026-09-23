"""Ancestor portraits end to end against a temporary project (ADR-015). Offline: fake generator only."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.curated import load_world, write_shape
from pipeline.exposure import erase_scale_bar, expose_plate
from pipeline.flowfield import encode_flow
from pipeline.generators.image import asset_digest
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
    write_portrait_pin,
)
from pipeline.prompts import PORTRAIT_STYLE
from pipeline.scenes import ScenePin
from pipeline.shapes import Tree, TreeNode
from pipeline.spend import Ledger
from pipeline.store import CandidateStore
from pipeline.transcode import PORTRAIT_WEBP_QUALITY, to_webp
from tests.support import (
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
    build_and_pick_all,
    jpeg_bytes,
    run_cli,
    specimen_plate,
)

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
    code, output = run_cli(backend, root, "build", "--max-spend", "10", "--only", "portraits")
    assert code == 0, output
    for node_id in ("luca", "tetrapod", "human"):
        assert run_cli(backend, root, "review", "portraits", "pick", node_id, "1")[0] == 0


# -- the committed portrait book ------------------------------------------------------------


@pytest.mark.content
def test_committed_portraits_render_as_square_1k_text_only_plates_naming_no_provider() -> None:
    paths = ProjectPaths(REPO_ROOT)
    tree = load_world(paths.curated).trees["lineage"]
    graph = build_portrait_graph(load_portrait_book(paths.portraits), tree, FakeBackend())

    for assets in graph.assets:
        assert assets.image.config == {"aspect_ratio": "1:1", "image_size": "1K"}
        assert assets.image.inputs.keys() == {"prompt"}
        prompt = assets.image.inputs["prompt"]
        assert prompt.startswith(PORTRAIT_STYLE)
        lowered = prompt.lower()
        assert [term for term in FORBIDDEN_IN_PROMPTS if term.lower() in lowered] == []


def test_portraits_of_nodes_missing_from_the_lineage_are_refused() -> None:
    book = parse_portrait_book(PORTRAITS_YAML.replace("id: human", "id: neanderthal"))

    with pytest.raises(ValueError, match="absent from tree 'lineage': neanderthal"):
        build_portrait_graph(book, LINEAGE, FakeBackend())


# -- plan and build -------------------------------------------------------------------------


def test_build_portraits_writes_square_candidates_to_the_portrait_store(root: Path) -> None:
    backend = FakeBackend()

    code, output = run_cli(
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
    paths = ProjectPaths(root)
    store = CandidateStore(paths.portrait_candidates)
    assert [len(store.candidates(n)) for n in ("luca", "tetrapod", "human")] == [2, 2, 2]
    assert not CandidateStore(paths.candidates).has(store.candidates("human")[0].record.node_digest)
    assert Ledger.load(paths.ledger).spent == pytest.approx(6 * ESTIMATE_USD)
    assert "3 portraits: 0 pinned, 3 awaiting review, 0 stale" in run_cli(backend, root, "plan")[1]


def test_a_pinned_portrait_survives_a_subject_change_and_is_not_regenerated(root: Path) -> None:
    backend = FakeBackend()
    assert run_cli(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0
    assert run_cli(backend, root, "review", "portraits", "pick", "human", "1")[0] == 0
    paths = ProjectPaths(root)
    pin = load_portrait_book(paths.portraits).portrait("human").pin
    paths.portraits.write_text(
        paths.portraits.read_text()
        .replace("a modern face and a long braincase", "a modern face")
        .replace("eight digits on each forelimb", "eight webbed digits")
    )
    backend.rendered.clear()

    code, output = run_cli(backend, root, "build", "--max-spend", "10", "--only", "portraits")

    assert code == 0, output
    assert backend.rendered == ["portrait.tetrapod.image"]
    assert load_portrait_book(paths.portraits).portrait("human").pin == pin


# -- review ---------------------------------------------------------------------------------


def test_review_portraits_pick_writes_one_pin_line_and_clear_restores_the_file(root: Path) -> None:
    backend = FakeBackend()
    assert run_cli(backend, root, "build", "--max-spend", "10", "--only", "portraits")[0] == 0
    paths = ProjectPaths(root)
    original = paths.portraits.read_text()
    chosen = CandidateStore(paths.portrait_candidates).candidates("tetrapod")[0]

    code, output = run_cli(backend, root, "review", "portraits", "pick", "tetrapod", "1")

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
        "already pinned"
        in run_cli(backend, root, "review", "portraits", "pick", "tetrapod", "1")[1]
    )

    assert run_cli(backend, root, "review", "portraits", "clear", "tetrapod")[0] == 0
    assert paths.portraits.read_text() == original


# -- publish --------------------------------------------------------------------------------


def _cache_morph(
    root: Path, older: str, younger: str, *, fallback_dissolve: bool = False
) -> MorphRecord:
    paths = ProjectPaths(root)
    book = load_portrait_book(paths.portraits)
    key = MorphKey.between(book.portrait(older), book.portrait(younger))
    field = np.zeros((4, 4, 2), dtype=np.float32)
    if not fallback_dissolve:
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
        fallback_dissolve=fallback_dissolve,
    )
    (directory / MORPH_RECORD_NAME).write_text(record.model_dump_json())
    return record


def test_publish_adds_plates_and_cached_morphs_to_the_lineage_layer(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    _build_and_pick_portraits(backend, root)
    morph = _cache_morph(root, "tetrapod", "human")
    paths = ProjectPaths(root)
    book = load_portrait_book(paths.portraits)

    code, output = run_cli(backend, root, "publish")

    assert code == 0, output
    assert "portraits: 3 plates, 1 morphs, 0 unpinned skipped" in output
    assert "WARNING: no morph for luca -> tetrapod; run `earthlapse morph`" in output
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
        published = paths.media / "portraits" / f"{node_id}.webp"
        # The fake generator's plates are a flat colour: no subject to expose and no scale bar
        # to erase, so the published bytes are exactly the pin, WebP-transcoded.
        assert published.read_bytes() == to_webp(
            (root / pin.path).read_bytes(), PORTRAIT_WEBP_QUALITY
        )
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
        "image": f"portraits/{node_id}.webp",
        "plate": plate,
        "pinned": pin.asset_digest,
        "width": 16,
        "height": 9,
        # The fake generator's plates are a flat colour: no subject, so nothing to expose.
        "exposure": {"highlight": None, "gain": 1.0},
    }


def test_publish_writes_a_dark_plate_exposure_normalised_and_leaves_its_pin_untouched(
    root: Path,
) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    paths = ProjectPaths(root)
    original = jpeg_bytes(specimen_plate(90))
    digest = asset_digest(original)
    pinned = paths.portrait_candidates / "human" / f"{digest}.jpg"
    pinned.parent.mkdir(parents=True)
    pinned.write_bytes(original)
    write_portrait_pin(
        paths.portraits,
        "human",
        ScenePin(asset_digest=digest, path=pinned.relative_to(root).as_posix()),
    )
    expected = expose_plate(original)

    code, output = run_cli(backend, root, "publish")

    assert code == 0, output
    assert expected.exposure.gain > 1.0
    lineage = json.loads((paths.media / "layers" / "lineage.json").read_text())
    assert lineage["portraits"] == {
        "plates": [
            {
                "nodeId": "human",
                "image": "portraits/human.webp",
                "plate": "SPECIMEN",
                "pinned": digest,
                "width": 512,
                "height": 512,
                "exposure": {
                    "highlight": expected.exposure.highlight,
                    "gain": expected.exposure.gain,
                },
            }
        ],
        "morphs": [],
    }
    assert (paths.media / "portraits" / "human.webp").read_bytes() == to_webp(
        erase_scale_bar(expected.data), PORTRAIT_WEBP_QUALITY
    )
    assert pinned.read_bytes() == original


def test_publish_refuses_a_portrait_whose_pinned_file_no_longer_matches(root: Path) -> None:
    backend = FakeBackend()
    build_and_pick_all(backend, root)
    _build_and_pick_portraits(backend, root)
    pin = load_portrait_book(ProjectPaths(root).portraits).portrait("tetrapod").pin
    assert pin is not None
    (root / pin.path).write_bytes(b"\x89PNG\r\n\x1a\n")

    code, output = run_cli(backend, root, "publish")

    assert code == 1
    assert f"tetrapod: {pin.path} no longer matches pinned digest {pin.asset_digest}" in output
    assert not ProjectPaths(root).media.exists()
