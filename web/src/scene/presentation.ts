'use client'

/**
 * Rate-limits what is *displayed* toward `sceneAt`'s target (ADR-012: "a minimum wall-clock
 * duration" — the human-reported abruptness around 500-200 Ma, where consecutive scenes sit
 * close together in log1p-`t` space so a fast scrub or playback tick can cross a whole
 * dissolve band in a handful of milliseconds).
 *
 * `sceneAt` stays exactly as it was — a pure, instantaneous function of `t` — because that
 * purity is what makes scrubbing and speed control the same mechanism (DESIGN §3). This
 * module sits downstream of it: `step` advances a *presented* `{from, to, mix}` toward that
 * target by at most `dt / MIN_TRANSITION_SECONDS` of `mix` per wall-clock second, so a full
 * 0 -> 1 sweep never completes in under `MIN_TRANSITION_SECONDS`, while a target that is
 * itself moving slower than that rate (a slow scrub through the dissolve band, slow
 * playback) is simply followed exactly — the rate limit never lags behind a target that
 * isn't outrunning it.
 *
 * `usePresentedSceneMix` drives `step` with `requestAnimationFrame`, only while the presented
 * state has not yet converged on the target (no idle rAF loop once it has caught up).
 */

import { useEffect, useRef, useState } from 'react'

import type { Scene } from '@/types/manifest'

import { dominantScene, type SceneMix } from './scene'

/** A full 0 -> 1 transition takes at least this long, regardless of how abruptly the target
 *  jumps. Tuned to read as a deliberate dissolve rather than a cut, without dragging out slow
 *  scrubbing (which already moves slower than this on its own). */
export const MIN_TRANSITION_SECONDS = 1.6

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
 * Four cases, in the order the brief poses them:
 * - **same pair** — `state` and `target` name the same two scenes in the same order: move
 *   `mix` toward `target.mix` directly.
 * - **reversed pair** — `state` names the same two scenes as `target` but swapped: read as
 *   `target`'s own labelling (`mix' = 1 - state.mix`) and fall through to the same movement.
 *   `sceneAt` always labels a pair `(newer, older)` by scene order, but a direct transition
 *   started below can point either way in time, so this reconciles the two labellings rather
 *   than treating them as unrelated pairs.
 * - **different pair, settled** (`state.mix` is exactly 0 or 1 — nothing captions this scene
 *   as "moving" right now): if the scene currently on screen is one end of `target`'s pair,
 *   rebase onto that pair (at the matching end) and keep moving in the same tick — free,
 *   since the displayed image doesn't change. Otherwise the two are unrelated: start a fresh
 *   transition straight from the on-screen scene to `target`'s dominant scene, so playback
 *   never flashes through whatever scenes lie between them.
 * - **different pair, mid-transition**: keep moving toward whichever end is nearer (in
 *   log1p `t`) to `target`'s dominant scene, so a target that reverses direction mid-flight
 *   turns the presented transition around smoothly instead of restarting it.
 *
 * Converged (`state` equal to `target` in every field) is a fixed point: every branch above
 * reduces to "same pair" once the two coincide, and `moveToward` snaps exactly onto a target
 * within reach rather than approaching it asymptotically — so a paused frame stays exactly at
 * `target`, and scrubbing that pauses catches up and then stops calling `step` at all (see the
 * hook below).
 */
export function step(state: SceneMix, target: SceneMix, dtSeconds: number): SceneMix {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state
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

/**
 * How long each scene stays settled on screen during playback before the presentation may
 * dissolve away from it. Symlog pacing spends equal wall-clock time per decade, so near the
 * present `t` crosses whole scene gaps faster than `MIN_TRANSITION_SECONDS`; without a hold
 * the display would stay perpetually mid-dissolve. With it, fast playback reads as a series of
 * settled scenes joined by dissolves, skipping (never flashing through) the ones it outran.
 */
export const PLAYBACK_HOLD_SECONDS = 2.4

/** A presented `SceneMix` plus how long its on-screen scene has been settled. */
export interface Presentation {
  scene: SceneMix
  /** Seconds the current scene has been settled (`mix` exactly 0 or 1); 0 mid-transition. */
  heldSeconds: number
}

/** The scene a settled mix shows alone, or `null` mid-transition. */
function settledScene({ from, to, mix }: SceneMix): Scene | null {
  if (mix === 0) return from
  if (mix === 1) return to
  return null
}

/**
 * `step`, plus a minimum on-screen hold: a scene that has been settled for less than
 * `minHoldSeconds` is not left yet — the presentation keeps showing it (while still counting
 * the hold) until the hold has elapsed, then moves toward wherever `target` is by then. Steps
 * that keep the same scene on screen (a free rebase, or no movement at all) always apply.
 * `minHoldSeconds = 0` is exactly `step`. Same `dt` edge cases as `step`.
 */
export function advance(state: Presentation, target: SceneMix, dtSeconds: number, minHoldSeconds: number): Presentation {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state

  const next = step(state.scene, target, dtSeconds)
  const onScreen = settledScene(state.scene)
  if (onScreen === null) return { scene: next, heldSeconds: 0 }

  const heldSeconds = state.heldSeconds + dtSeconds
  const nextOnScreen = settledScene(next)
  if (nextOnScreen !== null && sameScene(nextOnScreen, onScreen)) return { scene: next, heldSeconds }
  if (heldSeconds < minHoldSeconds) return { scene: state.scene, heldSeconds }
  return { scene: next, heldSeconds: 0 }
}

function converged(state: SceneMix, target: SceneMix): boolean {
  return sameScene(state.from, target.from) && sameScene(state.to, target.to) && state.mix === target.mix
}

/**
 * Drives `advance` with `requestAnimationFrame`, exposing the presented `SceneMix` — what
 * `SceneCanvasView`/`SceneFallbackView` actually render — rather than `target` itself. Mounts
 * at `target` exactly (no animation on mount, matching `sceneAt`'s own "the first frame at a
 * given `t` is deterministic" contract) and only runs the frame loop while the presented state
 * has not yet converged on the (possibly still-moving) target, so a settled scrub or a paused
 * playhead costs nothing. `minHoldSeconds` is read fresh every frame, so pausing mid-hold
 * releases it immediately.
 */
export function usePresentedSceneMix(target: SceneMix, minHoldSeconds: number): SceneMix {
  // The mounted scene has already been "seen" for as long as anything cares: no hold applies.
  const [presented, setPresented] = useState<Presentation>(() => ({ scene: target, heldSeconds: Infinity }))

  const presentedRef = useRef(presented)
  presentedRef.current = presented
  const targetRef = useRef(target)
  targetRef.current = target
  const holdRef = useRef(minHoldSeconds)
  holdRef.current = minHoldSeconds
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  // When the loop last stopped: a settled scene keeps accruing hold time while no frames run.
  const idleSinceRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  useEffect(() => {
    // A loop is already running (it reads targetRef fresh every frame, so it will pick this
    // update up on its own) or the presented state already matches this target exactly.
    if (rafRef.current !== null || converged(presentedRef.current.scene, target)) return

    lastFrameRef.current = null
    const tick = (now: number): void => {
      const last = lastFrameRef.current
      lastFrameRef.current = now
      let current = presentedRef.current
      if (last === null && idleSinceRef.current !== null) {
        current = { ...current, heldSeconds: current.heldSeconds + (now - idleSinceRef.current) / 1000 }
        idleSinceRef.current = null
      }
      const dtSeconds = last === null ? 0 : (now - last) / 1000
      const next = advance(current, targetRef.current, dtSeconds, holdRef.current)
      presentedRef.current = next
      setPresented(next)

      if (converged(next.scene, targetRef.current)) {
        rafRef.current = null
        lastFrameRef.current = null
        idleSinceRef.current = now
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [target])

  return presented.scene
}
