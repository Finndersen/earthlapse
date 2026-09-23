"""sources/lineage. Hand-curated: data/lineage.yaml is the source of truth and normalise() reads
it directly. The file is one path from LUCA to Homo sapiens, not a phylogeny, and no date may be
derived from TimeTree (sources/lineage/README.md "Licensing note")."""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path

import pytest

from pipeline.shapes import Tree
from tests.sources.support import load_source_module


@pytest.fixture(scope="module")
def lineage_tree() -> Tree:
    (tree,) = load_source_module("lineage", "normalise").normalise(Path("unused"))
    assert isinstance(tree, Tree)
    return tree


@pytest.mark.content
def test_lineage_is_one_chain_from_luca_to_homo_sapiens(lineage_tree: Tree) -> None:
    path = lineage_tree.path_to("homo-sapiens")

    assert lineage_tree.id == "lineage"
    assert [path[0].id, path[-1].id] == ["luca", "homo-sapiens"]
    assert {n.id for n in path} == {n.id for n in lineage_tree.nodes}
    assert all(child.t_divergence < parent.t_divergence for parent, child in pairwise(path))
    assert lineage_tree.sample(0.0) == path[-1]


@pytest.mark.content
def test_every_node_is_cited_and_no_citation_is_timetree(lineage_tree: Tree) -> None:
    for node in lineage_tree.nodes:
        assert node.citation and node.citation.strip(), node.id
        assert "timetree" not in node.citation.lower(), node.id
