"""Ancestor portraits: data/portraits.yaml, one specimen plate per lineage node (ADR-015).

A portrait is keyed by a lineage node id (data/lineage.yaml, Tree "lineage") and rendered from
text alone (ADR-010): the invariant portrait style, a plate type and the curated subject
(VISUAL_SPEC §10). Its pin lives in its record, as a scene's does in data/scenes.yaml, so it
survives every rebuild (ADR-005). Not every lineage node needs a portrait: the viewer shows the
nearest older plate for a node without one.

Morph fields between consecutive pinned plates are derived, deterministic data. They are cached
under data/candidates/portraits/_morph/ (ProjectPaths.portrait_morphs), keyed by both pins' digests and the algorithm version,
so re-picking either plate invalidates exactly the two morphs that touch it.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from pipeline.assets import PROMPT_GENERATOR, PROMPT_GENERATOR_VERSION, GeneratorIdentity
from pipeline.generators.image import PORTRAIT_ASPECT_RATIO, PORTRAIT_IMAGE_SIZE
from pipeline.graph import AssetKind, AssetNode, Pin, Resolver, Store
from pipeline.prompts import (
    PLATE_TYPE,
    PORTRAIT_STYLE,
    PlateType,
    PortraitPrompt,
    PortraitSubject,
    render_portrait_prompt,
    render_portrait_subject,
)
from pipeline.scenes import SLUG_PATTERN, ScenePin, patch_pin_line
from pipeline.shapes import Tree, TreeNode

LINEAGE_TREE_ID = "lineage"
MORPH_ALGORITHM_VERSION = "4"
FORWARD_FLOW_NAME = "forward.png"
BACKWARD_FLOW_NAME = "backward.png"
MORPH_RECORD_NAME = "morph.json"


class UnknownPortrait(LookupError):
    """A lineage node id that data/portraits.yaml gives no portrait."""


class Evidence(StrEnum):
    """What the subject text stands on. Not rendered into the prompt; the organism text says it."""

    FOSSIL = "fossil"  # a described specimen or species
    EXTANT_PROXY = "extant-proxy"  # a living organism standing in for an unknown ancestor
    RECONSTRUCTION = "reconstruction"  # hypothetical, molecular-clock-only or fragmentary


_EVIDENCE_WORDING = {Evidence.RECONSTRUCTION: "reconstruction", Evidence.EXTANT_PROXY: "proxy"}


class PortraitRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=SLUG_PATTERN)  # a lineage node id
    plate: PlateType
    evidence: Evidence
    sources: tuple[str, ...] = Field(min_length=1)  # what the subject text was checked against
    gaps: tuple[str, ...]  # what those sources do not settle; empty when nothing is open
    subject: PortraitSubject
    pin: ScenePin | None

    @model_validator(mode="after")
    def _organism_says_what_it_rests_on(self) -> PortraitRecord:
        wording = _EVIDENCE_WORDING.get(self.evidence)
        if wording is not None and wording not in self.subject.organism.lower():
            raise ValueError(
                f"{self.id}: evidence {self.evidence} requires the organism text to say "
                f"{wording!r}, so the prompt never presents it as a specimen"
            )
        return self


class PortraitBook(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    portraits: tuple[PortraitRecord, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> PortraitBook:
        duplicates = sorted(i for i, n in Counter(r.id for r in self.portraits).items() if n > 1)
        if duplicates:
            raise ValueError(f"duplicate portrait id: {', '.join(duplicates)}")
        return self

    def portrait(self, node_id: str) -> PortraitRecord:
        for record in self.portraits:
            if record.id == node_id:
                return record
        raise UnknownPortrait(f"no portrait for lineage node {node_id!r}")


def load_portrait_book(path: Path) -> PortraitBook:
    return parse_portrait_book(path.read_text())


def parse_portrait_book(text: str) -> PortraitBook:
    return PortraitBook.model_validate(yaml.safe_load(text))


def write_portrait_pin(path: Path, node_id: str, pin: ScenePin | None) -> PortraitBook:
    """Rewrite one portrait's `pin:` line in place, checked by re-parsing before it is written."""
    patched = patch_pin_line(path.read_text(), node_id, pin)
    book = parse_portrait_book(patched)
    if book.portrait(node_id).pin != pin:
        raise AssertionError(f"{node_id}: pin did not round-trip through {path}")
    path.write_text(patched)
    return book


# --------------------------------------------------------------------------- asset graph


def portrait_prompt_node_id(node_id: str) -> str:
    return f"portrait.{node_id}.prompt"


def portrait_image_node_id(node_id: str) -> str:
    return f"portrait.{node_id}.image"


@dataclass(frozen=True)
class PortraitAssets:
    record: PortraitRecord
    node: TreeNode
    prompt: AssetNode
    image: AssetNode
    pin: Pin | None


@dataclass(frozen=True)
class PortraitGraph:
    assets: tuple[PortraitAssets, ...]  # ascending in t_divergence, as the lineage tree

    @property
    def nodes(self) -> list[AssetNode]:
        return [node for a in self.assets for node in (a.prompt, a.image)]

    @property
    def pins(self) -> dict[str, Pin]:
        return {a.image.id: a.pin for a in self.assets if a.pin is not None}

    def resolver(self, store: Store) -> Resolver:
        return Resolver(self.nodes, self.pins, store)

    def neighbours(self, node_id: str) -> tuple[PortraitAssets | None, PortraitAssets | None]:
        """(older, younger) portraits either side of `node_id` on the lineage path."""
        ids = [a.record.id for a in self.assets]
        if node_id not in ids:
            raise UnknownPortrait(f"no portrait for lineage node {node_id!r}")
        index = ids.index(node_id)
        older = self.assets[index + 1] if index + 1 < len(self.assets) else None
        younger = self.assets[index - 1] if index > 0 else None
        return older, younger


def portrait_assets(
    record: PortraitRecord, node: TreeNode, generator: GeneratorIdentity
) -> PortraitAssets:
    prompt = PortraitPrompt(plate=record.plate, subject=render_portrait_subject(record.subject))
    prompt_node = AssetNode(
        id=portrait_prompt_node_id(record.id),
        kind=AssetKind.PROMPT,
        generator=PROMPT_GENERATOR,
        generator_version=PROMPT_GENERATOR_VERSION,
        inputs={
            "style": PORTRAIT_STYLE,
            "plate": PLATE_TYPE[prompt.plate],
            "subject": prompt.subject,
        },
    )
    image_node = AssetNode(
        id=portrait_image_node_id(record.id),
        kind=AssetKind.IMAGE,
        generator=generator.name,
        generator_version=generator.version,
        inputs={"prompt": render_portrait_prompt(prompt)},
        config={"aspect_ratio": PORTRAIT_ASPECT_RATIO, "image_size": PORTRAIT_IMAGE_SIZE.value},
        depends_on=[prompt_node.id],
    )
    pin = (
        None
        if record.pin is None
        else Pin(node_id=image_node.id, asset_digest=record.pin.asset_digest, path=record.pin.path)
    )
    return PortraitAssets(record=record, node=node, prompt=prompt_node, image=image_node, pin=pin)


def lineage_order(book: PortraitBook, tree: Tree) -> tuple[tuple[PortraitRecord, TreeNode], ...]:
    """Each portrait with its lineage node, ascending in t_divergence (youngest first)."""
    nodes = {n.id: n for n in tree.nodes}
    unknown = sorted(r.id for r in book.portraits if r.id not in nodes)
    if unknown:
        raise ValueError(f"portraits for nodes absent from tree {tree.id!r}: {', '.join(unknown)}")
    ordered = sorted(book.portraits, key=lambda r: nodes[r.id].t_divergence)
    return tuple((record, nodes[record.id]) for record in ordered)


def pinned_pairs(
    book: PortraitBook, tree: Tree
) -> tuple[tuple[PortraitRecord, PortraitRecord], ...]:
    """(older, younger) for each pair of consecutive pinned portraits: the morphs to compute."""
    pinned = [record for record, _ in lineage_order(book, tree) if record.pin is not None]
    return tuple((older, younger) for younger, older in pairwise(pinned))


def build_portrait_graph(
    book: PortraitBook, tree: Tree, generator: GeneratorIdentity
) -> PortraitGraph:
    return PortraitGraph(
        assets=tuple(portrait_assets(r, n, generator) for r, n in lineage_order(book, tree))
    )


# --------------------------------------------------------------------------------- morphs


class MorphKey(BaseModel):
    """Identity of one morph: the two plates it bends between, by pinned digest."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    older: str
    older_digest: str
    younger: str
    younger_digest: str

    @classmethod
    def between(cls, older: PortraitRecord, younger: PortraitRecord) -> MorphKey:
        if older.pin is None or younger.pin is None:
            raise ValueError(f"morph {older.id} -> {younger.id}: both plates must be pinned")
        return cls(
            older=older.id,
            older_digest=older.pin.asset_digest,
            younger=younger.id,
            younger_digest=younger.pin.asset_digest,
        )

    def directory(self, cache_root: Path) -> Path:
        return (
            cache_root
            / f"{self.older}--{self.younger}"
            / f"{self.older_digest}-{self.younger_digest}-v{MORPH_ALGORITHM_VERSION}"
        )


class MorphRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    key: MorphKey
    algorithm_version: str
    size: int = Field(gt=0)
    forward_range: float = Field(gt=0)
    backward_range: float = Field(gt=0)
    # ADR-015 amendment (2026-09-15): True when `compute_morph` judged the flow too incoherent to
    # trust (pipeline.morph.MAX_INVERSE_CONSISTENCY) and zeroed both fields. `forward`/`backward`
    # are still written (an all-zero field is a valid, tiny encoding), but publish treats such a
    # pair as if no morph existed at all, so it crossfades rather than shipping a meaningless
    # near-zero-range flow texture.
    fallback_dissolve: bool


def load_morph(cache_root: Path, key: MorphKey) -> MorphRecord | None:
    """The cached morph for `key`, or None when `earthtime morph` has not computed it yet."""
    path = key.directory(cache_root) / MORPH_RECORD_NAME
    if not path.is_file():
        return None
    record = MorphRecord.model_validate_json(path.read_text())
    if record.key != key or record.algorithm_version != MORPH_ALGORITHM_VERSION:
        raise ValueError(f"{path}: records {record.key}, expected {key}")
    return record
