"""What is stale and what building it would cost. Pure: reads the graph and the store, spends nothing.

The graph's `Resolver` knows PINNED, FRESH and STALE. For an image node, FRESH means candidates
exist for the current digest, and without a pin that is AWAITING_REVIEW: a human still has to
pick one. That mapping lives here so graph.py stays the contract it is.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from pipeline.assets import SceneAssets, SceneGraph
from pipeline.graph import AssetNode, Status
from pipeline.scenes import UnknownScene
from pipeline.shapes import GeoTime
from pipeline.store import CandidateStore

Estimator = Callable[[AssetNode], float]


@dataclass(frozen=True)
class ScenePlan:
    assets: SceneAssets
    status: Status
    digest: str  # the image node's current digest
    candidate_count: int  # candidates stored for that digest
    estimate_usd: float  # cost of building it, zero unless stale


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


def make_plan(
    graph: SceneGraph, store: CandidateStore, estimate: Estimator, candidates_per_scene: int
) -> BuildPlan:
    if candidates_per_scene < 1:
        raise ValueError(f"candidates per scene must be at least 1, got {candidates_per_scene}")
    resolver = graph.resolver(store)
    scenes = []
    for assets in graph.assets:
        digest = resolver.digest(assets.image.id)
        status = _image_status(resolver.status(assets.image.id))
        scenes.append(
            ScenePlan(
                assets=assets,
                status=status,
                digest=digest,
                candidate_count=store.count(assets.scene.id, digest),
                estimate_usd=(
                    estimate(assets.image) * candidates_per_scene if status is Status.STALE else 0.0
                ),
            )
        )
    return BuildPlan(scenes=tuple(scenes), candidates_per_scene=candidates_per_scene)


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
    counts = {status: sum(1 for s in plan.scenes if s.status is status) for status in Status}
    stale = len(plan.stale)
    images = stale * plan.candidates_per_scene
    summary = [
        (
            f"{len(plan.scenes)} scenes: {counts[Status.PINNED]} pinned, "
            f"{counts[Status.AWAITING_REVIEW]} awaiting review, {stale} stale"
        ),
        (
            f"estimate to build stale scenes: {stale} x {plan.candidates_per_scene} candidates = "
            f"{images} images, ${plan.estimate_usd:.2f}"
        ),
    ]
    return "\n".join([header, *rows, "", *summary])
