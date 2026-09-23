"""`ensure_verified_artefact`, the download-and-verify step every sources/*/fetch.py shares:
a cached artefact is reused only when its sha256 verifies, and nothing unverified is written."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from pipeline.fetching import FetchIntegrityError, ensure_verified_artefact

_CONTENT = b"the real, verified upstream bytes"
_SHA256 = hashlib.sha256(_CONTENT).hexdigest()


def test_missing_artefact_is_downloaded_verified_and_written(tmp_path: Path) -> None:
    calls: list[None] = []

    def download() -> bytes:
        calls.append(None)
        return _CONTENT

    result = ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, download)

    assert len(calls) == 1
    assert result == tmp_path / "artefact.bin"
    assert result.read_bytes() == _CONTENT


def test_a_verified_artefact_already_on_disk_is_reused_without_downloading(tmp_path: Path) -> None:
    (tmp_path / "artefact.bin").write_bytes(_CONTENT)

    def download() -> bytes:
        raise AssertionError("download must not be called when the cached file already verifies")

    result = ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, download)

    assert result.read_bytes() == _CONTENT


def test_a_corrupted_cached_artefact_is_re_downloaded_not_silently_used(tmp_path: Path) -> None:
    """The file on disk exists but does not match the expected sha256 (truncated, bit-rotted,
    or an interrupted prior write) -- this must fall through to a real download and end up
    with the verified bytes, never return the corrupt file as-is."""
    (tmp_path / "artefact.bin").write_bytes(b"truncated garbage, wrong hash")
    calls: list[None] = []

    def download() -> bytes:
        calls.append(None)
        return _CONTENT

    result = ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, download)

    assert len(calls) == 1
    assert result.read_bytes() == _CONTENT


def test_a_fresh_download_that_does_not_verify_raises_and_writes_nothing(tmp_path: Path) -> None:
    with pytest.raises(FetchIntegrityError, match="sha256 mismatch"):
        ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, lambda: b"wrong bytes")

    assert not (tmp_path / "artefact.bin").exists()
