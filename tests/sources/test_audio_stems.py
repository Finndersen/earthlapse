"""Offline validator for sources/audio-stems, run against the committed fixture only.

ADR-023: this source's normalise() emits no CuratedShape (audio stems are not one of the
four curated shapes) — its real work is fetch.py's per-stem download loop and
write_outputs()'s verified copy into data/media/audio/.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import httpx
import numpy as np
import pytest
from pydantic import ValidationError

from pipeline.audio import (
    LOOP_REFERENCE_LOUDNESS_DB,
    ONE_SHOT_REFERENCE_LOUDNESS_DB,
    AudioFormat,
    LoopRegion,
    StemBook,
    StemManifest,
    content_hashed_filename,
    load_stem_book,
    sniff_audio,
)
from pipeline.fetching import FetchIntegrityError
from tests.sources.support import fixture_dir, load_source_module

FIXTURE_STEM_ID = "test-loop"
FIXTURE_RAW_FILENAME = "test-loop.wav"
REAL_CATALOGUE = Path(__file__).resolve().parents[2] / "sources" / "audio-stems" / "stems.toml"


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
        "duration_seconds = 1.0\nloop_safe = true\nloudness_db = -30.0\npeak_dbfs = -6.0\n"
    )
    path.write_text(entry + "\n" + entry.replace('"A"', '"B"'))
    with pytest.raises(ValueError, match="duplicate stem id"):
        load_stem_book(path)


def test_real_catalogue_carries_the_v3_stem_set() -> None:
    """The committed catalogue (parsed offline, no download) is the closed set the web engine's
    `StemId` union mirrors (ADR-023 "era fit v3" amendment, extended by its 2026-09-15
    "human-history scene sounds, once-mode fix and Safari re-sourcing" amendment's `artillery`
    addition, that amendment's own re-review adding `lake-water`, and a further 2026-09-15
    "wing-hum" amendment): 16 ambience stems plus 9 scene-only stems, of which exactly the
    one-shots are not loop-safe."""
    book = load_stem_book(REAL_CATALOGUE)

    assert {s.id for s in book.stems} == {
        "wind",
        "water",
        "storm",
        "volcanic",
        "forest",
        "wing-hum",
        "insects",
        "large-animal",
        "birds",
        "archosaurs",
        "mammals",
        "livestock",
        "fire",
        "settlement",
        "industry",
        "traffic",
        "geothermal",
        "impact",
        "rocket",
        "aircraft",
        "buzzing",
        "knapping",
        "mammoth",
        "artillery",
        "lake-water",
    }
    assert {s.id for s in book.stems if not s.loop_safe} == {
        "impact",
        "rocket",
        "aircraft",
        "mammoth",
    }


def test_real_catalogue_uses_only_webkit_decodable_formats() -> None:
    """Nothing in `pipeline.audio.StemManifest` itself forbids declaring `format = "ogg"` or
    `"wav"` (the WAV test fixture legitimately needs to) -- `pipeline.publish._audio_stems`
    enforces this for a real publish, but the real catalogue should never even get that far
    (2026-09-15 audio re-review item 7)."""
    book = load_stem_book(REAL_CATALOGUE)

    assert {s.format for s in book.stems} <= {"mp3", "m4a"}


def test_real_catalogue_names_each_published_file_after_its_id() -> None:
    book = load_stem_book(REAL_CATALOGUE)

    assert [s.raw_filename for s in book.stems] == [f"{s.id}.{s.format}" for s in book.stems]


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

    published = (
        repo_root
        / "data"
        / "media"
        / "audio"
        / content_hashed_filename(FIXTURE_STEM_ID, "wav", raw_bytes)
    )
    assert published.read_bytes() == raw_bytes


def test_write_outputs_removes_a_stale_published_file_when_content_changes(
    normalise_module, tmp_path: Path, monkeypatch
) -> None:
    """Content-hashed filenames (ADR-023 amendment "on-demand loading") must never leave a
    previous run's file for the same stem id behind -- `_audio_stems` would then find two
    candidates and refuse to publish."""
    monkeypatch.setattr(normalise_module, "_STEMS_TOML", fixture_dir("audio-stems") / "stems.toml")
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    repo_root = tmp_path / "repo"

    (raw_dir / FIXTURE_RAW_FILENAME).write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 40)
    normalise_module.write_outputs(raw_dir, repo_root)
    (raw_dir / FIXTURE_RAW_FILENAME).write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x01" * 40)
    normalise_module.write_outputs(raw_dir, repo_root)

    audio_dir = repo_root / "data" / "media" / "audio"
    matches = list(audio_dir.glob(f"{FIXTURE_STEM_ID}-*.wav"))
    assert len(matches) == 1


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
        "duration_seconds = 1.0\nloop_safe = true\nloudness_db = -30.0\npeak_dbfs = -6.0\n"
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
        "loudness_db = -30.0\npeak_dbfs = -6.0\n"
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


def test_fetch_sends_a_descriptive_user_agent(fetch_module, tmp_path, monkeypatch) -> None:
    """Wikimedia's upload servers answer 403 to a request without a descriptive User-Agent."""
    content = b"RIFF....WAVEfmt "
    _write_one_stem_catalogue(
        tmp_path / "stems.toml",
        url="https://example.invalid/wind.wav",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    seen_headers = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        seen_headers.append(kwargs["headers"])
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(tmp_path / "raw")

    assert seen_headers == [{"User-Agent": fetch_module._USER_AGENT}]
    assert "earthview" in fetch_module._USER_AGENT


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


# ----------------------------------------------------------------------------------- levels
#
# `StemManifest`'s curator-attested levels and loop region (ADR-023 amendment "stem levels and
# loop regions"), and the sourcing-time `levels.py` measurement run against synthetic signals.


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


def test_level_trim_brings_a_loop_to_the_loop_reference_loudness() -> None:
    assert _stem(loudness_db=-40.0, peak_dbfs=-20.0).level_trim_db == 10.0
    assert _stem(loudness_db=-20.0, peak_dbfs=-1.0).level_trim_db == -10.0


def test_level_trim_brings_a_one_shot_to_the_louder_one_shot_reference() -> None:
    assert _stem(loop_safe=False, loudness_db=-36.0, peak_dbfs=-19.5).level_trim_db == 16.0


def test_level_trim_never_lifts_a_peak_past_full_scale() -> None:
    assert _stem(loudness_db=-45.0, peak_dbfs=-8.0).level_trim_db == 8.0


def test_loop_region_is_accepted_inside_a_loop_safe_clip() -> None:
    stem = _stem(loop={"start_seconds": 1.5, "end_seconds": 59.0})
    assert stem.loop == LoopRegion(start_seconds=1.5, end_seconds=59.0)


def test_loop_region_must_start_before_it_ends() -> None:
    with pytest.raises(ValidationError, match="before its end"):
        _stem(loop={"start_seconds": 30.0, "end_seconds": 10.0})


def test_loop_region_must_end_inside_the_clip() -> None:
    with pytest.raises(ValidationError, match="after the clip"):
        _stem(loop={"start_seconds": 1.0, "end_seconds": 61.0})


def test_a_one_shot_cannot_carry_a_loop_region() -> None:
    with pytest.raises(ValidationError, match="one-shot"):
        _stem(loop_safe=False, loop={"start_seconds": 0.0, "end_seconds": 10.0})


def test_real_catalogue_trims_every_loop_to_within_1_5_db_of_the_reference() -> None:
    """Loops share one bed, so each must land near the reference once trimmed; the peak cap only
    shaves the few whose transients sit close to full scale. One-shots are exempt: `rocket`'s
    launch transient already peaks at -0.2 dBFS, so it stays below its foreground reference."""
    book = load_stem_book(REAL_CATALOGUE)

    for stem in book.stems:
        reference = LOOP_REFERENCE_LOUDNESS_DB if stem.loop_safe else ONE_SHOT_REFERENCE_LOUDNESS_DB
        trimmed = stem.loudness_db + stem.level_trim_db
        assert trimmed <= reference + 0.05, stem.id
        if stem.loop_safe:
            assert reference - trimmed <= 1.5, (stem.id, reference - trimmed)


def test_web_test_mirrors_of_forest_match_the_real_catalogue() -> None:
    """`decodedBudget.test.ts` and `stemGains.test.ts` hand-copy `forest`'s attested
    `duration_seconds` and `loudness_db`/`level_trim_db` as JS literals (comment discipline only
    -- CLAUDE.md "No live API calls or large downloads in tests" keeps the web suite from reading
    `stems.toml` directly). `forest` has now been re-sourced four times (ADR-023 amendment
    "forest's SECOND pick was also rain" and its own 2026-09-16 correction); this guards the two
    hand-copies against silently drifting out of sync with a future re-source, the way nothing
    previously would have caught one of them being missed."""
    book = load_stem_book(REAL_CATALOGUE)
    forest = book.stem("forest")
    assert forest is not None

    web_audio_dir = Path(__file__).resolve().parents[2] / "web" / "src" / "audio"

    decoded_budget_ts = (web_audio_dir / "decodedBudget.test.ts").read_text()
    duration_match = re.search(r"\bforest:\s*([\d.]+),", decoded_budget_ts)
    assert duration_match is not None, "forest duration mirror not found in decodedBudget.test.ts"
    assert float(duration_match.group(1)) == pytest.approx(forest.duration_seconds, abs=0.005)

    stem_gains_ts = (web_audio_dir / "stemGains.test.ts").read_text()
    level_match = re.search(
        r"FOREST_EFFECTIVE_LOUDNESS_DB = (-?[\d.]+) \+ (-?[\d.]+)", stem_gains_ts
    )
    assert level_match is not None, (
        "FOREST_EFFECTIVE_LOUDNESS_DB mirror not found in stemGains.test.ts"
    )
    assert float(level_match.group(1)) == pytest.approx(forest.loudness_db, abs=0.005)
    assert float(level_match.group(2)) == pytest.approx(forest.level_trim_db, abs=0.005)


@pytest.fixture(scope="module")
def levels_module():
    return load_source_module("audio-stems", "levels")


def _sine(frequency_hz: float, amplitude: float, seconds: float, sample_rate: int) -> np.ndarray:
    t = np.arange(round(seconds * sample_rate)) / sample_rate
    return (amplitude * np.sin(2 * np.pi * frequency_hz * t))[:, None]


def test_measure_levels_reads_a_full_scale_1khz_sine_as_minus_3_db(levels_module) -> None:
    levels = levels_module.measure_levels(_sine(1000.0, 1.0, 2.0, 48000), 48000)
    assert levels == levels_module.StemLevels(loudness_db=-3.0, peak_dbfs=0.0)


def test_measure_levels_a_weights_low_frequencies_down(levels_module) -> None:
    levels = levels_module.measure_levels(_sine(100.0, 1.0, 2.0, 48000), 48000)
    assert levels.loudness_db == pytest.approx(-3.0 - 19.1, abs=0.2)  # A(100 Hz) = -19.1 dB


def test_measure_levels_gates_out_silence_between_calls(levels_module) -> None:
    call = _sine(1000.0, 0.5, 1.0, 48000)
    silence = np.zeros((48000 * 4, 1))
    levels = levels_module.measure_levels(np.concatenate([call, silence, call]), 48000)
    assert levels.loudness_db == pytest.approx(-9.0, abs=0.6)


def test_measure_levels_averages_channels_rather_than_summing_them(levels_module) -> None:
    mono = _sine(1000.0, 0.5, 2.0, 48000)
    stereo = np.concatenate([mono, mono], axis=1)
    assert levels_module.measure_levels(stereo, 48000) == levels_module.measure_levels(mono, 48000)


def test_measure_levels_refuses_digital_silence(levels_module) -> None:
    with pytest.raises(ValueError, match="silence"):
        levels_module.measure_levels(np.zeros((48000, 2)), 48000)


def test_read_pcm16_wav_round_trips_the_fixture(levels_module) -> None:
    samples, sample_rate = levels_module.read_pcm16_wav(
        fixture_dir("audio-stems") / FIXTURE_RAW_FILENAME
    )
    assert sample_rate > 0
    assert samples.ndim == 2 and samples.shape[0] > 0
    assert np.abs(samples).max() <= 1.0
