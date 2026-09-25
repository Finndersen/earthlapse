"""Lossless MP3 trimming by whole frames, for audio stems that only ever play part of their clip.

An MP3 stream is a run of self-contained frames, each decoding to a fixed number of samples, so
dropping whole frames from the head and tail cuts the audio without decoding or re-encoding it:
every kept frame's bytes are unchanged. A kept frame decodes to the same samples it did before,
shifted earlier by exactly the dropped frames' duration, which is what makes a loop region moved
by that shift land on the same samples it did in the original clip.

Two details make the cut clean:

- **The LAME/Xing info frame is kept and rewritten.** It carries the encoder delay and padding a
  gapless decoder trims, so keeping it keeps the start-of-stream trim identical in both files,
  and with it the shift. Its frame count, byte count, seek table, music length and CRC are
  rewritten for the shorter stream; a decoder that finds a stale CRC may ignore the whole tag.
- **The first kept frame may decode imperfectly.** Layer III frames can borrow bits from the
  frames before them (the bit reservoir) and overlap their neighbours in the MDCT, so the first
  frame or two after a cut can decode to a short glitch. Callers keep a margin of frames before
  any sample they need exact (`pipeline.audio.TRIM_MARGIN_SECONDS`).

Only MPEG-1/2/2.5 Layer III with no ID3v2 tag is handled, which is every published stem; anything
else raises rather than being copied through untrimmed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

_BITRATES_KBPS = {
    1: (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    2: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_SAMPLE_RATES = {1: (44100, 48000, 32000), 2: (22050, 24000, 16000), 25: (11025, 12000, 8000)}

_XING_FRAMES, _XING_BYTES, _XING_TOC, _XING_QUALITY = 1, 2, 4, 8
_TOC_LENGTH = 100
# Offsets inside the LAME extension that follows the Xing fields.
_LAME_MUSIC_LENGTH = 28
_LAME_TAG_CRC = 34


@dataclass(frozen=True)
class StreamFormat:
    sample_rate: int
    samples_per_frame: int

    def frame_seconds(self, frames: int) -> float:
        return frames * self.samples_per_frame / self.sample_rate


@dataclass(frozen=True)
class _Frame:
    offset: int
    length: int


def _header(data: bytes, offset: int) -> tuple[StreamFormat, int, bool]:
    """The frame at `offset`: its stream format, byte length, and whether it is mono."""
    b = data[offset : offset + 4]
    if len(b) < 4 or b[0] != 0xFF or (b[1] & 0xE0) != 0xE0:
        raise ValueError(f"no MP3 frame sync at byte {offset}")
    version = {3: 1, 2: 2, 0: 25}.get((b[1] >> 3) & 3)
    if version is None or (b[1] >> 1) & 3 != 1:
        raise ValueError(f"frame at byte {offset} is not MPEG Layer III")
    bitrate = _BITRATES_KBPS[1 if version == 1 else 2][b[2] >> 4]
    rate_index = (b[2] >> 2) & 3
    if bitrate == 0 or rate_index == 3:
        raise ValueError(f"frame at byte {offset} has a free-format or reserved header")
    sample_rate = _SAMPLE_RATES[version][rate_index]
    padding = (b[2] >> 1) & 1
    per_frame = 1152 if version == 1 else 576
    length = per_frame // 8 * bitrate * 1000 // sample_rate + padding
    return StreamFormat(sample_rate, per_frame), length, (b[3] >> 6) == 3


def _xing_offset(data: bytes, frame: _Frame) -> int | None:
    fmt, _, mono = _header(data, frame.offset)
    side_info = (17 if mono else 32) if fmt.samples_per_frame == 1152 else (9 if mono else 17)
    crc = 2 if not data[frame.offset + 1] & 1 else 0
    at = frame.offset + 4 + crc + side_info
    return at if data[at : at + 4] in (b"Xing", b"Info") else None


def _frames(data: bytes) -> list[_Frame]:
    if data[:3] == b"ID3":
        raise ValueError("an ID3v2-tagged MP3 is not handled")
    frames: list[_Frame] = []
    offset = 0
    while offset + 4 <= len(data) and data[offset] == 0xFF:
        _, length, _ = _header(data, offset)
        if offset + length > len(data):
            break
        frames.append(_Frame(offset, length))
        offset += length
    if not frames:
        raise ValueError("no MP3 frames found")
    return frames


def stream_format(data: bytes) -> StreamFormat:
    return _header(data, 0)[0]


def _crc16(data: bytes) -> int:
    """CRC-16/ARC, the LAME tag's own checksum."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def _rewritten_info(info: bytearray, xing: int, audio_frames: int, total_bytes: int) -> bytes:
    flags = int.from_bytes(info[xing + 4 : xing + 8], "big")
    at = xing + 8
    if flags & _XING_FRAMES:
        info[at : at + 4] = audio_frames.to_bytes(4, "big")
        at += 4
    if flags & _XING_BYTES:
        info[at : at + 4] = total_bytes.to_bytes(4, "big")
        at += 4
    if flags & _XING_TOC:
        # A linear seek table: exact seeking inside a stem is never needed, only a valid one.
        info[at : at + _TOC_LENGTH] = bytes(i * 256 // _TOC_LENGTH for i in range(_TOC_LENGTH))
        at += _TOC_LENGTH
    if flags & _XING_QUALITY:
        at += 4
    if info[at : at + 4] == b"LAME" and at + _LAME_TAG_CRC + 2 <= len(info):
        music = at + _LAME_MUSIC_LENGTH
        info[music : music + 4] = total_bytes.to_bytes(4, "big")
        crc_at = at + _LAME_TAG_CRC
        info[crc_at : crc_at + 2] = _crc16(bytes(info[:crc_at])).to_bytes(2, "big")
    return bytes(info)


def trim_frames(data: bytes, first: int, stop: int) -> bytes:
    """Keeps audio frames `first` (inclusive) to `stop` (exclusive), counted from the first audio
    frame, i.e. not counting a LAME/Xing info frame, which is kept and rewritten. Raises on an
    empty or out-of-range window."""
    frames = _frames(data)
    info = frames[0] if _xing_offset(data, frames[0]) is not None else None
    audio = frames[1:] if info is not None else frames
    if not 0 <= first < stop <= len(audio):
        raise ValueError(f"frame window [{first}, {stop}) is outside the {len(audio)} audio frames")
    kept = audio[first:stop]
    body = b"".join(data[f.offset : f.offset + f.length] for f in kept)
    if info is None:
        return body
    xing = _xing_offset(data, info)
    assert xing is not None
    header = bytearray(data[info.offset : info.offset + info.length])
    total = len(header) + len(body)
    return _rewritten_info(header, xing - info.offset, len(kept), total) + body


def frame_window(fmt: StreamFormat, start_seconds: float, end_seconds: float) -> tuple[int, int]:
    """The audio frames that fully cover `[start_seconds, end_seconds]`, as `(first, stop)`."""
    first = max(0, math.floor(start_seconds * fmt.sample_rate / fmt.samples_per_frame))
    stop = math.ceil(end_seconds * fmt.sample_rate / fmt.samples_per_frame)
    return first, stop


def audio_frame_count(data: bytes) -> int:
    frames = _frames(data)
    return len(frames) - (1 if _xing_offset(data, frames[0]) is not None else 0)
