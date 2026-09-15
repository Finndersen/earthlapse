"""Curated storage round-trips every shape and is the single loader for WorldModel."""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from pipeline.curated import CuratedFormatError, load_world, path_for, read_shape, write_shape
from pipeline.shapes import (
    CuratedShape,
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventSet,
    EventTag,
    Gap,
    GlobeEffect,
    GlobeEffectKind,
    Interpolation,
    RasterFrame,
    RasterSequence,
    Sample,
    TimeSeries,
    Tree,
    TreeNode,
)

CO2 = TimeSeries(
    id="co2",
    unit="ppm",
    interpolation=Interpolation.LOG_LINEAR,
    samples=[Sample(t=0.0, value=280.0), Sample(t=5e8, value=4000.0, lower=2000.0, upper=6000.0)],
)
EVENTS = EventSet(
    id="events-core",
    events=[
        Event(
            id="kpg",
            label="K-Pg impact",
            kind=EventKind.MOMENT,
            t_min=6.6e7,
            t_max=6.61e7,
            t=6.605e7,
            tags=[EventTag.CATASTROPHE, EventTag.LIFE],
            importance=0.95,
            description="Chicxulub.",
            citation="Renne et al. 2013",
            # Exercises the additive `effect` field (docs/GLOBE.md §6) through the round trip
            # below, both the anchored case (this event) and the absent case ("no-effect").
            effect=GlobeEffect(
                kind=GlobeEffectKind.IMPACT_WINTER,
                anchor=EffectAnchor(lat=21.3, lon=-89.5),
                windows=[EffectWindow(t_min=6.6e7, t_max=6.61e7)],
            ),
        ),
        Event(
            id="no-effect",
            label="An event with no globe visual",
            kind=EventKind.PERIOD,
            t_min=0.0,
            t_max=1.0,
            tags=[EventTag.SOCIETY],
            importance=0.1,
            description="d.",
            citation="c.",
        ),
    ],
)
PALEODEM = RasterSequence(
    id="paleodem",
    frames=[
        RasterFrame(t=0.0, ref="textures/paleodem/0.png"),
        RasterFrame(t=1e8, ref="textures/paleodem/100.png"),
    ],
)
LINEAGE = Tree(
    id="lineage",
    nodes=[
        TreeNode(
            id="luca", parent=None, label="LUCA", t_divergence=4.0e9, citation="Moody et al. 2024"
        ),
        TreeNode(
            id="human",
            parent="luca",
            label="Homo sapiens",
            t_divergence=3.0e5,
            representative="Homo sapiens",
        ),
    ],
)


@pytest.mark.parametrize("shape", [CO2, EVENTS, PALEODEM, LINEAGE], ids=lambda s: type(s).__name__)
def test_every_shape_round_trips_exactly(shape: CuratedShape, tmp_path: Path) -> None:
    path = write_shape(shape, tmp_path)
    assert path == path_for(shape.id, tmp_path)
    assert read_shape(path) == shape


def test_file_renamed_away_from_its_shape_id_is_rejected(tmp_path: Path) -> None:
    write_shape(CO2, tmp_path).rename(tmp_path / "o2.parquet")
    with pytest.raises(CuratedFormatError):
        read_shape(tmp_path / "o2.parquet")


def test_parquet_without_shape_metadata_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "co2.parquet"
    pq.write_table(pa.table({"t": [0.0], "value": [1.0]}), path)
    with pytest.raises(CuratedFormatError):
        read_shape(path)


def test_load_world_registers_each_shape_by_id(tmp_path: Path) -> None:
    for shape in (CO2, EVENTS, PALEODEM, LINEAGE):
        write_shape(shape, tmp_path)
    world = load_world(tmp_path)
    assert (world.series, world.events, world.rasters, world.trees) == (
        {"co2": CO2},
        {"events-core": EVENTS},
        {"paleodem": PALEODEM},
        {"lineage": LINEAGE},
    )
    state = world.at(0.0)
    assert state.atmosphere.co2_ppm == 280.0
    assert state.plates.elevation is not None
    assert state.biosphere.ancestor == LINEAGE.nodes[0]


def test_load_world_on_missing_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_world(tmp_path / "absent")


def test_event_effect_is_stored_as_a_json_string_column(tmp_path: Path) -> None:
    """A storage detail, not part of the NORMATIVE contract (pipeline.shapes.GlobeEffect is
    a nested model there) — but locking it in here means a future refactor of write_shape's
    encoding can't silently break round-tripping without a test failing here first."""
    path = write_shape(EVENTS, tmp_path)
    table = pq.read_table(path)
    assert table.schema.field("effect").type == pa.string()
    rows = table.to_pylist()
    kpg = next(r for r in rows if r["id"] == "kpg")
    no_effect = next(r for r in rows if r["id"] == "no-effect")
    assert isinstance(kpg["effect"], str) and kpg["effect"].startswith("{")
    assert no_effect["effect"] is None


def test_gaps_round_trip_through_the_header_not_a_column(tmp_path: Path) -> None:
    """ADR-027: `gaps` lives in `write_shape`'s JSON header alongside `unit`/`interpolation`,
    not a per-sample parquet column, so it round-trips for free through the existing
    header/rows split -- this pins that in place, and that a file with no gaps (every other
    fixture in this module) keeps writing `"gaps": []` rather than omitting the key."""
    with_gap = TimeSeries(
        id="co2",
        unit="ppm",
        interpolation=Interpolation.LOG_LINEAR,
        samples=[
            Sample(t=0.0, value=280.0),
            Sample(t=1.0, value=270.0),
            Sample(t=2.0, value=260.0),
        ],
        gaps=[Gap(from_index=0, to_index=1)],
    )
    path = write_shape(with_gap, tmp_path)
    table = pq.read_table(path)
    assert set(table.schema.names) == {"t", "value", "lower", "upper"}  # unchanged, no new column
    meta = json.loads((table.schema.metadata or {})[b"earthtime"])
    assert meta["header"]["gaps"] == [{"from_index": 0, "to_index": 1}]
    assert read_shape(path) == with_gap


def test_kind_t_tags_round_trip_through_parquet(tmp_path: Path) -> None:
    """ADR-022: `t` is nullable (absent for a period), `tags` is a plain list<string> column
    (no JSON encoding needed, unlike the nested `effect` model above)."""
    path = write_shape(EVENTS, tmp_path)
    table = pq.read_table(path)
    assert table.schema.field("kind").type == pa.string()
    assert table.schema.field("t").type == pa.float64()
    assert table.schema.field("tags").type == pa.list_(pa.string())
    rows = table.to_pylist()
    kpg = next(r for r in rows if r["id"] == "kpg")
    no_effect = next(r for r in rows if r["id"] == "no-effect")
    assert (kpg["kind"], kpg["t"], kpg["tags"]) == ("moment", 6.605e7, ["catastrophe", "life"])
    assert (no_effect["kind"], no_effect["t"], no_effect["tags"]) == ("period", None, ["society"])
