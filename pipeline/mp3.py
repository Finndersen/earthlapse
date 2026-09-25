"""Decoding a stem's raw MP3 and re-encoding the part that plays, small.

Stems arrive as the ~185 kbps VBR previews Freesound serves, far more than wind, a crowd or a
one-off effect needs from phone speakers or headphones. Publish decodes the raw clip, keeps only
the span that ever plays, and re-encodes it as constant-bitrate MP3 at `STEREO_KBPS` or
`MONO_KBPS`. LAME resamples to 32 kHz at those rates, which cuts off above ~14 kHz.

Two decoders agree on the raw clips sample for sample: `miniaudio` here and Chromium's
`decodeAudioData`, since both honour the raw file's LAME gapless tag. Every loop point in
`stems.toml` is in that decoded timeline.

The re-encoded stream carries no gapless tag, so every decoder plays the encoder's priming as
it is: `ENCODER_PRIMING_SAMPLES` of lead-in, at the output rate, before the first input sample. A
tag some decoders honour and others ignore would put a loop point in a different place in each;
no tag puts it in the same place everywhere, and publish moves every time by the lead-in.
"""

from __future__ import annotations

from dataclasses import dataclass

import lameenc
import miniaudio
import numpy as np

STEREO_KBPS = 96
MONO_KBPS = 56
# LAME's encoder delay (576) plus the Layer III decoder delay (529), measured on `lameenc` output
# decoded by `miniaudio`: a marker at input sample n decodes at n + 1105 (1106 when resampling
# from 44.1 kHz, a sub-sample phase).
ENCODER_PRIMING_SAMPLES = 1105
# LAME's slowest, best-quality search; encoding runs once per stem at build time.
_LAME_QUALITY = 2


@dataclass(frozen=True)
class Pcm:
    """16-bit samples, shape `(frames, channels)`."""

    samples: np.ndarray
    sample_rate: int

    @property
    def channels(self) -> int:
        return int(self.samples.shape[1])

    def span(self, start_seconds: float, end_seconds: float) -> Pcm:
        first = max(0, round(start_seconds * self.sample_rate))
        stop = min(len(self.samples), round(end_seconds * self.sample_rate))
        return Pcm(self.samples[first:stop], self.sample_rate)


def decode(data: bytes) -> Pcm:
    info = miniaudio.mp3_get_info(data)
    decoded = miniaudio.decode(
        data,
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=info.nchannels,
        sample_rate=info.sample_rate,
    )
    samples = np.frombuffer(decoded.samples, dtype=np.int16).reshape(-1, info.nchannels)
    return Pcm(samples, info.sample_rate)


def encode(pcm: Pcm) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_channels(pcm.channels)
    encoder.set_in_sample_rate(pcm.sample_rate)
    encoder.set_bit_rate(MONO_KBPS if pcm.channels == 1 else STEREO_KBPS)
    encoder.set_quality(_LAME_QUALITY)
    return bytes(encoder.encode(np.ascontiguousarray(pcm.samples).tobytes()) + encoder.flush())


@dataclass(frozen=True)
class StreamInfo:
    sample_rate: int
    duration_seconds: float

    @property
    def lead_in_seconds(self) -> float:
        return ENCODER_PRIMING_SAMPLES / self.sample_rate


def stream_info(data: bytes) -> StreamInfo:
    info = miniaudio.mp3_get_info(data)
    return StreamInfo(info.sample_rate, info.num_frames / info.sample_rate)
