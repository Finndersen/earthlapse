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

from pipeline.models import WorldState


class Shot(StrEnum):
    """The camera grammar (VISUAL_SPEC §3). Mirrors `Scene.shot` in web/src/types/manifest.ts."""

    WIDE_RIDGE = "WIDE_RIDGE"
    WATER_EDGE = "WATER_EDGE"
    CANOPY = "CANOPY"
    GROUND = "GROUND"


class ChapterId(StrEnum):
    MESOZOIC = "mesozoic"
    DEVONIAN_ESTUARY = "devonian-estuary"
    CARBONIFEROUS_SWAMP = "carboniferous-swamp"
    PERMIAN_INTERIOR = "permian-interior"


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

# One composition deliberately spans three consecutive chapters: gate v2 asks whether a held
# camera survives very different worlds (DESIGN §14, question 1). Light direction is fixed but
# its quality is not, because a harsh desert sun and a swamp overcast are the world, not the camera.
WATER_EDGE_SERIES_COMPOSITION = (
    "Composition, identical across this series of photographs: the horizon is level at 40% of "
    "frame height from the top. Calm water fills the bottom third of the frame. The shoreline "
    "enters from the left edge and recedes diagonally to meet the horizon right of centre. A tall "
    "mass of vegetation occupies the left third, its top about 15% below the top edge. The main "
    "subject is in the middle ground just right of centre, at the waterline, about a fifth of "
    "the frame width. Open sky over the right half, above a low far bank on the horizon. The "
    "light comes from the upper left, the sun itself out of frame; any shadows fall to the right."
)

# Held fixed within a chapter so dissolves read as morphs (VISUAL_SPEC §3). Time of day and
# sun direction live here too: the spec holds time of day constant within a chapter.
COMPOSITION_CONSTRAINTS: dict[ChapterId, str] = {
    ChapterId.DEVONIAN_ESTUARY: WATER_EDGE_SERIES_COMPOSITION,
    ChapterId.CARBONIFEROUS_SWAMP: WATER_EDGE_SERIES_COMPOSITION,
    ChapterId.PERMIAN_INTERIOR: WATER_EDGE_SERIES_COMPOSITION,
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

# A reference that carries no era at all, so there is no content for a scene to copy: neutral
# grey rock and a featureless sky expose the camera's grain and colour response and little else.
STYLE_REFERENCE_SUBJECT = (
    "Subject: a neutral calibration photograph with no era and no life in it. Bare, weathered "
    "grey rock and rounded grey pebbles at the edge of still, clear water. No plants, no moss, no "
    "algae, no animals, no footprints, no people, no structures. A plain, evenly overcast pale "
    "grey sky without distinct clouds. Soft, even, neutral daylight. The rock is a neutral grey, "
    "so the camera's colour response and grain show without the land imposing a colour."
)

# Worded for a reference placed BEFORE the text (PartOrder.REFERENCE_FIRST): "the image above".
STYLE_REFERENCE_CONDITIONING = (
    "The image above is a photographic style reference and nothing more. Take ONLY its "
    "photographic treatment: the lens rendering and perspective, the sensor and grain character, "
    "the colour response, contrast and tonal grade, and the degree of realism, as if both "
    "photographs came from the same camera and the same processing. Take NOTHING else from it: "
    "not its rocks, water, shoreline, sky, weather, light, the colours of its land, or the "
    "arrangement of its frame. This is a new photograph of a different place, not an edit of the "
    "reference. ALL content, layout, light and weather come only from the text below."
)


class Aridity(StrEnum):
    HUMID = "humid"
    SEMI_ARID = "semi-arid"
    ARID = "arid"


# Sky and light follow the moisture regime at the vantage (VISUAL_SPEC §2, variant half).
SKY_BY_ARIDITY: dict[Aridity, str] = {
    Aridity.HUMID: (
        "Sky and light: a low, even overcast of white-grey cloud; soft, diffuse, almost shadowless "
        "light; the air saturated and heavy, a dense humid haze tinted green-grey that swallows "
        "the distance."
    ),
    Aridity.SEMI_ARID: (
        "Sky and light: a clear, pale blue sky with a few small fair-weather cumulus; bright, "
        "crisp sunlight with clean, defined shadows; clear air, the far distance sharp."
    ),
    Aridity.ARID: (
        "Sky and light: a cloudless sky bleached almost white by suspended dust; a hard, glaring "
        "sun and short, sharp, dark shadows; heat shimmer and a tan dust haze over the distance."
    ),
}


class UnsourcedConditions(BaseModel):
    """World conditions no curated source covers yet, hand-written per chapter.

    Each field becomes a `WorldState` lookup when its source lands; until then the values are
    rounded, plausible figures, not citations.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    o2_percent: float = Field(gt=0, lt=100)
    mean_temp_c: float
    aridity: Aridity


class MissingCondition(ValueError):
    """A value the conditions template needs is absent from `WorldState` at this t."""


class SceneContent(BaseModel):
    """A chapter's world as data, rendered by one template so chapters differ only in values."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    setting: str = Field(min_length=1)
    vegetation_mass: str = Field(min_length=1)
    shore: str = Field(min_length=1)
    water: str = Field(min_length=1)
    main_subject: str = Field(min_length=1)
    far_bank: str = Field(min_length=1)
    absent: tuple[str, ...] = Field(min_length=1)


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


def render_style_reference_prompt(shot: Shot) -> str:
    """The camera and nothing else: no composition constraints, no conditions, no era."""
    return "\n\n".join([INVARIANT_STYLE, SHOT_TYPE[shot], STYLE_REFERENCE_SUBJECT])


def render_style_referenced_prompt(scene: ScenePrompt) -> str:
    """For a scene sent after a content-free style reference image."""
    return "\n\n".join([STYLE_REFERENCE_CONDITIONING, render_prompt(scene)])


def render_conditions(state: WorldState, unsourced: UnsourcedConditions) -> str:
    """The variant half of the style spec, a pure function of the world at one instant."""
    co2 = _required(state.atmosphere.co2_ppm, "atmosphere.co2_ppm", state)
    day_hours = _required(state.sky.day_length_hours, "sky.day_length_hours", state)
    luminosity = _required(state.sky.solar_luminosity_rel, "sky.solar_luminosity_rel", state)
    return " ".join(
        [
            f"About {state.t / 1e6:,.0f} million years ago.",
            (
                f"Atmosphere: CO2 {co2:,.0f} ppm, {_co2_band(co2)}; oxygen "
                f"{unsourced.o2_percent:.0f}%, {_o2_band(unsourced.o2_percent)}."
            ),
            (
                f"Global mean temperature about {unsourced.mean_temp_c:.0f} °C, "
                f"{_temperature_band(unsourced.mean_temp_c)}."
            ),
            (
                f"The Sun is {(1 - luminosity) * 100:.1f}% fainter than today; a day lasts "
                f"{day_hours:.1f} hours."
            ),
            SKY_BY_ARIDITY[unsourced.aridity],
        ]
    )


def render_subject(content: SceneContent) -> str:
    return " ".join(
        [
            f"{content.setting}.",
            f"The vegetation mass on the left: {content.vegetation_mass}.",
            f"Along the near shore: {content.shore}.",
            f"The water: {content.water}.",
            f"The main subject, at the waterline just right of centre: {content.main_subject}.",
            f"On the far bank at the horizon: {content.far_bank}.",
            f"None of these may appear anywhere in the frame: {', '.join(content.absent)}.",
        ]
    )


def _required(value: float | None, field: str, state: WorldState) -> float:
    if value is None:
        raise MissingCondition(f"WorldState.{field} is absent at t={state.t:g}")
    return value


def _co2_band(ppm: float) -> str:
    if ppm < 700:
        return "close to today's level"
    if ppm < 2000:
        return "several times today's level"
    return "a greenhouse atmosphere, many times today's level"


def _o2_band(percent: float) -> str:
    if percent < 19:
        return "a little below today's 21%"
    if percent <= 24:
        return "close to today's 21%"
    return "far richer than today's 21%"


def _temperature_band(celsius: float) -> str:
    if celsius < 18:
        return "an icehouse world with ice at the poles, though the tropics stay hot"
    if celsius < 22:
        return "warmer than today"
    return "a hot greenhouse world with little or no polar ice"
