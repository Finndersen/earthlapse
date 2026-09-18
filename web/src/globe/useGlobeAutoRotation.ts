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
 * **The scene-location focus (ADR-034) rides this same accumulator.** `focusLon` is the current
 * scene's longitude, or `null`; passing a new one starts an ease toward whatever `rotation.y`
 * actually centres it and suppresses drift until it settles. It is emphatically not a second
 * rotation source — see `sceneLocation.ts`'s own doc comment.
 *
 * **The camera's own azimuth, read from the one place that owns it.** Centring has to account
 * for wherever `OrbitControls` (`Globe.tsx`'s `GlobeCameraControls`) has actually left the
 * camera — it rotates the camera about this same `+Y` axis in both the minimised orb and the
 * expanded sphere, so a viewer who has dragged the globe leaves it at some azimuth other than 0
 * (`sceneLocation.ts`'s `focusRotationY` doc comment has the full "moves but doesn't go all the
 * way" story). This hook already runs inside the `<Canvas>` (as `GlobeRotatingGroup`'s child),
 * so `useThree()` here reads the *same* camera object `GlobeCameraControls` drives — not a copy,
 * not a value threaded down through `Globe.tsx`'s own props, which would be a second source of
 * truth for something already owned by three.js's own scene graph. Read once, at the instant a
 * new focus target is set (not every frame) — sampling continuously would restart the ease on
 * every tick of a viewer's own drag while a scene's location is already the target, fighting the
 * very input this feature must not fight.
 *
 * **Drift stays suppressed for as long as a scene location is the target, not just while the
 * ease runs.** An ease alone only guarantees a perfect landing at one instant; the scene stays
 * on screen for its own dwell afterward, and this hook has no way to know how long that will be.
 * Tying suppression to "is `focusLon` currently non-null" — the same signal that starts the ease
 * — rather than a fixed extra delay means the globe stays exactly on the scene's place for
 * exactly as long as that place is what's being shown, with no separate timer to invent, tune
 * against a dwell length that varies per scene, or let drift out of sync with. Ambient drift
 * resumes, from wherever the ease landed, the moment the dominant scene has no location (or the
 * orb expands, which already clears `focusLon` at the call site) — never mid-scene.
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
  /** The current scene's location longitude, or `null` for none — only ever passed while the
   *  orb is minimised (`Globe.tsx`'s own gate: expanded, the viewer steers). The `rotation.y`
   *  that actually centres it depends on the camera's own azimuth at the moment the ease
   *  starts, which this hook reads itself (see this file's own doc comment) — `sceneLocation.ts`
   *  stays pure and never reaches for it. */
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
