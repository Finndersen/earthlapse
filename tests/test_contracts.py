"""Contract tests for the serial spine.

These pin the behaviour every parallel agent depends on. If one of these fails, two agents
are about to build incompatible things. Run before any fan-out.

Offline by construction — no fixtures, no network, no curated data.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.graph import AssetKind, AssetNode, Pin, Resolver, Status
from pipeline.models import WorldModel
from pipeline.shapes import (
    Event,
    EventKind,
    EventSet,
    EventTag,
    Gap,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
    Tree,
    TreeNode,
)
from pipeline.spend import DEFAULT_CEILING_USD, BudgetExceeded, Ledger


@pytest.fixture
def co2() -> TimeSeries:
    return TimeSeries(
        id="co2",
        unit="ppm",
        interpolation=Interpolation.LOG_LINEAR,
        samples=[Sample(t=0, value=420), Sample(t=1e8, value=1000), Sample(t=5e8, value=4000)],
    )


@pytest.fixture
def lineage() -> Tree:
    return Tree(
        id="lineage",
        nodes=[
            TreeNode(id="luca", parent=None, label="LUCA", t_divergence=4.0e9),
            TreeNode(id="tetrapod", parent="luca", label="Tetrapoda", t_divergence=3.9e8),
            TreeNode(id="human", parent="tetrapod", label="Homo sapiens", t_divergence=3.0e5),
        ],
    )


# --------------------------------------------------------------------------- TimeSeries


def test_exact_sample_is_returned_verbatim(co2: TimeSeries) -> None:
    assert co2.sample(0) == 420


def test_log_linear_interpolation_stays_between_neighbours(co2: TimeSeries) -> None:
    assert 420 < co2.sample(5e7) < 1000


def test_outside_domain_is_none_not_extrapolated(co2: TimeSeries) -> None:
    """Deep time is patchy. Absence must render as absence, never as a plausible number."""
    assert co2.sample(1e10) is None


def test_samples_are_sorted_on_construction() -> None:
    ts = TimeSeries(
        id="x",
        unit="u",
        interpolation=Interpolation.LINEAR,
        samples=[Sample(t=100, value=2), Sample(t=0, value=1)],
    )
    assert [s.t for s in ts.samples] == [0, 100]


# ------------------------------------------------------------------------------------- Gap


def _series(gaps: list[Gap]) -> TimeSeries:
    return TimeSeries(
        id="x",
        unit="u",
        interpolation=Interpolation.LINEAR,
        samples=[
            Sample(t=0, value=1),
            Sample(t=1, value=2),
            Sample(t=2, value=3),
            Sample(t=3, value=4),
        ],
        gaps=gaps,
    )


def test_gap_must_span_adjacent_indices() -> None:
    with pytest.raises(ValueError, match="to_index must be from_index \\+ 1"):
        Gap(from_index=0, to_index=2)


def test_gap_to_index_out_of_range_is_rejected() -> None:
    with pytest.raises(ValueError, match="out of range"):
        _series([Gap(from_index=3, to_index=4)])


def test_overlapping_gaps_are_rejected() -> None:
    with pytest.raises(ValueError, match="overlap"):
        _series([Gap(from_index=0, to_index=1), Gap(from_index=0, to_index=1)])


def test_adjoining_gaps_sharing_one_boundary_sample_are_accepted() -> None:
    # samples[1] is both the end of the first gap and the start of the second -- a single real
    # reading bridging two "no data" spans, not an overlap.
    ts = _series([Gap(from_index=1, to_index=2), Gap(from_index=0, to_index=1)])
    assert [(g.from_index, g.to_index) for g in ts.gaps] == [(0, 1), (1, 2)]


def test_sample_is_none_strictly_inside_a_gap() -> None:
    assert _series([Gap(from_index=1, to_index=2)]).sample(1.5) is None


def test_sample_at_a_gap_edge_is_real_and_outside_a_gap_still_interpolates() -> None:
    ts = _series([Gap(from_index=1, to_index=2)])
    assert (ts.sample(1), ts.sample(2)) == (2, 3)
    assert ts.sample(0.5) == pytest.approx(1.5)


# ----------------------------------------------------------------------------- EventSet


def _event(eid: str, t_min: float, t_max: float, importance: float) -> Event:
    return Event(
        id=eid,
        label=eid,
        kind=EventKind.PERIOD,
        t_min=t_min,
        t_max=t_max,
        tags=[EventTag.LIFE],
        importance=importance,
        description=".",
        citation=".",
    )


def test_window_filters_by_zoom_lod_importance() -> None:
    es = EventSet(
        id="e", events=[_event("kpg", 6.60e7, 6.61e7, 0.95), _event("minor", 1e6, 2e6, 0.1)]
    )
    assert len(es.window(0, 1e8)) == 2
    assert len(es.window(0, 1e8, min_importance=0.5)) == 1


def test_inverted_uncertainty_interval_is_rejected() -> None:
    with pytest.raises(ValueError):
        _event("bad", 100, 10, 0.5)


# ----------------------------------------------------------------------- RasterSequence


def test_blend_alpha_is_continuous_between_frames() -> None:
    """This is what makes continental drift continuous rather than a slideshow of epochs."""
    rs = RasterSequence(
        id="r", frames=[RasterFrame(t=0, ref="a.png"), RasterFrame(t=100, ref="b.png")]
    )
    blend = rs.sample(25)
    assert blend is not None
    assert blend.before == "a.png" and blend.after == "b.png"
    assert blend.alpha == pytest.approx(0.25)


# --------------------------------------------------------------------------------- Tree


def test_ancestor_lookup_returns_lineage_member_alive_at_t(lineage: Tree) -> None:
    assert lineage.sample(1e9).label == "LUCA"
    assert lineage.sample(2e8).label == "Tetrapoda"


def test_path_to_walks_back_to_root(lineage: Tree) -> None:
    assert [n.id for n in lineage.path_to("human")] == ["luca", "tetrapod", "human"]


def test_unknown_parent_is_rejected() -> None:
    with pytest.raises(ValueError):
        Tree(id="t", nodes=[TreeNode(id="a", parent="ghost", label="A", t_divergence=1.0)])


# --------------------------------------------------------------------------- WorldState


def test_worldstate_diff_names_what_changed(co2: TimeSeries, lineage: Tree) -> None:
    """Transition prompts describe deltas rather than inferring them (ADR-002)."""
    wm = WorldModel(series={"co2": co2}, trees={"lineage": lineage})
    changed = wm.at(0).diff(wm.at(5e7))
    assert "atmosphere.co2_ppm" in changed


def test_absent_source_yields_none_not_a_crash(co2: TimeSeries) -> None:
    """A partial MVP must still build — an unregistered source is None, not an error."""
    state = WorldModel(series={"co2": co2}).at(0)
    assert state.atmosphere.co2_ppm == 420
    assert state.climate.sea_level_m is None
    assert state.anthropo is None


# -------------------------------------------------------------------------- asset graph


class _EmptyStore:
    def has(self, digest: str) -> bool:
        return False

    def path_for(self, digest: str) -> Path:
        return Path(digest)


def _two_node_graph() -> list[AssetNode]:
    return [
        AssetNode(id="prompt1", kind=AssetKind.PROMPT, generator="tpl", generator_version="1"),
        AssetNode(
            id="img1",
            kind=AssetKind.IMAGE,
            generator="flux2",
            generator_version="1",
            depends_on=["prompt1"],
        ),
    ]


def test_upstream_change_propagates_to_downstream_digest() -> None:
    nodes = _two_node_graph()
    before = Resolver(nodes, {}, _EmptyStore()).digest("img1")
    nodes[0].config["seed"] = 7
    assert Resolver(nodes, {}, _EmptyStore()).digest("img1") != before


def test_digest_is_order_independent() -> None:
    a = AssetNode(
        id="n", kind=AssetKind.IMAGE, generator="g", generator_version="1", config={"x": 1, "y": 2}
    )
    b = AssetNode(
        id="n", kind=AssetKind.IMAGE, generator="g", generator_version="1", config={"y": 2, "x": 1}
    )
    assert a.digest() == b.digest()


def test_pinned_node_survives_a_rebuild() -> None:
    """ADR-005. Without this the project is unusable after week two."""
    nodes = _two_node_graph()
    pins = {"img1": Pin(node_id="img1", asset_digest="x", path="p")}
    resolver = Resolver(nodes, pins, _EmptyStore())
    assert resolver.status("img1") is Status.PINNED
    assert [n.id for n in resolver.stale()] == ["prompt1"]


def test_stale_list_is_topologically_ordered() -> None:
    stale = Resolver(_two_node_graph(), {}, _EmptyStore()).stale()
    assert [n.id for n in stale] == ["prompt1", "img1"]


# --------------------------------------------------------------------------------- spend


def test_the_default_ceiling_is_the_project_budget_of_100_usd() -> None:
    assert DEFAULT_CEILING_USD == 100.0
    assert Ledger().ceiling_usd == 100.0


def test_ceiling_refuses_rather_than_overspending() -> None:
    ledger = Ledger(ceiling_usd=25.0)
    entry = ledger.reserve("img1", "flux2", 4, 20.0)
    ledger.settle(entry, 18.5)
    with pytest.raises(BudgetExceeded):
        ledger.reserve("img2", "flux2", 4, 20.0)
    assert len(ledger.entries) == 1


def test_a_call_that_lands_exactly_on_the_ceiling_is_allowed() -> None:
    ledger = Ledger(ceiling_usd=1.0)
    ledger.reserve("a", "g", 1, 0.25)
    ledger.reserve("b", "g", 1, 0.75)
    assert (ledger.spent, ledger.remaining) == (1.0, 0.0)
    with pytest.raises(BudgetExceeded):
        ledger.check(0.01)


def test_unsettled_reservation_counts_against_budget() -> None:
    """A crash mid-call must not produce spend the ledger never saw."""
    ledger = Ledger(ceiling_usd=100.0)
    ledger.reserve("img1", "flux2", 1, 30.0)
    assert ledger.spent == 30.0


def test_spent_uses_the_actual_cost_once_settled() -> None:
    ledger = Ledger()
    ledger.settle(ledger.reserve("a", "g", 1, 5.0), 0.0)
    ledger.settle(ledger.reserve("b", "g", 1, 5.0), 7.5)
    assert ledger.spent == 7.5


def test_remaining_never_goes_negative() -> None:
    ledger = Ledger(ceiling_usd=10.0)
    ledger.settle(ledger.reserve("a", "g", 1, 5.0), 40.0)
    assert ledger.remaining == 0.0


def test_the_ledger_round_trips_through_spend_json(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "spend.json"
    ledger = Ledger(ceiling_usd=100.0)
    ledger.settle(ledger.reserve("a", "g", 2, 1.5), 1.25)
    ledger.reserve("b", "g", 1, 0.5)

    ledger.save(path)

    assert Ledger.load(path, ceiling_usd=100.0) == ledger


def test_loading_a_missing_ledger_starts_empty_at_the_given_ceiling(tmp_path: Path) -> None:
    assert Ledger.load(tmp_path / "spend.json") == Ledger(ceiling_usd=100.0)
    assert Ledger.load(tmp_path / "spend.json", ceiling_usd=3.0).ceiling_usd == 3.0


def test_load_overwrites_the_stored_ceiling_with_the_given_absolute_value(tmp_path: Path) -> None:
    """`--max-spend` replaces the ceiling; it does not add to it or keep the stored one."""
    path = tmp_path / "spend.json"
    stored = Ledger(ceiling_usd=100.0)
    stored.settle(stored.reserve("a", "g", 1, 60.0), 60.0)
    stored.save(path)

    lowered = Ledger.load(path, ceiling_usd=10.0)
    raised = Ledger.load(path, ceiling_usd=500.0)

    assert (lowered.ceiling_usd, lowered.spent, lowered.remaining) == (10.0, 60.0, 0.0)
    assert raised.ceiling_usd == 500.0
    assert Ledger.load(path).ceiling_usd == DEFAULT_CEILING_USD
    assert json.loads(path.read_text())["ceiling_usd"] == 100.0
