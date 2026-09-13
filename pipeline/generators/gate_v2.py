"""W6a gate v2: content-free style reference (A) against the style spec alone (B).

Three consecutive chapters, one camera. Variant A generates a single style reference that shows
no era at all, then renders each chapter conditioned on it. Variant B renders the identical
chapter prompts with no image. A human decides from the images; this script decides nothing.

    python -m pipeline.generators.gate_v2 --out-dir data/candidates/gate-v2 --ledger spend.json

Budget rules are hard-coded, not flags: an 18 USD ledger ceiling, at most nine paid calls (seven
images plus two retries), and one retry per image for a response without an image. Rate limits
back off inside the generator and never count as failures.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

from pipeline.curated import load_world
from pipeline.generators.gate import (
    GateStopped,
    PaidCallAllowance,
    image_node,
    render_with_one_retry,
)
from pipeline.generators.gemini import (
    MODEL_ID,
    GeminiImageGenerator,
    TokenUsage,
    load_api_key,
    make_client,
)
from pipeline.generators.image import ImageRequest, PartKind, PartOrder
from pipeline.generators.prompts import (
    Aridity,
    ChapterId,
    SceneContent,
    ScenePrompt,
    Shot,
    UnsourcedConditions,
    render_conditions,
    render_prompt,
    render_style_reference_prompt,
    render_style_referenced_prompt,
    render_subject,
)
from pipeline.graph import AssetNode
from pipeline.models import WorldModel
from pipeline.shapes import GeoTime
from pipeline.spend import BudgetExceeded, Ledger

GATE_CEILING_USD = 18.0
MAX_PAID_CALLS = 9
REPORT_NAME = "gate.json"
CONTACT_SHEET_NAME = "contact-sheet.jpg"
SHOT = Shot.WATER_EDGE

STYLE_REFERENCE_PART_ORDER = PartOrder.REFERENCE_FIRST
PART_ORDER_RATIONALE = (
    "Reference image first, then text. Gate v1 sent text then image, and its first scene came "
    "back as a near re-edit of the anchor: an image arriving after the instructions reads as the "
    "thing to edit. With the image first, the text that follows names it as a style reference "
    "only, and the full scene description is the last and longest instruction the model reads."
)

TILE_WIDTH = 640
LABEL_HEIGHT = 30
LABEL_FONT_SIZE = 18


class Variant(StrEnum):
    STYLE_REFERENCE = "A"
    STYLE_SPEC = "B"


@dataclass(frozen=True)
class ChapterShot:
    number: int
    slug: str
    label: str
    chapter: ChapterId
    t_years_bp: GeoTime
    unsourced: UnsourcedConditions
    content: SceneContent


_PALEOZOIC_ABSENT = (
    "flowers",
    "grass",
    "broadleaf trees",
    "palms",
    "dinosaurs",
    "mammals",
    "birds",
)

# CO2, day length and solar luminosity come from WorldState. O2, global mean temperature and
# aridity have no curated source yet, so they are hand-written here as rounded plausible values.
CHAPTERS: tuple[ChapterShot, ...] = (
    ChapterShot(
        number=1,
        slug="devonian",
        label="Devonian estuary, 380 Ma",
        chapter=ChapterId.DEVONIAN_ESTUARY,
        t_years_bp=3.8e8,
        unsourced=UnsourcedConditions(o2_percent=18, mean_temp_c=24, aridity=Aridity.SEMI_ARID),
        content=SceneContent(
            setting=(
                "A Late Devonian estuary where a river meets a shallow sea, on the coastal lowland "
                "of a bare continent"
            ),
            vegetation_mass=(
                "a stand of Archaeopteris, the first true trees: straight, slender trunks up to "
                "20 m tall carrying flat, horizontal sprays of fern-like foliage, open and airy "
                "with sky visible between the branches"
            ),
            shore=(
                "bare, wet grey-brown mud and sand with scattered low tufts of leafless green "
                "Psilophyton stems and small clubmosses, much bare ground between them"
            ),
            water="shallow, calm, slightly silty brackish water",
            main_subject=(
                "a Tiktaalik-like tetrapodomorph, a 2 m flat-headed lobe-finned fish with a "
                "crocodile-like head, resting in the shallows with its head and front fins raised "
                "out of the water"
            ),
            far_bank=(
                "a low, barren upland of thin rocky soil, grey and ochre, with only faint patches "
                "of low green and no forest"
            ),
            absent=(*_PALEOZOIC_ABSENT, "conifers", "cycads", "flying insects"),
        ),
    ),
    ChapterShot(
        number=2,
        slug="carboniferous",
        label="Carboniferous swamp, 310 Ma",
        chapter=ChapterId.CARBONIFEROUS_SWAMP,
        t_years_bp=3.1e8,
        unsourced=UnsourcedConditions(o2_percent=32, mean_temp_c=16, aridity=Aridity.HUMID),
        content=SceneContent(
            setting="A Late Carboniferous coal swamp on a hot, wet lowland near the equator",
            vegetation_mass=(
                "a dense wall of towering Lepidodendron and Sigillaria lycopsid trees, 30 m "
                "pole-like trunks patterned with diamond-shaped leaf scars and topped by forked "
                "crowns of long grass-like leaves, with giant Calamites horsetails 10 m tall and "
                "Psaronius tree ferns packed beneath, dark inside"
            ),
            shore=(
                "fallen, rotting lycopsid trunks half sunk in black mud, crowded with ferns and "
                "seed-fern fronds"
            ),
            water="still, black, tannin-dark standing swamp water, glassy, with floating debris",
            main_subject=(
                "a Meganeura, a giant griffinfly with a 70 cm wingspan, hovering low over the "
                "water, and beneath it an Arthropleura, a 2 m armoured millipede, crawling along a "
                "fallen log at the water's edge"
            ),
            far_bank="more swamp forest of lycopsid poles fading into the humid haze",
            absent=(*_PALEOZOIC_ABSENT, "conifers"),
        ),
    ),
    ChapterShot(
        number=3,
        slug="permian",
        label="Permian interior, 260 Ma",
        chapter=ChapterId.PERMIAN_INTERIOR,
        t_years_bp=2.6e8,
        unsourced=UnsourcedConditions(o2_percent=26, mean_temp_c=20, aridity=Aridity.ARID),
        content=SceneContent(
            setting=(
                "The arid interior of the supercontinent Pangaea in the Middle Permian, far from "
                "any sea"
            ),
            vegetation_mass=(
                "a sparse, ragged stand of Walchia-like early conifers and Glossopteris trees "
                "clinging to the river bank, dusty grey-green, several dead and leafless, open "
                "ground visible between the trunks"
            ),
            shore=(
                "cracked red mud and dry banks of layered red sandstone and mudstone, bare of "
                "plants"
            ),
            water="a shallow, shrinking seasonal river, opaque red-brown with silt",
            main_subject=(
                "two Moschops-like dinocephalians, massive barrel-bodied synapsids about 3 m long "
                "with thick skulls and sprawling limbs, standing in the shallows, one drinking"
            ),
            far_bank="flat-lying red beds and low dunes, bare to the horizon under dust",
            absent=(*_PALEOZOIC_ABSENT, "swamp forest", "lush green vegetation"),
        ),
    ),
)

STYLE_REFERENCE_CHAPTER = "style-reference"


class GateV2Record(BaseModel):
    file: str
    node_id: str
    variant: Variant
    chapter: str
    t_years_bp: GeoTime | None  # None for the style reference, which depicts no time
    model_id: str
    prompt: str
    part_order: list[PartKind]
    conditioned_on_reference: bool
    reference: str | None
    mime_type: str
    width: int
    height: int
    usage: TokenUsage | None
    cost_usd: float
    asset_digest: str
    attempts: int


class GateV2Report(BaseModel):
    part_order_rationale: str
    images: list[GateV2Record]


@dataclass(frozen=True)
class Tile:
    path: Path | None  # None leaves the cell blank, label only
    label: str


def scene_prompt(shot: ChapterShot, world: WorldModel) -> ScenePrompt:
    return ScenePrompt(
        shot=SHOT,
        chapter=shot.chapter,
        conditions=render_conditions(world.at(shot.t_years_bp), shot.unsourced),
        subject=render_subject(shot.content),
    )


def file_stem(variant: Variant, number: int, slug: str) -> str:
    return f"{variant.value}-{number:02d}-{slug}"


def style_reference_node(generator: GeminiImageGenerator) -> AssetNode:
    stem = file_stem(Variant.STYLE_REFERENCE, 0, STYLE_REFERENCE_CHAPTER)
    return image_node(f"gate-v2-{stem}", generator, {"prompt": render_style_reference_prompt(SHOT)})


def referenced_scene_node(
    generator: GeminiImageGenerator,
    shot: ChapterShot,
    scene: ScenePrompt,
    reference: AssetNode,
    reference_path: Path,
) -> AssetNode:
    """Conditioned on the style reference only, never on another scene (ADR-004)."""
    node = image_node(
        f"gate-v2-{file_stem(Variant.STYLE_REFERENCE, shot.number, shot.slug)}",
        generator,
        {
            "prompt": render_style_referenced_prompt(scene),
            "reference": {
                "path": str(reference_path),
                "part_order": STYLE_REFERENCE_PART_ORDER.value,
            },
        },
    )
    return node.model_copy(update={"depends_on": [reference.id]})


def spec_only_scene_node(
    generator: GeminiImageGenerator, shot: ChapterShot, scene: ScenePrompt
) -> AssetNode:
    return image_node(
        f"gate-v2-{file_stem(Variant.STYLE_SPEC, shot.number, shot.slug)}",
        generator,
        {"prompt": render_prompt(scene)},
    )


def run_gate_v2(generator: GeminiImageGenerator, world: WorldModel, out_dir: Path) -> GateV2Report:
    out_dir.mkdir(parents=True, exist_ok=True)
    if any(out_dir.iterdir()):
        raise GateStopped(f"{out_dir} is not empty; refusing to overwrite or re-spend")
    # Every prompt is rendered before the first paid call, so absent world data costs nothing.
    scenes = [(shot, scene_prompt(shot, world)) for shot in CHAPTERS]
    allowance = PaidCallAllowance(MAX_PAID_CALLS)
    report = GateV2Report(part_order_rationale=PART_ORDER_RATIONALE, images=[])

    def produce(
        node: AssetNode, variant: Variant, number: int, chapter: str, t: GeoTime | None
    ) -> Path:
        image, attempts = render_with_one_retry(generator, node, allowance)
        path = out_dir / f"{file_stem(variant, number, chapter)}{image.info.extension}"
        path.write_bytes(image.data)
        request = ImageRequest.from_node(node)
        report.images.append(
            GateV2Record(
                file=path.name,
                node_id=node.id,
                variant=variant,
                chapter=chapter,
                t_years_bp=t,
                model_id=generator.version,
                prompt=request.prompt,
                part_order=list(request.part_kinds),
                conditioned_on_reference=request.reference is not None,
                reference=None if request.reference is None else request.reference.path.name,
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
            f"{image.info.mime_type} ${image.cost_usd:.4f} (attempts {attempts})"
        )
        return path

    reference = style_reference_node(generator)
    reference_path = produce(reference, Variant.STYLE_REFERENCE, 0, STYLE_REFERENCE_CHAPTER, None)
    a_paths = [
        produce(
            referenced_scene_node(generator, shot, scene, reference, reference_path),
            Variant.STYLE_REFERENCE,
            shot.number,
            shot.slug,
            shot.t_years_bp,
        )
        for shot, scene in scenes
    ]
    b_paths = [
        produce(
            spec_only_scene_node(generator, shot, scene),
            Variant.STYLE_SPEC,
            shot.number,
            shot.slug,
            shot.t_years_bp,
        )
        for shot, scene in scenes
    ]
    write_contact_sheet(
        [
            [
                Tile(reference_path, "A-00 style reference"),
                *(Tile(p, f"A-{s.number:02d} {s.label}") for s, p in zip(CHAPTERS, a_paths)),
            ],
            [
                Tile(None, "B: style spec only, no reference"),
                *(Tile(p, f"B-{s.number:02d} {s.label}") for s, p in zip(CHAPTERS, b_paths)),
            ],
        ],
        out_dir / CONTACT_SHEET_NAME,
    )
    return report


def write_contact_sheet(rows: Sequence[Sequence[Tile]], path: Path) -> None:
    """A grid of TILE_WIDTH-wide thumbnails, each with its label in a strip beneath it."""
    thumbnails = {
        tile.path: _thumbnail(tile.path) for row in rows for tile in row if tile.path is not None
    }
    image_height = max(thumb.height for thumb in thumbnails.values())
    cell_height = image_height + LABEL_HEIGHT
    columns = max(len(row) for row in rows)
    sheet = Image.new("RGB", (columns * TILE_WIDTH, len(rows) * cell_height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=LABEL_FONT_SIZE)
    for row_index, row in enumerate(rows):
        for column_index, tile in enumerate(row):
            x, y = column_index * TILE_WIDTH, row_index * cell_height
            if tile.path is not None:
                sheet.paste(thumbnails[tile.path], (x, y))
            draw.text((x + 8, y + image_height + 5), tile.label, fill="black", font=font)
    sheet.save(path, "JPEG", quality=90)


def _thumbnail(path: Path) -> Image.Image:
    with Image.open(path) as source:
        rgb = source.convert("RGB")
    height = round(TILE_WIDTH * rgb.height / rgb.width)
    return rgb.resize((TILE_WIDTH, height), Image.Resampling.LANCZOS)


app = typer.Typer(add_completion=False)


@app.command()
def main(
    out_dir: Annotated[Path, typer.Option()] = Path("data/candidates/gate-v2"),
    ledger_path: Annotated[Path, typer.Option("--ledger")] = Path("spend.json"),
    env_file: Annotated[Path, typer.Option()] = Path(".env"),
    curated_dir: Annotated[Path, typer.Option()] = Path("data/curated"),
) -> None:
    world = load_world(curated_dir)
    ledger = Ledger.load(ledger_path, ceiling_usd=GATE_CEILING_USD)
    typer.echo(f"model {MODEL_ID}; ledger {ledger.summary()}")
    with make_client(load_api_key(env_file)) as client:
        generator = GeminiImageGenerator(client, ledger, ledger_path)
        try:
            run_gate_v2(generator, world, out_dir)
        except (BudgetExceeded, GateStopped) as err:
            typer.echo(f"STOPPED: {err}", err=True)
            typer.echo(f"ledger {ledger.summary()}", err=True)
            raise typer.Exit(1) from err
    typer.echo(f"done; ledger {ledger.summary()}")


if __name__ == "__main__":
    app()
