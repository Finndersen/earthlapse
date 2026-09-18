"""Offline validator for sources/hyde/_rangezip.py's pure/local-only functions: `_merge_ranges`
(byte-range coalescing) and `_build_local_zip` (assembling a valid standalone zip from raw
bytes). Neither touches the network -- `extract_members`/`open_remote_zip`/`discover_tags`
(the actual HTTP Range machinery) are exercised only by real fetches, never in this suite, the
same "pure logic only" split `test_hyde.py` uses for `normalise.py`.
"""

from __future__ import annotations

import struct
import zipfile
import zlib

import pytest

from tests.sources.support import load_source_module


def _rangezip_module():
    return load_source_module("hyde", "_rangezip")


# --------------------------------------------------------------------------- _merge_ranges


def test_merge_ranges_merges_contiguous_spans() -> None:
    rz = _rangezip_module()
    info_a = zipfile.ZipInfo(filename="a")
    info_b = zipfile.ZipInfo(filename="b")
    a = rz._MemberByteRange(info=info_a, start=0, end=100)
    b = rz._MemberByteRange(info=info_b, start=100, end=200)  # starts exactly where a ends

    merged = rz._merge_ranges([a, b])

    assert len(merged) == 1
    start, end, members = merged[0]
    assert (start, end) == (0, 200)
    assert {m.info.filename for m in members} == {"a", "b"}


def test_merge_ranges_merges_overlapping_spans() -> None:
    rz = _rangezip_module()
    a = rz._MemberByteRange(info=zipfile.ZipInfo(filename="a"), start=0, end=150)
    b = rz._MemberByteRange(info=zipfile.ZipInfo(filename="b"), start=100, end=200)

    merged = rz._merge_ranges([a, b])

    assert len(merged) == 1
    assert merged[0][:2] == (0, 200)


def test_merge_ranges_keeps_disjoint_spans_separate() -> None:
    rz = _rangezip_module()
    a = rz._MemberByteRange(info=zipfile.ZipInfo(filename="a"), start=0, end=100)
    b = rz._MemberByteRange(info=zipfile.ZipInfo(filename="b"), start=500, end=600)

    merged = rz._merge_ranges([a, b])

    assert len(merged) == 2
    assert [(s, e) for s, e, _ in merged] == [(0, 100), (500, 600)]


def test_merge_ranges_handles_unsorted_input() -> None:
    rz = _rangezip_module()
    a = rz._MemberByteRange(info=zipfile.ZipInfo(filename="a"), start=500, end=600)
    b = rz._MemberByteRange(info=zipfile.ZipInfo(filename="b"), start=0, end=100)

    merged = rz._merge_ranges([a, b])

    assert [(s, e) for s, e, _ in merged] == [(0, 100), (500, 600)]


# ------------------------------------------------------------------------- _build_local_zip


def _stored_member(filename: str, data: bytes) -> tuple[zipfile.ZipInfo, bytes]:
    """A minimal, real local-file-header + STORED (uncompressed) data blob for one member --
    STORED so the resulting mini-zip can be read back with Python's own `zipfile` in this test
    (Deflate64, the format the real archive actually uses, needs the system `unzip` --
    `_build_local_zip` itself doesn't care which compression method a member uses, it only
    copies bytes, so STORED is a faithful, decompressor-independent test of its own logic)."""
    info = zipfile.ZipInfo(filename=filename)
    info.compress_type = zipfile.ZIP_STORED
    info.CRC = zlib.crc32(data)
    info.compress_size = len(data)
    info.file_size = len(data)
    name_b = filename.encode()
    local_header = struct.pack(
        "<IHHHHHIIIHH",
        0x04034B50,
        20,
        0,
        zipfile.ZIP_STORED,
        0,
        0,
        info.CRC,
        info.compress_size,
        info.file_size,
        len(name_b),
        0,
    )
    blob = local_header + name_b + data
    return info, blob


def test_build_local_zip_produces_a_valid_readable_zip(tmp_path) -> None:
    rz = _rangezip_module()
    info_a, blob_a = _stored_member("cropland0AD.asc", b"hello cropland")
    info_b, blob_b = _stored_member("grazing0AD.asc", b"hello grazing, a bit longer")

    members = [
        rz._MemberByteRange(info=info_a, start=0, end=len(blob_a)),
        rz._MemberByteRange(info=info_b, start=0, end=len(blob_b)),
    ]
    blob_by_range = {
        (0, len(blob_a)): blob_a,
        (0, len(blob_b)): blob_b,
    }
    out = tmp_path / "chunk.zip"

    rz._build_local_zip(blob_by_range, members, out)

    with zipfile.ZipFile(out) as zf:
        assert set(zf.namelist()) == {"cropland0AD.asc", "grazing0AD.asc"}
        assert zf.read("cropland0AD.asc") == b"hello cropland"
        assert zf.read("grazing0AD.asc") == b"hello grazing, a bit longer"
        assert zf.testzip() is None  # every member's own CRC-32 checks out


def test_build_local_zip_raises_when_no_blob_covers_a_member(tmp_path) -> None:
    rz = _rangezip_module()
    info_a, blob_a = _stored_member("cropland0AD.asc", b"data")
    members = [rz._MemberByteRange(info=info_a, start=0, end=len(blob_a))]
    out = tmp_path / "chunk.zip"

    with pytest.raises(rz.RemoteZipMemberError):
        rz._build_local_zip({}, members, out)
