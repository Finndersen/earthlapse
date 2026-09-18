'use client'

/**
 * The people/km² colour key under the "Human civilisation" toggle. A density colour carries no
 * meaning on its own, so the one overlay in this layer that uses colour to encode a quantity gets
 * a scale; arrivals and cities do not, and deliberately have no key (the user's own direction).
 *
 * The gradient and the tick positions are generated from `density.ts`'s `DENSITY_RAMP` itself —
 * the same stops the fragment shader interpolates — placed at each stop's own `log10(1 + d)`
 * position, which is exactly the axis the shader interpolates along. So the key cannot claim a
 * colour the globe does not paint, and its spacing is the ramp's real spacing rather than an
 * evenly-spread approximation of it.
 */

import { DENSITY_RAMP } from './density'
import styles from './Globe.module.css'

function position(density: number): number {
  return Math.log10(1 + density)
}

const RAMP_START = position(DENSITY_RAMP[0]!.density)
const RAMP_END = position(DENSITY_RAMP[DENSITY_RAMP.length - 1]!.density)

function unitPosition(density: number): number {
  return (position(density) - RAMP_START) / (RAMP_END - RAMP_START)
}

/** `#rrggbb` + alpha as a plain `rgba()` — written out rather than using CSS relative-colour
 *  syntax, which is too new to rely on across the browsers this page targets. */
function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`
}

/** `linear-gradient` stops straight off the ramp — including each stop's own alpha, so the bar
 *  shows the overlay's real transparency at the low end rather than implying a solid tint the
 *  globe never draws. */
const GRADIENT = `linear-gradient(to right, ${DENSITY_RAMP.map(
  (stop) => `${rgba(stop.hex, stop.alpha)} ${(unitPosition(stop.density) * 100).toFixed(1)}%`,
).join(', ')})`

/** Labelled ticks, one per order of magnitude the ramp actually spans. Not one per ramp stop:
 *  seven labels under a 150px bar is unreadable, and round decades are what a reader can reason
 *  about. */
const TICKS: readonly { density: number; label: string }[] = [
  { density: 1, label: '1' },
  { density: 10, label: '10' },
  { density: 100, label: '100' },
  { density: 1000, label: '1k' },
  { density: 10000, label: '10k' },
]

export function DensityRampKey() {
  return (
    <div className={styles.rampKey} data-testid="density-ramp-key">
      <div className={styles.rampBar} style={{ background: GRADIENT }} aria-hidden="true" />
      <div className={styles.rampTicks} aria-hidden="true">
        {TICKS.map((tick) => (
          <span key={tick.density} className={styles.rampTick} style={{ left: `${unitPosition(tick.density) * 100}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <span className={styles.rampUnit}>people / km²</span>
    </div>
  )
}
