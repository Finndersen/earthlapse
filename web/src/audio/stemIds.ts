/**
 * The closed stem catalogue (ADR-023 §1). Two kinds:
 *
 * - **Ambience** stems have a `stemGains` row and always loop at their curve gain.
 * - **Scene-only** stems have no curve and are reached only through a scene's `sound`. Whether
 *   one may loop (`geothermal`, `buzzing`, `knapping`, `artillery`, `lake-water`,
 *   `geiger-counter`, `chainsaw`, `howler-monkeys`, `hippo`, `wall-chiselling`, `church-bell`,
 *   `ship-rigging`) or is a one-shot (`impact`, `rocket`, `aircraft`, `mammoth`, `steam-whistle`,
 *   `ship-horn`, `klaxon-horn`, `tram-bell`) is the published `AudioStem.loopSafe` flag, not a
 *   second web-side list — see `stemVoices.ts`.
 *
 * A new stem is a new id here (plus a `stemGains.ts` row if it is ambience), never a free-text
 * string threaded through from `Manifest.audioStems`/`SceneRecord.sound`: both are `string` on
 * the wire, because the pipeline's `StemBook` is the source of truth for what ids exist, and
 * this union is the web engine's compile-time mirror of that same closed set.
 */

export type AmbienceStemId =
  | 'wind'
  | 'water'
  | 'storm'
  | 'volcanic'
  | 'forest'
  | 'wing-hum'
  | 'insects'
  | 'large-animal'
  | 'birds'
  | 'archosaurs'
  | 'mammals'
  | 'livestock'
  | 'fire'
  | 'settlement'
  | 'industry'
  | 'traffic'

export type SceneStemId =
  | 'geothermal'
  | 'impact'
  | 'rocket'
  | 'aircraft'
  | 'buzzing'
  | 'knapping'
  | 'mammoth'
  | 'artillery'
  | 'lake-water'
  | 'geiger-counter'
  | 'steam-whistle'
  | 'ship-horn'
  | 'chainsaw'
  | 'howler-monkeys'
  | 'klaxon-horn'
  | 'hippo'
  | 'wall-chiselling'
  | 'church-bell'
  | 'ship-rigging'
  | 'tram-bell'

export type StemId = AmbienceStemId | SceneStemId

export const AMBIENCE_STEM_IDS: readonly AmbienceStemId[] = [
  'wind',
  'water',
  'storm',
  'volcanic',
  'forest',
  'wing-hum',
  'insects',
  'large-animal',
  'birds',
  'archosaurs',
  'mammals',
  'livestock',
  'fire',
  'settlement',
  'industry',
  'traffic',
]

export const SCENE_STEM_IDS: readonly SceneStemId[] = [
  'geothermal',
  'impact',
  'rocket',
  'aircraft',
  'buzzing',
  'knapping',
  'mammoth',
  'artillery',
  'lake-water',
  'geiger-counter',
  'steam-whistle',
  'ship-horn',
  'chainsaw',
  'howler-monkeys',
  'klaxon-horn',
  'hippo',
  'wall-chiselling',
  'church-bell',
  'ship-rigging',
  'tram-bell',
]

export const STEM_IDS: readonly StemId[] = [...AMBIENCE_STEM_IDS, ...SCENE_STEM_IDS]

/** Each ambience stem's gain, always in `[0, 1]`. Scene-only stems have no row by construction. */
export type StemGains = Record<AmbienceStemId, number>

export function isAmbienceStemId(id: string): id is AmbienceStemId {
  return (AMBIENCE_STEM_IDS as readonly string[]).includes(id)
}

export function isStemId(id: string): id is StemId {
  return (STEM_IDS as readonly string[]).includes(id)
}
