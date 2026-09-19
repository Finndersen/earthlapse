'use client'

/**
 * Rate-limits what is *displayed* toward `sceneAt`'s target (ADR-012): near 500-200 Ma,
 * consecutive scenes sit close together in log1p-`t` space, so a fast scrub or playback tick
 * can cross a whole dissolve band in a handful of milliseconds.
 *
 * `sceneAt` stays a pure, instantaneous function of `t` (DESIGN §3), which is what lets
 * scrubbing and speed control share the same mechanism. `step` advances a *presented*
 * `{from, to, mix}` toward that target by at most `dt / MIN_TRANSITION_SECONDS` of `mix` per
 * wall-clock second, so a full 0 -> 1 sweep never completes faster than
 * `MIN_TRANSITION_SECONDS` — a target moving slower than that rate is simply followed exactly.
 *
 * `usePresentedSceneMix` drives `step` with `requestAnimationFrame`, only while not yet
 * converged on the target.
 *
 * Minimum on-screen dwell during playback is not this module's job: holding the
 * *presentation* would desync the picture from every other `t`-keyed readout (time, era,
 * ancestor, CO2). Playback paces `t` itself instead (`scene/pacing.ts`,
 * `timeline/playback.ts`'s `advancePlayhead`), so this rate limit is only a backstop for
 * scrubbing and fast playback.
 */

import { useEffect, useRef, useState } from 'react'

import type { Scene } from '@/types/manifest'

import { dominantScene, type PresentationRegime, type SceneMix } from './scene'

/** A full 0 -> 1 transition takes at least this long, regardless of how abruptly the target
 *  jumps. Tuned to read as a deliberate dissolve rather than a cut, without dragging out slow
 *  scrubbing (which already moves slower than this on its own). */
export const MIN_TRANSITION_SECONDS = 1.6

/**
 * Mirrors `scene/steadyPacing.ts`'s `MIN_CUT_DWELL_SECONDS` by value — kept in sync by hand,
 * not by importing it, since `steadyPacing.ts` already imports `MIN_TRANSITION_SECONDS` from
 * *this* file (the same "shared value, no cross-import back up" convention
 * `timeline/playback.ts` uses for its own mirror of this constant).
 *
 * Backstops `usePresentedSceneMix` against real `requestAnimationFrame` jitter (ADR-029):
 * `advanceSteadyPlayhead`'s floor only guarantees dwell in *simulated* time, but uneven frame
 * delivery can still land two or three displayed changes closer together in *wall-clock* time
 * than that floor implies (measured up to 4 changes in 1 s, smallest observed gap 232 ms). This
 * value floors the real time between one displayed dominant-scene change and the next,
 * *regardless of `regime`* — a `'crossfade'` flip is exactly as visible as a `'cut'` flip and
 * can land in the same window (e.g. a seek forced to `'crossfade'` for one frame right after a
 * `'cut'`). It also covers a seek landing partway through an already-floored territory, since
 * it measures from the last real change rather than from territory entry.
 */
const MIN_CUT_DWELL_SECONDS = 0.35

function sameScene(a: Scene, b: Scene): boolean {
  return a.id === b.id
}

function isSettled(mix: number): boolean {
  return mix === 0 || mix === 1
}

/** `current` moved toward `target` by at most `maxDelta`, landing exactly on `target` once
 *  within reach — never overshoots. */
function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

/** Distance between two scenes in the same log1p-`t` space `sceneAt` interpolates in, so
 *  "nearer" matches what a viewer perceives as closer on the warped timeline, not raw years. */
function logDistance(a: Scene, b: Scene): number {
  return Math.abs(Math.log1p(a.t) - Math.log1p(b.t))
}

/**
 * Advances presentation `state` toward `target` by at most `dt / MIN_TRANSITION_SECONDS` of
 * `mix`. `dt <= 0` or non-finite is a no-op (returns `state` unchanged, same reference) — a
 * paused clock or a first frame with no prior timestamp to diff against must not move
 * anything. Pure and side-effect free; `usePresentedSceneMix` is the only stateful caller.
 *
 * Four cases:
 * - **same pair**: `state` and `target` name the same two scenes in the same order — move
 *   `mix` toward `target.mix` directly.
 * - **reversed pair**: same two scenes but swapped — relabel to `target`'s order
 *   (`mix' = 1 - state.mix`) and fall through. `sceneAt` always labels a pair
 *   `(newer, older)`, but a direct transition can point either way in time.
 * - **different pair, settled** (`state.mix` is exactly 0 or 1): if the on-screen scene is one
 *   end of `target`'s pair, rebase onto that pair at the matching end — free, since the
 *   displayed image doesn't change. Otherwise start a fresh transition straight from the
 *   on-screen scene to `target`'s dominant scene, so playback never flashes through whatever
 *   scenes lie between them.
 * - **different pair, mid-transition**: keep moving toward whichever end is nearer (log1p
 *   `t`) to `target`'s dominant scene, so a target that reverses direction mid-flight turns
 *   the transition around smoothly instead of restarting it.
 *
 * Converged (`state` equal to `target`) is a fixed point: every branch above reduces to "same
 * pair" once the two coincide, and `moveToward` snaps exactly onto a target within reach — so
 * a paused frame stays exactly at `target`, and the hook below stops calling `step` once caught up.
 *
 * `regime` (ADR-029, default `'crossfade'`): `'cut'` skips all of the above and snaps
 * straight to `target`'s own dominant scene, at `mix` 0 or 1 — an instant image switch for a
 * scene whose on-screen dwell at steady speed is too short for a full `MIN_TRANSITION_SECONDS`
 * crossfade to read as anything but a blur through several scenes (`steadyPacing.ts` decides
 * which). The switch happens at exactly the same `t` `dominantScene` itself flips at, so a cut
 * never disagrees with the caption or a pip highlight about which scene is "current".
 */
export function step(state: SceneMix, target: SceneMix, dtSeconds: number, regime: PresentationRegime = 'crossfade'): SceneMix {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state

  if (regime === 'cut') {
    return { from: target.from, to: target.to, mix: target.mix < 0.5 ? 0 : 1 }
  }

  const maxDelta = dtSeconds / MIN_TRANSITION_SECONDS

  if (sameScene(state.from, target.from) && sameScene(state.to, target.to)) {
    return { from: target.from, to: target.to, mix: moveToward(state.mix, target.mix, maxDelta) }
  }

  if (sameScene(state.from, target.to) && sameScene(state.to, target.from)) {
    const relabelledMix = 1 - state.mix
    return { from: target.from, to: target.to, mix: moveToward(relabelledMix, target.mix, maxDelta) }
  }

  if (isSettled(state.mix)) {
    const onScreen = state.mix === 0 ? state.from : state.to
    if (sameScene(onScreen, target.from)) {
      return { from: target.from, to: target.to, mix: moveToward(0, target.mix, maxDelta) }
    }
    if (sameScene(onScreen, target.to)) {
      return { from: target.from, to: target.to, mix: moveToward(1, target.mix, maxDelta) }
    }
    const dest = dominantScene(target)
    return { from: onScreen, to: dest, mix: moveToward(0, 1, maxDelta) }
  }

  const dest = dominantScene(target)
  const towardTo = logDistance(state.to, dest) <= logDistance(state.from, dest)
  return { from: state.from, to: state.to, mix: moveToward(state.mix, towardTo ? 1 : 0, maxDelta) }
}

/** Whether `state` already renders `target` under `regime` — in `'cut'` regime that means
 *  matching `target`'s *binarized* mix (see `step`'s own cut branch), since a raw-`mix`
 *  comparison would find "not converged" forever while `target.mix` drifts inside the same
 *  binarized bucket, busy-looping the rAF loop for no visible change. */
function converged(state: SceneMix, target: SceneMix, regime: PresentationRegime): boolean {
  if (!sameScene(state.from, target.from) || !sameScene(state.to, target.to)) return false
  const targetMix = regime === 'cut' ? (target.mix < 0.5 ? 0 : 1) : target.mix
  return state.mix === targetMix
}

/**
 * Drives `step` with `requestAnimationFrame`, exposing the presented `SceneMix` — what
 * `SceneCanvasView`/`SceneFallbackView` actually render — rather than `target` itself. Mounts
 * at `target` exactly (no animation on mount, matching `sceneAt`'s own "first frame at a given
 * `t` is deterministic" contract) and only runs the frame loop while not yet converged on the
 * (possibly still-moving) target, so a settled scrub or paused playhead costs nothing.
 *
 * `regime` (default `'crossfade'`) passes straight through to `step` every tick, read via a ref
 * (the same pattern `targetRef` uses) so a regime flip mid-dissolve is picked up on the next
 * frame without restarting the loop.
 *
 * **Wall-clock backstop (ADR-029).** `step` is a pure function of `target` alone — it has no
 * notion of *when* the presented scene last actually changed, so anything driving `target`'s
 * dominant scene to change faster than `MIN_CUT_DWELL_SECONDS` apart would otherwise flash
 * through it just as fast, under either regime: rAF jitter around the sim-time floor, a seek
 * landing partway through an already-floored territory (both `'cut'`), or a `'crossfade'`
 * change whose presented mix was already close to the `0.5` switch point (see
 * `MIN_CUT_DWELL_SECONDS`'s doc comment). `lastDominantChangeAtRef` records the real timestamp
 * the presented dominant scene last changed, under any regime; a tick whose freshly-stepped
 * result would change it again too soon is held at the previous presented value instead (`next`
 * stays the same reference, so `setPresented` is a no-op) — `converged` then keeps reporting
 * "not yet", so the rAF loop retries every frame until the gate opens. Applying the same gate
 * to `'crossfade'` only ever *holds* a flip that would land too soon: an ordinary crossfade's
 * dominant scene never flips sooner than `MIN_TRANSITION_SECONDS / 2` (0.8 s) after starting
 * from a settled pair, so this never delays a normal one.
 */
export function usePresentedSceneMix(target: SceneMix, regime: PresentationRegime = 'crossfade'): SceneMix {
  const [presented, setPresented] = useState<SceneMix>(target)

  const presentedRef = useRef(presented)
  presentedRef.current = presented
  const targetRef = useRef(target)
  targetRef.current = target
  const regimeRef = useRef(regime)
  regimeRef.current = regime
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  /** rAF timestamp the presented dominant scene last changed, or `null` before the first one. */
  const lastDominantChangeAtRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  useEffect(() => {
    // A loop is already running (reads targetRef/regimeRef fresh, so it picks this update up on
    // its own), or presented already matches this target exactly.
    if (rafRef.current !== null || converged(presentedRef.current, target, regime)) return

    lastFrameRef.current = null
    const tick = (now: number): void => {
      const last = lastFrameRef.current
      lastFrameRef.current = now
      const dtSeconds = last === null ? 0 : (now - last) / 1000
      const regime = regimeRef.current
      const prevDominant = dominantScene(presentedRef.current)
      const stepped = step(presentedRef.current, targetRef.current, dtSeconds, regime)
      const steppedDominant = dominantScene(stepped)

      // Wall-clock backstop: a dominant-scene change sooner than MIN_CUT_DWELL_SECONDS after
      // the last one is held at the previous presented value instead of applied.
      const lastChangeAt = lastDominantChangeAtRef.current
      const held =
        steppedDominant.id !== prevDominant.id &&
        lastChangeAt !== null &&
        now - lastChangeAt < MIN_CUT_DWELL_SECONDS * 1000
      const next = held ? presentedRef.current : stepped

      if (dominantScene(next).id !== prevDominant.id) lastDominantChangeAtRef.current = now

      presentedRef.current = next
      setPresented(next)

      if (converged(next, targetRef.current, regimeRef.current)) {
        rafRef.current = null
        lastFrameRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [target, regime])

  return presented
}
