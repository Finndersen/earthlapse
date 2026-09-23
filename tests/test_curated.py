"""Curated storage round-trips every shape and is the single loader for WorldModel."""

from __future__ import annotations

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from pipeline.curated import CuratedFormatError, load_world, path_for, read_shape, write_shape
from pipeline.shapes import (
    ArrivalEffect,
    ArrivalKind,
    CuratedShape,
    EffectAnchor,
    EffectWindow,
    Event,
    EventKind,
    EventSet,
    EventTag,
    Feature,
    FeatureCertainty,
    FeatureSet,
    Gap,
    GlobeEffect,
    GlobeEffectKind,
    Interpolation,
    PopulationEstimate,
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
    samples=[
        Sample(t=0.0, value=280.0),
        Sample(t=1e7, value=300.0),
        Sample(t=5e8, value=4000.0, lower=2000.0, upper=6000.0),
    ],
    gaps=[Gap(from_index=0, to_index=1)],
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
        Event(
            id="arrival-example",
            label="An event with a schematic arrival",
            kind=EventKind.MOMENT,
            t_min=1.0,
            t_max=2.0,
            t=1.5,
            tags=[EventTag.HUMAN_ORIGINS],
            importance=0.2,
            description="d.",
            citation="c.",
            effect=ArrivalEffect(
                kind=GlobeEffectKind.ARRIVAL,
                arrival_kind=ArrivalKind.PEOPLING,
                origin=EffectAnchor(lat=2.0, lon=20.0),
                destination=EffectAnchor(lat=31.5, lon=35.0),
                established=1.5,
                windows=[EffectWindow(t_min=0.0, t_max=2.0)],
            ),
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
CITIES = FeatureSet(
    id="cities",
    features=[
        Feature(
            id="uruk",
            name="Uruk",
            country="Iraq",
            lat=31.32,
            lon=45.64,
            certainty=FeatureCertainty.HIGH,
            estimates=[
                PopulationEstimate(t=6700.0, population=14_000),
                PopulationEstimate(t=5700.0, population=40_000),
            ],
        ),
    ],
)


@pytest.mark.parametrize(
    "shape", [CO2, EVENTS, PALEODEM, LINEAGE, CITIES], ids=lambda s: type(s).__name__
)
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
    for shape in (CO2, EVENTS, PALEODEM, LINEAGE, CITIES):
        write_shape(shape, tmp_path)
    world = load_world(tmp_path)
    assert (world.series, world.events, world.rasters, world.trees, world.features) == (
        {"co2": CO2},
        {"events-core": EVENTS},
        {"paleodem": PALEODEM},
        {"lineage": LINEAGE},
        {"cities": CITIES},
    )
    state = world.at(0.0)
    assert state.atmosphere.co2_ppm == 280.0
    assert state.plates.elevation is not None
    assert state.biosphere.ancestor == LINEAGE.nodes[0]
