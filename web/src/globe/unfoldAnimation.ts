'use client'

/**
 * The Globe/Map toggle's sphere<->map tween (`uUnfold`, `shaders.ts`; ADR-033): ~0.8s, eased,
 * wall-clock. Reuses `lib/presentedMix.ts`'s generic `useRateLimitedState` rAF driver (mount/
 * cleanup, no idle rAF loop once settled) rather than a second loop, but not that module's
 * `moveToward` speed cap: a speed cap suits a value tracking continuously-changing `t`, where
 * there is no natural duration. This toggle is a discrete one-shot action with no `t`, so a fixed
 * eased duration is what reads as one deliberate motion per press.
 */

import { useMemo } from 'react'

import { useRateLimitedState } from '@/lib/presentedMix'

/** Long enough to see the sphere/map morph and camera reframe as one deliberate motion, short
 *  enough not to feel sluggish on a discrete, one-shot toggle press (ADR-033). */
export const UNFOLD_DURATION_SECONDS = 0.8

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

export function easeInOutCubic(x: number): number {
  const c = clamp01(x)
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2
}

export interface UnfoldState {
  /** 0 (sphere) .. 1 (map) — what `uUnfold` and the map-mode camera framing read right now. */
  value: number
  /** 0 or 1: where the tween is currently headed. */
  target: number
  /** Wall-clock seconds since `target` last changed. */
  elapsedSeconds: number
}

export const SPHERE_UNFOLD: UnfoldState = { value: 0, target: 0, elapsedSeconds: 0 }

/**
 * Advances `state` by `dtSeconds` toward `target.target`. Changing the destination restarts the
 * ease from whatever `value` currently is, over the *full* `durationSeconds` again — not just
 * the remaining distance — so reversing mid-unfold never jumps, and each press of the toggle
 * reads as one full ~0.8s motion regardless of where the previous one left off.
 * `durationSeconds <= 0` (reduced motion) snaps immediately, matching every other chrome
 * animation's reduced-motion rule in this codebase.
 *
 * `target`'s own `value`/`elapsedSeconds` fields are unused placeholders — `useUnfold` below
 * only needs `target.target`, but `useRateLimitedState` requires the target and presented state
 * to share one type, and reusing that generic driver (see the module doc) is worth the small
 * unused-field cost over hand-rolling a second rAF loop.
 */
export function stepUnfold(state: UnfoldState, target: UnfoldState, dtSeconds: number, durationSeconds: number): UnfoldState {
  if (durationSeconds <= 0) return { value: target.target, target: target.target, elapsedSeconds: 0 }
  const restarted = target.target === state.target ? state : { value: state.value, target: target.target, elapsedSeconds: 0 }
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return restarted
  const elapsedSeconds = restarted.elapsedSeconds + dtSeconds
  const progress = clamp01(elapsedSeconds / durationSeconds)
  const value = restarted.value + (target.target - restarted.value) * easeInOutCubic(progress)
  return { value, target: target.target, elapsedSeconds }
}

export function unfoldSettled(state: UnfoldState, target: UnfoldState): boolean {
  return state.target === target.target && state.value === target.target
}

/** `mapMode` as a tween: 0 while false, 1 while true, ~0.8s eased between (instant under
 *  `reducedMotion`). Mounts already settled at `mapMode`'s initial value (`useRateLimitedState`'s
 *  own "mounts at target exactly" rule), so opening the expanded globe never plays an unfold
 *  animation it didn't ask for. */
export function useUnfold(mapMode: boolean, reducedMotion: boolean): number {
  const target = useMemo<UnfoldState>(() => {
    const t = mapMode ? 1 : 0
    return { value: t, target: t, elapsedSeconds: 0 }
  }, [mapMode])
  const durationSeconds = reducedMotion ? 0 : UNFOLD_DURATION_SECONDS
  const step = (state: UnfoldState, target: UnfoldState, dt: number): UnfoldState => stepUnfold(state, target, dt, durationSeconds)
  const presented = useRateLimitedState(target, step, unfoldSettled)
  return presented.value
}
