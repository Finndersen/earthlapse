"""Offline unit tests for pipeline.fetching.ensure_verified_artefact itself.

sources/*/fetch.py tests exercise this helper indirectly (reuse-without-download,
download-when-missing, fresh-download-mismatch-raises); this module is the direct coverage
for the helper's own contract, including the case none of those indirect tests hit: an
artefact already on disk that is corrupted or truncated -- wrong sha256, not merely absent --
must be re-downloaded (or raise), never silently returned as-is.
"""

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


def test_a_corrupted_cached_artefact_whose_redownload_also_mismatches_raises(
    tmp_path: Path,
) -> None:
    """If the re-download itself doesn't verify either, this must raise -- not fall back to
    the stale corrupt bytes already on disk, and not write the bad re-download over them."""
    stale_content = b"truncated garbage, wrong hash"
    (tmp_path / "artefact.bin").write_bytes(stale_content)

    with pytest.raises(FetchIntegrityError):
        ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, lambda: b"also wrong")

    assert (tmp_path / "artefact.bin").read_bytes() == stale_content


def test_a_fresh_download_that_does_not_verify_raises_and_writes_nothing(tmp_path: Path) -> None:
    with pytest.raises(FetchIntegrityError, match="sha256 mismatch"):
        ensure_verified_artefact(tmp_path, "artefact.bin", _SHA256, lambda: b"wrong bytes")

    assert not (tmp_path / "artefact.bin").exists()


def test_creates_raw_dir_if_missing(tmp_path: Path) -> None:
    raw_dir = tmp_path / "nested" / "raw"

    result = ensure_verified_artefact(raw_dir, "artefact.bin", _SHA256, lambda: _CONTENT)

    assert result == raw_dir / "artefact.bin"
    assert result.read_bytes() == _CONTENT
