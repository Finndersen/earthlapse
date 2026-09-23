"""Prompt templates (pipeline/prompts.py) and the committed scene book's rendered prompts."""

from __future__ import annotations

import pytest

from pipeline.paths import ProjectPaths
from pipeline.prompts import (
    COMPOSITION_CONSTRAINTS,
    SHOT_TYPE,
    Composition,
    ScenePrompt,
    Shot,
    _render_atmosphere,
    render_prompt,
    render_subject,
)
from pipeline.scenes import load_scene_book
from tests.support import FORBIDDEN_IN_PROMPTS, REPO_ROOT


def test_every_shot_and_composition_has_a_template() -> None:
    assert set(SHOT_TYPE) == set(Shot)
    assert set(COMPOSITION_CONSTRAINTS) == set(Composition)


@pytest.mark.content
def test_committed_scene_prompts_render_and_name_no_provider() -> None:
    book = load_scene_book(ProjectPaths(REPO_ROOT).scenes)
    offenders = {}
    for scene in book.scenes:
        prompt = render_prompt(
            ScenePrompt(
                shot=scene.shot,
                composition=book.chapter(scene.chapter).composition,
                conditions="Placeholder conditions.",
                subject=render_subject(scene.subject),
            )
        ).lower()
        if found := [term for term in FORBIDDEN_IN_PROMPTS if term.lower() in prompt]:
            offenders[scene.id] = found

    assert offenders == {}


GAP_DOMAIN = (805_743.87, 1.0e7)


@pytest.mark.parametrize(
    ("t", "co2_ppm", "co2_domain", "expected"),
    [
        (
            GAP_DOMAIN[0],
            222.0,
            GAP_DOMAIN,
            (
                "Atmosphere: CO2 222 ppm, a glacial low, well below today's level; "
                "no estimate of oxygen."
            ),
        ),
        (
            3.2e6,
            None,
            GAP_DOMAIN,
            "Atmosphere: no CO2 record covers this interval; no estimate of oxygen.",
        ),
        (
            4.5e9,
            None,
            (0.0, 5.7e8),
            "Atmosphere: no CO2 record reaches this far back; no estimate of oxygen.",
        ),
    ],
    ids=["quoted", "declared-gap", "no-source"],
)
def test_atmosphere_names_an_absent_value_rather_than_inventing_one(
    t: float, co2_ppm: float | None, co2_domain: tuple[float, float] | None, expected: str
) -> None:
    assert _render_atmosphere(t, co2_ppm, co2_domain, None) == expected
