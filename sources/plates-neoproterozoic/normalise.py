"""Normalise data/raw/plates-neoproterozoic/ into data/curated/plates_neoproterozoic.parquet.

docs/GLOBE.md §4.1 (G7): continents from Merdith et al. 2021's `ContinentalPolygons`,
reconstructed every 10 Myr from 1000 to 550 Ma, plus one extra frame at 540 Ma so the
integrator can cross-fade the seam against `sources/paleodem`'s own 540 Ma frame (the two
reconstructions don't agree there -- see README.md "540 Ma seam"). One `RasterSequence`
comes out, id `"plates_neoproterozoic"` -- deliberately no companion `TimeSeries` (unlike
`sources/paleodem`'s `land_fraction`): nothing downstream needs one yet, and adding one
unused would be curated data for nothing.

Unlike `sources/paleodem`, `normalise()` here needs nothing from `pygplates` -- the frame
ages are fixed by this module's own `FRAME_AGES_MA`, not discovered from raw file contents,
so this function only has to confirm the three raw files fetch() produces are present. The
actual plate reconstruction (pygplates, GPL-2.0, the project's `geo` extra) happens in the
sibling `relief.py`, loaded only from `write_outputs()` below -- mirroring docs/GLOBE.md
§3.4's stated plan for `sources/plates` (G3): "Tests never import gplately: the extraction
runs in write_outputs under the geo extra, and normalise() reads the committed or derived
tables only." Keeping that import out of this module means `tests/sources/
test_plates_neoproterozoic.py` never needs the `geo` extra installed.
"""

from __future__ import annotations

from pathlib import Path

from pipeline.curated import write_shape
from pipeline.databuild import load_source_module
from pipeline.shapes import CuratedShape, RasterFrame, RasterSequence

CURATED_ID = "plates_neoproterozoic"

MA_TO_YEARS = 1e6

FRAME_AGES_MA: tuple[float, ...] = tuple(float(age) for age in range(1000, 549, -10)) + (540.0,)
"""1000, 990, ..., 560, 550 (46 frames, 10 Myr apart) plus 540 Ma (the seam frame). Fixed by
this module, not discovered from raw data -- geometry can be reconstructed at any t, so
there's no "native epoch" to read off a filename the way sources/paleodem does."""

TEXTURE_EXTENSION = ".webp"
TEXTURE_WEBP_QUALITY = 90
"""Same encoding as sources/paleodem (README.md "Texture encoding") so the two sources'
frames -- crossfaded across the 540 Ma seam -- don't jump in compression artefacting."""

_TEXTURE_SUBDIR = Path("textures") / CURATED_ID

_CONTINENTS_FILENAME = "shapes_continents_Merdith_et_al.gpml"
_CRATONS_FILENAME = "shapes_cratons_Merdith_et_al.gpml"
_ROTATIONS_FILENAME = "1000_0_rotfile_Merdith_et_al.rot"
_EXPECTED_RAW_FILENAMES = (_CONTINENTS_FILENAME, _CRATONS_FILENAME, _ROTATIONS_FILENAME)


class MissingRawFilesError(FileNotFoundError):
    """raw_dir is missing one of the three files fetch() is supposed to have extracted."""


def _validate_raw_dir(raw_dir: Path) -> None:
    missing = [name for name in _EXPECTED_RAW_FILENAMES if not (raw_dir / name).is_file()]
    if missing:
        raise MissingRawFilesError(
            f"plates-neoproterozoic: missing {missing} in {raw_dir} -- run fetch() first"
        )


def _texture_name(age_ma: float) -> str:
    """`0540.0Ma.webp` .. `1000.0Ma.webp`: zero-padded to a fixed width so a directory
    listing sorts chronologically even with the 4-digit ages this source reaches (unlike
    sources/paleodem, capped at 540)."""
    return f"{age_ma:06.1f}Ma{TEXTURE_EXTENSION}"


def _frame_ref(age_ma: float) -> str:
    return (_TEXTURE_SUBDIR / _texture_name(age_ma)).as_posix()


def normalise(raw_dir: Path) -> list[CuratedShape]:
    _validate_raw_dir(raw_dir)
    frames = [RasterFrame(t=age * MA_TO_YEARS, ref=_frame_ref(age)) for age in FRAME_AGES_MA]
    return [RasterSequence(id=CURATED_ID, frames=frames)]


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s optional post-normalise side-effect hook (see CONTRIBUTING.md "Optional
    write_outputs hook"), mirroring sources/paleodem/normalise.py's own. Loads the heavy
    pygplates-based renderer by path (module docstring) rather than importing it at this
    module's top level."""
    _validate_raw_dir(raw_dir)
    relief = load_source_module(Path(__file__).resolve().parent, "relief")
    out_dir = repo_root / "data" / "media" / _TEXTURE_SUBDIR
    relief.render_textures(
        continents_path=raw_dir / _CONTINENTS_FILENAME,
        cratons_path=raw_dir / _CRATONS_FILENAME,
        rotations_path=raw_dir / _ROTATIONS_FILENAME,
        out_dir=out_dir,
        frame_ages_ma=FRAME_AGES_MA,
        texture_name=_texture_name,
        webp_quality=TEXTURE_WEBP_QUALITY,
    )


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "plates-neoproterozoic"
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")
    write_outputs(raw_dir, repo_root)
    print(f"wrote textures to {repo_root / 'data' / 'media' / _TEXTURE_SUBDIR}")


if __name__ == "__main__":
    main()
