"""The asset graph for scenes: one PROMPT node and one IMAGE node per scene record.

The prompt node is a deterministic template render of `WorldState.at(scene.t)` plus the curated
subject, so a change in either the world data or the curation changes its digest and, through
`depends_on`, the image node's. Pins come from the scene records and are honoured by the
`Resolver` regardless of that drift (ADR-005).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from pipeline.generators.image import PROJECT_ASPECT_RATIO, PROJECT_IMAGE_SIZE
from pipeline.graph import AssetKind, AssetNode, Pin, Resolver, Store
from pipeline.models import WorldModel, WorldState
from pipeline.prompts import (
    COMPOSITION_CONSTRAINTS,
    INVARIANT_STYLE,
    SHOT_TYPE,
    ScenePrompt,
    render_conditions,
    render_prompt,
    render_subject,
)
from pipeline.scenes import ChapterRecord, SceneBook, SceneRecord

PROMPT_GENERATOR = "prompt-template"
PROMPT_GENERATOR_VERSION = "1"


class GeneratorIdentity(Protocol):
    name: str
    version: str


@dataclass(frozen=True)
class SceneAssets:
    scene: SceneRecord
    prompt: AssetNode
    image: AssetNode
    pin: Pin | None


@dataclass(frozen=True)
class SceneGraph:
    assets: tuple[SceneAssets, ...]  # ascending in t, as in the scene book

    @property
    def nodes(self) -> list[AssetNode]:
        return [node for a in self.assets for node in (a.prompt, a.image)]

    @property
    def pins(self) -> dict[str, Pin]:
        return {a.image.id: a.pin for a in self.assets if a.pin is not None}

    def resolver(self, store: Store) -> Resolver:
        return Resolver(self.nodes, self.pins, store)


def prompt_node_id(scene_id: str) -> str:
    return f"{scene_id}.prompt"


def image_node_id(scene_id: str) -> str:
    return f"{scene_id}.image"


def scene_prompt(scene: SceneRecord, chapter: ChapterRecord, state: WorldState) -> ScenePrompt:
    return ScenePrompt(
        shot=scene.shot,
        composition=chapter.composition,
        conditions=render_conditions(state, scene.unsourced),
        subject=render_subject(scene.subject),
    )


def scene_assets(
    scene: SceneRecord, chapter: ChapterRecord, state: WorldState, generator: GeneratorIdentity
) -> SceneAssets:
    prompt = scene_prompt(scene, chapter, state)
    prompt_node = AssetNode(
        id=prompt_node_id(scene.id),
        kind=AssetKind.PROMPT,
        generator=PROMPT_GENERATOR,
        generator_version=PROMPT_GENERATOR_VERSION,
        inputs={
            "style": INVARIANT_STYLE,
            "shot": SHOT_TYPE[prompt.shot],
            "composition": COMPOSITION_CONSTRAINTS[prompt.composition],
            "conditions": prompt.conditions,
            "subject": prompt.subject,
        },
    )
    image_node = AssetNode(
        id=image_node_id(scene.id),
        kind=AssetKind.IMAGE,
        generator=generator.name,
        generator_version=generator.version,
        inputs={"prompt": render_prompt(prompt)},
        config={"aspect_ratio": PROJECT_ASPECT_RATIO, "image_size": PROJECT_IMAGE_SIZE.value},
        depends_on=[prompt_node.id],
    )
    pin = (
        None
        if scene.pin is None
        else Pin(node_id=image_node.id, asset_digest=scene.pin.asset_digest, path=scene.pin.path)
    )
    return SceneAssets(scene=scene, prompt=prompt_node, image=image_node, pin=pin)


def build_scene_graph(
    book: SceneBook, world: WorldModel, generator: GeneratorIdentity
) -> SceneGraph:
    return SceneGraph(
        assets=tuple(
            scene_assets(scene, book.chapter(scene.chapter), world.at(scene.t), generator)
            for scene in book.scenes
        )
    )
