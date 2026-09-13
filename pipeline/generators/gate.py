"""W6a anchor gate: one era anchor plus three scenes conditioned on it, then stop.

Tests ADR-004's assumption that anchor conditioning holds a recognisable photographic look
across scenes. A human decides go / no-go from the images; this script decides nothing.

    python -m pipeline.generators.gate --out-dir data/candidates/gate --ledger spend.json

Budget rules are hard-coded, not flags: an 18 USD ledger ceiling, at most six paid calls, and
one retry per image for a response without an image. Rate limits back off inside the generator
and never count as failures.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import typer
from pydantic import BaseModel

from pipeline.generators.gemini import (
    MODEL_ID,
    GeminiImageGenerator,
    GeneratedImage,
    GenerationFailed,
    TokenUsage,
    load_api_key,
    make_client,
)
from pipeline.generators.image import PROJECT_ASPECT_RATIO, PROJECT_IMAGE_SIZE, ImageRequest
from pipeline.generators.prompts import (
    ChapterId,
    ScenePrompt,
    Shot,
    render_conditioned_prompt,
    render_prompt,
)
from pipeline.graph import AssetKind, AssetNode
from pipeline.spend import BudgetExceeded, Ledger

GATE_CEILING_USD = 18.0
MAX_PAID_CALLS = 6
ATTEMPTS_PER_IMAGE = 2
REPORT_NAME = "gate.json"


class GateStopped(RuntimeError):
    """The gate hit one of its own stop rules. Report it; do not work around it."""


@dataclass(frozen=True)
class GateShot:
    slug: str
    t_years_bp: float
    scene: ScenePrompt


def _mesozoic(conditions: str, subject: str) -> ScenePrompt:
    return ScenePrompt(
        shot=Shot.WATER_EDGE, chapter=ChapterId.MESOZOIC, conditions=conditions, subject=subject
    )


# Conditions are hand-written for the gate because curated data is not merged yet. In W6 they
# come from render_conditions(WorldState.at(t)); only the subjects stay curated text.
ANCHOR = GateShot(
    slug="anchor",
    t_years_bp=1.70e8,
    scene=_mesozoic(
        conditions=(
            "Middle Jurassic, about 170 million years ago. A greenhouse world with no polar ice, "
            "warm and humid. The sky is a pale blue softened by light warm haze, with scattered "
            "fair-weather cumulus. The air is visibly moist and the far shore slightly veiled."
        ),
        subject=(
            "A lagoon shore on a warm coastal lowland. The vegetation mass is a stand of tall "
            "araucarian conifers over tree ferns and cycads. Two long-necked sauropod dinosaurs "
            "stand at the waterline, one lowering its head to drink. Horsetails line the shore."
        ),
    ),
)

SCENES: tuple[GateShot, ...] = (
    GateShot(
        slug="late-triassic",
        t_years_bp=2.15e8,
        scene=_mesozoic(
            conditions=(
                "Late Triassic, about 215 million years ago, deep in the interior of the "
                "supercontinent Pangaea. Hot and strongly seasonal, at the end of the dry season. "
                "Glaring light even this late in the day; the sky a pale, washed-out blue whitened "
                "by fine dust, cloudless. Heat shimmer over the far shore."
            ),
            subject=(
                "The shallow margin of a seasonal lake on a red mudflat. The vegetation mass is "
                "a stand of early conifers and horsetails, partly dry and brown-green. Three "
                "Plateosaurus, bipedal early sauropodomorphs, stand at the waterline. The eyes "
                "and snout of a phytosaur break the water surface. Cracked red mud along the shore."
            ),
        ),
    ),
    GateShot(
        slug="late-jurassic",
        t_years_bp=1.50e8,
        scene=_mesozoic(
            conditions=(
                "Late Jurassic, about 150 million years ago. Warm, semi-arid and seasonal, early "
                "in the wet season. A clear, deep blue sky with high thin cirrus and a bank of "
                "building cumulus on the horizon. Crisp air with moderate distance haze."
            ),
            subject=(
                "The bank of a broad braided river crossing a floodplain. The vegetation mass is "
                "a gallery forest of tall conifers over a ginkgo and cycad understory. A "
                "Brachiosaurus wades at the waterline; a Diplodocus stands on a sandbar behind "
                "it. Low fern prairie on the far bank."
            ),
        ),
    ),
    GateShot(
        slug="late-cretaceous",
        t_years_bp=6.8e7,
        scene=_mesozoic(
            conditions=(
                "Late Cretaceous, about 68 million years ago, on the coastal plain of a shallow "
                "inland seaway. A hot, humid hothouse climate. Heavy milky haze, towering cumulus "
                "clouds, soft diffused warm light, the air thick with humidity."
            ),
            subject=(
                "The edge of a swampy estuary. The vegetation mass is a subtropical forest of "
                "flowering broadleaf trees, palms and bald cypress. A small herd of "
                "Edmontosaurus, duck-billed dinosaurs, stands at the waterline, one wading. "
                "Reeds and water lilies along the near shore."
            ),
        ),
    ),
)


class GateRecord(BaseModel):
    file: str
    slug: str
    t_years_bp: float
    model_id: str
    prompt: str
    conditioned_on_anchor: bool
    reference: str | None
    mime_type: str
    width: int
    height: int
    usage: TokenUsage | None
    cost_usd: float
    asset_digest: str
    attempts: int


class GateReport(BaseModel):
    images: list[GateRecord]


class PaidCallAllowance:
    def __init__(self, calls: int) -> None:
        self._remaining = calls

    def take(self) -> None:
        if self._remaining == 0:
            raise GateStopped(f"paid-call cap of {MAX_PAID_CALLS} reached")
        self._remaining -= 1


def image_node(node_id: str, generator: GeminiImageGenerator, inputs: dict[str, str]) -> AssetNode:
    return AssetNode(
        id=node_id,
        kind=AssetKind.IMAGE,
        generator=generator.name,
        generator_version=generator.version,
        inputs=inputs,
        config={"aspect_ratio": PROJECT_ASPECT_RATIO, "image_size": PROJECT_IMAGE_SIZE.value},
    )


def anchor_node(generator: GeminiImageGenerator) -> AssetNode:
    return image_node(f"gate-{ANCHOR.slug}", generator, {"prompt": render_prompt(ANCHOR.scene)})


def scene_node(
    generator: GeminiImageGenerator, shot: GateShot, anchor: AssetNode, anchor_path: Path
) -> AssetNode:
    """Conditioned on the anchor only, never on a previous scene (ADR-004)."""
    node = image_node(
        f"gate-{shot.slug}",
        generator,
        {"prompt": render_conditioned_prompt(shot.scene), "reference": str(anchor_path)},
    )
    return node.model_copy(update={"depends_on": [anchor.id]})


def render_with_one_retry(
    generator: GeminiImageGenerator, node: AssetNode, allowance: PaidCallAllowance
) -> tuple[GeneratedImage, int]:
    for attempt in range(1, ATTEMPTS_PER_IMAGE + 1):
        allowance.take()
        try:
            return generator.render(node), attempt
        except GenerationFailed as err:
            if attempt == ATTEMPTS_PER_IMAGE:
                raise GateStopped(f"{node.id} failed {attempt} times, stopping: {err}") from err
            typer.echo(f"{node.id}: {err} — retrying once", err=True)
    raise AssertionError("unreachable: the loop returns or raises")


def run_gate(generator: GeminiImageGenerator, out_dir: Path) -> GateReport:
    out_dir.mkdir(parents=True, exist_ok=True)
    if any(out_dir.iterdir()):
        raise GateStopped(f"{out_dir} is not empty; refusing to overwrite or re-spend")
    allowance = PaidCallAllowance(MAX_PAID_CALLS)
    report = GateReport(images=[])

    def produce(index: int, shot: GateShot, node: AssetNode) -> Path:
        image, attempts = render_with_one_retry(generator, node, allowance)
        path = out_dir / f"{index:02d}-{shot.slug}{image.info.extension}"
        path.write_bytes(image.data)
        request = ImageRequest.from_node(node)
        report.images.append(
            GateRecord(
                file=path.name,
                slug=shot.slug,
                t_years_bp=shot.t_years_bp,
                model_id=generator.version,
                prompt=request.prompt,
                conditioned_on_anchor=request.reference is not None,
                reference=None if request.reference is None else request.reference.name,
                mime_type=image.info.mime_type,
                width=image.info.width,
                height=image.info.height,
                usage=image.usage,
                cost_usd=image.cost_usd,
                asset_digest=image.digest,
                attempts=attempts,
            )
        )
        (out_dir / REPORT_NAME).write_text(report.model_dump_json(indent=2))
        typer.echo(
            f"{path.name}: {image.info.width}x{image.info.height} "
            f"{image.info.mime_type} ${image.cost_usd:.4f}"
        )
        return path

    anchor = anchor_node(generator)
    anchor_path = produce(0, ANCHOR, anchor)
    for index, shot in enumerate(SCENES, start=1):
        produce(index, shot, scene_node(generator, shot, anchor, anchor_path))
    return report


app = typer.Typer(add_completion=False)


@app.command()
def main(
    out_dir: Annotated[Path, typer.Option()] = Path("data/candidates/gate"),
    ledger_path: Annotated[Path, typer.Option("--ledger")] = Path("spend.json"),
    env_file: Annotated[Path, typer.Option()] = Path(".env"),
) -> None:
    ledger = Ledger.load(ledger_path, ceiling_usd=GATE_CEILING_USD)
    typer.echo(f"model {MODEL_ID}; ledger {ledger.summary()}")
    with make_client(load_api_key(env_file)) as client:
        generator = GeminiImageGenerator(client, ledger, ledger_path)
        try:
            run_gate(generator, out_dir)
        except (BudgetExceeded, GateStopped) as err:
            typer.echo(f"STOPPED: {err}", err=True)
            typer.echo(f"ledger {ledger.summary()}", err=True)
            raise typer.Exit(1) from err
    typer.echo(f"done; ledger {ledger.summary()}")


if __name__ == "__main__":
    app()
