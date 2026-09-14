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
 * under a moving lens slides past the pointer at the magnification rate), so the lens holds
 * still while the pointer moves inside a dead zone and only eases after it once the pointer
 * leaves that zone (`stepFisheye`).
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/** Half-width of the stretched region, in undistorted track pixels. */
export const FISHEYE_HALF_WIDTH_PX = 60

/** Extra density at the lens centre; the peak magnification is `(1 + gain) / normaliser`,
 *  about 5x on a typical 1440px-wide track. */
export const FISHEYE_GAIN = 5

/** How far (displayed px) the pointer may move from the lens centre before the lens follows. */
export const FISHEYE_DEADZONE_PX = 48

const FOLLOW_TIME_CONSTANT_S = 0.09
const STRENGTH_TIME_CONSTANT_S = 0.12
const SETTLE_PX = 0.25
const SETTLE_STRENGTH = 0.002
const BISECTION_ITERATIONS = 48

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
  /** True while the lens is easing after a pointer that left the dead zone. */
  following: boolean
}

export const RESTING_FISHEYE: FisheyeMotion = { lens: { centreU: 0.5, strength: 0 }, following: false }

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
 * Advances the lens by `dtSeconds` toward `pointerU` (displayed track units), or fades it out
 * when the pointer is gone (`null`). Pass `dtSeconds = Infinity` to jump straight to the
 * target (reduced motion).
 *
 * - A lens that has faded out reappears directly under the pointer instead of sweeping in
 *   from where it last was.
 * - Inside `FISHEYE_DEADZONE_PX` of the centre the lens holds still, so the magnified content
 *   stays put under a pointer making small, precise movements.
 * - Beyond it the lens eases after the pointer until it has caught up, then holds again.
 */
export function stepFisheye(
  motion: FisheyeMotion,
  pointerU: number | null,
  trackWidthPx: number,
  dtSeconds: number,
): FisheyeMotion {
  const { centreU, strength } = motion.lens
  if (pointerU === null) {
    return { lens: { centreU, strength: approachStrength(strength, 0, dtSeconds) }, following: false }
  }
  const target = clampUnit(pointerU)
  const nextStrength = approachStrength(strength, 1, dtSeconds)
  if (strength <= SETTLE_STRENGTH) {
    return { lens: { centreU: target, strength: nextStrength }, following: false }
  }
  const offsetPx = Math.abs(target - centreU) * trackWidthPx
  const following = motion.following || offsetPx > FISHEYE_DEADZONE_PX
  if (!following) {
    return { lens: { centreU, strength: nextStrength }, following: false }
  }
  const nextCentre = approach(centreU, target, dtSeconds, FOLLOW_TIME_CONSTANT_S)
  const caughtUp = Math.abs(target - nextCentre) * trackWidthPx <= SETTLE_PX
  return {
    lens: { centreU: caughtUp ? target : nextCentre, strength: nextStrength },
    following: !caughtUp,
  }
}

/** Whether another `stepFisheye` call would change nothing — the animation loop can stop. */
export function isFisheyeSettled(motion: FisheyeMotion, pointerU: number | null): boolean {
  if (motion.following) return false
  return motion.lens.strength === (pointerU === null ? 0 : 1)
}
