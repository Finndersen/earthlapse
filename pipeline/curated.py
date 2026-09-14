"""Curated-data storage, and the loader that turns data/curated/ into a WorldModel.

This is the only module that reads data/curated/ (ADR-002). Sources write through
`write_shape`; everything downstream goes through `load_world(...).at(t)`.

File convention: `<curated_dir>/<shape.id>.parquet`, one file per shape instance. The shape id
is also the key `WorldModel` registers it under, so a TimeSeries must be named for the key
`WorldModel.at` reads ("co2", "day_length", ...). One row per sample / event / frame / node;
shape-level fields (unit, interpolation) live in the parquet schema metadata.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

import pyarrow as pa
import pyarrow.parquet as pq

from pipeline.models import WorldModel
from pipeline.shapes import CuratedShape, EventSet, RasterSequence, TimeSeries, Tree

_METADATA_KEY: Final = b"earthtime"


class CuratedFormatError(ValueError):
    """A curated file does not follow the storage convention."""


class _Layout:
    def __init__(
        self, items_field: str, schema: pa.Schema, json_fields: frozenset[str] = frozenset()
    ) -> None:
        self.items_field = items_field
        self.schema = schema
        # Columns holding a nested model (or None) rather than a scalar. Parquet's column
        # types are flat, so these round-trip as a JSON string column instead — encoded on
        # write, decoded on read. Pydantic reconstructs the nested model from the resulting
        # dict either way, so this is a storage detail, invisible above write_shape/read_shape.
        self.json_fields = json_fields


_LAYOUTS: Final[dict[type[CuratedShape], _Layout]] = {
    TimeSeries: _Layout(
        "samples",
        pa.schema(
            [
                ("t", pa.float64()),
                ("value", pa.float64()),
                ("lower", pa.float64()),
                ("upper", pa.float64()),
            ]
        ),
    ),
    EventSet: _Layout(
        "events",
        pa.schema(
            [
                ("id", pa.string()),
                ("label", pa.string()),
                ("t_min", pa.float64()),
                ("t_max", pa.float64()),
                ("importance", pa.float64()),
                ("description", pa.string()),
                ("citation", pa.string()),
                ("effect", pa.string()),  # JSON-encoded GlobeEffect, or null — see json_fields
            ]
        ),
        json_fields=frozenset({"effect"}),
    ),
    RasterSequence: _Layout("frames", pa.schema([("t", pa.float64()), ("ref", pa.string())])),
    Tree: _Layout(
        "nodes",
        pa.schema(
            [
                ("id", pa.string()),
                ("parent", pa.string()),
                ("label", pa.string()),
                ("t_divergence", pa.float64()),
                ("representative", pa.string()),
                ("note", pa.string()),
                ("citation", pa.string()),
            ]
        ),
    ),
}

_SHAPES_BY_NAME: Final[dict[str, type[CuratedShape]]] = {cls.__name__: cls for cls in _LAYOUTS}


def path_for(shape_id: str, curated_dir: Path) -> Path:
    return curated_dir / f"{shape_id}.parquet"


def write_shape(shape: CuratedShape, curated_dir: Path) -> Path:
    layout = _LAYOUTS[type(shape)]
    dumped = shape.model_dump(mode="json")
    rows = dumped.pop(layout.items_field)
    for row in rows:
        for field in layout.json_fields:
            if row.get(field) is not None:
                row[field] = json.dumps(row[field])
    metadata = {_METADATA_KEY: json.dumps({"shape": type(shape).__name__, "header": dumped})}
    table = pa.Table.from_pylist(rows, schema=layout.schema.with_metadata(metadata))
    path = path_for(shape.id, curated_dir)
    curated_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path)
    return path


def read_shape(path: Path) -> CuratedShape:
    table = pq.read_table(path)
    raw = (table.schema.metadata or {}).get(_METADATA_KEY)
    if raw is None:
        raise CuratedFormatError(f"{path}: missing {_METADATA_KEY.decode()} schema metadata")
    meta = json.loads(raw)
    try:
        cls = _SHAPES_BY_NAME[meta["shape"]]
    except KeyError as err:
        raise CuratedFormatError(f"{path}: unknown shape {meta.get('shape')!r}") from err
    layout = _LAYOUTS[cls]
    if table.schema.names != layout.schema.names:
        raise CuratedFormatError(
            f"{path}: columns {table.schema.names} do not match {cls.__name__} layout "
            f"{layout.schema.names}"
        )
    rows = table.to_pylist()
    for row in rows:
        for field in layout.json_fields:
            if row.get(field) is not None:
                row[field] = json.loads(row[field])
    shape = cls.model_validate({**meta["header"], layout.items_field: rows})
    if shape.id != path.stem:
        raise CuratedFormatError(f"{path}: file name does not match shape id {shape.id!r}")
    return shape


def load_world(curated_dir: Path) -> WorldModel:
    """Every curated file, registered by shape id. An absent source is simply unregistered,
    so `WorldModel.at` yields None for its fields rather than failing."""
    if not curated_dir.is_dir():
        raise FileNotFoundError(f"curated data directory not found: {curated_dir}")
    series: dict[str, TimeSeries] = {}
    rasters: dict[str, RasterSequence] = {}
    events: dict[str, EventSet] = {}
    trees: dict[str, Tree] = {}
    for path in sorted(curated_dir.glob("*.parquet")):
        match read_shape(path):
            case TimeSeries() as ts:
                series[ts.id] = ts
            case RasterSequence() as rs:
                rasters[rs.id] = rs
            case EventSet() as es:
                events[es.id] = es
            case Tree() as tree:
                trees[tree.id] = tree
    return WorldModel(series=series, rasters=rasters, events=events, trees=trees)
