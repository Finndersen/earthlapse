/**
 * The ten ambience stem ids (ADR-023 §1). Closed set — a new stem is a new id added here plus
 * a new row in `stemGains.ts`'s table, never a free-text string threaded through from
 * `Manifest.audioStems`/`SceneRecord.sound` (both of which are already typed to `string` on
 * the wire, since the pipeline's own `StemBook` is the source of truth for what ids exist —
 * this union is the web engine's compile-time mirror of that same closed set).
 */
export type AmbienceStemId =
  | 'wind'
  | 'water'
  | 'storm'
  | 'volcanic'
  | 'insects'
  | 'birds'
  | 'mammals'
  | 'fire'
  | 'settlement'
  | 'machinery'

export const STEM_IDS: readonly AmbienceStemId[] = [
  'wind',
  'water',
  'storm',
  'volcanic',
  'insects',
  'birds',
  'mammals',
  'fire',
  'settlement',
  'machinery',
]

/** Each stem's gain, always in `[0, 1]`. */
export type StemGains = Record<AmbienceStemId, number>

export function isAmbienceStemId(id: string): id is AmbienceStemId {
  return (STEM_IDS as readonly string[]).includes(id)
}
