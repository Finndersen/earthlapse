"""Offline fakes and fixtures for the pipeline tests: the fake image backend and the small
synthetic project the CLI tests build against, synthetic specimen plates, and mocked
image-generator responses."""

from __future__ import annotations

import base64
import io
import struct
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw
from typer.testing import CliRunner

from pipeline.cli import create_app
from pipeline.generators.gemini import MODEL_ID, GeminiImageGenerator, make_client
from pipeline.generators.image import (
    GeneratedImage,
    GenerationFailed,
    ImageGenerator,
    sniff_image,
)
from pipeline.graph import AssetNode
from pipeline.shapes import (
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventSet,
    EventTag,
    GlobeEffect,
    GlobeEffectKind,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
)
from pipeline.spend import Ledger

# -- the fake image backend and synthetic project ----------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[1]


FORBIDDEN_IN_PROMPTS = (
    MODEL_ID,
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


ESTIMATE_USD = 0.1
FAKE_GENERATOR = "fake-image"
FAKE_VERSION = "1"


SCENES_YAML = """\
# A comment the pin writer must keep.
chapters:
  - id: molten
    label: Molten
    shot: WIDE_RIDGE
    composition: ridge-vista
  - id: shore
    label: Shore
    shot: WATER_EDGE
    composition: water-edge-series

scenes:
  - id: hot-start
    t: 4.5e9
    chapter: molten
    shot: WIDE_RIDGE
    title: Hot Start
    caption: A molten world.
    unsourced:
      o2_percent: 0  # hand-written
      mean_temp_c: null
    subject:
      setting: A magma ocean
      left_mass: black crust
      vegetation: none
      fauna: none
      main_subject: a lava fountain
      ground: hot crust
      water: none
      far_bank: none
      sky_and_light: ash
      absent: [water]
    pin: null

  - id: devonian
    t: 3.75e8
    chapter: shore
    shot: WATER_EDGE
    title: Devonian Estuary
    caption: An estuary.
    unsourced:
      o2_percent: 18
      mean_temp_c: 24
    subject:
      setting: A Devonian estuary
      left_mass: Archaeopteris trees
      vegetation: Archaeopteris
      fauna: lobe-finned fishes
      main_subject: a tetrapodomorph
      ground: mud
      water: brackish
      far_bank: bare upland
      sky_and_light: clear
      absent: [flowers, grass]
    pin: null

  - id: city
    t: 0
    chapter: shore
    shot: WATER_EDGE
    title: A City
    caption: A city.
    unsourced:
      o2_percent: 21
      mean_temp_c: 15
    subject:
      setting: A waterfront
      left_mass: towers
      vegetation: street trees
      fauna: gulls
      main_subject: a ferry
      ground: an embankment
      water: a river
      far_bank: a skyline
      sky_and_light: haze
      absent: [flying cars]
    pin: null
"""


CO2 = TimeSeries(
    id="co2",
    unit="ppm",
    interpolation=Interpolation.LOG_LINEAR,
    samples=[Sample(t=0.0, value=280.0), Sample(t=5.7e8, value=4000.0)],
)
DAY_LENGTH = TimeSeries(
    id="day_length",
    unit="hours",
    interpolation=Interpolation.LINEAR,
    samples=[Sample(t=0.0, value=24.0), Sample(t=4.567e9, value=6.0, lower=5.0, upper=7.0)],
)
SOLAR_LUMINOSITY = TimeSeries(
    id="solar_luminosity",
    unit="relative",
    interpolation=Interpolation.LINEAR,
    samples=[Sample(t=0.0, value=1.0), Sample(t=4.567e9, value=0.7)],
)
PALEODEM = RasterSequence(
    id="paleodem",
    frames=[
        RasterFrame(t=0.0, ref="textures/paleodem/0.png"),
        RasterFrame(t=1e8, ref="textures/paleodem/100.png"),
    ],
)
EVENTS = EventSet(
    id="events-core",
    events=[
        Event(
            id="kpg",
            label="K-Pg impact",
            kind=EventKind.MOMENT,
            t_min=6.6e7,
            t_max=6.61e7,
            t=6.605e7,
            tags=[EventTag.CATASTROPHE, EventTag.LIFE],
            importance=0.95,
            description="Chicxulub.",
            citation="Renne et al. 2013",
            effect=GlobeEffect(
                kind=GlobeEffectKind.IMPACT_WINTER,
                anchor=EffectAnchor(lat=21.3, lon=-89.5),
                windows=[EffectWindow(t_min=6.6e7, t_max=6.61e7)],
            ),
        )
    ],
)
SOURCE_MANIFESTS = {
    "astronomy": ("Analytic astronomy", "Laskar 2004", "n/a", "https://example.org/astro"),
    "co2-o2": ("GEOCARB III", "Berner 2001", "public domain", "https://example.org/co2"),
    "globe-regimes": (
        "Pre-1 Ga globe regimes",
        "Barboni et al. 2017",
        "n/a",
        "https://example.org/globe-regimes",
    ),
}


class FakeGenerator:
    """Reserves and settles in the real ledger, as every `ImageGenerator` must."""

    name = FAKE_GENERATOR
    version = FAKE_VERSION

    def __init__(self, backend: FakeBackend, ledger: Ledger, ledger_path: Path) -> None:
        self._backend = backend
        self._ledger = ledger
        self._ledger_path = ledger_path

    def estimate_usd(self, node: AssetNode) -> float:
        return ESTIMATE_USD

    def render(self, node: AssetNode) -> GeneratedImage:
        entry = self._ledger.reserve(node.id, self.name, 1, ESTIMATE_USD)
        self._ledger.save(self._ledger_path)
        self._backend.rendered.append(node.id)
        if node.id in self._backend.failing:
            self._ledger.settle(entry, 0.0)
            self._ledger.save(self._ledger_path)
            raise GenerationFailed(f"{node.id}: no image")
        self._ledger.settle(entry, self._backend.actual_usd)
        self._ledger.save(self._ledger_path)
        data = fake_png(len(self._backend.rendered))
        return GeneratedImage(
            data=data, info=sniff_image(data), usage=None, cost_usd=self._backend.actual_usd
        )


class FakeBackend:
    name = FAKE_GENERATOR
    version = FAKE_VERSION

    def __init__(self, actual_usd: float = ESTIMATE_USD, failing: frozenset[str] = frozenset()):
        self.actual_usd = actual_usd
        self.failing = failing
        self.rendered: list[str] = []
        self.opened = 0

    def estimate_usd(self, node: AssetNode) -> float:
        return ESTIMATE_USD

    @contextmanager
    def open(self, ledger: Ledger, ledger_path: Path, env_file: Path) -> Iterator[ImageGenerator]:
        self.opened += 1
        yield FakeGenerator(self, ledger, ledger_path)


def fake_png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 9), (seed * 37 % 256, seed * 91 % 256, 128)).save(buffer, "PNG")
    return buffer.getvalue()


def run_cli(backend: FakeBackend, root: Path, *args: str) -> tuple[int, str]:
    result = CliRunner().invoke(create_app(backend), ["--root", str(root), *args])
    if result.exception is not None and not isinstance(result.exception, SystemExit):
        raise result.exception
    return result.exit_code, result.output


def build_and_pick_all(backend: FakeBackend, root: Path) -> None:
    code, _ = run_cli(backend, root, "build", "--max-spend", "10", "--candidates", "1")
    assert code == 0
    for scene_id in ("hot-start", "devonian", "city"):
        assert run_cli(backend, root, "review", "pick", scene_id, "1")[0] == 0


# -- synthetic specimen plates -------------------------------------------------------------

SPECIMEN_SIZE = 512
SPECIMEN_CENTRE = (SPECIMEN_SIZE // 2, SPECIMEN_SIZE // 2)


def specimen_plate(
    peak: int,
    *,
    glow: int = 25,
    centre: tuple[int, int] = SPECIMEN_CENTRE,
    subject: tuple[int, int] = (300, 70),
) -> Image.Image:
    """A specimen-like plate: black rim, a soft central glow of `glow`, and an elliptical subject
    lit from just above the glow on one side to `peak` on the other."""
    distance = Image.radial_gradient("L").resize((SPECIMEN_SIZE, SPECIMEN_SIZE))  # 0 at the centre
    backdrop = distance.point(lambda v: round(glow * max(0.0, 1 - v / 180)))
    shade = glow + 5
    ramp = (
        Image.linear_gradient("L")
        .rotate(90)
        .resize(subject)
        .point(lambda v: round(shade + v * (peak - shade) / 255))
    )
    outline = Image.new("L", subject, 0)
    ImageDraw.Draw(outline).ellipse((0, 0, subject[0] - 1, subject[1] - 1), fill=255)
    backdrop.paste(ramp, (centre[0] - subject[0] // 2, centre[1] - subject[1] // 2), outline)
    return Image.merge("RGB", (backdrop, backdrop, backdrop))


def jpeg_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=100, subsampling=2)  # as the generator delivers plates
    return buffer.getvalue()


# -- mocked image-generator responses -------------------------------------------------------

Handler = Callable[[httpx.Request], httpx.Response]

USAGE_METADATA = {
    "promptTokenCount": 1200,
    "candidatesTokenCount": 1120,
    "candidatesTokensDetails": [{"modality": "IMAGE", "tokenCount": 1120}],
    "thoughtsTokenCount": 300,
    "totalTokenCount": 2620,
}


def png_header(width: int, height: int, tag: bytes = b"") -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + tag
    )


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def image_body(image: bytes, parts_before: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    parts = [*(parts_before or []), {"inlineData": {"mimeType": "image/png", "data": b64(image)}}]
    return {
        "candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}],
        "usageMetadata": USAGE_METADATA,
    }


def mock_generator(
    handler: Handler, ledger_path: Path, sleeps: list[float] | None = None
) -> GeminiImageGenerator:
    client = make_client("test-key", transport=httpx.MockTransport(handler))
    recorded = sleeps if sleeps is not None else []
    return GeminiImageGenerator(
        client, Ledger(ceiling_usd=18.0), ledger_path, sleep=recorded.append
    )
