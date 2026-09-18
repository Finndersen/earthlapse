"""Selective extraction from a remote zip via HTTP Range requests, without downloading the
whole archive. Private to sources/hyde -- see README.md "Fetch strategy" for why this exists:
`HYDE3_2_1-baseline.zip` is 5.3 GB and ships every HYDE variable (population, built-up area,
irrigated/rainfed splits, ...); this project needs exactly four ascii grids
(`cropland<year>.asc`, `pasture<year>.asc`, `rangeland<year>.asc`, `conv_rangeland<year>.asc`)
per timestep, ~980 MB total across all four.

Two things make this possible:
1. The DANS access endpoint forwards a `Range` header through its own redirect to the
   underlying object store (SURF, S3-compatible) -- confirmed live: a `Range: bytes=0-9`
   request against `https://archaeology.datastations.nl/api/access/datafile/<id>` returns
   `206 Partial Content` with the requested 10 bytes, not the whole file.
2. `HYDE3_2_1-baseline.zip`'s members use **Deflate64** (zip compression method 9), which
   Python's stdlib `zipfile` cannot decompress (`NotImplementedError`, confirmed) -- there is
   no maintained pure-Python or prebuilt-wheel package that adds it for cpython 3.12/arm64
   either (`deflate64` on PyPI is an empty placeholder; `zipfile-deflate64` ships no cp311+ or
   arm64 wheel and fails to build from source against this machine's clang/zlib). macOS's
   built-in `/usr/bin/unzip` (Apple's Info-ZIP fork) **does** decompress Deflate64, confirmed
   by round-tripping a real member end to end. `extract_members` therefore builds a small,
   valid, standalone zip containing only the member(s) it needs (local header + compressed
   bytes, read via Range, plus a synthesized central directory and EOCD record) and shells out
   to the system `unzip` to do the actual decompression. `check_deflate64_support` preflights
   this once, at the start of `fetch()`, by parsing `unzip -v`'s own "special compilation
   options" banner for `DEFLATE64` -- so a machine without a Deflate64-capable `unzip` fails
   loudly before any download, not partway through the 73rd timestep.

This is a real, documented platform dependency (README.md "Gotchas") -- not a hidden one.
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

_RANGE_TIMEOUT = 120.0


class Deflate64ToolMissingError(RuntimeError):
    """No system `unzip` on PATH, or it can't decompress Deflate64 (confirmed on macOS's
    built-in Info-ZIP fork; not confirmed on Linux's, which historically lacks Deflate64
    support). See this module's docstring."""


class RemoteZipMemberError(RuntimeError):
    """An extracted member's size or CRC-32 didn't match the remote zip's own central
    directory record -- corrupted download or a bad local extraction."""


class HTTPRangeFile:
    """A read-only, seekable file-like object over one URL, fetching bytes on demand via HTTP
    Range requests. Enough for `zipfile.ZipFile` to read a remote archive's central directory
    and local headers without downloading the body."""

    def __init__(self, url: str, client: httpx.Client, size: int) -> None:
        self._url = url
        self._client = client
        self._pos = 0
        self.size = size

    def seekable(self) -> bool:
        return True

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self._pos = offset
        elif whence == 1:
            self._pos += offset
        elif whence == 2:
            self._pos = self.size + offset
        else:
            raise ValueError(f"unsupported whence {whence}")
        return self._pos

    def tell(self) -> int:
        return self._pos

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self._pos
        if n <= 0 or self._pos >= self.size:
            return b""
        end = min(self._pos + n, self.size) - 1
        response = self._client.get(
            self._url, headers={"Range": f"bytes={self._pos}-{end}"}, timeout=_RANGE_TIMEOUT
        )
        response.raise_for_status()
        data = response.content
        self._pos += len(data)
        return data


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def remote_size(url: str, client: httpx.Client) -> int:
    response = client.get(
        url, headers={"Range": "bytes=0-0"}, timeout=_RANGE_TIMEOUT, follow_redirects=True
    )
    response.raise_for_status()
    return int(response.headers["content-range"].split("/")[-1])


def open_remote_zip(url: str, client: httpx.Client) -> tuple[zipfile.ZipFile, HTTPRangeFile]:
    """Open the central directory of a remote zip without downloading its body."""
    size = remote_size(url, client)
    handle = HTTPRangeFile(url, client, size)
    return zipfile.ZipFile(handle), handle  # type: ignore[arg-type]  # duck-typed file object


@dataclass(frozen=True)
class _MemberByteRange:
    info: zipfile.ZipInfo
    start: int  # local file header offset
    end: int  # exclusive, end of this member's compressed data


def _member_byte_range(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> _MemberByteRange:
    """The exact byte span (local header through compressed data) a member occupies in the
    archive. Reads just the 30-byte local header (already cached by ZipFile.infolist() having
    read the central directory, which does not include the local header's own name/extra field
    lengths -- those can differ from the central directory's copy, so this is read fresh)."""
    fp = zf.fp
    assert fp is not None
    fp.seek(info.header_offset)
    local_header = fp.read(30)
    if local_header[:4] != b"PK\x03\x04":
        raise RemoteZipMemberError(f"{info.filename}: bad local file header signature")
    name_len, extra_len = struct.unpack("<HH", local_header[26:30])
    start = info.header_offset
    data_start = start + 30 + name_len + extra_len
    end = data_start + info.compress_size
    return _MemberByteRange(info=info, start=start, end=end)


def _merge_ranges(ranges: list[_MemberByteRange]) -> list[tuple[int, int, list[_MemberByteRange]]]:
    """Merge byte ranges that are contiguous or overlapping into one HTTP request each --
    `pasture<year>.asc` and `rangeland<year>.asc` are physically adjacent in every timestep
    directory (confirmed: rangeland's header_offset equals pasture's own end), so this turns
    those two members' Range GETs into one; `cropland<year>.asc` sits elsewhere in the archive
    and is always its own separate GET (two HTTP requests per timestep in total, not three)."""
    ordered = sorted(ranges, key=lambda r: r.start)
    merged: list[tuple[int, int, list[_MemberByteRange]]] = []
    for r in ordered:
        if merged and r.start <= merged[-1][1]:
            prev_start, prev_end, members = merged[-1]
            merged[-1] = (prev_start, max(prev_end, r.end), [*members, r])
        else:
            merged.append((r.start, r.end, [r]))
    return merged


def _build_local_zip(
    blob_by_range: dict[tuple[int, int], bytes], members: list[_MemberByteRange], tmp_zip: Path
) -> None:
    """Write a standalone, valid zip containing exactly `members`, sourcing each member's raw
    bytes (local header + compressed data, copied verbatim) from whichever merged blob covers
    its byte range."""
    with tmp_zip.open("wb") as out:
        local_offsets: dict[str, int] = {}
        for m in members:
            for (blob_start, blob_end), blob in blob_by_range.items():
                if blob_start <= m.start and m.end <= blob_end:
                    local_offsets[m.info.filename] = out.tell()
                    out.write(blob[m.start - blob_start : m.end - blob_start])
                    break
            else:
                raise RemoteZipMemberError(f"{m.info.filename}: no fetched blob covers its range")
        central_dir_start = out.tell()
        for m in members:
            info = m.info
            name_b = info.filename.encode()
            out.write(
                struct.pack(
                    "<IHHHHHHIIIHHHHHII",
                    0x02014B50,
                    20,
                    20,
                    0,
                    info.compress_type,
                    0,
                    0,
                    info.CRC,
                    info.compress_size,
                    info.file_size,
                    len(name_b),
                    0,
                    0,
                    0,
                    0,
                    0,
                    local_offsets[info.filename],
                )
            )
            out.write(name_b)
        central_dir_size = out.tell() - central_dir_start
        out.write(
            struct.pack(
                "<IHHHHIIH",
                0x06054B50,
                0,
                0,
                len(members),
                len(members),
                central_dir_size,
                central_dir_start,
                0,
            )
        )


def _unzip_binary() -> str:
    path = shutil.which("unzip")
    if path is None:
        raise Deflate64ToolMissingError(
            "sources/hyde needs a system `unzip` that supports Deflate64 (zip compression "
            "method 9) to extract HYDE3_2_1-baseline.zip's members -- none found on PATH. "
            "Confirmed working: macOS's built-in /usr/bin/unzip (Apple's Info-ZIP fork), and "
            "Info-ZIP UnZip >= 5.5 generally (most Linux distributions' default `unzip`). See "
            "sources/hyde/_rangezip.py's module docstring."
        )
    return path


def check_deflate64_support() -> None:
    """Preflight, once, before any download (called from `fetch()`'s own start): confirms the
    system `unzip` exists and reports Deflate64 support in its own `-v` "special compilation
    options" banner (Info-ZIP's own way of naming this -- `USE_DEFLATE64`), rather than only
    discovering the gap after burning through a Range fetch for the first timestep. Raises
    `Deflate64ToolMissingError` with `unzip -v`'s full output attached either way, so a report
    of this failure carries the actual local `unzip` build's own self-description."""
    path = _unzip_binary()
    result = subprocess.run([path, "-v"], capture_output=True, text=True, check=False)
    banner = f"{result.stdout}{result.stderr}"
    if "DEFLATE64" not in banner.upper():
        raise Deflate64ToolMissingError(
            f"sources/hyde needs a system `unzip` that supports Deflate64 (zip compression "
            f"method 9); {path} does not report it in `unzip -v`'s own compilation-options "
            f"banner:\n{banner}\nConfirmed working: macOS's built-in /usr/bin/unzip (Apple's "
            f"Info-ZIP fork), and Info-ZIP UnZip >= 5.5 generally. See "
            f"sources/hyde/_rangezip.py's module docstring."
        )


def extract_members(
    url: str, client: httpx.Client, filenames: list[str], dest_dir: Path, tmp_dir: Path
) -> None:
    """Extract exactly `filenames` (full in-archive paths) from the remote zip at `url` into
    `dest_dir`, flattened to their basenames. Raises `RemoteZipMemberError` if an extracted
    file's size doesn't match the archive's own record."""
    zf, _handle = open_remote_zip(url, client)
    try:
        infos = {name: zf.getinfo(name) for name in filenames}
        byte_ranges = [_member_byte_range(zf, info) for info in infos.values()]
        merged = _merge_ranges(byte_ranges)
        blob_by_range: dict[tuple[int, int], bytes] = {}
        for start, end, _members in merged:
            response = client.get(
                url, headers={"Range": f"bytes={start}-{end - 1}"}, timeout=_RANGE_TIMEOUT
            )
            response.raise_for_status()
            blob_by_range[(start, end)] = response.content
    finally:
        zf.close()

    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_zip = tmp_dir / "_chunk.zip"
    tmp_extract = tmp_dir / "_extract"
    _build_local_zip(blob_by_range, byte_ranges, tmp_zip)
    unzip = _unzip_binary()
    try:
        subprocess.run(
            [unzip, "-o", "-q", str(tmp_zip), "-d", str(tmp_extract)],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as err:
        raise RemoteZipMemberError(
            f"unzip exited {err.returncode} extracting {tmp_zip} -- stderr: "
            f"{err.stderr.decode(errors='replace').strip()!r}, stdout: "
            f"{err.stdout.decode(errors='replace').strip()!r}"
        ) from err
    dest_dir.mkdir(parents=True, exist_ok=True)
    for name, info in infos.items():
        extracted = tmp_extract / name
        if not extracted.is_file():
            raise RemoteZipMemberError(f"{name}: unzip did not produce {extracted}")
        data = extracted.read_bytes()
        if len(data) != info.file_size or zlib.crc32(data) != info.CRC:
            raise RemoteZipMemberError(
                f"{name}: extracted {len(data)} bytes (crc {zlib.crc32(data):08x}), expected "
                f"{info.file_size} bytes (crc {info.CRC:08x})"
            )
        (dest_dir / Path(name).name).write_bytes(data)
    shutil.rmtree(tmp_extract, ignore_errors=True)
    tmp_zip.unlink(missing_ok=True)


def list_member_infos(url: str, client: httpx.Client) -> list[zipfile.ZipInfo]:
    zf, _handle = open_remote_zip(url, client)
    try:
        return zf.infolist()
    finally:
        zf.close()
