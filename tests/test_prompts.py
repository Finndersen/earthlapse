"""Prompt template tests (pipeline/prompts.py). Offline by construction — no fixtures, no network.

Covers the ADR-014 additions (the `UNDERWATER` shot and its `UNDERWATER_SERIES` composition)
and validates data/scenes-draft-deep.yaml against the same `SceneBook`/`render_prompt` path the
pipeline uses, since that draft is not wired into `earthtime` and so is not exercised by any
other test.
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
from pipeline.scenes import load_scene_book

REPO_ROOT = Path(__file__).resolve().parents[1]
DRAFT_SCENES = REPO_ROOT / "data" / "scenes-draft-deep.yaml"

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


def test_every_shot_has_a_template() -> None:
    assert set(SHOT_TYPE) == set(Shot)


def test_every_composition_has_a_template() -> None:
    assert set(COMPOSITION_CONSTRAINTS) == set(Composition)


def test_underwater_shot_template_describes_a_submerged_camera() -> None:
    text = SHOT_TYPE[Shot.UNDERWATER].lower()
    assert "submerged" in text
    assert "sea floor" in text


def test_underwater_composition_holds_no_horizon_or_sky() -> None:
    text = COMPOSITION_CONSTRAINTS[Composition.UNDERWATER_SERIES].lower()
    assert "horizon" not in text
    assert "sky" not in text
    assert "sea floor" in text


def test_underwater_prompt_renders_and_names_no_provider() -> None:
    prompt = ScenePrompt(
        shot=Shot.UNDERWATER,
        composition=Composition.UNDERWATER_SERIES,
        conditions="About 518 million years ago.",
        subject="A test subject.",
    )
    text = render_prompt(prompt)
    lowered = text.lower()
    assert [term for term in FORBIDDEN_IN_PROMPTS if term in lowered] == []
    assert "submerged" in lowered


def test_draft_deep_scene_book_loads_through_the_real_loader() -> None:
    book = load_scene_book(DRAFT_SCENES)
    assert len(book.scenes) == 17
    assert {c.id for c in book.chapters} == {
        "primordial-seas",
        "cambrian-seafloor",
        "greening-world",
    }
    assert all(scene.pin is None for scene in book.scenes)


def test_draft_deep_scene_prompts_render_and_name_no_provider() -> None:
    book = load_scene_book(DRAFT_SCENES)
    for scene in book.scenes:
        chapter = book.chapter(scene.chapter)
        prompt = ScenePrompt(
            shot=scene.shot,
            composition=chapter.composition,
            conditions="Placeholder conditions.",
            subject=render_subject(scene.subject),
        )
        text = render_prompt(prompt)
        lowered = text.lower()
        forbidden = [term for term in FORBIDDEN_IN_PROMPTS if term in lowered]
        assert forbidden == [], f"{scene.id}: names a provider: {forbidden}"


def test_only_cambrian_seafloor_uses_the_underwater_shot() -> None:
    book = load_scene_book(DRAFT_SCENES)
    underwater = [s.id for s in book.scenes if s.shot is Shot.UNDERWATER]
    assert underwater == ["cambrian-seafloor"]


@pytest.mark.parametrize(
    "scene_id",
    [
        "origin-of-life",
        "great-oxidation",
        "cambrian-seafloor",
        "kpg-arrival",
        "kpg-aftermath",
    ],
)
def test_selected_draft_scenes_have_a_distinct_caption(scene_id: str) -> None:
    book = load_scene_book(DRAFT_SCENES)
    assert book.scene(scene_id).caption.strip()
