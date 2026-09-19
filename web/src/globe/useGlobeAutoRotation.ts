'use client'

/**
 * The globe's rotation angle (radians, about the Y axis), owned by exactly one place:
 * `Globe.tsx`'s `GlobeRotatingGroup`, which wraps the sphere mesh *and* every lat/lon-placed
 * overlay (`HumanCivilisation`) in a single `<group>`.
 *
 * One group rather than each consumer reading a shared angle, because react-three-fiber's
 * `useFrame` callbacks fire in the order their `useEffect`-based subscriptions registered, which
 * for a parent/child pair is React's child-before-parent effect-commit order — a child's
 * `useFrame` would read the shared value one tick stale. One rotating `<group>` removes the
 * cross-component read: the rotation applies to one `Object3D` and descendants inherit it via
 * three.js's ordinary scene-graph matrix composition.
 *
 * `wrapAngle` (`sceneLocation.ts`) keeps the accumulator in `[-π, π)`, which does two things at
 * once: the displayed angle never exceeds half a turn however long the session runs, and
 * interpolating from an in-range angle toward a target automatically takes the shorter direction.
 *
 * The scene-location focus (ADR-034) rides this same accumulator — `focusLon` is the current
 * scene's longitude or `null`, and a new one starts an ease toward the `rotation.y` that centres
 * it. It is not a second rotation source; see `sceneLocation.ts`.
 *
 * Centring accounts for wherever `OrbitControls` (`Globe.tsx`'s `GlobeCameraControls`) has left
 * the camera, which rotates about this same `+Y` axis. This hook runs inside the `<Canvas>`, so
 * `useThree()` reads the *same* camera object those controls drive rather than a copy or a
 * threaded-down prop. The azimuth is sampled once, when a new focus target is set — sampling
 * every frame would restart the ease on every tick of a viewer's drag, fighting the input this
 * must not fight.
 *
 * Drift stays suppressed while `focusLon` is non-null, not just while the ease runs: the ease
 * guarantees a landing at one instant, but the scene stays on screen for a dwell this hook can't
 * know. Keying suppression to the same signal that starts the ease avoids inventing a timer to
 * tune against a per-scene dwell. Ambient drift resumes from wherever the ease landed once the
 * dominant scene has no location (or the orb expands, which clears `focusLon` at the call site).
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type MutableRefObject } from 'react'

import { FOCUS_EASE_SECONDS, focusRotationY, REST_ROTATION, startFocusEase, stepGlobeRotation } from './sceneLocation'

export const AUTO_ROTATE_RADIANS_PER_SECOND = 0.025

export interface GlobeRotationOptions {
  /** 0 (sphere) .. 1 (map). The displayed angle eases to square-on over this span, and drift
   *  stops accumulating once the unfold has started. */
  unfold: number
  /** `prefers-reduced-motion`: stops drift outright (a continuous, non-essential motion effect)
   *  and snaps the scene-location focus instead of easing it. */
  reducedMotion: boolean
  /** The current scene's location longitude, or `null` for none — only passed while the orb is
   *  minimised (`Globe.tsx` gates this: expanded, the viewer steers). The centring `rotation.y`
   *  depends on the camera azimuth when the ease starts, which this hook reads itself so
   *  `sceneLocation.ts` stays pure. */
  focusLon: number | null
}

/** The live `rotation.y` for `GlobeRotatingGroup`, updated in place every frame. */
export function useGlobeAutoRotationY({ unfold, reducedMotion, focusLon }: GlobeRotationOptions): MutableRefObject<number> {
  const { camera } = useThree()
  const stateRef = useRef(REST_ROTATION)
  const focusLonRef = useRef<number | null>(null)
  const rotationYRef = useRef(0)

  useFrame((_state, delta) => {
    if (focusLon !== focusLonRef.current) {
      focusLonRef.current = focusLon
      if (focusLon !== null) {
        const cameraAzimuthY = Math.atan2(camera.position.x, camera.position.z)
        const target = focusRotationY(focusLon, cameraAzimuthY)
        stateRef.current = startFocusEase(stateRef.current, target, reducedMotion ? 0 : FOCUS_EASE_SECONDS)
      }
    }
    const drift = unfold === 0 && !reducedMotion && focusLon === null ? AUTO_ROTATE_RADIANS_PER_SECOND : 0
    stateRef.current = stepGlobeRotation(stateRef.current, delta, drift)
    rotationYRef.current = stateRef.current.rotationY * (1 - unfold)
  })

  return rotationYRef
}
