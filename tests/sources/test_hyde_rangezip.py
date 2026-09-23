"""sources/hyde/_rangezip.py's local functions: byte-range coalescing and assembling a
standalone zip from raw member bytes. The HTTP Range machinery runs only in a real fetch."""

from __future__ import annotations

import struct
import zipfile
import zlib

import pytest

from tests.sources.support import load_source_module


def _rangezip_module():
    return load_source_module("hyde", "_rangezip")


def test_merge_ranges_coalesces_touching_and_overlapping_spans_in_order() -> None:
    rz = _rangezip_module()

    def span(name: str, start: int, end: int):
        return rz._MemberByteRange(info=zipfile.ZipInfo(filename=name), start=start, end=end)

    merged = rz._merge_ranges(
        [span("d", 500, 600), span("a", 0, 100), span("b", 100, 150), span("c", 120, 200)]
    )

    assert [(s, e, {m.info.filename for m in ms}) for s, e, ms in merged] == [
        (0, 200, {"a", "b", "c"}),
        (500, 600, {"d"}),
    ]


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
