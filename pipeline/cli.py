"""`earthtime`: plan, build, review and publish the scene images (DESIGN §9).

    earthtime plan
    earthtime build --only images --max-spend <USD> [--candidates 3] [--scene ID ...]
    earthtime review [sheet | pick <scene_id> <n> | clear <scene_id>]
    earthtime publish [--allow-unpinned]

The generator comes from pipeline/generators/registry.py; nothing here names a provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer

from pipeline.assets import SceneGraph, build_scene_graph
from pipeline.build import build_images, format_report
from pipeline.curated import load_world
from pipeline.generators.image import MissingCredentials
from pipeline.generators.registry import ImageBackend, image_backend
from pipeline.paths import ProjectPaths
from pipeline.plan import BuildPlan, format_plan, make_plan
from pipeline.publish import (
    PublishRefused,
    prepare_publication,
    unpinned_scene_ids,
    write_publication,
)
from pipeline.review import (
    ReviewError,
    clear_pin,
    format_reviews,
    pick_candidate,
    review_scenes,
    write_review_sheets,
)
from pipeline.scenes import SceneBook, UnknownScene, load_scene_book
from pipeline.spend import Ledger
from pipeline.store import CandidateStore

DEFAULT_CANDIDATES = 3


class BuildTarget(StrEnum):
    IMAGES = "images"


@dataclass(frozen=True)
class Workspace:
    paths: ProjectPaths
    book: SceneBook
    graph: SceneGraph
    store: CandidateStore


def create_app(backend: ImageBackend) -> typer.Typer:
    app = typer.Typer(add_completion=False, no_args_is_help=True, help=__doc__)
    review_app = typer.Typer(add_completion=False, invoke_without_command=True)
    app.add_typer(review_app, name="review", help="List, compare and pin candidates.")

    def workspace(ctx: typer.Context) -> Workspace:
        paths: ProjectPaths = ctx.obj
        book = load_scene_book(paths.scenes)
        graph = build_scene_graph(book, load_world(paths.curated), backend)
        return Workspace(
            paths=paths, book=book, graph=graph, store=CandidateStore(paths.candidates)
        )

    def plan_for(ws: Workspace, candidates: int, scene_ids: list[str] | None) -> BuildPlan:
        plan = make_plan(ws.graph, ws.store, backend.estimate_usd, candidates)
        return plan.select(scene_ids) if scene_ids else plan

    def fail(message: str) -> typer.Exit:
        typer.echo(message, err=True)
        return typer.Exit(1)

    @app.callback()
    def main(
        ctx: typer.Context,
        root: Annotated[Path, typer.Option(help="Project root.")] = Path("."),
    ) -> None:
        ctx.obj = ProjectPaths(root.resolve())

    @app.command()
    def plan(
        ctx: typer.Context,
        candidates: Annotated[int, typer.Option(min=1)] = DEFAULT_CANDIDATES,
        scene: Annotated[list[str] | None, typer.Option(help="Restrict to this scene.")] = None,
    ) -> None:
        """What is stale and what building it would cost. Spends nothing, calls nothing."""
        ws = workspace(ctx)
        try:
            build_plan = plan_for(ws, candidates, scene)
        except UnknownScene as err:
            raise fail(str(err)) from err
        typer.echo(format_plan(build_plan))
        if ws.paths.ledger.is_file():
            spent = Ledger.load(ws.paths.ledger).spent
            typer.echo(f"ledger {ws.paths.ledger.name}: ${spent:.2f} spent so far")
        else:
            typer.echo(f"ledger {ws.paths.ledger.name}: none yet")

    @app.command()
    def build(
        ctx: typer.Context,
        max_spend: Annotated[float, typer.Option("--max-spend", min=0.0, help="Ceiling, USD.")],
        only: Annotated[BuildTarget, typer.Option()] = BuildTarget.IMAGES,
        candidates: Annotated[int, typer.Option(min=1)] = DEFAULT_CANDIDATES,
        scene: Annotated[list[str] | None, typer.Option(help="Restrict to this scene.")] = None,
    ) -> None:
        """Generate candidates for stale scenes, sequentially, inside the spend ceiling."""
        ws = workspace(ctx)
        try:
            build_plan = plan_for(ws, candidates, scene)
        except UnknownScene as err:
            raise fail(str(err)) from err
        typer.echo(format_plan(build_plan))
        ledger = Ledger.load(ws.paths.ledger, ceiling_usd=max_spend)
        typer.echo(f"ledger: {ledger.summary()}")
        if not build_plan.stale:
            typer.echo(f"nothing stale to build ({only.value})")
            return
        if build_plan.estimate_usd > ledger.remaining:
            raise fail(
                f"REFUSED: estimate ${build_plan.estimate_usd:.2f} exceeds the "
                f"${ledger.remaining:.2f} remaining under --max-spend {max_spend:.2f}. "
                "Reduce the work (--scene, --candidates); never raise the ceiling."
            )
        try:
            with backend.open(ledger, ws.paths.ledger, ws.paths.env_file) as generator:
                report = build_images(build_plan, generator, ws.store, typer.echo)
        except MissingCredentials as err:
            raise fail(f"REFUSED: {err}") from err
        typer.echo(format_report(report))
        typer.echo(f"ledger: {ledger.summary()}")
        if not report.complete:
            raise typer.Exit(1)

    @review_app.callback()
    def review(ctx: typer.Context) -> None:
        """Each scene's candidates beside its predecessor and successor."""
        if ctx.invoked_subcommand is not None:
            return
        ws = workspace(ctx)
        plan = plan_for(ws, DEFAULT_CANDIDATES, None)
        typer.echo(format_reviews(review_scenes(ws.book, plan, ws.store), ws.paths.root))

    @review_app.command("sheet")
    def review_sheet(ctx: typer.Context) -> None:
        """Contact sheets (previous | candidates | next) and an overview strip."""
        ws = workspace(ctx)
        plan = plan_for(ws, DEFAULT_CANDIDATES, None)
        reviews = review_scenes(ws.book, plan, ws.store)
        written = write_review_sheets(reviews, ws.store, ws.paths.root, ws.paths.review)
        if not written:
            typer.echo("no candidates to put on a sheet")
        for path in written:
            typer.echo(str(path.relative_to(ws.paths.root)))

    @review_app.command("pick")
    def review_pick(ctx: typer.Context, scene_id: str, number: int) -> None:
        """Pin candidate NUMBER (as listed by `earthtime review`) for SCENE_ID."""
        paths: ProjectPaths = ctx.obj
        book = load_scene_book(paths.scenes)
        try:
            pin = pick_candidate(
                paths.scenes, book, CandidateStore(paths.candidates), paths.root, scene_id, number
            )
        except (ReviewError, UnknownScene) as err:
            raise fail(str(err)) from err
        typer.echo(f"pinned {scene_id}: {pin.asset_digest} {pin.path}")

    @review_app.command("clear")
    def review_clear(ctx: typer.Context, scene_id: str) -> None:
        """Remove SCENE_ID's pin, so the next build may regenerate it."""
        paths: ProjectPaths = ctx.obj
        try:
            pin = clear_pin(paths.scenes, load_scene_book(paths.scenes), scene_id)
        except (ReviewError, UnknownScene) as err:
            raise fail(str(err)) from err
        typer.echo(f"cleared {scene_id} (was {pin.asset_digest})")

    @app.command()
    def publish(
        ctx: typer.Context,
        allow_unpinned: Annotated[
            bool, typer.Option(help="Skip unpinned scenes instead of refusing.")
        ] = False,
    ) -> None:
        """Write data/media/manifest.json and the media it references."""
        paths: ProjectPaths = ctx.obj
        book = load_scene_book(paths.scenes)
        unpinned = unpinned_scene_ids(book)
        if unpinned and not allow_unpinned:
            raise fail(f"REFUSED: unpinned scenes: {', '.join(unpinned)}")
        if unpinned:
            typer.echo(f"WARNING: skipping unpinned scenes: {', '.join(unpinned)}", err=True)
        try:
            publication = prepare_publication(
                book, load_world(paths.curated), paths.sources, paths.root
            )
        except PublishRefused as err:
            raise fail(f"REFUSED: {err}") from err
        manifest_path = write_publication(publication, paths.media)
        manifest = publication.manifest
        typer.echo(
            f"wrote {manifest_path.relative_to(paths.root)} (build {manifest.build_id}): "
            f"{len(manifest.scenes)} scenes, {len(manifest.chapters)} chapters, "
            f"{len(manifest.layers)} layers, {len(manifest.events)} events, "
            f"{len(manifest.credits)} credits"
        )

    return app


app = create_app(image_backend())

if __name__ == "__main__":
    app()
