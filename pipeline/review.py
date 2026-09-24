"""`earthlapse review`: candidates beside their neighbours, and the human pick that pins one.

VISUAL_SPEC §7: review adjacent pairs, never single images in isolation. Every listing and
contact sheet therefore shows a scene's predecessor and successor alongside its candidates, and
a portrait's older and younger neighbours on the lineage path, the plates it morphs between
(VISUAL_SPEC §10).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pipeline.contact_sheet import Tile, write_contact_sheet
from pipeline.plan import BuildPlan, PortraitBuildPlan, PortraitPlan, ScenePlan, format_age
from pipeline.portraits import PortraitAssets, PortraitBook, PortraitGraph, write_portrait_pin
from pipeline.scenes import SceneBook, ScenePin, SceneRecord, write_pin
from pipeline.store import CandidateStore, PinStore, StoredCandidate

OVERVIEW_NAME = "overview.jpg"
PORTRAIT_OVERVIEW_COLUMNS = 8


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


@dataclass(frozen=True)
class PortraitReview:
    plan: PortraitPlan
    candidates: tuple[StoredCandidate, ...]
    older: PortraitAssets | None
    younger: PortraitAssets | None


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


def review_portraits(
    graph: PortraitGraph, plan: PortraitBuildPlan, store: CandidateStore
) -> list[PortraitReview]:
    """Oldest first, along the lineage path."""
    reviews = []
    for assets in reversed(graph.assets):
        node_id = assets.record.id
        older, younger = graph.neighbours(node_id)
        reviews.append(
            PortraitReview(
                plan=plan.portrait(node_id),
                candidates=tuple(store.candidates(node_id)),
                older=older,
                younger=younger,
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
            f"  predecessor: {_scene_label(review.predecessor)}",
            f"  successor:   {_scene_label(review.successor)}",
            *_pin_and_candidate_lines(scene.pin, review.candidates, review.plan.digest, root),
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def format_portrait_reviews(reviews: list[PortraitReview], root: Path) -> str:
    blocks = []
    for number, review in enumerate(reviews, start=1):
        assets = review.plan.assets
        lines = [
            (
                f"[{number}/{len(reviews)}] {assets.record.id}  "
                f"{format_age(assets.node.t_divergence)}  plate {assets.record.plate.value}  "
                f"{review.plan.status.value}"
            ),
            f"  older:   {_portrait_label(review.older)}",
            f"  younger: {_portrait_label(review.younger)}",
            *_pin_and_candidate_lines(
                assets.record.pin, review.candidates, review.plan.digest, root
            ),
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _pin_and_candidate_lines(
    pin: ScenePin | None, candidates: Sequence[StoredCandidate], digest: str, root: Path
) -> list[str]:
    lines = [] if pin is None else [f"  pinned: {pin.asset_digest} {pin.path}"]
    if not candidates:
        lines.append("  no candidates")
    for index, candidate in enumerate(candidates, start=1):
        record = candidate.record
        earlier = "" if record.node_digest == digest else "  (earlier prompt)"
        lines.append(
            f"  {index:>2}. {record.asset_digest}  {record.width}x{record.height}  "
            f"${record.cost_usd:.3f}  {_relative(candidate.image_path, root)}{earlier}"
        )
    return lines


def _scene_label(scene: SceneRecord | None) -> str:
    if scene is None:
        return "(none)"
    pinned = "pinned" if scene.pin is not None else "unpinned"
    return f"{scene.id} ({format_age(scene.t)}, {pinned})"


def _portrait_label(assets: PortraitAssets | None) -> str:
    if assets is None:
        return "(none)"
    pinned = "pinned" if assets.pin is not None else "unpinned"
    return f"{assets.record.id} ({format_age(assets.node.t_divergence)}, {pinned})"


def representative_image(scene: SceneRecord, store: CandidateStore, root: Path) -> Path | None:
    """What a neighbour looks like for now: its pin, else its first candidate, else nothing."""
    return _representative(scene.pin, scene.id, store, root)


def _representative(
    pin: ScenePin | None, subject_id: str, store: CandidateStore, root: Path
) -> Path | None:
    if pin is not None:
        return root / pin.path
    candidates = store.candidates(subject_id)
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
            _scene_tile("previous", review.predecessor, store, root),
            *_candidate_tiles(review.candidates),
            _scene_tile("next", review.successor, store, root),
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


def write_portrait_review_sheets(
    reviews: list[PortraitReview], store: CandidateStore, root: Path, out_dir: Path
) -> list[Path]:
    """One sheet per portrait with candidates (older | candidates | younger), plus an overview
    grid in lineage order, which is how the morph sequence will read."""
    written = []
    for number, review in enumerate(reviews, start=1):
        if not review.candidates:
            continue
        row = [
            _portrait_tile("older", review.older, store, root),
            *_candidate_tiles(review.candidates),
            _portrait_tile("younger", review.younger, store, root),
        ]
        path = out_dir / f"{number:02d}-{review.plan.subject_id}.jpg"
        write_contact_sheet([row], path)
        written.append(path)
    tiles = [
        Tile(
            _representative(r.plan.assets.record.pin, r.plan.subject_id, store, root),
            f"{r.plan.subject_id} {format_age(r.plan.assets.node.t_divergence)}",
        )
        for r in reviews
    ]
    if any(tile.path is not None for tile in tiles):
        rows = [
            tiles[i : i + PORTRAIT_OVERVIEW_COLUMNS]
            for i in range(0, len(tiles), PORTRAIT_OVERVIEW_COLUMNS)
        ]
        path = out_dir / OVERVIEW_NAME
        write_contact_sheet(rows, path)
        written.append(path)
    return written


def _candidate_tiles(candidates: Sequence[StoredCandidate]) -> list[Tile]:
    return [
        Tile(c.image_path, f"{i}. {c.record.asset_digest}")
        for i, c in enumerate(candidates, start=1)
    ]


def _scene_tile(role: str, scene: SceneRecord | None, store: CandidateStore, root: Path) -> Tile:
    if scene is None:
        return Tile(None, f"{role}: none")
    return Tile(representative_image(scene, store, root), f"{role}: {scene.id}")


def _portrait_tile(
    role: str, assets: PortraitAssets | None, store: CandidateStore, root: Path
) -> Tile:
    if assets is None:
        return Tile(None, f"{role}: none")
    return Tile(
        _representative(assets.record.pin, assets.record.id, store, root),
        f"{role}: {assets.record.id}",
    )


def pick_candidate(
    book_path: Path,
    book: SceneBook,
    store: CandidateStore,
    pins: PinStore,
    scene_id: str,
    number: int,
) -> ScenePin:
    """Pin candidate `number` (1-based, as listed by `earthlapse review`) into data/scenes.yaml."""
    scene = book.scene(scene_id)
    if scene.pin is not None:
        raise ReviewError(
            f"{scene_id} is already pinned to {scene.pin.asset_digest}; "
            "clear it first with `earthlapse review clear`"
        )
    pin = pins.add(scene_id, _chosen(store, scene_id, number))
    write_pin(book_path, scene_id, pin)
    return pin


def pick_portrait(
    book_path: Path,
    book: PortraitBook,
    store: CandidateStore,
    pins: PinStore,
    node_id: str,
    number: int,
) -> ScenePin:
    """Pin candidate `number` (as listed by `earthlapse review portraits`) into data/portraits.yaml."""
    record = book.portrait(node_id)
    if record.pin is not None:
        raise ReviewError(
            f"{node_id} is already pinned to {record.pin.asset_digest}; "
            "clear it first with `earthlapse review portraits clear`"
        )
    pin = pins.add(node_id, _chosen(store, node_id, number))
    write_portrait_pin(book_path, node_id, pin)
    return pin


def _chosen(store: CandidateStore, subject_id: str, number: int) -> StoredCandidate:
    candidates = store.candidates(subject_id)
    if not 1 <= number <= len(candidates):
        raise ReviewError(f"{subject_id} has {len(candidates)} candidate(s); no candidate {number}")
    return candidates[number - 1]


def clear_pin(book_path: Path, book: SceneBook, pins: PinStore, scene_id: str) -> ScenePin:
    pin = book.scene(scene_id).pin
    if pin is None:
        raise ReviewError(f"{scene_id} is not pinned")
    write_pin(book_path, scene_id, None)
    pins.remove(pin)
    return pin


def clear_portrait_pin(
    book_path: Path, book: PortraitBook, pins: PinStore, node_id: str
) -> ScenePin:
    pin = book.portrait(node_id).pin
    if pin is None:
        raise ReviewError(f"{node_id} is not pinned")
    write_portrait_pin(book_path, node_id, None)
    pins.remove(pin)
    return pin


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
