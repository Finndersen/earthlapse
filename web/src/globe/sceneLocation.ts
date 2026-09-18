/**
 * The scene-location marker's pure core (ADR-034): where the small orb should turn to put a
 * scene's place in view, how that turn eases, and the shape of the brief pulse the marker plays
 * as the scene comes in. No three.js, no React.
 *
 * **One rotation owner, extended — never a second one.** `Globe.tsx`'s `GlobeRotatingGroup` is
 * the single place the sphere's `rotation.y` is written (`useGlobeAutoRotation.ts`'s own doc
 * comment has the read-after-write bug that rule exists to prevent). Centring a scene's location
 * is therefore not a new rotation source: it is a target handed to that same accumulator, which
 * eases to it and then resumes its ordinary drift from wherever it landed. Everything in this
 * module is the arithmetic for that, kept out of the hook so it can be tested without a canvas.
 *
 * **The orb only.** Expanded — sphere or map — the viewer is steering the camera themselves, so
 * nothing here is applied: the marker and its pulse are drawn in place and the camera is left
 * alone. That is a caller-side gate (`Globe.tsx` passes no focus target when expanded), not a
 * branch in here.
 */

import type { SceneCoordinates } from '@/types/manifest'

const DEG2RAD = Math.PI / 180

/** Long enough to read as the globe deliberately turning to look at something, short enough that
 *  it has settled well before a scene's own dwell is over. */
export const FOCUS_EASE_SECONDS = 1.2

/** Wraps `angle` (radians) into `[-π, π)`. The accumulator below is kept normalised at all
 *  times, so a long session can never leave the sphere many whole turns from zero — the bug
 *  `useGlobeAutoRotation.ts`'s own doc comment records, and the reason interpolating toward a
 *  focus target is automatically the shorter way round. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

/**
 * The `rotation.y` that brings `lon` to face the camera. `lonLatToSphere` puts longitude `L` at
 * angle `L` about `+Y` from `+Z` (the camera's own direction, `projection.ts`'s doc comment), and
 * a `rotation.y` of `θ` carries a point at `L` to `L + θ`, so `θ = -L` is what lands it dead
 * centre. Latitude is deliberately ignored: the globe's single rotation axis is `Y`, and tilting
 * it to chase a latitude would mean a second rotation source, which this feature must not add.
 */
export function focusRotationY(lon: number): number {
  return wrapAngle(-lon * DEG2RAD)
}

/** The signed shortest way round from `from` to `to`, in `[-π, π)`. Easing along this rather than
 *  the raw difference is what stops a focus target just past the seam spinning the long way. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

function easeInOutCubic(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2
}

/**
 * The sphere's rotation accumulator. `rotationY` is always wrapped into `[-π, π)` so it can never
 * run away over a long session (the bug `useGlobeAutoRotation.ts` documents); an ease in progress
 * carries its own unwrapped `from`/`to` pair so it interpolates monotonically across the seam
 * instead of snapping back when the wrapped value crosses ±π.
 */
export interface GlobeRotationState {
  rotationY: number
  easeFrom: number
  easeTo: number
  easeElapsed: number
  /** 0 when no ease is running. */
  easeDuration: number
}

export const REST_ROTATION: GlobeRotationState = {
  rotationY: 0,
  easeFrom: 0,
  easeTo: 0,
  easeElapsed: 0,
  easeDuration: 0,
}

/**
 * Begins an ease from wherever the sphere currently is to `targetRotationY`, along the shortest
 * way round. `durationSeconds <= 0` (reduced motion) snaps instead — the project rule is snap,
 * never animate, and never a slower animation.
 */
export function startFocusEase(state: GlobeRotationState, targetRotationY: number, durationSeconds: number): GlobeRotationState {
  const to = state.rotationY + shortestAngleDelta(state.rotationY, targetRotationY)
  if (durationSeconds <= 0) {
    return { rotationY: wrapAngle(to), easeFrom: to, easeTo: to, easeElapsed: 0, easeDuration: 0 }
  }
  return { rotationY: state.rotationY, easeFrom: state.rotationY, easeTo: to, easeElapsed: 0, easeDuration: durationSeconds }
}

/**
 * Advances the accumulator by one frame. An ease in progress takes precedence and suppresses
 * drift for its duration — two sources adding into the same angle at once would make the ease
 * overshoot its own target. Once it finishes, drift resumes from exactly where the ease left the
 * sphere, so there is no snap at the handover.
 *
 * `driftRadiansPerSecond` of 0 covers both reduced motion and map mode, where the caller wants
 * the angle held rather than accumulating.
 */
export function stepGlobeRotation(state: GlobeRotationState, dtSeconds: number, driftRadiansPerSecond: number): GlobeRotationState {
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0
  if (state.easeDuration > 0) {
    const easeElapsed = state.easeElapsed + dt
    const progress = easeInOutCubic(easeElapsed / state.easeDuration)
    const rotationY = state.easeFrom + (state.easeTo - state.easeFrom) * progress
    if (easeElapsed >= state.easeDuration) {
      return { rotationY: wrapAngle(state.easeTo), easeFrom: state.easeTo, easeTo: state.easeTo, easeElapsed: 0, easeDuration: 0 }
    }
    return { ...state, rotationY: wrapAngle(rotationY), easeElapsed }
  }
  return { ...state, rotationY: wrapAngle(state.rotationY + dt * driftRadiansPerSecond) }
}

/** The location the globe should actually plot for a scene, or `null` for "no marker at all".
 *  ADR-034 is explicit that an absent or `null` `marker` must never fall back to `presentDay`:
 *  a scene older than every plate model has no defensible position, and a modern coastline is a
 *  wrong answer, not an approximation. Centralised here so no caller can reach past it. */
export function sceneMarkerCoordinates(location: { marker: SceneCoordinates | null } | undefined): SceneCoordinates | null {
  return location?.marker ?? null
}
