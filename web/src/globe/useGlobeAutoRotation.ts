'use client'

/**
 * The globe's rotation angle (radians, about the Y axis) — owned by exactly one place,
 * `Globe.tsx`'s `GlobeRotatingGroup`, which wraps the sphere mesh *and* every lat/lon-placed
 * overlay (`HumanCivilisation`) in a single `<group>` so the rotation applies to all of them via
 * one shared transform, not a value each of them has to read and apply independently.
 *
 * **Why a single group, not each consumer reading a shared ref (the first version of this
 * fix).** Rotating the sphere mesh and reading the same angle independently in the overlay
 * still has a real ordering bug: react-three-fiber's `useFrame` callbacks fire in the order
 * their `useEffect`-based subscriptions were registered, which for a parent/child pair follows
 * React's own child-before-parent effect-commit order — so a child's `useFrame` can read a
 * shared ref *before* the parent's own `useFrame` has updated it that frame, one tick stale.
 * Wrapping both in one rotating `<group>` removes the cross-component read entirely: the
 * rotation is applied once, to one `Object3D`, and every descendant inherits it through the
 * ordinary scene-graph matrix composition three.js already does every frame — no JS-level
 * ordering to get right.
 *
 * **Unbounded accumulation (the other bug this fixes).** The angle used to accumulate forever
 * while at rest, so after a long session the *displayed* angle could be many full turns —
 * pressing "Map" after 10 minutes span ~2.4 turns in the unfold's own 0.8s. `wrapAngle`
 * (`sceneLocation.ts`) keeps the accumulator in `[-π, π)` at all times, which has two effects at
 * once: the displayed angle can never exceed half a turn regardless of session length, and
 * interpolating from any angle already in range toward a target is automatically the shorter of
 * the two possible directions.
 *
 * **The scene-location focus (ADR-034) rides this same accumulator.** `focusRotationY` is the
 * angle that centres a scene's place; passing one here starts an ease toward it and suppresses
 * drift until it settles, then drift resumes from where it landed. It is emphatically not a
 * second rotation source — see `sceneLocation.ts`'s own doc comment.
 */

import { useFrame } from '@react-three/fiber'
import { useRef, type MutableRefObject } from 'react'

import { FOCUS_EASE_SECONDS, REST_ROTATION, startFocusEase, stepGlobeRotation } from './sceneLocation'

export const AUTO_ROTATE_RADIANS_PER_SECOND = 0.025

export interface GlobeRotationOptions {
  /** 0 (sphere) .. 1 (map). The displayed angle eases to square-on over this span, and drift
   *  stops accumulating once the unfold has started. */
  unfold: number
  /** `prefers-reduced-motion`: stops drift outright (a continuous, non-essential motion effect)
   *  and snaps the scene-location focus instead of easing it. */
  reducedMotion: boolean
  /** The angle that centres the current scene's location, or `null` for none — only ever passed
   *  while the orb is minimised (`Globe.tsx`'s own gate: expanded, the viewer steers). */
  focusRotationY: number | null
}

/** The live `rotation.y` for `GlobeRotatingGroup`, updated in place every frame. */
export function useGlobeAutoRotationY({ unfold, reducedMotion, focusRotationY }: GlobeRotationOptions): MutableRefObject<number> {
  const stateRef = useRef(REST_ROTATION)
  const focusTargetRef = useRef<number | null>(null)
  const rotationYRef = useRef(0)

  useFrame((_state, delta) => {
    if (focusRotationY !== focusTargetRef.current) {
      focusTargetRef.current = focusRotationY
      if (focusRotationY !== null) {
        stateRef.current = startFocusEase(stateRef.current, focusRotationY, reducedMotion ? 0 : FOCUS_EASE_SECONDS)
      }
    }
    const drift = unfold === 0 && !reducedMotion ? AUTO_ROTATE_RADIANS_PER_SECOND : 0
    stateRef.current = stepGlobeRotation(stateRef.current, delta, drift)
    rotationYRef.current = stateRef.current.rotationY * (1 - unfold)
  })

  return rotationYRef
}
