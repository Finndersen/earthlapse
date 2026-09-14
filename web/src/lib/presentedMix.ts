'use client'

/**
 * A minimum wall-clock duration for anything displayed as a two-item crossfade (ADR-012's
 * limiter, generalised over the item type for ADR-015's ancestor portrait).
 *
 * The *target* mix stays a pure function of `t`; this module only rate-limits what is
 * displayed toward it, by at most `dt / minSeconds` of `mix` per wall-clock second. A target
 * moving slower than that is followed exactly. It is the same algorithm as
 * `scene/presentation.ts`'s `step`, kept here so the layers package can use it without
 * importing the scene package; the scene package can adopt it without behaviour change.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** `to` drawn over `from` at `mix`: 0 shows `from` alone, 1 shows `to` alone. */
export interface Mix<T> {
  from: T
  to: T
  mix: number
}

/** How two items are told apart, and how far apart they read on the warped timeline. */
export interface MixKeying<T> {
  same(a: T, b: T): boolean
  distance(a: T, b: T): number
}

/** The item that reads as "current" for UI that can show only one. */
export function dominantItem<T>({ from, to, mix }: Mix<T>): T {
  return mix < 0.5 ? from : to
}

function isSettled(mix: number): boolean {
  return mix === 0 || mix === 1
}

/** `current` moved toward `target` by at most `maxDelta`, landing exactly on it once within reach. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

/**
 * Advances presented `state` toward `target` by at most `dtSeconds / minSeconds` of `mix`.
 * A non-positive or non-finite `dt` returns `state` itself. The four cases:
 * - same pair: move `mix` directly;
 * - reversed pair: relabel as `1 - mix`, then move;
 * - different pair, settled: rebase if the item on screen is one end of the target pair,
 *   otherwise start a direct transition from it to the target's dominant item, never flashing
 *   through the items in between;
 * - different pair, mid-transition: finish toward whichever end is nearer the target's
 *   dominant item.
 */
export function stepMix<T>(state: Mix<T>, target: Mix<T>, dtSeconds: number, minSeconds: number, keying: MixKeying<T>): Mix<T> {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state
  const maxDelta = dtSeconds / minSeconds

  if (keying.same(state.from, target.from) && keying.same(state.to, target.to)) {
    return { from: target.from, to: target.to, mix: moveToward(state.mix, target.mix, maxDelta) }
  }

  if (keying.same(state.from, target.to) && keying.same(state.to, target.from)) {
    return { from: target.from, to: target.to, mix: moveToward(1 - state.mix, target.mix, maxDelta) }
  }

  if (isSettled(state.mix)) {
    const onScreen = state.mix === 0 ? state.from : state.to
    if (keying.same(onScreen, target.from)) {
      return { from: target.from, to: target.to, mix: moveToward(0, target.mix, maxDelta) }
    }
    if (keying.same(onScreen, target.to)) {
      return { from: target.from, to: target.to, mix: moveToward(1, target.mix, maxDelta) }
    }
    return { from: onScreen, to: dominantItem(target), mix: moveToward(0, 1, maxDelta) }
  }

  const dest = dominantItem(target)
  const towardTo = keying.distance(state.to, dest) <= keying.distance(state.from, dest)
  return { from: state.from, to: state.to, mix: moveToward(state.mix, towardTo ? 1 : 0, maxDelta) }
}

export function mixesEqual<T>(a: Mix<T>, b: Mix<T>, keying: MixKeying<T>): boolean {
  return keying.same(a.from, b.from) && keying.same(a.to, b.to) && a.mix === b.mix
}

/**
 * Drives an arbitrary `step` function with `requestAnimationFrame`, returning the presented
 * state. Mounts at `target` exactly, and runs frames only while `settled` says the presented
 * state has not converged on `target` — no idle rAF loop once it has caught up. This is the
 * rAF/dt-accounting loop every wall-clock presentation limiter in this codebase shares;
 * `usePresentedMix` below and `usePresentedNumericRecord` are both thin `step`/`settled`
 * bindings over it, so a second (or third) copy of the loop itself never needs writing.
 * `step` and `settled` must be referentially stable (module constants, or memoised) — they run
 * inside the rAF loop's closure, not as an effect dependency the loop restarts for.
 */
export function useRateLimitedState<S>(
  target: S,
  step: (state: S, target: S, dtSeconds: number) => S,
  settled: (state: S, target: S) => boolean,
): S {
  const [presented, setPresented] = useState<S>(target)

  const presentedRef = useRef(presented)
  presentedRef.current = presented
  const targetRef = useRef(target)
  targetRef.current = target
  const stepRef = useRef(step)
  stepRef.current = step
  const settledRef = useRef(settled)
  settledRef.current = settled
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (rafRef.current !== null || settledRef.current(presentedRef.current, target)) return

    lastFrameRef.current = null
    const tick = (now: number): void => {
      const last = lastFrameRef.current
      lastFrameRef.current = now
      const dtSeconds = last === null ? 0 : (now - last) / 1000
      const next = stepRef.current(presentedRef.current, targetRef.current, dtSeconds)
      presentedRef.current = next
      setPresented(next)

      if (settledRef.current(next, targetRef.current)) {
        rafRef.current = null
        lastFrameRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [target])

  return presented
}

/**
 * Drives `stepMix` with `requestAnimationFrame`, returning the presented mix. Mounts at
 * `target` exactly, and runs frames only while the presentation has not converged on it.
 * `keying` must be referentially stable (a module constant).
 */
export function usePresentedMix<T>(target: Mix<T>, minSeconds: number, keying: MixKeying<T>): Mix<T> {
  const step = useCallback(
    (state: Mix<T>, target: Mix<T>, dtSeconds: number) => stepMix(state, target, dtSeconds, minSeconds, keying),
    [minSeconds, keying],
  )
  const settled = useCallback((state: Mix<T>, target: Mix<T>) => mixesEqual(state, target, keying), [keying])
  return useRateLimitedState(target, step, settled)
}

/**
 * Rate-limits a plain numeric record — several independent scalar values, each moved toward its
 * own target field by at most `dtSeconds / minSeconds` per wall-clock second via `moveToward`
 * (no field's motion affects another's). Generalises `stepMix`/`usePresentedMix` above to values
 * that aren't a keyed "from/to" transition between two named items — e.g. the globe's effect
 * intensities (`web/src/globe/effects/presentation.ts`), which are just numbers that must not
 * visibly snap when their target jumps (a fast scrub or playback tick crossing a whole
 * ease/crossfade band in a handful of milliseconds), with no "other item" to name.
 */
export function stepNumericRecord<K extends string>(
  state: Readonly<Record<K, number>>,
  target: Readonly<Record<K, number>>,
  dtSeconds: number,
  minSeconds: number,
): Record<K, number> {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state
  const maxDelta = dtSeconds / minSeconds
  const next: Record<K, number> = { ...state }
  let changed = false
  for (const key of Object.keys(target) as K[]) {
    const value = moveToward(state[key], target[key], maxDelta)
    if (value !== state[key]) {
      next[key] = value
      changed = true
    }
  }
  return changed ? next : state
}

function numericRecordSettled<K extends string>(state: Readonly<Record<K, number>>, target: Readonly<Record<K, number>>): boolean {
  return (Object.keys(target) as K[]).every((key) => state[key] === target[key])
}

/** `useRateLimitedState` bound to `stepNumericRecord`/`numericRecordSettled` — see that
 *  function's doc comment. */
export function usePresentedNumericRecord<K extends string>(target: Readonly<Record<K, number>>, minSeconds: number): Record<K, number> {
  const step = useCallback(
    (state: Record<K, number>, target: Record<K, number>, dtSeconds: number) => stepNumericRecord(state, target, dtSeconds, minSeconds),
    [minSeconds],
  )
  return useRateLimitedState(target, step, numericRecordSettled)
}
