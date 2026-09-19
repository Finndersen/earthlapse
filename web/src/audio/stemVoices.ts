/**
 * Which kind of playback each catalogued stem gets from the published manifest (ADR-023
 * amendment). Pure and Tone-free so `engine.ts`'s runtime construction is decided by a
 * unit-testable function, not inside the Tone.js graph builder.
 *
 * - `ambience-loop`: an ambience stem, always looping at `max(curve, scene loop)`.
 * - `scene-loop`: a loop-safe scene-only stem (e.g. `geothermal`), looping at its scene gain only.
 * - `one-shot`: a scene-only stem that is not loop-safe (`impact`, `rocket`, `aircraft`): buffer
 *   only, never a looping player, played by a scene's `once` sound.
 * - `missing` / `not-loop-safe`: skipped with one warning (an ambience stem must loop).
 */

import type { AudioStem } from '@/types/manifest'

import { STEM_IDS, isAmbienceStemId, type AmbienceStemId, type SceneStemId, type StemId } from './stemIds'

export type StemVoicePlan =
  | { kind: 'ambience-loop'; id: AmbienceStemId; stem: AudioStem }
  | { kind: 'scene-loop'; id: SceneStemId; stem: AudioStem }
  | { kind: 'one-shot'; id: SceneStemId; stem: AudioStem }
  | { kind: 'missing'; id: StemId }
  | { kind: 'not-loop-safe'; id: AmbienceStemId; stem: AudioStem }

/** Linear gain for a stem's published `levelTrimDb`, multiplied into every curve, scene-loop and
 *  once gain so a gain value means the same loudness whichever clip it drives. */
export function stemLevelGain(stem: AudioStem): number {
  return 10 ** (stem.levelTrimDb / 20)
}

/** One plan per catalogued id, in `STEM_IDS` order. Published stems outside the catalogue (e.g.
 *  a retired id in an older manifest) are ignored. */
export function planStemVoices(audioStems: ReadonlyArray<AudioStem>): StemVoicePlan[] {
  return STEM_IDS.map((id): StemVoicePlan => {
    const stem = audioStems.find((s) => s.id === id)
    if (stem === undefined) return { kind: 'missing', id }
    if (isAmbienceStemId(id)) {
      return stem.loopSafe ? { kind: 'ambience-loop', id, stem } : { kind: 'not-loop-safe', id, stem }
    }
    return stem.loopSafe ? { kind: 'scene-loop', id, stem } : { kind: 'one-shot', id, stem }
  })
}
