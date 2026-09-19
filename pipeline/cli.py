"""`earthtime`: plan, build, review and publish scene images and ancestor portraits (DESIGN §9).

    earthtime plan [--candidates 3] [--scene ID ...] [--portrait-candidates 1] [--node ID ...]
    earthtime build --max-spend <USD> [--only images|portraits] [--candidates N]
                    [--scene ID ... | --node ID ...]
    earthtime review [sheet | pick <scene_id> <n> | clear <scene_id>]
    earthtime review portraits [sheet | pick <node_id> <n> | clear <node_id>]
    earthtime morph
    earthtime publish [--allow-unpinned] [--asset-base URL]

The generator comes from pipeline/generators/registry.py; nothing here names a provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer

from pipeline.assets import SceneGraph, build_scene_graph
from pipeline.build import ImageJob, build_images, format_report
from pipeline.curated import load_world
from pipeline.generators.image import MissingCredentials
from pipeline.generators.registry import ImageBackend, image_backend
from pipeline.models import WorldModel
from pipeline.paths import ProjectPaths
from pipeline.plan import (
    BuildPlan,
    PortraitBuildPlan,
    format_plan,
    format_portrait_plan,
    make_plan,
    make_portrait_plan,
)
from pipeline.portraits import (
    LINEAGE_TREE_ID,
    MorphKey,
    PortraitBook,
    PortraitGraph,
    UnknownPortrait,
    build_portrait_graph,
    load_morph,
    load_portrait_book,
    pinned_pairs,
)
from pipeline.publish import (
    ASSET_BASE,
    PortraitInputs,
    PortraitPublication,
    PublishRefused,
    prepare_publication,
    unpinned_scene_ids,
    write_publication,
)
from pipeline.review import (
    ReviewError,
    clear_pin,
    clear_portrait_pin,
    format_portrait_reviews,
    format_reviews,
    pick_candidate,
    pick_portrait,
    review_portraits,
    review_scenes,
    write_portrait_review_sheets,
    write_review_sheets,
)
from pipeline.scenes import SceneBook, UnknownScene, load_scene_book
from pipeline.shapes import Tree
from pipeline.spend import Ledger
from pipeline.store import CandidateStore


class BuildTarget(StrEnum):
    IMAGES = "images"
    PORTRAITS = "portraits"


# Portraits default to one candidate: 42 plates at three each would spend most of a small
# budget before the style gate (VISUAL_SPEC §10) has approved the look.
DEFAULT_CANDIDATES = {BuildTarget.IMAGES: 3, BuildTarget.PORTRAITS: 1}


@dataclass(frozen=True)
class Workspace:
    paths: ProjectPaths
    world: WorldModel
    book: SceneBook
    graph: SceneGraph
    store: CandidateStore


@dataclass(frozen=True)
class PortraitWorkspace:
    paths: ProjectPaths
    tree: Tree
    book: PortraitBook
    graph: PortraitGraph
    store: CandidateStore


def create_app(backend: ImageBackend) -> typer.Typer:
    app = typer.Typer(add_completion=False, no_args_is_help=True, help=__doc__)
    review_app = typer.Typer(add_completion=False, invoke_without_command=True)
    app.add_typer(review_app, name="review", help="List, compare and pin candidates.")
    portraits_app = typer.Typer(add_completion=False, invoke_without_command=True)
    review_app.add_typer(
        portraits_app, name="portraits", help="List, compare and pin ancestor portraits."
    )

    def fail(message: str) -> typer.Exit:
        typer.echo(message, err=True)
        return typer.Exit(1)

    def workspace(ctx: typer.Context) -> Workspace:
        paths: ProjectPaths = ctx.obj
        book = load_scene_book(paths.scenes)
        world = load_world(paths.curated)
        graph = build_scene_graph(book, world, backend)
        return Workspace(
            paths=paths,
            world=world,
            book=book,
            graph=graph,
            store=CandidateStore(paths.candidates),
        )

    def portrait_workspace(paths: ProjectPaths, world: WorldModel) -> PortraitWorkspace:
        if not paths.portraits.is_file():
            raise fail(f"REFUSED: {paths.portraits.relative_to(paths.root)} does not exist")
        tree = world.trees.get(LINEAGE_TREE_ID)
        if tree is None:
            raise fail(f"REFUSED: no curated {LINEAGE_TREE_ID!r} tree; run `make data`")
        book = load_portrait_book(paths.portraits)
        return PortraitWorkspace(
            paths=paths,
            tree=tree,
            book=book,
            graph=build_portrait_graph(book, tree, backend),
            store=CandidateStore(paths.portrait_candidates),
        )

    def plan_for(ws: Workspace, candidates: int, scene_ids: list[str] | None) -> BuildPlan:
        plan = make_plan(ws.graph, ws.store, backend.estimate_usd, candidates)
        return plan.select(scene_ids) if scene_ids else plan

    def portrait_plan_for(
        pws: PortraitWorkspace, candidates: int, node_ids: list[str] | None
    ) -> PortraitBuildPlan:
        plan = make_portrait_plan(pws.graph, pws.store, backend.estimate_usd, candidates)
        return plan.select(node_ids) if node_ids else plan

    @app.callback()
    def main(
        ctx: typer.Context,
        root: Annotated[Path, typer.Option(help="Project root.")] = Path("."),
    ) -> None:
        ctx.obj = ProjectPaths(root.resolve())

    @app.command()
    def plan(
        ctx: typer.Context,
        candidates: Annotated[int, typer.Option(min=1)] = DEFAULT_CANDIDATES[BuildTarget.IMAGES],
        scene: Annotated[list[str] | None, typer.Option(help="Restrict to this scene.")] = None,
        portrait_candidates: Annotated[int, typer.Option(min=1)] = DEFAULT_CANDIDATES[
            BuildTarget.PORTRAITS
        ],
        node: Annotated[
            list[str] | None, typer.Option(help="Restrict portraits to this lineage node.")
        ] = None,
    ) -> None:
        """What is stale and what building it would cost. Spends nothing, calls nothing."""
        ws = workspace(ctx)
        try:
            build_plan = plan_for(ws, candidates, scene)
        except UnknownScene as err:
            raise fail(str(err)) from err
        typer.echo(format_plan(build_plan))
        typer.echo("")
        if ws.paths.portraits.is_file():
            pws = portrait_workspace(ws.paths, ws.world)
            try:
                typer.echo(format_portrait_plan(portrait_plan_for(pws, portrait_candidates, node)))
            except UnknownPortrait as err:
                raise fail(str(err)) from err
        else:
            typer.echo(f"portraits: {ws.paths.portraits.relative_to(ws.paths.root)} not present")
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
        candidates: Annotated[
            int | None,
            typer.Option(
                min=1, help="Candidates per image; default 3 for images, 1 for portraits."
            ),
        ] = None,
        scene: Annotated[list[str] | None, typer.Option(help="Restrict to this scene.")] = None,
        node: Annotated[
            list[str] | None, typer.Option(help="Restrict portraits to this lineage node.")
        ] = None,
    ) -> None:
        """Generate candidates for stale scenes or portraits, sequentially, inside the ceiling."""
        count = candidates if candidates is not None else DEFAULT_CANDIDATES[only]
        ws = workspace(ctx)
        jobs: tuple[ImageJob, ...]
        match only:
            case BuildTarget.IMAGES:
                if node:
                    raise fail("REFUSED: --node selects portraits; use --only portraits")
                try:
                    scene_plan = plan_for(ws, count, scene)
                except UnknownScene as err:
                    raise fail(str(err)) from err
                typer.echo(format_plan(scene_plan))
                jobs, estimate, store, noun = (
                    scene_plan.stale,
                    scene_plan.estimate_usd,
                    ws.store,
                    "scenes",
                )
            case BuildTarget.PORTRAITS:
                if scene:
                    raise fail("REFUSED: --scene selects scenes; use --only images")
                pws = portrait_workspace(ws.paths, ws.world)
                try:
                    portrait_plan = portrait_plan_for(pws, count, node)
                except UnknownPortrait as err:
                    raise fail(str(err)) from err
                typer.echo(format_portrait_plan(portrait_plan))
                jobs, estimate, store, noun = (
                    portrait_plan.stale,
                    portrait_plan.estimate_usd,
                    pws.store,
                    "portraits",
                )
        ledger = Ledger.load(ws.paths.ledger, ceiling_usd=max_spend)
        typer.echo(f"ledger: {ledger.summary()}")
        if not jobs:
            typer.echo(f"nothing stale to build ({only.value})")
            return
        if estimate > ledger.remaining:
            raise fail(
                f"REFUSED: estimate ${estimate:.2f} exceeds the "
                f"${ledger.remaining:.2f} remaining under --max-spend {max_spend:.2f}. "
                "Reduce the work (--scene, --node, --candidates); never raise the ceiling."
            )
        try:
            with backend.open(ledger, ws.paths.ledger, ws.paths.env_file) as generator:
                report = build_images(jobs, count, generator, store, typer.echo)
        except MissingCredentials as err:
            raise fail(f"REFUSED: {err}") from err
        typer.echo(format_report(report, noun))
        typer.echo(f"ledger: {ledger.summary()}")
        if not report.complete:
            raise typer.Exit(1)

    @review_app.callback()
    def review(ctx: typer.Context) -> None:
        """Each scene's candidates beside its predecessor and successor."""
        if ctx.invoked_subcommand is not None:
            return
        ws = workspace(ctx)
        plan = plan_for(ws, DEFAULT_CANDIDATES[BuildTarget.IMAGES], None)
        typer.echo(format_reviews(review_scenes(ws.book, plan, ws.store), ws.paths.root))

    @review_app.command("sheet")
    def review_sheet(ctx: typer.Context) -> None:
        """Contact sheets (previous | candidates | next) and an overview strip."""
        ws = workspace(ctx)
        plan = plan_for(ws, DEFAULT_CANDIDATES[BuildTarget.IMAGES], None)
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

    def reviewed_portraits(ctx: typer.Context) -> tuple[PortraitWorkspace, PortraitBuildPlan]:
        paths: ProjectPaths = ctx.obj
        pws = portrait_workspace(paths, load_world(paths.curated))
        return pws, portrait_plan_for(pws, DEFAULT_CANDIDATES[BuildTarget.PORTRAITS], None)

    @portraits_app.callback()
    def review_portrait_list(ctx: typer.Context) -> None:
        """Each portrait's candidates beside its older and younger neighbours on the lineage."""
        if ctx.invoked_subcommand is not None:
            return
        pws, plan = reviewed_portraits(ctx)
        reviews = review_portraits(pws.graph, plan, pws.store)
        typer.echo(format_portrait_reviews(reviews, pws.paths.root))

    @portraits_app.command("sheet")
    def review_portrait_sheet(ctx: typer.Context) -> None:
        """Contact sheets (older | candidates | younger) and an overview grid in lineage order."""
        pws, plan = reviewed_portraits(ctx)
        reviews = review_portraits(pws.graph, plan, pws.store)
        written = write_portrait_review_sheets(
            reviews, pws.store, pws.paths.root, pws.paths.portrait_review
        )
        if not written:
            typer.echo("no portrait candidates to put on a sheet")
        for path in written:
            typer.echo(str(path.relative_to(pws.paths.root)))

    @portraits_app.command("pick")
    def review_portrait_pick(ctx: typer.Context, node_id: str, number: int) -> None:
        """Pin candidate NUMBER (as listed by `earthtime review portraits`) for NODE_ID."""
        paths: ProjectPaths = ctx.obj
        book = load_portrait_book(paths.portraits)
        try:
            pin = pick_portrait(
                paths.portraits,
                book,
                CandidateStore(paths.portrait_candidates),
                paths.root,
                node_id,
                number,
            )
        except (ReviewError, UnknownPortrait) as err:
            raise fail(str(err)) from err
        typer.echo(f"pinned portrait {node_id}: {pin.asset_digest} {pin.path}")

    @portraits_app.command("clear")
    def review_portrait_clear(ctx: typer.Context, node_id: str) -> None:
        """Remove NODE_ID's portrait pin, so the next portrait build may regenerate it."""
        paths: ProjectPaths = ctx.obj
        try:
            pin = clear_portrait_pin(paths.portraits, load_portrait_book(paths.portraits), node_id)
        except (ReviewError, UnknownPortrait) as err:
            raise fail(str(err)) from err
        typer.echo(f"cleared portrait {node_id} (was {pin.asset_digest})")

    @app.command()
    def morph(ctx: typer.Context) -> None:
        """Flow fields between consecutive pinned portraits. Local and free."""
        # OpenCV and numpy are core dependencies (ADR-015: `pipeline.exposure` needs them directly
        # too), but the import stays deferred and defensive so a broken
        # installation fails with a clear message here rather than at CLI start-up.
        try:
            from pipeline.morph import MorphError, write_morph
        except ModuleNotFoundError as err:
            raise fail(f"REFUSED: {err}; install with: pip install -e .") from err
        paths: ProjectPaths = ctx.obj
        pws = portrait_workspace(paths, load_world(paths.curated))
        pairs = pinned_pairs(pws.book, pws.tree)
        if not pairs:
            typer.echo("no two consecutive pinned portraits to morph between")
        for older, younger in pairs:
            key = MorphKey.between(older, younger)
            if load_morph(paths.portrait_morphs, key) is not None:
                typer.echo(f"{older.id} -> {younger.id}: cached")
                continue
            assert older.pin is not None and younger.pin is not None, key
            try:
                record = write_morph(
                    paths.portrait_morphs,
                    key,
                    paths.root / older.pin.path,
                    paths.root / younger.pin.path,
                )
            except MorphError as err:
                raise fail(f"{older.id} -> {younger.id}: {err}") from err
            if record.fallback_dissolve:
                typer.echo(
                    f"{older.id} -> {younger.id}: falls back to a plain dissolve "
                    "(flow incoherence exceeded the threshold)"
                )
            else:
                typer.echo(
                    f"{older.id} -> {younger.id}: computed (range {record.forward_range:.4f} / "
                    f"{record.backward_range:.4f})"
                )

    @app.command()
    def publish(
        ctx: typer.Context,
        allow_unpinned: Annotated[
            bool, typer.Option(help="Skip unpinned scenes instead of refusing.")
        ] = False,
        asset_base: Annotated[
            str,
            typer.Option(
                help="Origin the manifest's media paths hang off, e.g. https://media.example.org. "
                "Defaults to the local dev server's own /media.",
            ),
        ] = ASSET_BASE,
    ) -> None:
        """Write data/media/manifest.json and the media it references."""
        paths: ProjectPaths = ctx.obj
        book = load_scene_book(paths.scenes)
        unpinned = unpinned_scene_ids(book)
        if unpinned and not allow_unpinned:
            raise fail(f"REFUSED: unpinned scenes: {', '.join(unpinned)}")
        if unpinned:
            typer.echo(f"WARNING: skipping unpinned scenes: {', '.join(unpinned)}", err=True)
        portraits = (
            PortraitInputs(
                book=load_portrait_book(paths.portraits), morph_cache=paths.portrait_morphs
            )
            if paths.portraits.is_file()
            else None
        )
        try:
            publication = prepare_publication(
                book, load_world(paths.curated), paths.sources, paths.root, portraits, asset_base
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
        if publication.portraits is not None:
            typer.echo(format_portrait_publication(publication.portraits))

    return app


def format_portrait_publication(portraits: PortraitPublication) -> str:
    plates = 0 if portraits.data is None else len(portraits.data.plates)
    morphs = 0 if portraits.data is None else len(portraits.data.morphs)
    lines = [
        f"portraits: {plates} plates, {morphs} morphs, {len(portraits.unpinned)} unpinned skipped"
    ]
    lines += [
        f"WARNING: no morph for {key.older} -> {key.younger}; run `earthtime morph` "
        "(the viewer crossfades this pair until then)"
        for key in portraits.missing_morphs
    ]
    lines += [
        f"note: {key.older} -> {key.younger} falls back to a plain dissolve "
        "(the flow was too incoherent to trust; see docs/DECISIONS.md ADR-015)"
        for key in portraits.dissolved_morphs
    ]
    return "\n".join(lines)


app = create_app(image_backend())

if __name__ == "__main__":
    app()
