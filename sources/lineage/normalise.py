"""Normalise data/lineage.yaml into pipeline.shapes.Tree id "lineage".

lineage is hand-curated: data/lineage.yaml IS the dataset (see its header comment and
sources/lineage/README.md), not something derived from data/raw/. normalise() therefore
reads data/lineage.yaml directly and ignores raw_dir — the parameter exists only to match
the normalise(raw_dir: Path) -> list[CuratedShape] convention shared by every source's
normalise.py, so `earthtime build` can invoke every source the same way.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, Tree, TreeNode

REPO_ROOT = Path(__file__).resolve().parents[2]
LINEAGE_YAML = REPO_ROOT / "data" / "lineage.yaml"


def _load_tree(lineage_yaml: Path) -> Tree:
    document = yaml.safe_load(lineage_yaml.read_text())
    nodes = [TreeNode(**record) for record in document["nodes"]]
    return Tree(id="lineage", nodes=nodes)


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Return the lineage Tree. raw_dir is unused — see module docstring."""
    del raw_dir
    return [_load_tree(LINEAGE_YAML)]


def main() -> None:
    for shape in normalise(REPO_ROOT / "data" / "raw" / "lineage"):
        path = write_shape(shape, REPO_ROOT / "data" / "curated")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
