/**
 * Regression guard for `DECODED_BYTES_CAP` (`engine.ts`) against the ambience-stem catalogue
 * itself, not just the loader's own bookkeeping (`bufferCache.test.ts` covers that in isolation
 * with synthetic sizes) — catches a single oversized clip pushing the peak simultaneous decode
 * near the cap once every stem needed alongside it at a busy checkpoint is summed.
 *
 * `engine.ts` downmixes every `ambience-loop` stem to mono right after decode
 * (`buffer.toMono()`), so a stem's decoded size is `duration * assumed sample rate * 4 bytes
 * (float32) * 1 channel` — the same 48 kHz assumption `engine.ts`'s
 * `ASSUMED_BYTES_PER_SECOND`/`estimatedStemBytes` use for a fetch still in flight.
 */

import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { DECODED_BYTES_CAP } from './engine'
import { GAIN_THRESHOLD } from './loadPlan'
import { stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, type AmbienceStemId } from './stemIds'

// Mirrors sources/audio-stems/stems.toml's attested `duration_seconds` for every ambience stem —
// update this table, in the same change, whenever a duration there changes. Not derived from the
// published manifest: this package's tests stay pure/offline (CLAUDE.md "no live API calls or
// large downloads in tests"), and a hand-cited table matches how `stemGains.ts`'s own boundary
// constants already cite real dates without deriving them from a data file.
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

/** A dense log1p-spaced sweep of the whole domain, plus a handful of checkpoints in the busiest,
 *  most human-era-adjacent stretch, included explicitly so this test's coverage there does not
 *  depend only on where the log-spaced grid happens to land. A gap in the sweep can only ever
 *  make this test *more* permissive, never less (a missed narrow bump undercounts a peak; a
 *  missed narrow duck overcounts one and so still yields a valid, if slightly pessimistic, upper
 *  bound), so density here trades runtime for a tighter bound, not for correctness. */
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
    // Scene-only stems (`buzzing`, `lake-water`, ...) are deliberately excluded: they are not
    // "always-on" the way an ambience stem is, they stay stereo (not mono-downmixed), and
    // `engine.ts`'s own `DECODED_BYTES_CAP` comment already accounts for `rocket`'s stereo size
    // needing no trim. This test's scope is the always-on ambience set the review's own fix
    // asked for, not the full worst case across every scene transition too.
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
