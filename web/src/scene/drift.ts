/**
 * Camera drift (DESIGN §5 v1 note — "subtle life without depth maps"). A slow zoom + tiny
 * lateral pan, standing in for the eventual depth-driven parallax breathing. Pure in `t`: each
 * scene's drift is derived only from its own position within its own "hold span" (the stretch
 * of `t` between the dissolve midpoints with its neighbours — see `sceneAt`), so it animates
 * continuously through a dissolve rather than resetting at it, and is identical on every render
 * at the same `t` regardless of scrub direction.
 *
 * Deliberately not the DESIGN §5 parallax: no depth map, no displacement, just a 2D
 * scale/translate kept inside the crop margin the zoom itself creates, so it can never reveal
 * an image edge.
 */

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

export interface DriftUniforms {
  /** Scale applied before cropping to the viewport. Always in `[1, ZOOM_END]`. */
  zoom: number
  /** Lateral offset as a fraction of frame. `hypot(dx, dy) <= (zoom - 1) / 2` always — the
   *  exact extra crop margin the current zoom affords, so translating can never reveal an
   *  edge the zoom hasn't already cropped past. */
  dx: number
  dy: number
}

/** No motion at all — used under `prefers-reduced-motion`. */
export const REST_DRIFT: DriftUniforms = { zoom: 1, dx: 0, dy: 0 }

const ZOOM_END = 1.05
/** Fraction of the zoom's crop margin actually spent on lateral drift, leaving headroom so
 *  the bound above is never approached exactly (floating-point safety, not a visible cue). */
const LATERAL_FRACTION = 0.6

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function smoothstep01(x: number): number {
  const u = clamp01(x)
  return u * u * (3 - 2 * u)
}

/** Deterministic 0..1 hash of a scene id — gives each scene a fixed, arbitrary drift
 *  direction with no actual randomness, so it is identical on every render. */
function hashUnit(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  }
  return ((h >>> 0) % 10000) / 10000
}

/** `t` at the log1p-space midpoint between `a` and `b` — the same point `sceneAt` centres its
 *  dissolve window on. */
function logMidpointT(a: GeoTime, b: GeoTime): GeoTime {
  return Math.expm1((Math.log1p(a) + Math.log1p(b)) / 2)
}

/**
 * The span of `t` over which `scenes[index]` is nominally on screen: from the dissolve midpoint
 * with its newer neighbour to the dissolve midpoint with its older neighbour (the scene's own
 * `t` for the first/last scene). Deliberately wider than any single dissolve — the scene's
 * whole visible lifetime, hold plus the two dissolves bracketing it — which is what keeps drift
 * moving smoothly through a dissolve instead of restarting at it.
 */
function holdSpan(scenes: readonly Scene[], index: number): [GeoTime, GeoTime] {
  const scene = scenes[index]!
  const start = index > 0 ? logMidpointT(scenes[index - 1]!.t, scene.t) : scene.t
  const end = index < scenes.length - 1 ? logMidpointT(scene.t, scenes[index + 1]!.t) : scene.t
  return [start, end]
}

/**
 * Drift uniforms for `scenes[index]` at `t`. Playback moves `t` toward the present (DESIGN §3 /
 * `advancePlayhead`), from a scene's `end` toward its `start`, so progress — and with it the
 * zoom — reads as a push-in across the time the scene is being watched, widest as it fades in
 * and closest as the next dissolve completes. `t` outside `[start, end]` clamps to the nearer
 * edge rather than extrapolating.
 */
export function driftAt(scenes: readonly Scene[], index: number, t: GeoTime): DriftUniforms {
  const scene = scenes[index]!
  const [start, end] = holdSpan(scenes, index)
  const progress = end === start ? 0 : smoothstep01((end - t) / (end - start))

  const zoom = 1 + (ZOOM_END - 1) * progress
  const margin = ((zoom - 1) / 2) * LATERAL_FRACTION
  // Zero margin (zoom exactly 1, e.g. REST_DRIFT-equivalent poses) must produce exact +0, not
  // the -0 that `Math.cos(angle) * 0` yields for an angle in the second/third quadrant —
  // `-0 !== 0` under `Object.is`, which `toEqual` uses, so a scene at rest would otherwise
  // fail to compare equal to `REST_DRIFT`.
  if (margin === 0) return { zoom, dx: 0, dy: 0 }
  const angle = hashUnit(scene.id) * Math.PI * 2
  return { zoom, dx: Math.cos(angle) * margin, dy: Math.sin(angle) * margin }
}
