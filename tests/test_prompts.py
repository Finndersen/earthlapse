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
    _co2_band,
    _render_atmosphere,
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


@pytest.mark.parametrize(
    ("ppm", "band"),
    [
        (191.4, "a glacial low, well below today's level"),  # Last Glacial Maximum
        (229.99, "a glacial low, well below today's level"),
        (230.0, "near pre-industrial levels, well below today's"),
        (277.2, "near pre-industrial levels, well below today's"),  # AD 1750
        (299.99, "near pre-industrial levels, well below today's"),
        (300.0, "close to today's level"),
        (427.35, "close to today's level"),  # AD 2025
        (449.99, "close to today's level"),
        (450.0, "above today's level"),
        (699.99, "above today's level"),
        (700.0, "several times today's level"),
        (1999.99, "several times today's level"),
        (2000.0, "a greenhouse atmosphere, many times today's level"),
    ],
)
def test_co2_band_boundaries(ppm: float, band: str) -> None:
    assert _co2_band(ppm) == band


_GLACIAL_QUOTE = (
    "Atmosphere: CO2 222 ppm, a glacial low, well below today's level; no estimate of oxygen."
)
_GAP_NAMED = "Atmosphere: no CO2 record covers this interval; no estimate of oxygen."
_NO_SOURCE = "Atmosphere: no CO2 record reaches this far back; no estimate of oxygen."

# A stand-in gap boundary, mirroring sources/co2-o2's ice-core -> GEOCARB bridge in shape
# without depending on it: `_render_atmosphere` reads only `co2_domain`, never a source.
_GAP_DOMAIN = (805_743.87, 1.0e7)


@pytest.mark.parametrize(
    ("t", "co2_ppm", "co2_domain", "expected"),
    [
        # co2_ppm present always quotes it, regardless of domain.
        (_GAP_DOMAIN[0], 222.0, _GAP_DOMAIN, _GLACIAL_QUOTE),  # a real sample at the gap's edge
        (_GAP_DOMAIN[1], 222.0, _GAP_DOMAIN, _GLACIAL_QUOTE),  # the other edge
        (
            3.1e8,
            351.14,
            (0.0, 5.7e8),
            "Atmosphere: CO2 351 ppm, close to today's level; no estimate of oxygen.",
        ),
        # co2_ppm=None inside a registered domain: a declared gap.
        (_GAP_DOMAIN[0] + 1, None, _GAP_DOMAIN, _GAP_NAMED),
        (3.2e6, None, _GAP_DOMAIN, _GAP_NAMED),  # Pliocene: the old bridge read a glacial low
        (_GAP_DOMAIN[1] - 1, None, _GAP_DOMAIN, _GAP_NAMED),
        # co2_ppm=None with no domain covering t, or no domain at all: no source, not a gap.
        (4.5e9, None, None, _NO_SOURCE),
        (4.5e9, None, (0.0, 5.7e8), _NO_SOURCE),
    ],
)
def test_atmosphere_distinguishes_a_declared_gap_from_no_source(
    t: float, co2_ppm: float | None, co2_domain: tuple[float, float] | None, expected: str
) -> None:
    assert _render_atmosphere(t, co2_ppm, co2_domain, None) == expected
