"""sources/audio-stems against its committed fixture.

This source's normalise() emits no curated shape; its work is fetch.py's per-stem download and
write_outputs()'s verified copy into data/media/audio/, cut to its loop region for a looping
MP3 (ADR-023).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import numpy as np
import pytest
from pydantic import ValidationError

from pipeline import mp3
from pipeline.audio import (
    AudioFormat,
    StemManifest,
    content_hashed_filename,
    load_stem_book,
    published_bytes,
    published_timing,
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


def test_a_loop_region_or_end_must_fit_its_kind_of_clip() -> None:
    with pytest.raises(ValidationError, match="before its end"):
        _stem(loop={"start_seconds": 30.0, "end_seconds": 10.0})
    with pytest.raises(ValidationError, match="one-shot"):
        _stem(loop_safe=False, loop={"start_seconds": 0.0, "end_seconds": 10.0})
    with pytest.raises(ValidationError, match="one-shots only"):
        _stem(end_seconds=10.0)
    with pytest.raises(ValidationError, match="room for its fade"):
        _stem(loop_safe=False, start_seconds=9.5, end_seconds=10.0)


def test_measure_levels_reads_a_full_scale_1khz_sine_as_minus_3_db() -> None:
    levels = load_source_module("audio-stems", "levels")
    t = np.arange(96000) / 48000
    sine = np.sin(2 * np.pi * 1000.0 * t)[:, None]

    assert levels.measure_levels(sine, 48000) == levels.StemLevels(loudness_db=-3.0, peak_dbfs=0.0)


# -- publishing an MP3 stem --------------------------------------------------------------------

_RATE = 48000


def _raw_mp3_with_clicks(click_seconds: list[float]) -> tuple[bytes, list[float]]:
    """A 6 s quiet sine with one-sample clicks, and where each click lands in the decoded raw
    clip -- the timeline `stems.toml` times are in."""
    t = np.arange(6 * _RATE) / _RATE
    signal = 0.05 * np.sin(2 * np.pi * 220 * t)
    for seconds in click_seconds:
        signal[round(seconds * _RATE)] = 0.95
    pcm = mp3.Pcm((np.stack([signal, signal], 1) * 32767).astype(np.int16), _RATE)
    raw = mp3.encode(pcm)
    return raw, [_click_at(mp3.decode(raw), seconds) for seconds in click_seconds]


def _click_at(pcm: mp3.Pcm, near_seconds: float) -> float:
    lo = max(0, round((near_seconds - 0.05) * pcm.sample_rate))
    window = np.abs(pcm.samples[lo : lo + round(0.1 * pcm.sample_rate), 0].astype(float))
    return (lo + int(np.argmax(window))) / pcm.sample_rate


@pytest.mark.parametrize(
    "fields",
    [
        {"loop_safe": True, "loop": ("a", "b")},
        {"loop_safe": False, "start_seconds": "a", "end_seconds": "b"},
    ],
    ids=["loop", "one-shot"],
)
def test_a_published_mp3_is_cut_small_with_its_times_on_the_same_audio(
    fields: dict[str, object],
) -> None:
    raw, (a, b) = _raw_mp3_with_clicks([2.0, 4.0])
    values = {"a": a, "b": b}
    overrides = {
        key: {"start_seconds": a, "end_seconds": b} if key == "loop" else values.get(value, value)  # type: ignore[arg-type]
        for key, value in fields.items()
    }
    stem = _stem(duration_seconds=6.0, **overrides)

    published = published_bytes(stem, raw)
    timing = published_timing(stem, published)
    decoded = mp3.decode(published)

    assert len(published) < len(raw) / 2
    start, end = (
        (timing.loop.start_seconds, timing.loop.end_seconds)
        if timing.loop is not None
        else (timing.start_seconds, timing.end_seconds)
    )
    assert start is not None and end is not None
    one_sample = 1.5 / decoded.sample_rate
    assert _click_at(decoded, start) == pytest.approx(start, abs=one_sample)
    assert _click_at(decoded, end) == pytest.approx(end, abs=one_sample)


def test_a_looping_mp3_without_a_region_is_refused() -> None:
    raw, _ = _raw_mp3_with_clicks([])
    with pytest.raises(ValueError, match="needs a `loop` region"):
        published_bytes(_stem(duration_seconds=6.0), raw)
