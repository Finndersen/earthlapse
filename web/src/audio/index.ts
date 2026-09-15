/**
 * Public API of the audio package (ADR-023, DESIGN.md §11). `useAudioEngine` is the one
 * stateful hook — it lazy-loads `tone` on the first "sound on" click, owns every player/synth,
 * and owns the toggle's persisted enabled/master-volume state (see `engine.ts`'s doc comment
 * for why it returns controls rather than taking them, a deliberate departure from
 * `audio-engine-spec.md`'s drafted signature). `<SoundToggle />` renders the HUD speaker icon
 * and volume slider from those controls.
 *
 * The pure logic is exported separately, for direct unit testing (IMPLEMENTATION.md A6) or a
 * future caller that needs the math without the engine:
 * - `stemGains(t, flatBasaltWindows)` — tier-1 ambience stem gains (ADR-023 §1).
 * - `scoreParams(t, series, catastropheWindows)` — tier-2 score parameters (ADR-023 §2).
 * - `sceneSoundLoopGains(presented)` / `useSceneSoundOnceTrigger(presented, playing)` — the
 *   per-scene sound mapping and arrival trigger (ADR-023 §3).
 * - `stemsNeeded(input)` / `lookaheadWindow(t, playback, sectionWindow)` — which stem buffers
 *   should be loaded right now, and the window that decision is based on (ADR-023 amendment
 *   "on-demand loading").
 * - `StemBufferCache` — the loader's fetch/evict bookkeeping (same amendment), generic over the
 *   decoded buffer type so it too carries no `tone` import.
 * - `rampLog` / `bump` — the one shared symlog-space ramp helper and its bump shape.
 *
 * None of the above import `tone` anywhere in their module graph — only `engine.ts` does,
 * behind a lazy `await import('tone')`.
 */

export { StemBufferCache } from './bufferCache'
export type { LoadStatus, StemFetchPlan } from './bufferCache'
export { useAudioEngine } from './engine'
export type { AudioEngineControls, UseAudioEngineInput } from './engine'
export { lookaheadWindow, stemsNeeded } from './loadPlan'
export type { StemsNeededInput } from './loadPlan'
export { bump, clampUnit, rampLog } from './ramp'
export type { TimeWindow } from './ramp'
export { scoreParams } from './score'
export type { ScoreParams } from './score'
export { nextOnceTriggerState, sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'
export type { OnceTriggerResult } from './sceneSound'
export { humanDominance, stemGains } from './stemGains'
export { AMBIENCE_STEM_IDS, isAmbienceStemId, isStemId, SCENE_STEM_IDS, STEM_IDS } from './stemIds'
export type { AmbienceStemId, SceneStemId, StemGains, StemId } from './stemIds'
export { planStemVoices } from './stemVoices'
export type { StemVoicePlan } from './stemVoices'
export { SoundToggle } from './toggle'
export type { SoundToggleProps } from './toggle'
