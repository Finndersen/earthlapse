"""Curated storage round-trips every shape and is the single loader for WorldModel."""

from __future__ import annotations

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
    EventSet,
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
            t_min=6.6e7,
            t_max=6.61e7,
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
            t_min=0.0,
            t_max=1.0,
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
