"""`earthtime build --only images`: generate candidates for stale scenes, one paid call at a time.

Sequential by design (VISUAL_SPEC §8: keep concurrency low). Every image is reserved, called,
settled and saved before the next begins, so a stop at any point leaves the ledger and the
store consistent. Stop rules:

* `BudgetExceeded` — stop at once. The ceiling is never raised (CLAUDE.md).
* `GeneratorUnavailable` — rate limiting outlasted the generator's own backoff; stop.
* `GenerationFailed` — retry that image once, then skip the rest of that scene and move on.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from pipeline.generators.image import GenerationFailed, GeneratorUnavailable, ImageGenerator
from pipeline.graph import Status
from pipeline.plan import BuildPlan, ScenePlan
from pipeline.spend import BudgetExceeded
from pipeline.store import CandidateStore, StoredCandidate

ATTEMPTS_PER_IMAGE = 2


class SceneFailed(RuntimeError):
    """An image failed on every attempt, so the scene is skipped."""


@dataclass(frozen=True)
class SkippedScene:
    scene_id: str
    reason: str


@dataclass
class BuildReport:
    built: dict[str, int] = field(default_factory=dict)  # scene id -> candidates written
    skipped: list[SkippedScene] = field(default_factory=list)
    stopped: str | None = None

    @property
    def complete(self) -> bool:
        return not self.skipped and self.stopped is None


def build_images(
    plan: BuildPlan,
    generator: ImageGenerator,
    store: CandidateStore,
    echo: Callable[[str], None],
) -> BuildReport:
    report = BuildReport()
    for scene in plan.stale:
        scene_id = scene.assets.scene.id
        try:
            for index in range(1, plan.candidates_per_scene + 1):
                stored = _render_candidate(generator, store, scene, echo)
                report.built[scene_id] = report.built.get(scene_id, 0) + 1
                echo(
                    f"{scene_id} [{index}/{plan.candidates_per_scene}]: "
                    f"{stored.image_path.name} ${stored.record.cost_usd:.4f}"
                )
        except SceneFailed as err:
            report.skipped.append(SkippedScene(scene_id=scene_id, reason=str(err)))
            echo(f"{scene_id}: SKIPPED — {err}")
        except (BudgetExceeded, GeneratorUnavailable) as err:
            report.stopped = f"{type(err).__name__}: {err}"
            echo(f"STOPPED at {scene_id}: {report.stopped}")
            break
    return report


def _render_candidate(
    generator: ImageGenerator,
    store: CandidateStore,
    scene: ScenePlan,
    echo: Callable[[str], None],
) -> StoredCandidate:
    # A pinned scene is never stale, so it can never reach a paid call (ADR-005).
    assert scene.status is Status.STALE and scene.assets.pin is None, scene.assets.scene.id
    node = scene.assets.image
    for attempt in range(1, ATTEMPTS_PER_IMAGE + 1):
        try:
            image = generator.render(node)
        except GenerationFailed as err:
            if attempt == ATTEMPTS_PER_IMAGE:
                raise SceneFailed(f"failed {attempt} times: {err}") from err
            echo(f"{scene.assets.scene.id}: {err} — retrying once")
            continue
        return store.save(scene.assets.scene.id, node, scene.digest, image, attempt)
    raise AssertionError("unreachable: the loop returns or raises")


def format_report(report: BuildReport) -> str:
    lines = [f"built: {sum(report.built.values())} candidates across {len(report.built)} scenes"]
    lines += [f"  {scene_id}: {count}" for scene_id, count in report.built.items()]
    lines += [f"skipped {s.scene_id}: {s.reason}" for s in report.skipped]
    if report.stopped is not None:
        lines.append(f"stopped: {report.stopped}")
    return "\n".join(lines)
