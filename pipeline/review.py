"""`earthtime review`: candidates beside their neighbours, and the human pick that pins one.

VISUAL_SPEC §7: review adjacent pairs, never single images in isolation. Every listing and
contact sheet therefore shows a scene's predecessor and successor alongside its candidates.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pipeline.contact_sheet import Tile, write_contact_sheet
from pipeline.plan import BuildPlan, ScenePlan, format_age
from pipeline.scenes import SceneBook, ScenePin, SceneRecord, write_pin
from pipeline.store import CandidateStore, StoredCandidate

OVERVIEW_NAME = "overview.jpg"


class ReviewError(ValueError):
    """A review command that cannot be carried out as asked."""


@dataclass(frozen=True)
class SceneReview:
    plan: ScenePlan
    candidates: tuple[StoredCandidate, ...]
    predecessor: SceneRecord | None
    successor: SceneRecord | None

    @property
    def scene(self) -> SceneRecord:
        return self.plan.assets.scene


def review_scenes(book: SceneBook, plan: BuildPlan, store: CandidateStore) -> list[SceneReview]:
    """Oldest first, the order adjacent pairs are judged in."""
    reviews = []
    for scene in book.chronological():
        predecessor, successor = book.neighbours(scene.id)
        reviews.append(
            SceneReview(
                plan=plan.scene(scene.id),
                candidates=tuple(store.candidates(scene.id)),
                predecessor=predecessor,
                successor=successor,
            )
        )
    return reviews


def format_reviews(reviews: list[SceneReview], root: Path) -> str:
    blocks = []
    for number, review in enumerate(reviews, start=1):
        scene = review.scene
        lines = [
            (
                f"[{number}/{len(reviews)}] {scene.id}  {format_age(scene.t)}  "
                f"chapter {scene.chapter}  {review.plan.status.value}"
            ),
            f"  predecessor: {_neighbour_label(review.predecessor)}",
            f"  successor:   {_neighbour_label(review.successor)}",
        ]
        if scene.pin is not None:
            lines.append(f"  pinned: {scene.pin.asset_digest} {scene.pin.path}")
        if not review.candidates:
            lines.append("  no candidates")
        for index, candidate in enumerate(review.candidates, start=1):
            record = candidate.record
            earlier = "" if record.node_digest == review.plan.digest else "  (earlier prompt)"
            lines.append(
                f"  {index:>2}. {record.asset_digest}  {record.width}x{record.height}  "
                f"${record.cost_usd:.3f}  {_relative(candidate.image_path, root)}{earlier}"
            )
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _neighbour_label(scene: SceneRecord | None) -> str:
    if scene is None:
        return "(none)"
    pinned = "pinned" if scene.pin is not None else "unpinned"
    return f"{scene.id} ({format_age(scene.t)}, {pinned})"


def representative_image(scene: SceneRecord, store: CandidateStore, root: Path) -> Path | None:
    """What a neighbour looks like for now: its pin, else its first candidate, else nothing."""
    if scene.pin is not None:
        return root / scene.pin.path
    candidates = store.candidates(scene.id)
    return candidates[0].image_path if candidates else None


def write_review_sheets(
    reviews: list[SceneReview], store: CandidateStore, root: Path, out_dir: Path
) -> list[Path]:
    """One sheet per scene with candidates (previous | candidates | next), plus an overview strip."""
    written = []
    for number, review in enumerate(reviews, start=1):
        if not review.candidates:
            continue
        row = [
            _neighbour_tile("previous", review.predecessor, store, root),
            *(
                Tile(c.image_path, f"{i}. {c.record.asset_digest}")
                for i, c in enumerate(review.candidates, start=1)
            ),
            _neighbour_tile("next", review.successor, store, root),
        ]
        path = out_dir / f"{number:02d}-{review.scene.id}.jpg"
        write_contact_sheet([row], path)
        written.append(path)
    overview = [
        Tile(representative_image(r.scene, store, root), f"{r.scene.id} {format_age(r.scene.t)}")
        for r in reviews
    ]
    if any(tile.path is not None for tile in overview):
        path = out_dir / OVERVIEW_NAME
        write_contact_sheet([overview], path)
        written.append(path)
    return written


def _neighbour_tile(
    role: str, scene: SceneRecord | None, store: CandidateStore, root: Path
) -> Tile:
    if scene is None:
        return Tile(None, f"{role}: none")
    return Tile(representative_image(scene, store, root), f"{role}: {scene.id}")


def pick_candidate(
    book_path: Path, book: SceneBook, store: CandidateStore, root: Path, scene_id: str, number: int
) -> ScenePin:
    """Pin candidate `number` (1-based, as listed by `earthtime review`) into data/scenes.yaml."""
    scene = book.scene(scene_id)
    if scene.pin is not None:
        raise ReviewError(
            f"{scene_id} is already pinned to {scene.pin.asset_digest}; "
            "clear it first with `earthtime review clear`"
        )
    candidates = store.candidates(scene_id)
    if not 1 <= number <= len(candidates):
        raise ReviewError(f"{scene_id} has {len(candidates)} candidate(s); no candidate {number}")
    chosen = candidates[number - 1]
    pin = ScenePin(asset_digest=chosen.record.asset_digest, path=_relative(chosen.image_path, root))
    write_pin(book_path, scene_id, pin)
    return pin


def clear_pin(book_path: Path, book: SceneBook, scene_id: str) -> ScenePin:
    pin = book.scene(scene_id).pin
    if pin is None:
        raise ReviewError(f"{scene_id} is not pinned")
    write_pin(book_path, scene_id, None)
    return pin


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
