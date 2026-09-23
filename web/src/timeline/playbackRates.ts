/**
 * The detents the playback rate control offers, per mode, and the pure rules for moving between
 * them. `'scenes'` mode's rate is a multiplier on its paced velocity; `'steady'` mode's is a
 * literal rate in years per second (ADR-050).
 */

import type { GeoTime, Playback, PlaybackMode } from '@/types/layer'

import type { TimeWindow } from './scale'

/** `'scenes'` multipliers: powers of two either side of the authored pace. */
export const SCENES_SPEEDS: readonly number[] = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64]

/** Every 1-2-5 step from `min` to `max` inclusive; both must be powers of ten. */
function oneTwoFive(min: number, max: number): number[] {
  const values: number[] = []
  for (let decade = min; decade <= max; decade *= 10) {
    for (const mantissa of [1, 2, 5]) {
      const value = decade * mantissa
      if (value <= max) values.push(value)
    }
  }
  return values
}

/** `'steady'` rates in years per second, 1 yr/s to 1 Gyr/s. */
export const STEADY_RATES: readonly number[] = oneTwoFive(1, 1e9)

export const DEFAULT_SCENES_SPEED = 1

/** How long the context default takes to cross the span it is sized to (`defaultSteadyRate`).
 *  Two minutes crosses a Holocene human-history section at 2–20 yr/s and a Phanerozoic period at
 *  hundreds of kyr/s, slow enough to read the scenes and fast enough not to stall. */
export const STEADY_DEFAULT_CROSSING_SECONDS = 120

export function rateDetents(mode: PlaybackMode): readonly number[] {
  return mode === 'scenes' ? SCENES_SPEEDS : STEADY_RATES
}

/** The index of the detent nearest `value` in log space. Non-positive or non-finite `value`
 *  resolves to the slowest detent. */
export function nearestDetentIndex(detents: readonly number[], value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0
  const target = Math.log(value)
  let best = 0
  for (let i = 1; i < detents.length; i++) {
    if (Math.abs(Math.log(detents[i]!) - target) < Math.abs(Math.log(detents[best]!) - target)) best = i
  }
  return best
}

/**
 * The next detent in `direction` from `current`, clamped at either end with no wrap: wrapping
 * the fast end back to the slowest would be a jarring jump mid-playback. An off-table `current`
 * moves to the nearest detent strictly on `direction`'s side.
 */
export function stepDetent(detents: readonly number[], current: number, direction: 'up' | 'down'): number {
  const exact = detents.indexOf(current)
  if (exact !== -1) {
    const next = direction === 'up' ? Math.min(exact + 1, detents.length - 1) : Math.max(exact - 1, 0)
    return detents[next]!
  }
  const onSide = direction === 'up' ? detents.filter((d) => d > current) : [...detents].reverse().filter((d) => d < current)
  return onSide[0] ?? (direction === 'up' ? detents[detents.length - 1]! : detents[0]!)
}

/**
 * The steady rate a viewer gets on entering steady mode before choosing one: the detent that
 * crosses the span of interest in about `STEADY_DEFAULT_CROSSING_SECONDS`. The span is the
 * selected section's, capped at `t` itself (the distance to the present), so the root section
 * near the present gets a rate sized to the last few centuries rather than to 4.6 Gyr.
 */
export function defaultSteadyRate(window: TimeWindow, t: GeoTime): number {
  const [newest, oldest] = window
  const span = Math.min(oldest - newest, Math.max(0, t))
  return STEADY_RATES[nearestDetentIndex(STEADY_RATES, span / STEADY_DEFAULT_CROSSING_SECONDS)]!
}

/** The rate the control currently shows for `playback.mode`. */
export function activeRate(playback: Playback): number {
  return playback.mode === 'scenes' ? playback.speed : playback.yearsPerSecond
}

/** `playback` with the active mode's rate replaced; the other mode's rate is untouched. */
export function withActiveRate(playback: Playback, rate: number): Playback {
  return playback.mode === 'scenes' ? { ...playback, speed: rate } : { ...playback, yearsPerSecond: rate }
}

/** One `[`/`]` step of the active mode's rate. */
export function stepActiveRate(playback: Playback, direction: 'up' | 'down'): Playback {
  return withActiveRate(playback, stepDetent(rateDetents(playback.mode), activeRate(playback), direction))
}

const MAGNITUDES = [
  { divisor: 1e9, short: 'G', long: 'billion' },
  { divisor: 1e6, short: 'M', long: 'million' },
  { divisor: 1e3, short: 'k', long: 'thousand' },
] as const

function magnitudeOf(value: number): { scaled: number; short: string; long: string } {
  for (const m of MAGNITUDES) {
    if (value >= m.divisor) return { scaled: value / m.divisor, short: m.short, long: m.long }
  }
  return { scaled: value, short: '', long: '' }
}

function fraction(value: number): string {
  return value >= 1 ? String(value) : `1/${Math.round(1 / value)}`
}

/** The compact label a detent row shows: `"500k"` (yr/s) or `"1/16×"`. */
export function detentLabel(mode: PlaybackMode, value: number): string {
  if (mode === 'scenes') return `${fraction(value)}×`
  const { scaled, short } = magnitudeOf(value)
  return `${Number(scaled.toPrecision(3))}${short}`
}

/** The unit caption under the rows. */
export function detentCaption(mode: PlaybackMode): string {
  return mode === 'scenes' ? 'speed' : 'yr/s'
}

/** `aria-valuetext`: `"500 thousand years per second"`, `"1/16 times scene pace"`. */
export function detentValueText(mode: PlaybackMode, value: number): string {
  if (mode === 'scenes') return `${fraction(value)} times scene pace`
  const { scaled, long } = magnitudeOf(value)
  const number = Number(scaled.toPrecision(3))
  if (long === '') return number === 1 ? '1 year per second' : `${number} years per second`
  return `${number} ${long} years per second`
}
