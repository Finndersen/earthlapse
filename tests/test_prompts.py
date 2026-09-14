"""Prompt template and scene-book content tests (pipeline/prompts.py, data/scenes.yaml).

Offline by construction: no fixtures, no network. The content checks guard failure modes the
ADR-014 scientific review found in drafted scenes, which no loader validation catches.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.prompts import (
    COMPOSITION_CONSTRAINTS,
    SHOT_TYPE,
    Composition,
    ScenePrompt,
    Shot,
    render_prompt,
    render_subject,
)
from pipeline.scenes import SceneBook, SceneRecord, load_scene_book

REPO_ROOT = Path(__file__).resolve().parents[1]
SCENES = REPO_ROOT / "data" / "scenes.yaml"

FORBIDDEN_IN_PROMPTS = (
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

# Words that mark a scene's main subject as a hominin, for which "people" in `absent` would
# forbid the subject itself.
HOMININ_MARKERS = ("hominin", "villager", "commuter", "human", "neanderthal")


@pytest.fixture(scope="module")
def book() -> SceneBook:
    return load_scene_book(SCENES)


def test_every_shot_has_a_template() -> None:
    assert set(SHOT_TYPE) == set(Shot)


def test_every_composition_has_a_template() -> None:
    assert set(COMPOSITION_CONSTRAINTS) == set(Composition)


def _prompt(book: SceneBook, scene: SceneRecord) -> str:
    return render_prompt(
        ScenePrompt(
            shot=scene.shot,
            composition=book.chapter(scene.chapter).composition,
            conditions="Placeholder conditions.",
            subject=render_subject(scene.subject),
        )
    )


def test_scene_prompts_render_and_name_no_provider(book: SceneBook) -> None:
    offenders = {
        scene.id: found
        for scene in book.scenes
        if (
            found := [term for term in FORBIDDEN_IN_PROMPTS if term in _prompt(book, scene).lower()]
        )
    }
    assert offenders == {}


def test_no_scene_forbids_its_own_main_subject(book: SceneBook) -> None:
    offenders = [
        scene.id
        for scene in book.scenes
        if "people" in scene.subject.absent
        and any(marker in scene.subject.main_subject.lower() for marker in HOMININ_MARKERS)
    ]
    assert offenders == []


def test_kpg_trio_is_arrival_then_darkness_then_aftermath(book: SceneBook) -> None:
    arrival, darkness, aftermath = (
        book.scene("kpg-arrival"),
        book.scene("kpg-darkness"),
        book.scene("kpg-aftermath"),
    )
    arrival_predecessor, arrival_successor = book.neighbours("kpg-arrival")
    darkness_predecessor, darkness_successor = book.neighbours("kpg-darkness")
    assert (arrival_predecessor is not None and arrival_predecessor.id, arrival_successor) == (
        "cretaceous-forest",
        darkness,
    )
    assert (darkness_predecessor, darkness_successor) == (arrival, aftermath)
    assert arrival.t > darkness.t > aftermath.t
