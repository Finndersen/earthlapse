/**
 * The scene-location marker's pure core (ADR-034): where the small orb should turn to put a
 * scene's place in view, how that turn eases, and the shape of the brief pulse the marker plays
 * as the scene comes in. No three.js, no React.
 *
 * One rotation owner, never a second: `Globe.tsx`'s `GlobeRotatingGroup` is the only place the
 * sphere's `rotation.y` is written (see `useGlobeAutoRotation.ts` for the read-after-write hazard
 * that rule prevents). Centring a scene's location is a target handed to that same accumulator,
 * which eases to it then resumes ordinary drift from where it landed. This module is the
 * arithmetic for that, kept out of the hook so it tests without a canvas.
 *
 * Applies to the minimised orb only. Expanded (sphere or map) the viewer steers the camera, so
 * the marker and pulse are drawn in place and the camera left alone — enforced by the caller
 * (`Globe.tsx` passes no focus target when expanded), not by a branch in here.
 *
 * The same accumulator's drift speed is gated here too (`stepDriftGate`): in the expanded view the
 * drift stops while the viewer is using the globe and eases back in once they leave it alone.
 */

import type { SceneCoordinates } from '@/types/manifest'

const DEG2RAD = Math.PI / 180

/** Long enough to read as the globe deliberately turning to look at something, short enough that
 *  it has settled well before a scene's own dwell is over. */
export const FOCUS_EASE_SECONDS = 1.2

/** Wraps `angle` (radians) into `[-π, π)`. Keeping the accumulator normalised at all times stops
 *  a long session leaving the sphere many whole turns from zero, and makes interpolation toward a
 *  focus target automatically take the shorter way round. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

/**
 * The `rotation.y` that brings `lon` to face the camera, given the camera's own current
 * azimuth about `+Y` (`cameraAzimuthY`, radians, measured the same way — angle from `+Z` toward
 * `+X`). `lonLatToSphere` puts longitude `L` at angle `L` about `+Y` from `+Z`, and a
 * `rotation.y` of `θ` carries a point at `L` to `L + θ`; that point faces the camera exactly
 * when it lines up with the camera's own azimuth, i.e. `L + θ = cameraAzimuthY`, so
 * `θ = cameraAzimuthY - L` is what lands it dead centre.
 *
 * The camera azimuth must be an argument, not assumed to be 0: `OrbitControls` (`Globe.tsx`'s
 * `GlobeCameraControls`) rotates the camera about this same `+Y` axis in both the orb and the
 * expanded sphere, so once a viewer has dragged the globe, assuming 0 lands the ease exactly that
 * far short of centred. The caller (`useGlobeAutoRotation.ts`, via `useThree()`) reads it from
 * three.js's scene graph when a focus target is set and passes it in, keeping this module pure.
 *
 * Latitude is deliberately ignored: the globe's only rotation axis is `Y`, and tilting to chase a
 * latitude would add the second rotation source this feature must not introduce.
 */
export function focusRotationY(lon: number, cameraAzimuthY: number): number {
  return wrapAngle(cameraAzimuthY - lon * DEG2RAD)
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
 * The sphere's rotation accumulator. `rotationY` is always wrapped into `[-π, π)` so it never runs
 * away over a long session; an ease in progress carries its own *unwrapped* `from`/`to` pair so it
 * interpolates monotonically instead of snapping back when the wrapped value crosses ±π.
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
 * drift for its duration — two sources adding into the same angle would make the ease overshoot.
 * Drift then resumes from exactly where the ease landed, so the handover never snaps.
 * `driftRadiansPerSecond` of 0 covers reduced motion and map mode, where the angle is held.
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

/** How long the expanded globe stays still after the viewer's last interaction, with nothing open
 *  and the view at its default zoom, before the drift resumes: long enough to read a tooltip or
 *  study a region without it sliding away, short enough that an abandoned view comes back to life. */
export const DRIFT_RESUME_IDLE_SECONDS = 45
/** How long a resuming drift takes to reach full speed, so it eases in rather than lurching. */
export const DRIFT_EASE_IN_SECONDS = 4

/** The drift's speed as a fraction of full (`speed`), and how long the view has been left alone
 *  (`idleSeconds`). */
export interface DriftGate {
  speed: number
  idleSeconds: number
}

export const DRIFT_RUNNING: DriftGate = { speed: 1, idleSeconds: Infinity }

export interface DriftInputs {
  expanded: boolean
  /** The viewer dragged, pinched, scrolled, pressed a zoom button or tapped since the last step. */
  interacted: boolean
  /** A tooltip or detail card is open, or the view is zoomed in past its default framing. */
  held: boolean
}

/**
 * Advances the expanded view's drift gate by one frame. Any interaction stops the drift at once
 * and restarts the idle clock; while `held`, the clock stays at zero. Once the view has been idle
 * for `DRIFT_RESUME_IDLE_SECONDS` the speed ramps back up over `DRIFT_EASE_IN_SECONDS` — a speed
 * ramp, so the angle itself never jumps. The collapsed orb always drifts (ramping up the same way).
 */
export function stepDriftGate(gate: DriftGate, dtSeconds: number, inputs: DriftInputs): DriftGate {
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0
  if (inputs.expanded && (inputs.interacted || inputs.held)) return { speed: 0, idleSeconds: 0 }
  const idleSeconds = inputs.expanded ? gate.idleSeconds + dt : Infinity
  if (idleSeconds < DRIFT_RESUME_IDLE_SECONDS) return { speed: 0, idleSeconds }
  return { speed: Math.min(1, gate.speed + dt / DRIFT_EASE_IN_SECONDS), idleSeconds }
}

/** The location the globe should actually plot for a scene, or `null` for "no marker at all".
 *  ADR-034 is explicit that an absent or `null` `marker` must never fall back to `presentDay`:
 *  a scene older than every plate model has no defensible position, and a modern coastline is a
 *  wrong answer, not an approximation. Centralised here so no caller can reach past it. */
export function sceneMarkerCoordinates(location: { marker: SceneCoordinates | null } | undefined): SceneCoordinates | null {
  return location?.marker ?? null
}
