/**
 * Focus + context distortion for the main scrub track: while the pointer is over it, the track
 * stretches around the pointer so nearby events, pips and ticks spread apart, and the rest of
 * the track compresses uniformly toward both ends. Anything outside the lens keeps its place
 * as the lens moves — only what passes through the lens moves.
 *
 * The distortion is a density over the undistorted track's own 0..1 space, `1 + gain·bump(s)`,
 * where `bump` is a raised cosine of half-width `FISHEYE_HALF_WIDTH_PX` centred on the lens
 * focus. A displayed position is that density's normalised integral: strictly increasing, so
 * the distorted scale always inverts, and closed-form, so only `fromUnit` needs bisection.
 *
 * A lens glued to the pointer would make pointing *less* precise than no lens at all (content
 * under a moving lens slides past the pointer at the magnification rate), so the lens centre
 * lags the pointer near the focus and only tracks it 1:1 once the pointer has moved a deliberate
 * distance away (`moveFisheyeLens`). Earlier this was a dead zone (the lens holds still, then
 * eases to catch up *over time* once the pointer clears it) — re-centring on a timer, rather
 * than on the pointer's own motion, could move the lens (and so the time under a now-*stationary*
 * pointer) well after the gesture that triggered it, reading as a sudden unprompted jump. The
 * lens now moves only in direct response to pointer movement — a still pointer leaves it exactly
 * where it is, no matter how much time passes — via a coupling that rises smoothly from 0 at the
 * centre to 1 at `FISHEYE_COUPLING_RADIUS_PX`, so small movements near the focus barely move the
 * lens (precise aiming) and a deliberate move far enough away drags it along 1:1 (moving to a new
 * area), with no discontinuity in between.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/** Half-width of the stretched region, in undistorted track pixels. */
export const FISHEYE_HALF_WIDTH_PX = 60

/** Extra density at the lens centre; the peak magnification is `(1 + gain) / normaliser`,
 *  about 5x on a typical 1440px-wide track. */
export const FISHEYE_GAIN = 5

/** Radius (displayed px) over which the lens centre's coupling to the pointer ramps from 0 (at
 *  the centre) to 1 (fully tracking): see `couplingFactor`. */
export const FISHEYE_COUPLING_RADIUS_PX = 48

const STRENGTH_TIME_CONSTANT_S = 0.12
const SETTLE_STRENGTH = 0.002
const BISECTION_ITERATIONS = 48

/** Coupling-integration step size (displayed px) — small enough that the result of a move does
 *  not depend on how many pointer events it arrived as (see `advanceLensCentre`). */
const MAX_SUBSTEP_PX = 1

export interface FisheyeScale extends TimeScale {
  /** Local stretch at `t`: displayed px per undistorted px (exactly 1 with no lens). */
  magnificationAt(t: GeoTime): number
}

/** `centreU` is in *displayed* track units — the point that stays under the pointer.
 *  `strength` is 0 (no distortion) to 1 (full lens). */
export interface FisheyeLens {
  centreU: number
  strength: number
}

export interface FisheyeMotion {
  lens: FisheyeLens
}

export const RESTING_FISHEYE: FisheyeMotion = { lens: { centreU: 0.5, strength: 0 } }

interface Bump {
  focus: number
  halfWidth: number
  gain: number
}

function bumpDensity(bump: Bump, s: number): number {
  const x = s - bump.focus
  if (Math.abs(x) >= bump.halfWidth) return 0
  return (1 + Math.cos((Math.PI * x) / bump.halfWidth)) / 2
}

/** `∫ bumpDensity` from -∞ to `s`. */
function bumpIntegral(bump: Bump, s: number): number {
  const x = s - bump.focus
  if (x <= -bump.halfWidth) return 0
  if (x >= bump.halfWidth) return bump.halfWidth
  return (x + bump.halfWidth + (bump.halfWidth / Math.PI) * Math.sin((Math.PI * x) / bump.halfWidth)) / 2
}

function primitive(bump: Bump, s: number): number {
  return s + bump.gain * bumpIntegral(bump, s)
}

function normaliser(bump: Bump): number {
  return primitive(bump, 1) - primitive(bump, 0)
}

function distort(bump: Bump, s: number): number {
  return (primitive(bump, s) - primitive(bump, 0)) / normaliser(bump)
}

function distortSlope(bump: Bump, s: number): number {
  return (1 + bump.gain * bumpDensity(bump, s)) / normaliser(bump)
}

/** Bisection over a strictly increasing `f` on [0, 1]. */
function invertIncreasing(f: (x: number) => number, target: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** The undistorted focus whose own displayed position is `centreU`. `f -> distort(bump_f, f)`
 *  is strictly increasing in `f` (its derivative's numerator is `N + gain·bump_f(0)·(N - P)`
 *  with normaliser `N` exceeding the partial integral `P`), so bisection always converges. */
function focusForCentre(centreU: number, halfWidth: number, gain: number): number {
  return invertIncreasing((focus) => distort({ focus, halfWidth, gain }, focus), clampUnit(centreU))
}

/**
 * `base` distorted by `lens` over a track `trackWidthPx` wide. With no lens (strength 0, or no
 * measured width) this is `base` itself with a flat magnification of 1.
 */
export function fisheyeScale(base: TimeScale, lens: FisheyeLens, trackWidthPx: number): FisheyeScale {
  const strength = clampUnit(lens.strength)
  if (strength === 0 || !(trackWidthPx > 0)) {
    return { kind: base.kind, domain: base.domain, toUnit: base.toUnit, fromUnit: base.fromUnit, magnificationAt: () => 1 }
  }
  const halfWidth = FISHEYE_HALF_WIDTH_PX / trackWidthPx
  const gain = FISHEYE_GAIN * strength
  const bump: Bump = { focus: focusForCentre(lens.centreU, halfWidth, gain), halfWidth, gain }

  return {
    kind: base.kind,
    domain: base.domain,
    toUnit: (t: GeoTime): number => distort(bump, base.toUnit(t)),
    fromUnit: (u: number): GeoTime => base.fromUnit(invertIncreasing((s) => distort(bump, s), clampUnit(u))),
    magnificationAt: (t: GeoTime): number => distortSlope(bump, base.toUnit(t)),
  }
}

function approach(value: number, target: number, dtSeconds: number, timeConstantSeconds: number): number {
  return target + (value - target) * Math.exp(-dtSeconds / timeConstantSeconds)
}

function approachStrength(value: number, target: number, dtSeconds: number): number {
  const next = approach(value, target, dtSeconds, STRENGTH_TIME_CONSTANT_S)
  return Math.abs(next - target) < SETTLE_STRENGTH ? target : next
}

/**
 * Advances `strength` by `dtSeconds` toward 1 (pointer present) or 0 (pointer gone) — the *only*
 * time-driven part of the lens. Pass `dtSeconds = Infinity` to jump straight to the target
 * (reduced motion). Never touches `centreU`: fading in/out never moves the lens, it only changes
 * how strongly the track is distorted around wherever the centre already is.
 */
export function stepFisheyeStrength(motion: FisheyeMotion, pointerPresent: boolean, dtSeconds: number): FisheyeMotion {
  const { centreU, strength } = motion.lens
  return { lens: { centreU, strength: approachStrength(strength, pointerPresent ? 1 : 0, dtSeconds) } }
}

/** Coupling between pointer movement and lens movement at `offsetPx` from the lens centre: 0 at
 *  the centre (the lens holds still — small, precise movements never perturb the magnified
 *  content), rising smoothly (smoothstep) to 1 at `FISHEYE_COUPLING_RADIUS_PX` (the lens tracks
 *  the pointer exactly — a deliberate move into a new area drags the lens straight along with
 *  it). Continuous and C¹ at both ends, so there is no kink in how fast the lens picks up. */
function couplingFactor(offsetPx: number): number {
  const x = clampUnit(offsetPx / FISHEYE_COUPLING_RADIUS_PX)
  return x * x * (3 - 2 * x)
}

/** Moves `centreU` for a pointer move from `fromU` to `toU` (displayed track units, on a
 *  `trackWidthPx`-wide track), integrating the coupling in `MAX_SUBSTEP_PX`-sized steps: at each
 *  substep the coupling is re-evaluated at the *current* offset before moving the centre by that
 *  fraction of the substep, so a move that crosses from inside the coupling radius to outside it
 *  smoothly speeds up rather than committing to one coupling factor for the whole move. Small
 *  enough substeps that splitting one long move into many shorter calls (a slow drag sampled
 *  every pointer event vs. the same drag sampled less often) lands the centre in the same place
 *  either way. Finishes by clamping the result to `FISHEYE_COUPLING_RADIUS_PX` of `toU`, in case
 *  a single move is itself larger than the radius. */
function advanceLensCentre(centreU: number, fromU: number, toU: number, trackWidthPx: number): number {
  const deltaU = toU - fromU
  if (deltaU === 0) return centreU
  const deltaPx = Math.abs(deltaU) * trackWidthPx
  const steps = Math.max(1, Math.ceil(deltaPx / MAX_SUBSTEP_PX))
  const stepU = deltaU / steps
  let pointer = fromU
  let centre = centreU
  for (let i = 0; i < steps; i++) {
    pointer += stepU
    const offsetPx = Math.abs(pointer - centre) * trackWidthPx
    centre += couplingFactor(offsetPx) * stepU
  }
  const offsetPx = Math.abs(toU - centre) * trackWidthPx
  if (offsetPx > FISHEYE_COUPLING_RADIUS_PX) {
    const radiusU = FISHEYE_COUPLING_RADIUS_PX / trackWidthPx
    centre = toU - Math.sign(toU - centre) * radiusU
  }
  return clampUnit(centre)
}

/**
 * Moves the lens in response to the pointer moving from `fromPointerU` to `toPointerU`
 * (displayed track units) — the *only* way `centreU` changes; nothing here depends on how much
 * time has passed. `fromPointerU` is `null` when there is no previous position to move from — the
 * pointer has just arrived, either because the lens had fully faded out since it was last seen,
 * or because it left and came straight back while still visible (a quick leave/re-enter of the
 * track; `strength` hasn't had time to fade).
 *
 * Only the fully-faded case reappears the lens directly under the pointer: with `strength` at or
 * below `SETTLE_STRENGTH` there is nothing on screen to jump, so snapping is unobservable and
 * exactly what "reappearing" should mean. While the lens is still visible, snapping there would
 * be a real, sudden jump, so re-entry is instead treated as an ordinary coupled move — as if the
 * pointer had last been exactly at the lens centre (zero offset, so barely coupled) and swept
 * from there to `toPointerU`, landing within `advanceLensCentre`'s usual coupling-radius clamp of
 * it. Same continuous, radius-bounded motion as any other move; the only special case is which
 * position stands in for the pointer's unknown last whereabouts.
 */
export function moveFisheyeLens(
  motion: FisheyeMotion,
  fromPointerU: number | null,
  toPointerU: number,
  trackWidthPx: number,
): FisheyeMotion {
  const toU = clampUnit(toPointerU)
  const { centreU, strength } = motion.lens
  if (!(trackWidthPx > 0)) {
    return { lens: { centreU: toU, strength } }
  }
  if (fromPointerU === null && strength <= SETTLE_STRENGTH) {
    return { lens: { centreU: toU, strength } }
  }
  const fromU = fromPointerU === null ? centreU : clampUnit(fromPointerU)
  return { lens: { centreU: advanceLensCentre(centreU, fromU, toU, trackWidthPx), strength } }
}

/** Whether another `stepFisheyeStrength` call would change nothing — the animation loop can
 *  stop. (`moveFisheyeLens` never needs a loop: it runs once per pointer event, not per frame.) */
export function isFisheyeSettled(motion: FisheyeMotion, pointerPresent: boolean): boolean {
  return motion.lens.strength === (pointerPresent ? 1 : 0)
}
