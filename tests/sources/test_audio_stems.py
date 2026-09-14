"""Offline validator for sources/audio-stems, run against the committed fixture only.

ADR-023: this source's normalise() emits no CuratedShape (audio stems are not one of the
four curated shapes) — its real work is fetch.py's per-stem download loop and
write_outputs()'s verified copy into data/media/audio/.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from pipeline.audio import AudioFormat, StemBook, load_stem_book, sniff_audio
from pipeline.fetching import FetchIntegrityError
from tests.sources.support import fixture_dir, load_source_module

FIXTURE_STEM_ID = "test-loop"
FIXTURE_RAW_FILENAME = "test-loop.wav"


@pytest.fixture(scope="module")
def stem_book() -> StemBook:
    return load_stem_book(fixture_dir("audio-stems") / "stems.toml")


def test_fixture_catalogue_shape(stem_book: StemBook) -> None:
    assert [s.id for s in stem_book.stems] == [FIXTURE_STEM_ID]
    stem = stem_book.stem(FIXTURE_STEM_ID)
    assert stem is not None
    assert stem.format == "wav"
    assert stem.licence == "CC0 1.0"
    assert stem.duration_seconds > 0


def test_missing_catalogue_file_is_an_empty_book_not_an_error(tmp_path: Path) -> None:
    book = load_stem_book(tmp_path / "does-not-exist.toml")
    assert book.stems == ()


def test_duplicate_stem_ids_are_rejected(tmp_path: Path) -> None:
    path = tmp_path / "stems.toml"
    entry = (
        '[[stems]]\nid = "wind"\ntitle = "A"\nauthor = "A"\nurl = "https://example.invalid/a"\n'
        f'licence = "CC0 1.0"\nsha256 = "{"0" * 64}"\nraw_filename = "a.wav"\nformat = "wav"\n'
        "duration_seconds = 1.0\nloop_safe = true\n"
    )
    path.write_text(entry + "\n" + entry.replace('"A"', '"B"'))
    with pytest.raises(ValueError, match="duplicate stem id"):
        load_stem_book(path)


def test_sniff_audio_reads_the_real_fixture_wav() -> None:
    data = (fixture_dir("audio-stems") / FIXTURE_RAW_FILENAME).read_bytes()
    assert sniff_audio(data) is AudioFormat.WAV


def test_sniff_audio_recognises_ogg_mp3_and_m4a_headers() -> None:
    assert sniff_audio(b"OggS" + b"\x00" * 20) is AudioFormat.OGG
    assert sniff_audio(b"ID3" + b"\x00" * 20) is AudioFormat.MP3
    assert sniff_audio(b"\xff\xfb" + b"\x00" * 20) is AudioFormat.MP3
    assert sniff_audio(b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 10) is AudioFormat.M4A


def test_sniff_audio_rejects_unrecognised_bytes() -> None:
    with pytest.raises(ValueError, match="unrecognised audio format"):
        sniff_audio(b"not audio at all")


# ----------------------------------------------------------------------------------- normalise


@pytest.fixture(scope="module")
def normalise_module():
    return load_source_module("audio-stems", "normalise")


def test_normalise_emits_no_curated_shape(normalise_module, tmp_path: Path) -> None:
    """ADR-023: stems are not WorldState data, so there is nothing for WorldModel to hold."""
    assert normalise_module.normalise(tmp_path) == []


def test_write_outputs_copies_the_verified_raw_file_to_its_published_path(
    normalise_module, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(normalise_module, "_STEMS_TOML", fixture_dir("audio-stems") / "stems.toml")
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    raw_bytes = (fixture_dir("audio-stems") / FIXTURE_RAW_FILENAME).read_bytes()
    (raw_dir / FIXTURE_RAW_FILENAME).write_bytes(raw_bytes)
    repo_root = tmp_path / "repo"

    normalise_module.write_outputs(raw_dir, repo_root)

    published = repo_root / "data" / "media" / "audio" / f"{FIXTURE_STEM_ID}.wav"
    assert published.read_bytes() == raw_bytes


def test_write_outputs_raises_when_the_raw_file_is_missing(
    normalise_module, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(normalise_module, "_STEMS_TOML", fixture_dir("audio-stems") / "stems.toml")
    with pytest.raises(FileNotFoundError, match=FIXTURE_STEM_ID):
        normalise_module.write_outputs(tmp_path / "raw", tmp_path / "repo")


def test_write_outputs_raises_when_the_raw_bytes_do_not_match_the_declared_format(
    normalise_module, tmp_path: Path, monkeypatch
) -> None:
    stems_toml = tmp_path / "stems.toml"
    stems_toml.write_text(
        '[[stems]]\nid = "wind"\ntitle = "A"\nauthor = "A"\nurl = "https://example.invalid/a"\n'
        f'licence = "CC0 1.0"\nsha256 = "{"0" * 64}"\nraw_filename = "wind.ogg"\nformat = "ogg"\n'
        "duration_seconds = 1.0\nloop_safe = true\n"
    )
    monkeypatch.setattr(normalise_module, "_STEMS_TOML", stems_toml)
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "wind.ogg").write_bytes(b"RIFF....WAVEfmt ")  # actually a WAV, declared as ogg

    with pytest.raises(ValueError, match="sniffs as 'wav'"):
        normalise_module.write_outputs(raw_dir, tmp_path / "repo")


# ----------------------------------------------------------------------------------- fetch
#
# fetch()'s own _STEMS_TOML is swapped for a tmp_path fixture the test controls (mirroring
# tests/sources/test_co2.py's fetch tests), and only the HTTP layer is faked.


@pytest.fixture
def fetch_module(tmp_path, monkeypatch):
    module = load_source_module("audio-stems", "fetch")
    monkeypatch.setattr(module, "_STEMS_TOML", tmp_path / "stems.toml")
    return module


def _write_one_stem_catalogue(path: Path, *, url: str, sha256: str) -> None:
    path.write_text(
        '[[stems]]\nid = "wind"\ntitle = "A"\nauthor = "A"\n'
        f'url = "{url}"\nlicence = "CC0 1.0"\nsha256 = "{sha256}"\n'
        'raw_filename = "wind.wav"\nformat = "wav"\nduration_seconds = 1.0\nloop_safe = true\n'
    )


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_is_a_no_op_when_the_catalogue_is_empty(fetch_module, tmp_path, monkeypatch) -> None:
    tmp_path.joinpath("stems.toml").write_text("")

    def _must_not_be_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.get must not be called for an empty catalogue")

    monkeypatch.setattr(httpx, "get", _must_not_be_called)

    fetch_module.fetch(tmp_path / "raw")


def test_fetch_downloads_each_catalogued_stem(fetch_module, tmp_path, monkeypatch) -> None:
    content = b"RIFF....WAVEfmt "
    _write_one_stem_catalogue(
        tmp_path / "stems.toml",
        url="https://example.invalid/wind.wav",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    calls = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(raw_dir)

    assert calls == ["https://example.invalid/wind.wav"]
    assert (raw_dir / "wind.wav").read_bytes() == content


def test_fetch_reuses_an_already_verified_file_without_calling_httpx_get(
    fetch_module, tmp_path, monkeypatch
) -> None:
    content = b"RIFF....WAVEfmt "
    _write_one_stem_catalogue(
        tmp_path / "stems.toml",
        url="https://example.invalid/wind.wav",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "wind.wav").write_bytes(content)

    def _must_not_be_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.get must not be called when the cached file already verifies")

    monkeypatch.setattr(httpx, "get", _must_not_be_called)

    fetch_module.fetch(raw_dir)


def test_fetch_raises_and_writes_nothing_on_a_sha256_mismatch(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_one_stem_catalogue(
        tmp_path / "stems.toml", url="https://example.invalid/wind.wav", sha256="0" * 64
    )
    raw_dir = tmp_path / "raw"
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(b"corrupt"))

    with pytest.raises(FetchIntegrityError):
        fetch_module.fetch(raw_dir)

    assert not (raw_dir / "wind.wav").exists()
