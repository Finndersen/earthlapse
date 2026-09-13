"""What is stale and what building it would cost. Pure: reads the graph and the store, spends nothing.

The graph's `Resolver` knows PINNED, FRESH and STALE. For an image node, FRESH means candidates
exist for the current digest, and without a pin that is AWAITING_REVIEW: a human still has to
pick one. That mapping lives here so graph.py stays the contract it is. Scenes and ancestor
portraits (ADR-015) are planned the same way, each against its own candidate store.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from pipeline.assets import SceneAssets, SceneGraph
from pipeline.graph import AssetNode, Resolver, Status
from pipeline.portraits import PortraitAssets, PortraitGraph, UnknownPortrait
from pipeline.scenes import UnknownScene
from pipeline.shapes import GeoTime
from pipeline.store import CandidateStore

Estimator = Callable[[AssetNode], float]


@dataclass(frozen=True)
class ImageStanding:
    status: Status
    digest: str  # the image node's current digest
    candidate_count: int  # candidates stored for that digest
    estimate_usd: float  # cost of building it, zero unless stale


@dataclass(frozen=True)
class ScenePlan:
    assets: SceneAssets
    status: Status
    digest: str
    candidate_count: int
    estimate_usd: float

    @property
    def subject_id(self) -> str:
        return self.assets.scene.id

    @property
    def image(self) -> AssetNode:
        return self.assets.image


@dataclass(frozen=True)
class BuildPlan:
    scenes: tuple[ScenePlan, ...]  # ascending in t
    candidates_per_scene: int

    @property
    def stale(self) -> tuple[ScenePlan, ...]:
        return tuple(s for s in self.scenes if s.status is Status.STALE)

    @property
    def estimate_usd(self) -> float:
        return sum(s.estimate_usd for s in self.scenes)

    def select(self, scene_ids: Sequence[str]) -> BuildPlan:
        known = {s.assets.scene.id for s in self.scenes}
        unknown = sorted(set(scene_ids) - known)
        if unknown:
            raise UnknownScene(f"unknown scene(s): {', '.join(unknown)}")
        wanted = set(scene_ids)
        return replace(self, scenes=tuple(s for s in self.scenes if s.assets.scene.id in wanted))

    def scene(self, scene_id: str) -> ScenePlan:
        for scene in self.scenes:
            if scene.assets.scene.id == scene_id:
                return scene
        raise UnknownScene(f"unknown scene {scene_id!r}")


@dataclass(frozen=True)
class PortraitPlan:
    assets: PortraitAssets
    status: Status
    digest: str
    candidate_count: int
    estimate_usd: float

    @property
    def subject_id(self) -> str:
        return self.assets.record.id

    @property
    def image(self) -> AssetNode:
        return self.assets.image


@dataclass(frozen=True)
class PortraitBuildPlan:
    portraits: tuple[PortraitPlan, ...]  # ascending in t_divergence
    candidates_per_portrait: int

    @property
    def stale(self) -> tuple[PortraitPlan, ...]:
        return tuple(p for p in self.portraits if p.status is Status.STALE)

    @property
    def estimate_usd(self) -> float:
        return sum(p.estimate_usd for p in self.portraits)

    def select(self, node_ids: Sequence[str]) -> PortraitBuildPlan:
        known = {p.subject_id for p in self.portraits}
        unknown = sorted(set(node_ids) - known)
        if unknown:
            raise UnknownPortrait(f"no portrait for lineage node(s): {', '.join(unknown)}")
        wanted = set(node_ids)
        return replace(self, portraits=tuple(p for p in self.portraits if p.subject_id in wanted))

    def portrait(self, node_id: str) -> PortraitPlan:
        for portrait in self.portraits:
            if portrait.subject_id == node_id:
                return portrait
        raise UnknownPortrait(f"no portrait for lineage node {node_id!r}")


def make_plan(
    graph: SceneGraph, store: CandidateStore, estimate: Estimator, candidates_per_scene: int
) -> BuildPlan:
    _require_candidates(candidates_per_scene)
    resolver = graph.resolver(store)
    scenes = []
    for assets in graph.assets:
        standing = _standing(
            resolver, store, assets.scene.id, assets.image, estimate, candidates_per_scene
        )
        scenes.append(
            ScenePlan(
                assets=assets,
                status=standing.status,
                digest=standing.digest,
                candidate_count=standing.candidate_count,
                estimate_usd=standing.estimate_usd,
            )
        )
    return BuildPlan(scenes=tuple(scenes), candidates_per_scene=candidates_per_scene)


def make_portrait_plan(
    graph: PortraitGraph, store: CandidateStore, estimate: Estimator, candidates_per_portrait: int
) -> PortraitBuildPlan:
    _require_candidates(candidates_per_portrait)
    resolver = graph.resolver(store)
    portraits = []
    for assets in graph.assets:
        standing = _standing(
            resolver, store, assets.record.id, assets.image, estimate, candidates_per_portrait
        )
        portraits.append(
            PortraitPlan(
                assets=assets,
                status=standing.status,
                digest=standing.digest,
                candidate_count=standing.candidate_count,
                estimate_usd=standing.estimate_usd,
            )
        )
    return PortraitBuildPlan(
        portraits=tuple(portraits), candidates_per_portrait=candidates_per_portrait
    )


def _require_candidates(count: int) -> None:
    if count < 1:
        raise ValueError(f"candidates per image must be at least 1, got {count}")


def _standing(
    resolver: Resolver,
    store: CandidateStore,
    subject_id: str,
    image: AssetNode,
    estimate: Estimator,
    candidates: int,
) -> ImageStanding:
    digest = resolver.digest(image.id)
    status = _image_status(resolver.status(image.id))
    return ImageStanding(
        status=status,
        digest=digest,
        candidate_count=store.count(subject_id, digest),
        estimate_usd=estimate(image) * candidates if status is Status.STALE else 0.0,
    )


def _image_status(status: Status) -> Status:
    match status:
        case Status.FRESH:
            return Status.AWAITING_REVIEW
        case Status.PINNED | Status.STALE:
            return status
        case Status.AWAITING_REVIEW:
            raise AssertionError("the Resolver never reports AWAITING_REVIEW itself")


def format_age(t: GeoTime) -> str:
    if t == 0:
        return "present"
    if t < 1e6:
        return f"{t / 1e3:,.0f} ka"
    if t < 1e9:
        return f"{t / 1e6:,.0f} Ma"
    return f"{t / 1e9:.2f} Ga"


def format_plan(plan: BuildPlan) -> str:
    header = f"{'scene':<28} {'age':>8}  {'chapter':<14} {'status':<16} {'cands':>5}  estimate"
    rows = [
        f"{s.assets.scene.id:<28} {format_age(s.assets.scene.t):>8}  "
        f"{s.assets.scene.chapter:<14} {s.status.value:<16} {s.candidate_count:>5}  "
        f"${s.estimate_usd:.2f}"
        for s in reversed(plan.scenes)
    ]
    summary = _summary(
        "scenes", [s.status for s in plan.scenes], plan.candidates_per_scene, plan.estimate_usd
    )
    return "\n".join([header, *rows, "", *summary])


def format_portrait_plan(plan: PortraitBuildPlan) -> str:
    header = (
        f"{'portrait':<22} {'age':>8}  {'plate':<10} {'evidence':<14} {'status':<16} "
        f"{'cands':>5}  estimate"
    )
    rows = [
        f"{p.subject_id:<22} {format_age(p.assets.node.t_divergence):>8}  "
        f"{p.assets.record.plate.value:<10} {p.assets.record.evidence.value:<14} "
        f"{p.status.value:<16} {p.candidate_count:>5}  ${p.estimate_usd:.2f}"
        for p in reversed(plan.portraits)
    ]
    summary = _summary(
        "portraits",
        [p.status for p in plan.portraits],
        plan.candidates_per_portrait,
        plan.estimate_usd,
    )
    return "\n".join([header, *rows, "", *summary])


def _summary(
    noun: str, statuses: Sequence[Status], candidates: int, estimate_usd: float
) -> list[str]:
    counts = {status: sum(1 for s in statuses if s is status) for status in Status}
    stale = counts[Status.STALE]
    return [
        (
            f"{len(statuses)} {noun}: {counts[Status.PINNED]} pinned, "
            f"{counts[Status.AWAITING_REVIEW]} awaiting review, {stale} stale"
        ),
        (
            f"estimate to build stale {noun}: {stale} x {candidates} candidates = "
            f"{stale * candidates} images, ${estimate_usd:.2f}"
        ),
    ]
