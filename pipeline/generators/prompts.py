"""Prompt templates (VISUAL_SPEC §6). Templates only — nothing here is written at generation time.

    prompt = INVARIANT_STYLE
           + SHOT_TYPE[shot]
           + COMPOSITION_CONSTRAINTS[chapter]
           + conditions          # the world: variant half, from WorldState
           + subject             # the curated content

Provider-neutral: no model or vendor is named, so any generator can render these.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Shot(StrEnum):
    """The camera grammar (VISUAL_SPEC §3). Mirrors `Scene.shot` in web/src/types/manifest.ts."""

    WIDE_RIDGE = "WIDE_RIDGE"
    WATER_EDGE = "WATER_EDGE"
    CANOPY = "CANOPY"
    GROUND = "GROUND"


class ChapterId(StrEnum):
    MESOZOIC = "mesozoic"


# The camera only (ADR-008). Anything describing the world belongs in conditions or subject.
INVARIANT_STYLE = (
    "A documentary nature photograph, photorealistic and indistinguishable from a real, "
    "unretouched photo. Shot on a full-frame digital camera with a 35mm prime lens: natural "
    "perspective, no wide-angle distortion. Fine, even, film-like grain as at ISO 400. Natural, "
    "true-to-life colour response and moderate contrast, straight out of camera. No cinematic "
    "colour grade, no teal-and-orange, no HDR, no bloom, no lens flare, no vignette. Not a "
    "painting, not an illustration, not concept art, not a 3D render. No text, no watermark, no "
    "border. Wide 16:9 frame."
)

SHOT_TYPE: dict[Shot, str] = {
    Shot.WIDE_RIDGE: (
        "Shot type: an elevated three-quarter vista from a ridge, looking out and slightly down "
        "across the land, horizon in the upper third of the frame."
    ),
    Shot.WATER_EDGE: (
        "Shot type: camera low, about one metre above the waterline, looking level along the "
        "shore, water occupying the lower third of the frame."
    ),
    Shot.CANOPY: (
        "Shot type: camera at mid-height within vegetation, looking through foliage into layered "
        "depth, near leaves softly framing the edges."
    ),
    Shot.GROUND: (
        "Shot type: camera low and close to the ground, detail-forward, shallow depth of field on "
        "the nearest subject."
    ),
}

# Held fixed within a chapter so dissolves read as morphs (VISUAL_SPEC §3). Time of day and
# sun direction live here too: the spec holds time of day constant within a chapter.
COMPOSITION_CONSTRAINTS: dict[ChapterId, str] = {
    ChapterId.MESOZOIC: (
        "Composition, fixed for this chapter: the horizon is level at 40% of frame height from "
        "the top. Calm water fills the bottom third of the frame. The shoreline enters from the "
        "left edge and recedes diagonally to meet the horizon right of centre. A tall mass of "
        "vegetation occupies the left third, its top about 15% below the top edge. The main "
        "subject stands in the middle ground just right of centre, at the waterline, about a "
        "fifth of the frame width. Open sky over the right half. Late afternoon, the sun low on "
        "the left behind the vegetation, shadows falling to the right."
    ),
}

# Style transfer, not content transfer: continuity of layout is the composition constraints'
# job, and copying the anchor's content would collapse every scene into the anchor.
ANCHOR_CONDITIONING = (
    "The attached image is a style reference from the same photographic series. Match its "
    "photographic treatment exactly: the same lens rendering and perspective, the same grain "
    "structure, the same colour response and contrast, the same degree of realism, as if both "
    "photographs were taken on the same camera. Do not copy its content, subject, landscape or "
    "layout. Depict only the scene described below."
)


class ScenePrompt(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    shot: Shot
    chapter: ChapterId
    conditions: str = Field(min_length=1)
    subject: str = Field(min_length=1)


def render_prompt(scene: ScenePrompt) -> str:
    return "\n\n".join(
        [
            INVARIANT_STYLE,
            SHOT_TYPE[scene.shot],
            COMPOSITION_CONSTRAINTS[scene.chapter],
            f"Conditions: {scene.conditions}",
            f"Subject: {scene.subject}",
        ]
    )


def render_conditioned_prompt(scene: ScenePrompt) -> str:
    """For a scene sent alongside its era anchor as a reference image (ADR-004)."""
    return "\n\n".join([ANCHOR_CONDITIONING, render_prompt(scene)])
