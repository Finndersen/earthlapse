/**
 * Per-scene sound (ADR-023 §3, DESIGN.md §11's "a fourth thing DESIGN never named"). A scene
 * names a stem in the one published catalogue: an ambience stem, which it foregrounds above that
 * stem's own `t`-driven curve, or a scene-only stem with no curve at all (`geothermal`, or the
 * one-shots `impact`, `rocket`, `aircraft`, which only `once` may name).
 *
 * `sceneSoundLoopGains` is pure. `useSceneSoundOnceTrigger` is the one small hook this module
 * exports; its edge-triggering logic is factored into `nextOnceTriggerState`, a pure function,
 * so the state machine itself is directly unit-testable without mounting a component.
 *
 * `nextOnceTriggerState`/`useSceneSoundOnceTrigger` take whichever `SceneMix` their caller hands
 * them — `engine.ts` feeds them the raw, un-rate-limited target mix, not the visually-throttled
 * *presented* one `sceneSoundLoopGains` always uses (see `nextOnceTriggerState`'s own doc comment
 * and `engine.ts`'s call site). `onceSoundOutlived` reads *both* mixes at once, for a reason its
 * own doc comment explains.
 */

'use client'

import { useEffect, useRef, useState } from 'react'

import { dominantScene, type SceneMix } from '@/scene'
import type { Scene } from '@/types/manifest'

/**
 * `loop`-mode gain per stem id, aggregated across `presented.from`/`presented.to` with
 * `Math.max` (never sum, so two scenes sharing a stem mid-dissolve never pushes it over that
 * stem's own declared gain) — the same `mix`/`1 - mix` weights the visual cross-dissolve
 * already uses (ADR-023 §3). Scenes with no `sound`, or `sound.mode !== 'loop'`, contribute
 * nothing. Pure in `presented`.
 */
export function sceneSoundLoopGains(presented: SceneMix): Partial<Record<string, number>> {
  const gains: Partial<Record<string, number>> = {}

  function contribute(scene: Scene, weight: number): void {
    if (scene.sound === undefined || scene.sound.mode !== 'loop') return
    const gain = weight * scene.sound.gain
    const stemId = scene.sound.stem
    gains[stemId] = Math.max(gains[stemId] ?? 0, gain)
  }

  contribute(presented.from, 1 - presented.mix)
  contribute(presented.to, presented.mix)
  return gains
}

/** Result of one `nextOnceTriggerState` evaluation: the possibly-updated "already fired since
 *  this scene last became dominant" set, and the scene to fire this render's once-mode sound
 *  for, if any. */
export interface OnceTriggerResult {
  armedOff: ReadonlySet<string>
  fired: Scene | null
}

/**
 * The pure core of the once-mode arrival trigger (ADR-023 §3). Fires when `sceneMix`'s
 * **dominant** scene (`dominantScene`: `mix < 0.5 ? from : to`, the same "current" reading every
 * other single-scene readout in this codebase uses) is a scene whose `sound?.mode === 'once'`,
 * `playing` is true, this call is not itself the render on which `playing` just turned true (see
 * `wasPlaying` below), and this scene's id is not already in `prevArmedOff` (fired since the last
 * time it was the dominant scene) — at most once per arrival. Deliberately generic in what
 * `SceneMix` it is handed: `sceneSoundLoopGains`/`onceSoundOutlived` are always called with the
 * *presented* (rate-limited) mix once a voice has been shown, since loop volume and an
 * already-sounding voice's fade must stay visually synced, but `engine.ts` calls this one with
 * the raw, un-throttled *target* mix instead — see its own call site for why.
 *
 * `wasPlaying` — whether `playing` was already true on the previous call — gates out a second,
 * independent false arrival: pressing play while already sitting on a once-mode scene is not an
 * arrival, since the playhead did not move into it under playback, so it must not fire. Without
 * this gate a scene reached by scrubbing while paused, or simply sitting under the playhead when
 * the page loads, fires the instant playback starts even though nothing was ever "arrived at".
 * The scene is armed off (not fired) on exactly the render where `playing` transitions `false`
 * -> `true`, whatever the dominant scene is; every other render is unaffected — a scene reached
 * by scrubbing *while already playing* still fires normally, since that transition never happens
 * on such a call.
 *
 * Firing on the *dominant* scene changing, rather than on `mix` reaching an exact 0/1, is what
 * makes this reliable: `scene/presentation.ts`'s `step` rate-limits a dissolve to take at least
 * `MIN_TRANSITION_SECONDS` of *wall-clock* time, a fixed floor independent of playback speed,
 * while `scene/pacing.ts`'s `scenePlaybackSegments` paces the *target* `t` through a dissolve
 * band in `MIN_TRANSITION_SECONDS / speed` — less, at any speed above 1x. In a densely-scened
 * stretch the target keeps moving on to the next dissolve before the rate-limited presented mix
 * ever lands on the exact float `0`/`1` an exact-settle check would require, so such a check
 * would rarely or never fire. The dominant-scene condition is weaker but always reachable:
 * `step`'s `state.mix` moves toward its target strictly monotonically, so a mix that ever starts
 * heading toward a scene below `0.5` provably crosses `0.5` even if later re-targeted past that
 * scene before reaching `1`.
 *
 * The presented mix can still fail a once-mode scene even with this looser condition: `step`'s
 * "different pair, settled" branch can rebase straight past an intervening scene without that
 * scene ever becoming `presented.to` at all (its own doc comment: "so playback never flashes
 * through whatever scenes lie between them") — such a scene never reports as dominant, however
 * loose the condition on `mix`. Feeding this function the raw *target* mix instead sidesteps
 * both failure modes: `sceneAt` is pure and instantaneous in `t` (DESIGN §3/§4), so it never
 * skips a scene the playhead actually passes through and never needs a wall-clock rate limit to
 * "catch up" with in the first place.
 *
 * Re-arming happens unconditionally, every call, not only on a fire: any id in `prevArmedOff`
 * that is no longer the dominant scene is dropped from the returned set, so leaving and
 * returning to a scene always re-arms it even if the effect never fired on the way out (e.g.
 * scrubbing straight past it without ever becoming dominant while playing). This is also what
 * still guarantees "not re-fire while dwelling": once a scene fires and is added to `armedOff`,
 * it stays there — and stays dominant, since nothing else is — for the whole rest of its dwell,
 * so the same arrival never fires twice.
 *
 * A scrub that happens to leave the dominant scene sitting on a once-mode scene must never fire
 * this — `playing` gates that out: `playing` must be whether `t` is currently being advanced by
 * the playback clock, never merely "was moving a moment ago".
 */
export function nextOnceTriggerState(
  sceneMix: SceneMix,
  playing: boolean,
  wasPlaying: boolean,
  prevArmedOff: ReadonlySet<string>,
): OnceTriggerResult {
  const current = dominantScene(sceneMix)
  const armedOff = new Set(prevArmedOff)
  for (const id of armedOff) {
    if (id !== current.id) armedOff.delete(id)
  }

  // Just pressed play while already sitting on `current` — arm it off without firing (see this
  // function's own doc comment).
  if (playing && !wasPlaying) {
    armedOff.add(current.id)
    return { armedOff, fired: null }
  }

  const shouldFire = playing && current.sound?.mode === 'once' && !armedOff.has(current.id)

  if (shouldFire) armedOff.add(current.id)

  return { armedOff, fired: shouldFire ? current : null }
}

/**
 * Whether `presented` has, as of this call, ever shown `sceneId` as its dominant scene since the
 * once-mode voice/pending trigger for it fired — a one-way latch: call with the previous return
 * value as `prev` and it stays `true` forever once it goes `true` (see `onceSoundOutlived`'s own
 * doc comment for why this exists). Pure in `presented`/`prev`.
 */
export function onceVoiceHasBeenPresented(presented: SceneMix, sceneId: string, prev: boolean): boolean {
  return prev || dominantScene(presented).id === sceneId
}

/**
 * Whether a `once`-mode voice/pending trigger fired for `sceneId` has outlived its scene and
 * should be faded/dropped rather than kept sounding (ADR-023; a launch clip runs over two
 * minutes).
 *
 * `nextOnceTriggerState` fires off the raw, un-rate-limited *target* mix, but the two mixes
 * disagree about more than just *when* a voice fires: the instant a voice fires off `target`
 * crossing into a scene, `presented` — which is still catching up, by construction, whenever it
 * lags — almost always still shows the *previous* scene as dominant. Reading `presented` alone
 * would therefore report "outlived" from the very first tick after firing, not once the picture
 * has actually moved on.
 *
 * The fix: only trust `presented` once it has actually shown `sceneId` as dominant at some point
 * (`hasBeenPresented`, latched via `onceVoiceHasBeenPresented`) — that is what "the picture has
 * caught up" means. Until then, `target` decides instead: it is pure and instantaneous in `t`
 * (DESIGN §3/§4), so it never itself skips past a scene the playhead actually visited, and a
 * voice/pending trigger for a scene `presented` may never show at all — `engine.ts`'s own
 * apollo-11-launch rebase case, where `step`'s "different pair, settled" branch can skip a scene
 * as `presented.to` entirely — still gets an explicit, reachable point at which it stops, instead
 * of either firing-then-instantly-fading or never fading at all. Once `presented` has shown the
 * scene, outlived reverts to `presented` alone, so anything already visually synced with an
 * on-screen once sound behaves exactly as expected.
 */
export function onceSoundOutlived(target: SceneMix, presented: SceneMix, sceneId: string, hasBeenPresented: boolean): boolean {
  if (hasBeenPresented) return dominantScene(presented).id !== sceneId
  return dominantScene(target).id !== sceneId
}

/**
 * Returns the scene whose `once`-mode effect should fire *this* render, or `null` — edge-
 * triggered (only the render right after `nextOnceTriggerState` computes a fire carries a
 * non-null value), not a continuous read. `sceneMix`/`playing` normally change once per
 * animation frame while playing, so this effect runs about that often, but each run is O(1).
 *
 * Tracks the previous `playing` value itself (`wasPlayingRef`), the same "ref mirror updated
 * only after the effect runs" pattern `armedOffRef` already uses, so `nextOnceTriggerState` can
 * tell a genuine arrival apart from playback merely resuming on a scene already under the
 * playhead (its own doc comment).
 */
export function useSceneSoundOnceTrigger(sceneMix: SceneMix, playing: boolean): Scene | null {
  const armedOffRef = useRef<ReadonlySet<string>>(new Set())
  const wasPlayingRef = useRef(false)
  const [fired, setFired] = useState<Scene | null>(null)

  useEffect(() => {
    const result = nextOnceTriggerState(sceneMix, playing, wasPlayingRef.current, armedOffRef.current)
    armedOffRef.current = result.armedOff
    wasPlayingRef.current = playing
    setFired(result.fired)
  }, [sceneMix, playing])

  return fired
}
