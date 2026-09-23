/**
 * Checks DECODED_BYTES_CAP against the real ambience catalogue: the peak simultaneous mono decode
 * of every stem audible at once, anywhere on the timeline, must fit under it. Ambience stems are
 * downmixed to mono after decode, so a stem costs duration × 48 kHz × 4 bytes.
 */

import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { DECODED_BYTES_CAP } from './engine'
import { GAIN_THRESHOLD } from './loadPlan'
import { stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, type AmbienceStemId } from './stemIds'

// Mirrors sources/audio-stems/stems.toml's `duration_seconds`; update both together.
const AMBIENCE_DURATION_SECONDS: Record<AmbienceStemId, number> = {
  wind: 128.2,
  water: 60.0,
  storm: 65.1,
  volcanic: 28.06,
  forest: 27.12,
  'wing-hum': 66.894,
  insects: 59.79,
  'large-animal': 30.37,
  birds: 96.17,
  archosaurs: 37.27,
  mammals: 70.09,
  livestock: 96.31,
  fire: 35.0,
  settlement: 58.64,
  industry: 37.1,
  traffic: 30.0,
}

const ASSUMED_SAMPLE_RATE_HZ = 48_000
const BYTES_PER_SAMPLE = 4 // 32-bit float PCM

const MONO_DECODED_BYTES: Record<AmbienceStemId, number> = Object.fromEntries(
  AMBIENCE_STEM_IDS.map((id) => [id, AMBIENCE_DURATION_SECONDS[id] * ASSUMED_SAMPLE_RATE_HZ * BYTES_PER_SAMPLE]),
) as Record<AmbienceStemId, number>

const NO_FLOOD_BASALT: never[] = []

/** A dense log1p sweep of the domain plus the busiest checkpoints explicitly. */
function sampleTimes(): number[] {
  const times: number[] = []
  const logMax = Math.log1p(EARTH_FORMATION)
  const SAMPLE_COUNT = 8000
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    times.push(Math.expm1((logMax * i) / SAMPLE_COUNT))
  }
  times.push(3.46e8, 3.25e8, 3.2e8, 3.1e8, 3.0e8, 2.5e8, 9.0e7, 1.2e7, 2.0e4, 1.0e4, 0)
  return times
}

describe('ambience decoded-bytes budget', () => {
  it('never needs more mono-decoded ambience bytes at once than DECODED_BYTES_CAP allows', () => {
    // Scene-only stems are excluded: they are not always-on and stay stereo.
    let peakBytes = 0
    let peakT = 0
    for (const t of sampleTimes()) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      let bytes = 0
      for (const id of AMBIENCE_STEM_IDS) {
        if (gains[id] > GAIN_THRESHOLD) bytes += MONO_DECODED_BYTES[id]
      }
      if (bytes > peakBytes) {
        peakBytes = bytes
        peakT = t
      }
    }
    expect(peakBytes, `peak ambience decode at t=${peakT}: ${(peakBytes / 1e6).toFixed(1)} MB`).toBeLessThan(
      DECODED_BYTES_CAP,
    )
  })
})
