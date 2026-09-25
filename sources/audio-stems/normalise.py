"""Place every catalogued stem's raw file at its published location, data/media/audio/.

ADR-023: audio stems are not one of the four curated shapes (`docs/DATA_SOURCES.md` §
Contract) -- they are not `WorldState`-projectable, time-indexed data, so `normalise()`
returns no `CuratedShape` at all. The real work happens in `write_outputs()`, the same
`pipeline.databuild` side-effect hook `sources/paleodem/normalise.py` uses for its globe
textures: it runs after `normalise()`, writes outside `data/curated/`, and is declared via
`manifest.toml`'s `outputs` globs.

Each raw file is published after checking its container format actually matches the `format` a
`[[stems]]` entry declares: a WAV unchanged, an MP3 decoded, cut to the span that plays and
re-encoded small (`pipeline.audio.published_bytes`, `pipeline/mp3.py`). The raw file itself is
never modified. Level matching and loop points are curator-attested `stems.toml` fields applied at
playback -- see README.md "Why levels are attested, not measured at build time".
"""

from __future__ import annotations

from pathlib import Path

from pipeline.audio import (
    StemManifest,
    content_hashed_filename,
    load_stem_book,
    published_bytes,
    sniff_audio,
)
from pipeline.shapes import CuratedShape

_STEMS_TOML = Path(__file__).resolve().parent / "stems.toml"
_MEDIA_SUBDIR = Path("audio")


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Always empty -- see module docstring. `raw_dir` is unused; kept only so this matches
    the `normalise(raw_dir: Path) -> list[CuratedShape]` convention every source's
    `normalise.py` shares, so `earthlapse build` can invoke every source the same way."""
    del raw_dir
    return []


def _published_path(stem: StemManifest, media_dir: Path, data: bytes) -> Path:
    """Content-hashed (ADR-023) -- `_place_stem` below is the
    only writer of `<id>-*.<format>` files, so it also removes any other one for this id before
    writing the current one: exactly one published file per catalogued stem always exists,
    never a stale sibling left behind by an earlier run whose content has since changed."""
    return media_dir / _MEDIA_SUBDIR / content_hashed_filename(stem.id, stem.format, data)


def _place_stem(stem: StemManifest, raw_dir: Path, media_dir: Path) -> None:
    raw_path = raw_dir / stem.raw_filename
    if not raw_path.is_file():
        raise FileNotFoundError(
            f"stem {stem.id}: {raw_path} is missing -- run `earthlapse` data fetch first"
        )
    data = raw_path.read_bytes()
    actual = sniff_audio(data)
    if actual.value != stem.format:
        raise ValueError(
            f"stem {stem.id}: raw file sniffs as {actual.value!r} but stems.toml declares "
            f"format {stem.format!r} -- source a file already encoded the way it will be "
            f"published, or correct the declared format"
        )
    published = published_bytes(stem, data)
    target = _published_path(stem, media_dir, published)
    target.parent.mkdir(parents=True, exist_ok=True)
    for stale in target.parent.glob(f"{stem.id}-*.{stem.format}"):
        if stale != target:
            stale.unlink()
    target.write_bytes(published)


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`pipeline.databuild`'s optional post-normalise side-effect hook (see CONTRIBUTING.md
    "Optional write_outputs hook") -- called automatically after `normalise()` so `make data`
    places every catalogued stem's published file too, not curated parquet only (there is
    none here)."""
    book = load_stem_book(_STEMS_TOML)
    media_dir = repo_root / "data" / "media"
    for stem in book.stems:
        _place_stem(stem, raw_dir, media_dir)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "audio-stems"
    assert normalise(raw_dir) == []
    write_outputs(raw_dir, repo_root)
    print(f"wrote stem media to {repo_root / 'data' / 'media' / _MEDIA_SUBDIR}")


if __name__ == "__main__":
    main()
