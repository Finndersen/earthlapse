"""Fetch step for sources/lineage — documented no-op.

lineage is hand-curated: data/lineage.yaml (committed to git, the source of truth) already
carries a specific citation per node, verified against the primary literature — see
sources/lineage/README.md for the method and sources/lineage/README.md "Licensing note" for
why TimeTree (the bulk-download source named in docs/DATA_SOURCES.md's original lineage
entry) is not used here.

There is no upstream file to download: every node's date and citation was looked up
individually against the published paper (or a freely accessible copy of it), not bulk-
fetched from one dataset. fetch() is therefore a documented no-op rather than absent, so
`earthlapse plan` / `make data` can invoke every source's fetch.py uniformly. normalise()
never reads raw_dir, so a no-op fetch never blocks the build.
"""

from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    """No-op: lineage has no upstream file to download. See module docstring."""
    del raw_dir


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    fetch(repo_root / "data" / "raw" / "lineage")


if __name__ == "__main__":
    main()
