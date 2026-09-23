"""Present-day location -> paleo position (ADR-034), for scenes older than the human-era
basemap domain (ADR-030) whose `location` (pipeline/scenes.py) the globe must mark at the
scene's own `t`, not at its modern coordinates.

Reuses the Merdith et al. 2021 plate model already fetched for `sources/plates-neoproterozoic`
(`relief.py`'s pygplates usage is the template this module follows): that source's own raw
directory holds a continuous 0-1000 Ma rotation model plus the continental polygons pygplates
needs to assign a present-day point to a plate id, even though the source's own *texture*
output only uses 540-1000 Ma of the same files (0-540 Ma already has real elevation data from
`sources/paleodem`, needing no reconstruction). No new download, no new model.

pygplates (GPL-2.0, the project's `geo` extra) is imported only inside `load_reconstructor`,
never at this module's top level, so this module -- and `pipeline.publish`, which calls it --
stay importable without the extra installed, and so this file's own tests never import it
(mirrors `sources/plates-neoproterozoic/normalise.py`'s `write_outputs` pattern; see that
source's README "Confirming pygplates can reconstruct" for why the real reconstruction is
exercised manually, never by pytest, a convention this module keeps).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pipeline.shapes import GeoTime

MODEL_DOMAIN: tuple[GeoTime, GeoTime] = (0.0, 1.0e9)
"""years BP -- Merdith et al. 2021's published domain, a continuous rotation model from 1000 Ma
to present (docs/DATA_SOURCES.md "plates-neoproterozoic"). `reconstruct()` cannot answer at all
outside this range."""

_CONTINENTS_FILENAME = "shapes_continents_Merdith_et_al.gpml"
_ROTATIONS_FILENAME = "1000_0_rotfile_Merdith_et_al.rot"

_YEARS_PER_MA = 1.0e6


class PlateModelUnavailable(RuntimeError):
    """The Merdith raw files are not present, or pygplates (the `geo` extra) is not installed.
    Callers treat this as "reconstruction is not feasible" (CLAUDE.md "if something is
    unusable, stop and report") -- never as licence to fall back to present-day coordinates."""


class Reconstructor(Protocol):
    """A loaded plate model. `load_reconstructor` builds the real one; tests use a fake, so
    they never need pygplates installed."""

    def reconstruct(self, lat: float, lon: float, t: GeoTime) -> tuple[float, float] | None:
        """Present-day `(lat, lon)` reconstructed to years-before-present `t`, or `None` if
        `t` falls outside `MODEL_DOMAIN`, or no polygon in the model covers this point -- a
        genuine model gap (e.g. the Isthmus of Panama, not part of Merdith's continental
        blocks), not an error."""
        ...


@dataclass(frozen=True)
class _PygplatesReconstructor:
    """Built once per `earthtime publish` run (`load_reconstructor` is the expensive part --
    parsing two GPML files) and reused for every scene that needs it."""

    partitioner: object  # pygplates.PlatePartitioner, present-day (t=0) partitioning
    rotation_model: object  # pygplates.RotationModel

    def reconstruct(self, lat: float, lon: float, t: GeoTime) -> tuple[float, float] | None:
        import pygplates  # already loaded by load_reconstructor; re-import is a cheap cache hit

        if not (MODEL_DOMAIN[0] <= t <= MODEL_DOMAIN[1]):
            return None
        point = pygplates.PointOnSphere(lat, lon)
        hit = self.partitioner.partition_point(point)
        if hit is None:
            return None
        plate_id = hit.get_feature().get_reconstruction_plate_id()
        rotation = self.rotation_model.get_rotation(t / _YEARS_PER_MA, plate_id, 0.0)
        new_lat, new_lon = (rotation * point).to_lat_lon()
        return new_lat, new_lon


def load_reconstructor(raw_dir: Path) -> Reconstructor:
    """`raw_dir` is `sources/plates-neoproterozoic`'s raw directory, populated by that source's
    `fetch.py` (`make data`). Raises `PlateModelUnavailable` if the extra isn't installed or
    the files aren't there -- callers turn that into a `PublishRefused`, never a silent
    fallback."""
    continents_path = raw_dir / _CONTINENTS_FILENAME
    rotations_path = raw_dir / _ROTATIONS_FILENAME
    missing = [p.name for p in (continents_path, rotations_path) if not p.is_file()]
    if missing:
        raise PlateModelUnavailable(
            f"Merdith plate model file(s) missing from {raw_dir}: {missing} -- run `make data` "
            "(sources/plates-neoproterozoic/fetch.py) first"
        )
    try:
        import pygplates
    except ModuleNotFoundError as err:
        raise PlateModelUnavailable(
            "pygplates is not installed -- install the geo extra: pip install -e '.[geo]'"
        ) from err
    rotation_model = pygplates.RotationModel(str(rotations_path))
    continents = pygplates.FeatureCollection(str(continents_path))
    partitioner = pygplates.PlatePartitioner(continents, rotation_model, reconstruction_time=0.0)
    return _PygplatesReconstructor(partitioner=partitioner, rotation_model=rotation_model)
