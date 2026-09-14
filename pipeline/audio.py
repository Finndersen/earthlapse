"""The audio stem catalogue: `sources/audio-stems/stems.toml`, the curated source of truth
for which CC0 (or public-domain) ambience loops exist, their provenance, and where their
published web files live. ADR-023.

Stems are **not** one of the four curated shapes (`docs/DATA_SOURCES.md` § Contract) — they
are not `WorldState`-projectable, time-indexed data, just static, per-id media files with
per-file provenance (a title, an author, a source URL, a licence). They therefore bypass
`WorldModel`/`pipeline/curated.py` entirely, the same way `pipeline/portraits.py`'s
hand-curated lineage plates do. `sources/audio-stems/` still exists as a `sources/<name>/`
directory (`fetch.py`, `normalise.py`, `fixture/`, `README.md`) so it gets the fetch/verify
and credit machinery every externally-sourced dataset uses (`discover_sources`,
`pipeline.publish._credit`) — `stems.toml` sits alongside its `manifest.toml` because one
source directory here bundles several independently-licensed files, not the single
url/sha256/licence a plain `manifest.toml` describes.
"""

from __future__ import annotations

import tomllib
from collections import Counter
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"


class StemManifest(BaseModel):
    """One ambience loop's provenance and published-file metadata.

    `duration_seconds` and `loop_safe` are curator-attested when the clip is sourced — the
    same way `sources/astronomy`'s checkpoint values are cited numbers, not something this
    pipeline measures (see `sources/audio-stems/README.md` "Why no automated loudness/trim
    pass"). `licence` must read as CC0 or public domain (ADR-023); nothing here enforces that
    string mechanically — the reviewing human does, same as every other source's `licence`
    field.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=SLUG_PATTERN)
    title: str = Field(min_length=1)
    author: str = Field(min_length=1)
    # Direct, machine-fetchable download URL -- what fetch.py's ensure_verified_artefact()
    # actually downloads (same convention as every other source's manifest.toml `url`), and
    # what ships as AudioStem.source_url on the credits page. See stems.toml's own header
    # comment for why a Freesound clip's url is its unauthenticated "-hq" preview CDN link
    # rather than the (auth-gated) original-quality download.
    url: str = Field(min_length=1)
    licence: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")  # of the raw file fetch.py downloads
    raw_filename: str = Field(min_length=1)  # data/raw/audio-stems/<raw_filename>
    format: str = Field(pattern=r"^[a-z0-9]+$")  # published extension, e.g. "ogg", "m4a"
    duration_seconds: float = Field(gt=0.0)
    loop_safe: bool


class StemBook(BaseModel):
    """Every catalogued stem. May be empty — the catalogue ships partially, like portraits
    (`pipeline.portraits.PortraitBook`) and scenes before they are pinned: a stem's absence
    here is not an error, only a stem `sources/audio-stems/normalise.py` cannot yet publish."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    stems: tuple[StemManifest, ...] = Field(default=())

    def stem(self, stem_id: str) -> StemManifest | None:
        return next((s for s in self.stems if s.id == stem_id), None)


def load_stem_book(path: Path) -> StemBook:
    """Empty `StemBook` if `path` does not exist yet — a fresh audio-stems catalogue before
    any stem has been sourced, not a build error."""
    if not path.is_file():
        return StemBook()
    with path.open("rb") as handle:
        document = tomllib.load(handle)
    book = StemBook.model_validate(document)
    _require_unique_ids(book.stems)
    return book


def _require_unique_ids(stems: tuple[StemManifest, ...]) -> None:
    duplicates = sorted(id_ for id_, count in Counter(s.id for s in stems).items() if count > 1)
    if duplicates:
        raise ValueError(f"duplicate stem id(s): {', '.join(duplicates)}")


class AudioFormat(StrEnum):
    WAV = "wav"
    OGG = "ogg"
    MP3 = "mp3"
    M4A = "m4a"


def sniff_audio(data: bytes) -> AudioFormat:
    """Container format read from the file header, trusting bytes over any declared
    extension — the same discipline `pipeline.generators.image.sniff_image` applies to
    images."""
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return AudioFormat.WAV
    if data[:4] == b"OggS":
        return AudioFormat.OGG
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return AudioFormat.M4A
    if data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return AudioFormat.MP3
    raise ValueError("unrecognised audio format (expected WAV, OGG, MP3 or M4A)")
