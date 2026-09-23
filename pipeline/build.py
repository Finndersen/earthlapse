"""`earthlapse build`: generate candidates for stale images, one paid call at a time.

Sequential by design (VISUAL_SPEC §8: keep concurrency low). Every image is reserved, called,
settled and saved before the next begins, so a stop at any point leaves the ledger and the
store consistent. Scenes and ancestor portraits (ADR-015) run through the same loop, each an
`ImageJob` against its own candidate store, under the same ledger and ceiling. Stop rules:

* `BudgetExceeded` — stop at once. The ceiling is never raised (CLAUDE.md).
* `GeneratorUnavailable` — rate limiting outlasted the generator's own backoff; stop.
* `GenerationFailed` — retry that image once, then skip the rest of that job and move on.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from pipeline.generators.image import GenerationFailed, GeneratorUnavailable, ImageGenerator
from pipeline.graph import AssetNode, Status
from pipeline.spend import BudgetExceeded
from pipeline.store import CandidateStore, StoredCandidate

ATTEMPTS_PER_IMAGE = 2


class ImageJob(Protocol):
    """One stale image to generate: a scene or a portrait plan row (pipeline/plan.py)."""

    @property
    def subject_id(self) -> str: ...

    @property
    def image(self) -> AssetNode: ...

    @property
    def digest(self) -> str: ...

    @property
    def status(self) -> Status: ...


class JobFailed(RuntimeError):
    """An image failed on every attempt, so the job is skipped."""


@dataclass(frozen=True)
class SkippedJob:
    subject_id: str
    reason: str


@dataclass
class BuildReport:
    built: dict[str, int] = field(default_factory=dict)  # subject id -> candidates written
    skipped: list[SkippedJob] = field(default_factory=list)
    stopped: str | None = None

    @property
    def complete(self) -> bool:
        return not self.skipped and self.stopped is None


def build_images(
    jobs: Sequence[ImageJob],
    candidates_per_job: int,
    generator: ImageGenerator,
    store: CandidateStore,
    echo: Callable[[str], None],
) -> BuildReport:
    report = BuildReport()
    for job in jobs:
        try:
            for index in range(1, candidates_per_job + 1):
                stored = _render_candidate(generator, store, job, echo)
                report.built[job.subject_id] = report.built.get(job.subject_id, 0) + 1
                echo(
                    f"{job.subject_id} [{index}/{candidates_per_job}]: "
                    f"{stored.image_path.name} ${stored.record.cost_usd:.4f}"
                )
        except JobFailed as err:
            report.skipped.append(SkippedJob(subject_id=job.subject_id, reason=str(err)))
            echo(f"{job.subject_id}: SKIPPED — {err}")
        except (BudgetExceeded, GeneratorUnavailable) as err:
            report.stopped = f"{type(err).__name__}: {err}"
            echo(f"STOPPED at {job.subject_id}: {report.stopped}")
            break
    return report


def _render_candidate(
    generator: ImageGenerator,
    store: CandidateStore,
    job: ImageJob,
    echo: Callable[[str], None],
) -> StoredCandidate:
    # The Resolver reports a pinned node as PINNED before it ever considers staleness, so a
    # pinned image can never reach a paid call (ADR-005).
    assert job.status is Status.STALE, job.subject_id
    for attempt in range(1, ATTEMPTS_PER_IMAGE + 1):
        try:
            image = generator.render(job.image)
        except GenerationFailed as err:
            if attempt == ATTEMPTS_PER_IMAGE:
                raise JobFailed(f"failed {attempt} times: {err}") from err
            echo(f"{job.subject_id}: {err} — retrying once")
            continue
        return store.save(job.subject_id, job.image, job.digest, image, attempt)
    raise AssertionError("unreachable: the loop returns or raises")


def format_report(report: BuildReport, noun: str) -> str:
    lines = [f"built: {sum(report.built.values())} candidates across {len(report.built)} {noun}"]
    lines += [f"  {subject_id}: {count}" for subject_id, count in report.built.items()]
    lines += [f"skipped {s.subject_id}: {s.reason}" for s in report.skipped]
    if report.stopped is not None:
        lines.append(f"stopped: {report.stopped}")
    return "\n".join(lines)
