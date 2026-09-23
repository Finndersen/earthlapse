"""sources/audio-stems against its committed fixture.

This source's normalise() emits no curated shape; its work is fetch.py's per-stem download and
write_outputs()'s verified copy into data/media/audio/ (ADR-023).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import numpy as np
import pytest
from pydantic import ValidationError

from pipeline.audio import (
    AudioFormat,
    StemManifest,
    content_hashed_filename,
    load_stem_book,
    sniff_audio,
)
from tests.sources.support import fixture_dir, load_source_module

FIXTURE_STEM_ID = "test-loop"
FIXTURE_RAW_FILENAME = "test-loop.wav"
FIXTURE_CATALOGUE = fixture_dir("audio-stems") / "stems.toml"
REAL_CATALOGUE = Path(__file__).resolve().parents[2] / "sources" / "audio-stems" / "stems.toml"


def _catalogue_entry(stem_id: str, raw_filename: str, fmt: str, url: str, sha256: str) -> str:
    return (
        f'[[stems]]\nid = "{stem_id}"\ntitle = "A"\nauthor = "A"\nurl = "{url}"\n'
        f'licence = "CC0 1.0"\nsha256 = "{sha256}"\nraw_filename = "{raw_filename}"\n'
        f'format = "{fmt}"\nduration_seconds = 1.0\nloop_safe = true\n'
        "loudness_db = -30.0\npeak_dbfs = -6.0\n"
    )


def test_fixture_catalogue_loads_one_wav_stem_that_sniffs_as_wav() -> None:
    book = load_stem_book(FIXTURE_CATALOGUE)

    assert [(s.id, s.format) for s in book.stems] == [(FIXTURE_STEM_ID, "wav")]
    data = (fixture_dir("audio-stems") / FIXTURE_RAW_FILENAME).read_bytes()
    assert sniff_audio(data) is AudioFormat.WAV
    with pytest.raises(ValueError, match="unrecognised audio format"):
        sniff_audio(b"not audio at all")


def test_duplicate_stem_ids_are_rejected(tmp_path: Path) -> None:
    entry = _catalogue_entry("wind", "a.wav", "wav", "https://example.invalid/a", "0" * 64)
    (tmp_path / "stems.toml").write_text(entry + "\n" + entry)

    with pytest.raises(ValueError, match="duplicate stem id"):
        load_stem_book(tmp_path / "stems.toml")


@pytest.mark.content
def test_real_catalogue_uses_only_webkit_decodable_formats() -> None:
    assert {s.format for s in load_stem_book(REAL_CATALOGUE).stems} <= {"mp3", "m4a"}


# -- write_outputs ---------------------------------------------------------------------------


@pytest.fixture
def normalise_module(monkeypatch: pytest.MonkeyPatch):
    module = load_source_module("audio-stems", "normalise")
    monkeypatch.setattr(module, "_STEMS_TOML", FIXTURE_CATALOGUE)
    return module


def test_write_outputs_publishes_one_content_hashed_file_per_stem(
    normalise_module, tmp_path: Path
) -> None:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    repo_root = tmp_path / "repo"
    audio_dir = repo_root / "data" / "media" / "audio"
    raw_bytes = (fixture_dir("audio-stems") / FIXTURE_RAW_FILENAME).read_bytes()
    (raw_dir / FIXTURE_RAW_FILENAME).write_bytes(raw_bytes)

    normalise_module.write_outputs(raw_dir, repo_root)
    published = audio_dir / content_hashed_filename(FIXTURE_STEM_ID, "wav", raw_bytes)
    assert published.read_bytes() == raw_bytes

    (raw_dir / FIXTURE_RAW_FILENAME).write_bytes(raw_bytes + b"\x00\x00")
    normalise_module.write_outputs(raw_dir, repo_root)
    assert len(list(audio_dir.glob(f"{FIXTURE_STEM_ID}-*.wav"))) == 1


def test_write_outputs_refuses_raw_bytes_that_are_not_the_declared_format(
    normalise_module, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stems_toml = tmp_path / "stems.toml"
    stems_toml.write_text(
        _catalogue_entry("wind", "wind.ogg", "ogg", "https://example.invalid/a", "0" * 64)
    )
    monkeypatch.setattr(normalise_module, "_STEMS_TOML", stems_toml)
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "wind.ogg").write_bytes(b"RIFF....WAVEfmt ")

    with pytest.raises(ValueError, match="sniffs as 'wav'"):
        normalise_module.write_outputs(raw_dir, tmp_path / "repo")


# -- fetch -----------------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_downloads_each_catalogued_stem_with_a_descriptive_user_agent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = load_source_module("audio-stems", "fetch")
    monkeypatch.setattr(module, "_STEMS_TOML", tmp_path / "stems.toml")
    content = b"RIFF....WAVEfmt "
    url = "https://example.invalid/wind.wav"
    (tmp_path / "stems.toml").write_text(
        _catalogue_entry("wind", "wind.wav", "wav", url, hashlib.sha256(content).hexdigest())
    )
    calls: list[tuple[str, object]] = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append((url, kwargs["headers"]))
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", _fake_get)

    module.fetch(tmp_path / "raw")

    assert calls == [(url, {"User-Agent": module._USER_AGENT})]
    assert (tmp_path / "raw" / "wind.wav").read_bytes() == content


# -- levels ----------------------------------------------------------------------------------


def _stem(**overrides: object) -> StemManifest:
    fields: dict[str, object] = {
        "id": "wind",
        "title": "A",
        "author": "A",
        "url": "https://example.invalid/a",
        "licence": "CC0 1.0",
        "sha256": "0" * 64,
        "raw_filename": "wind.mp3",
        "format": "mp3",
        "duration_seconds": 60.0,
        "loop_safe": True,
        "loudness_db": -40.0,
        "peak_dbfs": -20.0,
    }
    fields.update(overrides)
    return StemManifest.model_validate(fields)


def test_level_trim_reaches_the_reference_without_lifting_a_peak_past_full_scale() -> None:
    assert _stem(loudness_db=-40.0, peak_dbfs=-20.0).level_trim_db == 10.0
    assert _stem(loop_safe=False, loudness_db=-36.0, peak_dbfs=-19.5).level_trim_db == 16.0
    assert _stem(loudness_db=-45.0, peak_dbfs=-8.0).level_trim_db == 8.0


def test_a_loop_region_must_lie_inside_a_loop_safe_clip() -> None:
    with pytest.raises(ValidationError, match="before its end"):
        _stem(loop={"start_seconds": 30.0, "end_seconds": 10.0})
    with pytest.raises(ValidationError, match="one-shot"):
        _stem(loop_safe=False, loop={"start_seconds": 0.0, "end_seconds": 10.0})


def test_measure_levels_reads_a_full_scale_1khz_sine_as_minus_3_db() -> None:
    levels = load_source_module("audio-stems", "levels")
    t = np.arange(96000) / 48000
    sine = np.sin(2 * np.pi * 1000.0 * t)[:, None]

    assert levels.measure_levels(sine, 48000) == levels.StemLevels(loudness_db=-3.0, peak_dbfs=0.0)
