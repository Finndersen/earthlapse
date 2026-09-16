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
 *
 * Minimum on-screen dwell during playback is not this module's job: holding the *presentation*
 * would desynchronise the picture from every other readout keyed off `t` (time, era, ancestor,
 * CO2). Playback paces `t` itself instead (`scene/pacing.ts`, `timeline/playback.ts`'s
 * `advancePlayhead` pacing argument), so this rate limit is only a backstop for scrubbing and
 * very fast playback.
 */

import { useEffect, useRef, useState } from 'react'

import type { Scene } from '@/types/manifest'

import { dominantScene, type PresentationRegime, type SceneMix } from './scene'

/** A full 0 -> 1 transition takes at least this long, regardless of how abruptly the target
 *  jumps. Tuned to read as a deliberate dissolve rather than a cut, without dragging out slow
 *  scrubbing (which already moves slower than this on its own). */
export const MIN_TRANSITION_SECONDS = 1.6

/**
 * Mirrors `scene/steadyPacing.ts`'s `MIN_CUT_DWELL_SECONDS` by value (kept in sync by hand, not
 * by importing it — `steadyPacing.ts` already imports `MIN_TRANSITION_SECONDS` from *this* file,
 * and this module sits low enough in the dependency graph that `scene/pacing.ts` and
 * `SceneView.tsx` both import it; the same "shared value, no cross-import back up" convention
 * `timeline/playback.ts`'s own mirror of this constant already established for the same reason).
 *
 * Used only by `usePresentedSceneMix`'s wall-clock backstop (ADR-029, re-review fixes
 * 2026-09-15): `advanceSteadyPlayhead`'s floor guarantees each scene territory at least this much
 * dwell in *simulated* time, but real `requestAnimationFrame` delivery is not perfectly uniform,
 * so a run of slightly-early frames can still land two or three actual displayed changes closer
 * together in *wall-clock* time than the sim-time floor alone would suggest (live-measured up to
 * 4 changes in 1 s, smallest real gap 232 ms). The backstop below never displays a new dominant
 * scene sooner than this many real seconds after the last one actually shown, *regardless of
 * `regime`* — an earlier version of this gate applied only to `'cut'`-regime changes, but a
 * dominant flip rendered under `'crossfade'` counts exactly the same toward the on-screen
 * flash rate as one rendered under `'cut'`, and one can land inside the same window (a seek
 * forced to `'crossfade'` for one frame right after a `'cut'` change, or a `step` rebase/direct
 * transition whose presented mix was already close to the switch point) — see
 * `usePresentedSceneMix`'s own doc comment for why holding it is always safe regardless of
 * regime. The gate is enforced at the point the change is actually observable (the pixels on
 * screen) rather than only in the model that's supposed to produce it. It also, as a side
 * effect, protects a seek that lands partway through an already-floored territory (the
 * *remaining* fraction of that territory can cross in under the full floor, since the floor is
 * computed for the whole territory, not "time left"): the backstop measures from the last real
 * change, not from territory entry, so it catches that case too.
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
 *
 * `regime` (ADR-029, default `'crossfade'` — every call site before this ADR, and every one
 * outside `'steady'`-mode playback, gets today's behaviour unchanged): `'cut'` skips all of the
 * above and snaps straight to `target`'s own dominant scene, at `mix` 0 or 1 — an instant image
 * switch instead of a rate-limited dissolve, for a scene whose on-screen dwell at the current
 * steady speed is too short for a full `MIN_TRANSITION_SECONDS` crossfade to read as anything but
 * a blur through several scenes (`scene/steadyPacing.ts` decides which, per scene). The switch
 * happens at exactly the same `t` `dominantScene` itself would flip at, so a cut never disagrees
 * with the caption or a pip highlight about which scene is "current".
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
 *  matching `target`'s *binarized* mix (see `step`'s own cut branch), since that is all a cut
 *  ever settles on; a raw-`mix` comparison would find "not converged" forever while `target.mix`
 *  keeps drifting inside the same binarized bucket, busy-looping `usePresentedSceneMix`'s rAF
 *  loop for no visible change. */
function converged(state: SceneMix, target: SceneMix, regime: PresentationRegime): boolean {
  if (!sameScene(state.from, target.from) || !sameScene(state.to, target.to)) return false
  const targetMix = regime === 'cut' ? (target.mix < 0.5 ? 0 : 1) : target.mix
  return state.mix === targetMix
}

/**
 * Drives `step` with `requestAnimationFrame`, exposing the presented `SceneMix` — what
 * `SceneCanvasView`/`SceneFallbackView` actually render — rather than `target` itself. Mounts
 * at `target` exactly (no animation on mount, matching `sceneAt`'s own "the first frame at a
 * given `t` is deterministic" contract) and only runs the frame loop while the presented state
 * has not yet converged on the (possibly still-moving) target, so a settled scrub or a paused
 * playhead costs nothing.
 *
 * `regime` (default `'crossfade'`) is passed straight through to `step` every tick — see its own
 * doc comment. Read via a ref inside the loop, the same "always fresh, no loop restart" pattern
 * `targetRef` already uses, so a regime flip mid-dissolve (steady playback entering or leaving a
 * dense cluster) is picked up on the very next frame without tearing down and restarting the loop.
 *
 * **Wall-clock backstop (ADR-029, re-review fixes 2026-09-15).** `step` is a pure function of
 * `target` alone — it has no notion of *when* the presented scene last actually changed, so
 * anything that drives `target` to change dominant scene faster than `MIN_CUT_DWELL_SECONDS`
 * apart would otherwise flash through it on screen just as fast, under *either* regime: real
 * `requestAnimationFrame` jitter around the sim-time floor or a seek landing partway through an
 * already-floored scene territory (both `'cut'`), but also a `'crossfade'`-regime change whose
 * presented mix happened to already be close to the `0.5` switch point — a seek forced to
 * `'crossfade'` for exactly one frame right after a `'cut'` change (`Experience.tsx`'s own seek
 * detection), or a `step` rebase/direct-transition/same-pair continuation resuming from a mix
 * near the boundary — see `MIN_CUT_DWELL_SECONDS`'s own doc comment for why the floor alone
 * doesn't already prevent this. `lastDominantChangeAtRef` records the real timestamp (`tick`'s
 * own rAF `now`) the presented *dominant* scene last actually changed, under any regime; a tick
 * whose freshly `step`ped result would change it again sooner than that is held at the previous
 * presented value instead (`next` stays `presentedRef.current`, the same reference, so
 * `setPresented` is a no-op re-render) rather than applying the change — `converged` then
 * correctly keeps reporting "not yet", so the rAF loop keeps retrying every frame until the gate
 * opens, never dropping the pending change. Applying the same gate to `'crossfade'` can only ever
 * *hold* a flip that would otherwise land too soon — an ordinary crossfade, whose dominant scene
 * never flips sooner than `MIN_TRANSITION_SECONDS / 2` (0.8 s) after it starts moving from a
 * settled pair, is never "too soon" in the first place, so this never delays one; see `step`'s own
 * doc comment for why every branch that starts a *fresh* transition (rebase, direct transition)
 * begins exactly at the settled endpoint, never partway toward the target.
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
  /** `now` (rAF timestamp) the presented dominant scene last actually changed, under any regime,
   *  or `null` before the first one — see this hook's own "wall-clock backstop" doc comment
   *  above. */
  const lastDominantChangeAtRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  useEffect(() => {
    // A loop is already running (it reads targetRef/regimeRef fresh every frame, so it will pick
    // this update up on its own) or the presented state already matches this target exactly.
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

      // Wall-clock backstop (see this hook's own doc comment): a change to a new dominant scene
      // sooner than MIN_CUT_DWELL_SECONDS after the last one is held at the previous presented
      // value rather than applied, regardless of regime.
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
