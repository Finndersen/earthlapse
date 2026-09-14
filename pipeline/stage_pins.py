"""`make pins`: keep git's copies of pinned candidate images in step with the pins (ADR-018).

`data/candidates/` is gitignored because unpinned candidates are local scratch, so a newly
pinned image has to be force-added, and one whose pin was cleared or replaced has to leave the
index. Run after `earthtime review pick` / `clear`, before committing.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from pipeline.portraits import load_portrait_book
from pipeline.scenes import load_scene_book

ROOT = Path(__file__).resolve().parent.parent
CANDIDATES_DIR = "data/candidates"


@dataclass(frozen=True)
class IndexChanges:
    add: tuple[str, ...]
    remove: tuple[str, ...]


def plan_index_changes(pinned: set[str], tracked: set[str]) -> IndexChanges:
    """Every pinned image is (re-)added; tracked candidates that are no longer pinned leave."""
    return IndexChanges(add=tuple(sorted(pinned)), remove=tuple(sorted(tracked - pinned)))


def pinned_paths(root: Path) -> set[str]:
    scenes = load_scene_book(root / "data" / "scenes.yaml").scenes
    portraits = load_portrait_book(root / "data" / "portraits.yaml").portraits
    return {record.pin.path for record in (*scenes, *portraits) if record.pin is not None}


def tracked_candidates(root: Path) -> set[str]:
    listing = subprocess.run(
        ["git", "ls-files", "--", CANDIDATES_DIR],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return set(listing.stdout.split())


def main() -> None:
    pinned = pinned_paths(ROOT)
    missing = sorted(path for path in pinned if not (ROOT / path).is_file())
    if missing:
        raise SystemExit(f"pinned images missing on disk: {', '.join(missing)}")
    changes = plan_index_changes(pinned, tracked_candidates(ROOT))
    if changes.remove:
        subprocess.run(
            ["git", "rm", "--cached", "--quiet", "--", *changes.remove], cwd=ROOT, check=True
        )
    subprocess.run(["git", "add", "--force", "--", *changes.add], cwd=ROOT, check=True)
    print(
        f"pins: {len(changes.add)} pinned images staged, {len(changes.remove)} unpinned removed from the index"
    )


if __name__ == "__main__":
    main()
