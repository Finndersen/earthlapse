"""Sourcing-time level measurement for one stem clip: the `loudness_db` and `peak_dbfs` a
`stems.toml` entry attests (ADR-023, amendment "stem levels and loop regions").

Run by a human when a clip is sourced, never by `earthtime build`, `make data` or a test that
touches a real clip: the pipeline still does no decoding (README "Why levels are attested, not
measured at build time"). It reads 16-bit PCM WAV only, so decode the clip first -- headless
Chromium's `OfflineAudioContext.decodeAudioData` handles every published format; macOS
`afconvert -f WAVE -d LEI16` handles MP3/M4A.

    python sources/audio-stems/levels.py clip.wav

Loudness is an A-weighted, gated mean square in the spirit of ITU-R BS.1770: 400 ms blocks at a
50% hop, an absolute gate at -70 dB and a relative gate 10 dB below the mean of the blocks that
pass it. Gating keeps a one-shot's decaying tail, or the quiet gaps between calls, from dragging
its level down. A-weighting rather than BS.1770's K-weighting because the published trims were
calibrated against A-weighted listening checks. Channels are averaged, not summed, because the
engine plays a mono clip at equal level in both ears.
"""

from __future__ import annotations

import argparse
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

BLOCK_SECONDS = 0.4
ABSOLUTE_GATE_DB = -70.0
RELATIVE_GATE_DB = -10.0
_A_WEIGHT_1KHZ = 0.7943282347242815  # IEC 61672 R_A(1 kHz), so A(1 kHz) = 0 dB


@dataclass(frozen=True)
class StemLevels:
    loudness_db: float
    peak_dbfs: float


def a_weighting_power(frequencies_hz: np.ndarray) -> np.ndarray:
    """IEC 61672 A-weighting as a power ratio, 1.0 at 1 kHz."""
    f2 = np.asarray(frequencies_hz, dtype=np.float64) ** 2
    r_a = (12194.0**2 * f2**2) / (
        (f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194.0**2)
    )
    return (r_a / _A_WEIGHT_1KHZ) ** 2


def _weighted_block_powers(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    frames = samples.shape[0]
    block = min(frames, round(BLOCK_SECONDS * sample_rate))
    hop = max(1, block // 2)
    weights = a_weighting_power(np.fft.rfftfreq(block, 1.0 / sample_rate))
    weights[0] = 0.0
    powers = []
    for start in range(0, frames - block + 1, hop):
        spectrum = np.fft.rfft(samples[start : start + block], axis=0)
        per_channel = 2.0 * (np.abs(spectrum) ** 2 * weights[:, None]).sum(axis=0) / block**2
        powers.append(per_channel.mean())
    return np.array(powers)


def measure_levels(samples: np.ndarray, sample_rate: int) -> StemLevels:
    """`samples` is `(frames, channels)` floating point in [-1, 1]."""
    if samples.ndim != 2 or samples.shape[0] == 0:
        raise ValueError(f"expected a non-empty (frames, channels) array, got {samples.shape}")
    peak = float(np.abs(samples).max())
    if peak == 0.0:
        raise ValueError("clip is digital silence; it has no loudness to attest")
    powers = _weighted_block_powers(samples.astype(np.float64), sample_rate)
    with np.errstate(divide="ignore"):
        levels = 10.0 * np.log10(powers)
    audible = powers[levels > ABSOLUTE_GATE_DB]
    if audible.size == 0:
        raise ValueError(f"every block is below the {ABSOLUTE_GATE_DB} dB absolute gate")
    relative_gate = 10.0 * np.log10(audible.mean()) + RELATIVE_GATE_DB
    gated = powers[(levels > ABSOLUTE_GATE_DB) & (levels > relative_gate)]
    return StemLevels(
        loudness_db=round(float(10.0 * np.log10(gated.mean())), 1),
        peak_dbfs=round(float(20.0 * np.log10(peak)), 1),
    )


def read_pcm16_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got {8 * handle.getsampwidth()}-bit")
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    samples = np.frombuffer(raw, dtype="<i2").reshape(-1, channels).astype(np.float64) / 32768.0
    return samples, sample_rate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("wav", type=Path, help="16-bit PCM WAV decoded from the clip")
    args = parser.parse_args()
    levels = measure_levels(*read_pcm16_wav(args.wav))
    print(f"loudness_db = {levels.loudness_db}\npeak_dbfs = {levels.peak_dbfs}")


if __name__ == "__main__":
    main()
