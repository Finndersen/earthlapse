/**
 * The one shared symlog-space ramp helper `stemGains.ts` and `score.ts` are both built from
 * (ADR-023 §1: "every ramp is written once as a small table... the shared helper consumes").
 * No import of `tone` anywhere in this module or its callers — see `web/src/audio/index.ts`'s
 * doc comment on why the pure math stays Tone-free.
 */

import type { GeoTime } from '@/types/layer'

/** A closed `[tMin, tMax]` interval in `GeoTime` — a flood-basalt effect window
 *  (`stemGains`'s `flatBasaltWindows`) or a catastrophe-tagged event's own dating interval
 *  (`score`'s `catastropheWindows`). `tMin <= tMax` always. */
export interface TimeWindow {
  tMin: GeoTime
  tMax: GeoTime
}

/**
 * Interpolates `from` -> `to` across `[tHigh, tLow]` in `log1p(t)` (symlog) space. `tHigh` is
 * numerically larger (further into the past); the ramp runs as `t` counts DOWN through the
 * interval, matching how the timeline itself reads left-to-right (deep past -> present). A
 * half-cosine ease, not linear-in-log-space, so the fade itself has no audible corner.
 *
 * Clamps outside the interval: `from` for `t >= tHigh`, `to` for `t <= tLow`. `tHigh === tLow`
 * degenerates to a step at that instant (every `t` is caught by one of the two clamp branches
 * before the division below ever runs) rather than a division by zero.
 */
export function rampLog(t: GeoTime, tHigh: GeoTime, tLow: GeoTime, from: number, to: number): number {
  if (tHigh < tLow) {
    throw new Error(`rampLog: tHigh (${tHigh}) must be >= tLow (${tLow})`)
  }
  if (t >= tHigh) return from
  if (t <= tLow) return to
  const u = (Math.log1p(t) - Math.log1p(tLow)) / (Math.log1p(tHigh) - Math.log1p(tLow))
  const eased = 0.5 - 0.5 * Math.cos(u * Math.PI)
  return to + (from - to) * eased
}

/**
 * A symmetric rise-and-fall around `window`, peaking at 1 at its midpoint and returning to 0
 * at both `window.tMax` (arriving from the past) and `window.tMin` (departing toward the
 * present) — a smooth bump, never a hard gate, built from two `rampLog` halves. Shared between
 * `stemGains.ts`'s `volcanic` flood-basalt pulses and `score.ts`'s catastrophe-proximity
 * dissonance (ADR-023 §1/§2), rather than reimplemented in each.
 */
export function bump(t: GeoTime, window: TimeWindow): number {
  if (window.tMin > window.tMax) {
    throw new Error(`bump: window.tMin (${window.tMin}) must be <= window.tMax (${window.tMax})`)
  }
  const mid = (window.tMin + window.tMax) / 2
  return t >= mid ? rampLog(t, window.tMax, mid, 0, 1) : rampLog(t, mid, window.tMin, 1, 0)
}

/** Clamps `x` into `[0, 1]` — every stem gain and score `dissonance` value's final step, so a
 *  sum of several ramps/bumps can never leave the range a gain or mix parameter must stay in. */
export function clampUnit(x: number): number {
  return Math.min(1, Math.max(0, x))
}
