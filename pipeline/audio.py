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

import hashlib
import tomllib
from collections import Counter
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from pipeline import mp3

# Hex characters of `sha256(published bytes)` kept in a stem's published filename (ADR-023
# amendment "on-demand loading"). Not cryptographic -- this catalogue holds dozens of files,
# not billions, so 10 hex chars (40 bits) is far beyond its actual collision risk; the same
# length webpack/Next.js content hashes commonly use.
CONTENT_HASH_LENGTH = 10


def content_hash(data: bytes) -> str:
    """Short, stable hash of a stem's published bytes -- unrelated to `StemManifest.sha256`
    (that one verifies the *raw fetch*, `pipeline.fetching`'s integrity check; this one names
    the *published* file). Two different bytes essentially never collide at this length; the
    same bytes always hash the same, so a rebuild that changes nothing about a stem's content
    reuses the same published filename."""
    return hashlib.sha256(data).hexdigest()[:CONTENT_HASH_LENGTH]


def content_hashed_filename(stem_id: str, fmt: str, data: bytes) -> str:
    """A stem's published filename, e.g. `wind-3a91cf02de.mp3` -- content-addressed so a CDN
    can cache it `immutable` (ADR-023 amendment "on-demand loading"): the name only changes
    when the published bytes do, so a long `max-age` never risks serving stale audio after a
    re-source, and never needs a cache-busting query string or a build-wide path change either.
    """
    return f"{stem_id}-{content_hash(data)}.{fmt}"


SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"

# Loudness every stem is trimmed to (`StemManifest.level_trim_db`), so a curve or scene gain
# means the same audible level whichever clip it drives. Loops -- ambience beds and loop-safe
# scene stems -- share one reference; one-shots sit 10 dB above it so a foreground event reads
# over the bed at the same scene gain. -30 dB leaves every loop within 1.5 dB of the reference
# without pushing any clip's peak past full scale (ADR-023 amendment "stem levels").
LOOP_REFERENCE_LOUDNESS_DB = -30.0
ONE_SHOT_REFERENCE_LOUDNESS_DB = -20.0

# How long a one-shot stopped early by `end_seconds` takes to fade out, ending at `end_seconds`.
ONE_SHOT_END_FADE_SECONDS = 1.0


class LoopRegion(BaseModel):
    """The span of a clip a looping player repeats, in seconds from the clip start. Chosen at
    sourcing time to skip a silent head or tail, a fade, or an edit splice, with its two ends
    at matched level and near-continuous samples so the wrap does not click."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    start_seconds: float = Field(ge=0.0)
    end_seconds: float = Field(gt=0.0)

    @model_validator(mode="after")
    def _starts_before_it_ends(self) -> LoopRegion:
        if self.start_seconds >= self.end_seconds:
            raise ValueError(
                f"loop start {self.start_seconds} s must be before its end {self.end_seconds} s"
            )
        return self


class StemManifest(BaseModel):
    """One stem's provenance and published-file metadata.

    `duration_seconds`, `loop_safe`, `loudness_db`, `peak_dbfs` and `loop` are curator-attested
    when the clip is sourced -- the same way `sources/astronomy`'s checkpoint values are cited
    numbers, not something this pipeline measures (`sources/audio-stems/levels.py` is the
    sourcing-time tool; README "Why levels are attested, not measured at build time").
    `licence` must read as CC0 or public domain (ADR-023); nothing here enforces that string
    mechanically — the reviewing human does, same as every other source's `licence` field.
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
    loudness_db: float = Field(lt=0.0)  # gated A-weighted loudness, levels.py
    peak_dbfs: float = Field(le=0.0)
    # Absent: the whole clip loops. Only a loop-safe stem may name one.
    loop: LoopRegion | None = None
    # Absent: a one-shot starts at 0. Skips a silent (or otherwise unwanted) lead-in on a
    # `loop_safe = false` clip so playback starts right on the scene's `once` trigger instead of
    # lagging behind it -- the one-shot counterpart to `loop`'s head/tail trim for loops.
    start_seconds: float | None = Field(default=None, ge=0.0)
    # Absent: a one-shot plays to the end of its clip. Where it stops instead, the last
    # `ONE_SHOT_END_FADE_SECONDS` fading out, so a long recording plays only its opening.
    end_seconds: float | None = Field(default=None, gt=0.0)

    @model_validator(mode="after")
    def _loop_region_fits_a_loop_safe_clip(self) -> StemManifest:
        if self.loop is None:
            return self
        if not self.loop_safe:
            raise ValueError(f"stem {self.id}: a one-shot (loop_safe = false) has no loop region")
        if self.loop.end_seconds > self.duration_seconds:
            raise ValueError(
                f"stem {self.id}: loop ends at {self.loop.end_seconds} s, after the clip's "
                f"{self.duration_seconds} s"
            )
        return self

    @model_validator(mode="after")
    def _start_offset_fits_a_one_shot_clip(self) -> StemManifest:
        if self.start_seconds is None:
            return self
        if self.loop_safe:
            raise ValueError(
                f"stem {self.id}: start_seconds is for one-shots only -- a loop_safe stem trims "
                f"its head via `loop`"
            )
        if self.start_seconds >= self.duration_seconds:
            raise ValueError(
                f"stem {self.id}: start_seconds {self.start_seconds} s is at or after the clip's "
                f"{self.duration_seconds} s"
            )
        return self

    @model_validator(mode="after")
    def _end_fits_a_one_shot_clip(self) -> StemManifest:
        if self.end_seconds is None:
            return self
        if self.loop_safe:
            raise ValueError(f"stem {self.id}: end_seconds is for one-shots only")
        start = self.start_seconds or 0.0
        if not start + ONE_SHOT_END_FADE_SECONDS < self.end_seconds <= self.duration_seconds:
            raise ValueError(
                f"stem {self.id}: end_seconds {self.end_seconds} s must leave room for its fade "
                f"after start {start} s and lie inside the clip's {self.duration_seconds} s"
            )
        return self

    @property
    def level_trim_db(self) -> float:
        """dB that brings this clip to its reference loudness, capped so its peak never passes
        full scale at unity gain -- the most any curve or scene gain asks for."""
        reference = LOOP_REFERENCE_LOUDNESS_DB if self.loop_safe else ONE_SHOT_REFERENCE_LOUDNESS_DB
        return round(min(reference - self.loudness_db, -self.peak_dbfs), 1)


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


# Formats a *published* stem may use. Every current shipped browser -- Safari/iOS included --
# decodes MP3 and M4A/AAC natively; WAV never ships as a real stem (only the fixture's synthesised
# silent signal uses it, `sources/audio-stems/fixture/`, to exercise the sniff/copy/hash machinery
# offline); OGG is not decodable on WebKit at all. Enforced at publish time
# (`pipeline.publish._audio_stems`), not on `StemManifest.format` itself -- narrowing that field's
# type would also reject the WAV fixture, which legitimately needs a format `numpy` can
# synthesise without a real encoder this offline pipeline does not have.
WEBKIT_DECODABLE_FORMATS = frozenset({AudioFormat.MP3, AudioFormat.M4A})


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


# Audio kept either side of a loop region when a published stem is cut down to it
# (`published_bytes`): a few MP3 frames, enough that the bit reservoir and MDCT overlap the cut
# disturbs (`pipeline.mp3`) have settled before `loopStart`, and that a gapless decoder's end
# padding trim never reaches `loopEnd`.
TRIM_MARGIN_SECONDS = 0.1


def _played_span(stem: StemManifest) -> tuple[float, float] | None:
    """The part of an MP3 stem that ever plays, when that is less than the whole clip: a loop
    region, or a one-shot's `start_seconds` to `end_seconds`."""
    if stem.format != AudioFormat.MP3:
        return None
    if stem.loop is not None:
        return stem.loop.start_seconds, stem.loop.end_seconds
    if stem.end_seconds is not None:
        return stem.start_seconds or 0.0, stem.end_seconds
    return None


def _is_trimmed(stem: StemManifest) -> bool:
    return _played_span(stem) is not None


def _trim_window(stem: StemManifest, fmt: mp3.StreamFormat) -> tuple[int, int]:
    span = _played_span(stem)
    assert span is not None
    return mp3.frame_window(fmt, span[0] - TRIM_MARGIN_SECONDS, span[1] + TRIM_MARGIN_SECONDS)


def published_bytes(stem: StemManifest, raw: bytes) -> bytes:
    """The bytes a stem publishes: an MP3 cut losslessly to the span that plays (its loop region,
    or a one-shot's start to end) plus a margin; anything else unchanged."""
    if not _is_trimmed(stem):
        return raw
    first, stop = _trim_window(stem, mp3.stream_format(raw))
    return mp3.trim_frames(raw, first, min(stop, mp3.audio_frame_count(raw)))


class PublishedTiming(BaseModel):
    """A stem's timing in its published file, which a trim has shifted earlier."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    duration_seconds: float
    loop: LoopRegion | None
    start_seconds: float | None
    end_seconds: float | None


def published_timing(stem: StemManifest, published: bytes) -> PublishedTiming:
    """`stem`'s curator-attested timing, moved onto the published file `published_bytes` wrote.
    The shift is whole frames, so every time lands on the same samples it did in the raw clip."""
    if not _is_trimmed(stem):
        return PublishedTiming(
            duration_seconds=stem.duration_seconds,
            loop=stem.loop,
            start_seconds=stem.start_seconds,
            end_seconds=stem.end_seconds,
        )
    fmt = mp3.stream_format(published)
    first, _ = _trim_window(stem, fmt)
    shift = fmt.frame_seconds(first)
    duration = min(
        stem.duration_seconds - shift, fmt.frame_seconds(mp3.audio_frame_count(published))
    )

    def shifted(seconds: float | None) -> float | None:
        return None if seconds is None else round(max(0.0, seconds - shift), 6)

    return PublishedTiming(
        duration_seconds=round(duration, 3),
        loop=None
        if stem.loop is None
        else LoopRegion(
            start_seconds=round(stem.loop.start_seconds - shift, 6),
            end_seconds=round(stem.loop.end_seconds - shift, 6),
        ),
        # A cut one-shot always names its start: the clip's own 0 has moved into the margin.
        start_seconds=None if stem.loop is not None else shifted(stem.start_seconds or 0.0),
        end_seconds=shifted(stem.end_seconds),
    )
