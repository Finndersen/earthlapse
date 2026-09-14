/**
 * Per-scene sound (ADR-023 §3, DESIGN.md §11's "a fourth thing DESIGN never named"). Reuses
 * the tier-1 stem catalogue: a scene names an existing stem id and asks for a different
 * playback treatment than that stem's own `t`-driven curve, not a bespoke sound file.
 *
 * `sceneSoundLoopGains` is pure. `useSceneSoundOnceTrigger` is the one small hook this module
 * exports; its edge-triggering logic is factored into `nextOnceTriggerState`, a pure function,
 * so the state machine itself is directly unit-testable without mounting a component.
 */

'use client'

import { useEffect, useRef, useState } from 'react'

import { dominantScene, type SceneMix } from '@/scene'
import type { Scene } from '@/types/manifest'

/** Matches `presentation.ts`'s own private `isSettled` (not exported): `mix` is exactly 0 or
 *  1, i.e. nothing is currently dissolving. */
function isSettled(mix: number): boolean {
  return mix === 0 || mix === 1
}

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
 *  last settling here" set, and the scene to fire this render's once-mode sound for, if any. */
export interface OnceTriggerResult {
  armedOff: ReadonlySet<string>
  fired: Scene | null
}

/**
 * The pure core of the once-mode arrival trigger (ADR-023 §3). Fires when `presented.mix` is
 * exactly settled at a scene whose `sound?.mode === 'once'`, `playing` is true, and this
 * scene's id is not already in `prevArmedOff` (fired since the last time it was the on-screen
 * scene) — at most once per arrival.
 *
 * Re-arming happens unconditionally, every call, not only on a fire: any id in `prevArmedOff`
 * that is no longer the dominant scene is dropped from the returned set, so leaving and
 * returning to a scene always re-arms it even if the effect never fired on the way out (e.g.
 * scrubbing straight past it without ever settling there while playing).
 *
 * A scrub that happens to leave `presented.mix` sitting at 1 must never fire this — `playing`
 * gates that out: `playing` must be whether `t` is currently being advanced by the playback
 * clock, never merely "was moving a moment ago".
 */
export function nextOnceTriggerState(
  presented: SceneMix,
  playing: boolean,
  prevArmedOff: ReadonlySet<string>,
): OnceTriggerResult {
  const current = dominantScene(presented)
  const armedOff = new Set(prevArmedOff)
  for (const id of armedOff) {
    if (id !== current.id) armedOff.delete(id)
  }

  const shouldFire =
    playing && isSettled(presented.mix) && current.sound?.mode === 'once' && !armedOff.has(current.id)

  if (shouldFire) armedOff.add(current.id)

  return { armedOff, fired: shouldFire ? current : null }
}

/**
 * Returns the scene whose `once`-mode effect should fire *this* render, or `null` — edge-
 * triggered (only the render right after `nextOnceTriggerState` computes a fire carries a
 * non-null value), not a continuous read. `presented`/`playing` normally change once per
 * animation frame while playing, so this effect runs about that often, but each run is O(1).
 */
export function useSceneSoundOnceTrigger(presented: SceneMix, playing: boolean): Scene | null {
  const armedOffRef = useRef<ReadonlySet<string>>(new Set())
  const [fired, setFired] = useState<Scene | null>(null)

  useEffect(() => {
    const result = nextOnceTriggerState(presented, playing, armedOffRef.current)
    armedOffRef.current = result.armedOff
    setFired(result.fired)
  }, [presented, playing])

  return fired
}
