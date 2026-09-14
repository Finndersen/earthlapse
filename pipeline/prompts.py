"""Prompt templates (VISUAL_SPEC §6). Templates only — nothing here is written at generation time.

    prompt = INVARIANT_STYLE
           + SHOT_TYPE[shot]
           + COMPOSITION_CONSTRAINTS[composition]
           + conditions          # the world: variant half, from WorldState
           + subject             # the curated content, from data/scenes.yaml

Text only (ADR-010): no reference or anchor image is sent with a final scene. Provider-neutral:
no model or vendor is named, so any generator can render these.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from pipeline.models import WorldState
from pipeline.shapes import GeoTime, TreeNode


class Shot(StrEnum):
    """The camera grammar (VISUAL_SPEC §3). Mirrors `Scene.shot` in web/src/types/manifest.ts."""

    WIDE_RIDGE = "WIDE_RIDGE"
    WATER_EDGE = "WATER_EDGE"
    CANOPY = "CANOPY"
    GROUND = "GROUND"


class Composition(StrEnum):
    """A held frame layout. A chapter is a run of scenes sharing one (DESIGN §6)."""

    WATER_EDGE_SERIES = "water-edge-series"
    RIDGE_VISTA = "ridge-vista"
    OPEN_GROUND = "open-ground"


# The camera only (ADR-008). Anything describing the world belongs in conditions or subject.
# Gate v2's style-spec-only Carboniferous frame drifted toward concept art, hence the explicit
# register at the top (ADR-010).
INVARIANT_STYLE = (
    "A real photograph: not concept art, not digital painting, not CGI, not illustration. A "
    "documentary nature photograph, indistinguishable from a real, unretouched photo. Shot on a "
    "full-frame digital camera with a 35mm prime lens: natural perspective, no wide-angle "
    "distortion. Fine, even, film-like grain as at ISO 400. Natural, true-to-life colour "
    "response and moderate contrast, straight out of camera. No cinematic colour grade, no "
    "teal-and-orange, no HDR, no bloom, no lens flare, no vignette. No text, no watermark, no "
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

# Held fixed within a chapter so dissolves read as morphs (VISUAL_SPEC §3). Light direction is
# fixed but its quality is not: a Snowball glare and a swamp overcast are the world, not the
# camera. The left mass is named generically because it is vegetation in one world and rock,
# ice or buildings in another; the subject says which.
COMPOSITION_CONSTRAINTS: dict[Composition, str] = {
    Composition.WATER_EDGE_SERIES: (
        "Composition, identical across this series of photographs: the horizon is level at 40% "
        "of frame height from the top. Calm water fills the bottom third of the frame. The "
        "shoreline enters from the left edge and recedes diagonally to meet the horizon right of "
        "centre. A tall mass occupies the left third, its top about 15% below the top edge. The "
        "main subject is in the middle ground just right of centre, at the waterline, about a "
        "fifth of the frame width. Open sky over the right half, above a low far bank on the "
        "horizon. The light comes from the upper left, the sun itself out of frame; any shadows "
        "fall to the right."
    ),
    Composition.OPEN_GROUND: (
        "Composition, fixed for this chapter: the horizon is level at 45% of frame height from "
        "the top, with flat open ground filling the lower half of the frame and no water in "
        "view. A low line on the ground leads from the near foreground toward the main subject. "
        "A tall mass occupies the left third, its top about 15% below the top edge. The main "
        "subject is in the middle ground just right of centre, about a fifth of the frame width. "
        "Open sky over the right half. The light comes from the upper left, the sun itself out "
        "of frame; any shadows fall to the right."
    ),
    Composition.RIDGE_VISTA: (
        "Composition, fixed for this chapter: the horizon is level at one third of frame height "
        "from the top. A dark rocky foreground ridge fills the bottom fifth of the frame. A tall "
        "mass occupies the left third, its top about 15% below the top edge. The main subject is "
        "in the middle distance just right of centre, about a fifth of the frame width. Open sky "
        "over the right half. The light comes from the upper left, the sun itself out of frame; "
        "any shadows fall to the right."
    ),
}


class UnsourcedConditions(BaseModel):
    """World conditions no curated source covers yet, hand-written per scene in data/scenes.yaml.

    Each field becomes a `WorldState` lookup when its source lands. Until then the values are
    rounded, plausible figures, not citations; `None` means no defensible figure exists.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    o2_percent: float | None = Field(ge=0, lt=100)
    mean_temp_c: float | None


class SceneSubject(BaseModel):
    """A scene's world as data, rendered by one template so scenes differ only in values.

    `absent` names the anachronisms the model is most likely to reach for (grass before ~60 Ma,
    flowers before ~130 Ma, palms in the Paleozoic): an explicit list does more than hoping.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    setting: str = Field(min_length=1)
    left_mass: str = Field(min_length=1)
    vegetation: str = Field(min_length=1)
    fauna: str = Field(min_length=1)
    main_subject: str = Field(min_length=1)
    ground: str = Field(min_length=1)
    water: str = Field(min_length=1)
    far_bank: str = Field(min_length=1)
    sky_and_light: str = Field(min_length=1)
    absent: tuple[str, ...] = Field(min_length=1)


class ScenePrompt(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    shot: Shot
    composition: Composition
    conditions: str = Field(min_length=1)
    subject: str = Field(min_length=1)


def render_prompt(scene: ScenePrompt) -> str:
    return "\n\n".join(
        [
            INVARIANT_STYLE,
            SHOT_TYPE[scene.shot],
            COMPOSITION_CONSTRAINTS[scene.composition],
            f"Conditions: {scene.conditions}",
            f"Subject: {scene.subject}",
        ]
    )


def render_conditions(state: WorldState, unsourced: UnsourcedConditions) -> str:
    """The variant half of the style spec, a pure function of the world at one instant.

    A value absent from `WorldState` renders as an explicit absence, never a substitute.
    """
    return " ".join(
        [
            _render_time(state.t),
            _render_atmosphere(state.atmosphere.co2_ppm, unsourced.o2_percent),
            _render_temperature(unsourced.mean_temp_c),
            _render_sky(state.sky.solar_luminosity_rel, state.sky.day_length_hours),
            _render_land(state.plates.land_fraction),
            _render_ancestor(state.biosphere.ancestor),
        ]
    )


def render_subject(subject: SceneSubject) -> str:
    return " ".join(
        [
            f"{subject.setting}.",
            f"The tall mass in the left third: {subject.left_mass}.",
            f"Dominant vegetation: {subject.vegetation}.",
            f"Animal life: {subject.fauna}.",
            f"The main subject, just right of centre: {subject.main_subject}.",
            f"The near ground: {subject.ground}.",
            f"The water: {subject.water}.",
            f"On the far bank at the horizon: {subject.far_bank}.",
            f"Sky and light: {subject.sky_and_light}.",
            f"None of these may appear anywhere in the frame: {', '.join(subject.absent)}.",
        ]
    )


def _render_time(t: GeoTime) -> str:
    if t == 0:
        return "The present day."
    if t < 1e6:
        return f"About {t:,.0f} years ago."
    if t < 1e9:
        return f"About {t / 1e6:,.0f} million years ago."
    return f"About {t / 1e9:.1f} billion years ago."


def _render_atmosphere(co2_ppm: float | None, o2_percent: float | None) -> str:
    co2 = (
        "no CO2 record reaches this far back"
        if co2_ppm is None
        else f"CO2 {co2_ppm:,.0f} ppm, {_co2_band(co2_ppm)}"
    )
    o2 = (
        "no estimate of oxygen"
        if o2_percent is None
        else f"oxygen {o2_percent:.0f}%, {_o2_band(o2_percent)}"
    )
    return f"Atmosphere: {co2}; {o2}."


def _render_temperature(mean_temp_c: float | None) -> str:
    if mean_temp_c is None:
        return "Global mean temperature: no estimate."
    return f"Global mean temperature about {mean_temp_c:,.0f} °C, {_temperature_band(mean_temp_c)}."


def _render_sky(luminosity_rel: float | None, day_length_hours: float | None) -> str:
    if luminosity_rel is None:
        sun = "No record of the Sun's brightness at this time"
    elif 1 - luminosity_rel < 0.0005:
        sun = "The Sun is as bright as today"
    else:
        sun = f"The Sun is {(1 - luminosity_rel) * 100:.1f}% fainter than today"
    day = (
        "no day-length record reaches this far back"
        if day_length_hours is None
        else f"a day lasts {day_length_hours:.1f} hours"
    )
    return f"{sun}; {day}."


def _render_land(land_fraction: float | None) -> str:
    if land_fraction is None:
        return "Land area: no reconstruction for this time."
    return f"Land covers about {land_fraction * 100:.0f}% of the planet's surface."


def _render_ancestor(ancestor: TreeNode | None) -> str:
    if ancestor is None:
        return "No ancestor of humans is on record at this time."
    example = f", represented by {ancestor.representative}" if ancestor.representative else ""
    return (
        f"The human lineage at this time: {ancestor.label}{example}; context only, it need not "
        "appear in the frame."
    )


def _co2_band(ppm: float) -> str:
    if ppm < 700:
        return "close to today's level"
    if ppm < 2000:
        return "several times today's level"
    return "a greenhouse atmosphere, many times today's level"


def _o2_band(percent: float) -> str:
    if percent < 1:
        return "essentially no free oxygen"
    if percent < 15:
        return "far below today's 21%"
    if percent < 19:
        return "a little below today's 21%"
    if percent <= 24:
        return "close to today's 21%"
    return "far richer than today's 21%"


def _temperature_band(celsius: float) -> str:
    if celsius < 0:
        return "a frozen world, ice reaching towards the equator"
    if celsius < 12:
        return "a glacial world, ice sheets spreading far beyond the poles"
    if celsius < 18:
        return "an icehouse world with ice at the poles, though the tropics stay hot"
    if celsius < 22:
        return "warmer than today"
    if celsius < 40:
        return "a hot greenhouse world with little or no polar ice"
    if celsius < 200:
        return "far hotter than any climate on Earth today"
    return "a molten surface, beyond any climate"


# ---------------------------------------------------------------------------- portraits


class PlateType(StrEnum):
    """The ancestor-portrait plate grammar (VISUAL_SPEC §10, ADR-015). Mirrors `PortraitPlate.plate`
    in web/src/types/layer.ts."""

    SPECIMEN = "SPECIMEN"  # a whole multicellular organism, side profile
    MICROSCOPE = "MICROSCOPE"  # a single cell or small colony, darkfield micrograph


# The plate camera only, identical in every portrait, the way INVARIANT_STYLE is for scenes. The
# framing is held fixed so consecutive plates share their mass layout and the morph between them
# reads as one creature becoming the next (VISUAL_SPEC §10).
PORTRAIT_STYLE = (
    "A real photograph: not concept art, not digital painting, not CGI, not illustration, not a "
    "sculpture or museum model. A natural-history specimen plate from a scientific monograph, one "
    "of a matched series photographed identically. Square 1:1 frame. The subject is exactly "
    "centred and its longest dimension spans about 70% of the frame width. A seamless near-black "
    "backdrop with no texture, horizon, props or ground, falling off evenly to pure black in a soft "
    "circular vignette towards the corners. Fine, even grain; natural, true-to-life colour; no "
    "colour grade, no HDR, no bloom, no lens flare. A thin, pale grey horizontal scale bar sits "
    "below the subject, left of centre, with no numbers or letters. No text, no labels, no "
    "watermark, no border."
)

PLATE_TYPE: dict[PlateType, str] = {
    PlateType.SPECIMEN: (
        "Plate type: whole-specimen portrait. The entire living organism in strict side profile, "
        "facing right: its head or front end at the right, its rear or tail at the left, every "
        "limb, fin, tentacle and the whole tail inside the frame. An organism that is attached or "
        "radially built stands upright in side view with its base at the bottom. One soft studio "
        "key light from the upper left and a faint rim light from behind; a barely visible soft "
        "contact shadow is the only trace of a surface. Medium-format camera, 120mm macro lens, "
        "stopped down so the whole organism is in sharp focus."
    ),
    PlateType.MICROSCOPE: (
        "Plate type: light micrograph. The living cell or small colony seen through a research "
        "microscope under darkfield illumination, glowing softly against the black field; the "
        "round field of view is itself the circular vignette. Oil-immersion objective, one thin "
        "focal plane, the cell's outer edges slightly soft, faint sensor noise. If the subject has "
        "a flagellum it trails to the left, so the cell faces right like every other plate."
    ),
}

PORTRAIT_ALWAYS_ABSENT = (
    "text or labels",
    "a handler's hand, tweezers, pins or a mounting stand",
    "a museum label card",
    "any other organism",
    "a landscape or habitat background",
)


class PortraitSubject(BaseModel):
    """One portrait's organism as data, rendered by one template so plates differ only in values.

    Every clause of `anatomy` rests on the record's `sources` (pipeline/portraits.py). `size` is
    None where no source checked gives one; the framing never changes with it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    organism: str = Field(min_length=1)
    anatomy: str = Field(min_length=1)
    surface: str = Field(min_length=1)
    size: str | None
    absent: tuple[str, ...] = Field(min_length=1)


class PortraitPrompt(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    plate: PlateType
    subject: str = Field(min_length=1)


def render_portrait_prompt(prompt: PortraitPrompt) -> str:
    return "\n\n".join([PORTRAIT_STYLE, PLATE_TYPE[prompt.plate], f"Subject: {prompt.subject}"])


def render_portrait_subject(subject: PortraitSubject) -> str:
    size = (
        []
        if subject.size is None
        else [
            (
                f"Real size: {subject.size}; the framing is identical across the series, so the "
                "subject still spans about 70% of the frame."
            )
        ]
    )
    absent = ", ".join((*subject.absent, *PORTRAIT_ALWAYS_ABSENT))
    return " ".join(
        [
            f"{subject.organism}.",
            f"Visible anatomy: {subject.anatomy}.",
            f"Surface and colour: {subject.surface}.",
            *size,
            f"None of these may appear anywhere in the frame: {absent}.",
        ]
    )
