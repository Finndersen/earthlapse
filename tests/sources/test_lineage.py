"""Validates the REAL, committed data/lineage.yaml — offline, no network, no fixture.

lineage is hand-curated (see sources/lineage/README.md): data/lineage.yaml is the source
of truth, so this suite asserts directly on it rather than on a fixture slice (matching
tests/sources/test_events.py's convention for events-core).

Also enforces the licence gate this package is built around: no citation may mention
TimeTree (see sources/lineage/README.md "Licensing note" and "Status").
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from pipeline.shapes import Tree
from tests.sources.support import load_source_module

HUMAN_ID = "homo-sapiens"
MINIMUM_NODE_COUNT = 30
SAMPLE_T_MIN = 1e3
SAMPLE_T_MAX = 4.5e9
SAMPLE_COUNT = 200
MINIMUM_DISTINCT_SAMPLED_NODES = 5


@pytest.fixture(scope="module")
def lineage_tree() -> Tree:
    normalise = load_source_module("lineage", "normalise")
    shapes = normalise.normalise(Path("unused-raw-dir"))
    assert len(shapes) == 1
    tree = shapes[0]
    assert isinstance(tree, Tree)
    return tree


def test_shape_id_is_lineage(lineage_tree: Tree) -> None:
    assert lineage_tree.id == "lineage"


def test_at_least_thirty_nodes(lineage_tree: Tree) -> None:
    assert len(lineage_tree.nodes) >= MINIMUM_NODE_COUNT


def test_ids_are_unique(lineage_tree: Tree) -> None:
    ids = [n.id for n in lineage_tree.nodes]
    assert len(ids) == len(set(ids))


def test_every_parent_resolves_to_a_known_node(lineage_tree: Tree) -> None:
    """Tree's own model_validator already enforces this at construction (it would have
    raised before this fixture even built), but assert it explicitly here too so a future
    change to that validator doesn't silently stop covering this contract."""
    ids = {n.id for n in lineage_tree.nodes}
    for node in lineage_tree.nodes:
        if node.parent is not None:
            assert node.parent in ids, f"{node.id}: parent {node.parent!r} does not resolve"


def test_exactly_one_root(lineage_tree: Tree) -> None:
    roots = [n for n in lineage_tree.nodes if n.parent is None]
    assert len(roots) == 1, f"expected exactly one root, found {[n.id for n in roots]}"
    assert roots[0].id == "luca"


def test_t_divergence_strictly_decreases_from_parent_to_child(lineage_tree: Tree) -> None:
    """A child originates after (nearer the present than) its parent, so t_divergence must
    be strictly smaller for the child — equal or larger would mean the child didn't
    actually postdate the split it descends from."""
    by_id_node = {n.id: n for n in lineage_tree.nodes}
    for node in lineage_tree.nodes:
        if node.parent is None:
            continue
        parent = by_id_node[node.parent]
        assert node.t_divergence < parent.t_divergence, (
            f"{node.id} (t={node.t_divergence}) does not postdate its parent "
            f"{node.parent} (t={parent.t_divergence})"
        )


def test_path_to_human_starts_at_luca_and_contains_every_node(lineage_tree: Tree) -> None:
    """This file is ONE PATH, not a phylogeny (docs/ONESHOT_SCOPE.md): every node must lie
    on the single chain from LUCA to Homo sapiens — no orphans, no branches."""
    path = lineage_tree.path_to(HUMAN_ID)
    assert path, "path_to(homo-sapiens) returned no nodes"
    assert path[0].id == "luca"
    assert path[-1].id == HUMAN_ID
    path_ids = [n.id for n in path]
    assert len(path_ids) == len(set(path_ids)), "path_to revisited a node — not a simple path"
    all_ids = {n.id for n in lineage_tree.nodes}
    assert set(path_ids) == all_ids, (
        f"path_to(homo-sapiens) omits nodes not on the main path: {sorted(all_ids - set(path_ids))}"
    )


def test_every_node_has_a_non_empty_citation(lineage_tree: Tree) -> None:
    for node in lineage_tree.nodes:
        assert node.citation is not None and node.citation.strip(), f"{node.id}: empty citation"


def test_every_node_has_a_non_empty_representative(lineage_tree: Tree) -> None:
    for node in lineage_tree.nodes:
        assert node.representative is not None and node.representative.strip(), (
            f"{node.id}: empty representative"
        )


def test_no_citation_mentions_timetree(lineage_tree: Tree) -> None:
    """The licence gate this package is built around (sources/lineage/README.md
    "Licensing note"): no committed date may be derived from, or attributed to, TimeTree."""
    for node in lineage_tree.nodes:
        assert "timetree" not in node.citation.lower(), f"{node.id}: citation mentions TimeTree"


def test_sample_over_log_spaced_domain_yields_at_least_five_distinct_nodes(
    lineage_tree: Tree,
) -> None:
    """Tree.sample(t) (pipeline/shapes.py) returns the most recent node that had already
    diverged by t. Sampling 200 log-spaced points across the full timeline should surface
    a good spread of nodes, not collapse onto one or two — a smoke test that the lineage
    actually covers deep time usefully, not just that individual nodes are well-formed."""
    log_min, log_max = math.log(SAMPLE_T_MIN), math.log(SAMPLE_T_MAX)
    sampled_ids: set[str] = set()
    for i in range(SAMPLE_COUNT):
        frac = i / (SAMPLE_COUNT - 1)
        t = math.exp(log_min + frac * (log_max - log_min))
        node = lineage_tree.sample(t)
        if node is not None:
            sampled_ids.add(node.id)
    assert len(sampled_ids) >= MINIMUM_DISTINCT_SAMPLED_NODES, (
        f"only {len(sampled_ids)} distinct nodes sampled across "
        f"[{SAMPLE_T_MIN}, {SAMPLE_T_MAX}]: {sorted(sampled_ids)}"
    )


def test_sample_at_present_returns_homo_sapiens(lineage_tree: Tree) -> None:
    node = lineage_tree.sample(0.0)
    assert node is not None
    assert node.id == HUMAN_ID


def test_domain_reaches_back_to_luca(lineage_tree: Tree) -> None:
    _, oldest = lineage_tree.domain
    luca = next(n for n in lineage_tree.nodes if n.id == "luca")
    assert oldest == luca.t_divergence
