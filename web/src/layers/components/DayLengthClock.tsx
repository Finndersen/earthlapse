'use client'

/**
 * A small clock face whose hand sweeps to reflect the sampled day length, plus the numeric
 * reading (e.g. "21.9 h"). This is a rendering of `layer.sample(t)` only — the hand position
 * illustrates *how long* a day was at `t` against a fixed 24-hour reference sweep; it is not
 * a live wall clock.
 */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatValue } from '../format'
import styles from './hud.module.css'

const SIZE = 44
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 2
const HAND_LENGTH = RADIUS - 5
const TICK_LENGTH = 3
const REFERENCE_DAY_HOURS = 24
/** Quarter-day marks (0, 6, 12, 18 h) — enough to read the sweep without cluttering a face
 *  this small. */
const TICK_ANGLES = [0, 90, 180, 270]

export interface DayLengthClockProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

function polar(radius: number, angleDegrees: number): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

export function DayLengthClock({ layer, t }: DayLengthClockProps) {
  const value = layer.sample(t)

  if (value === null) {
    return (
      <span className={styles.readout}>
        <span className={styles.label}>{layer.name}</span> <span className={styles.noData} aria-live="polite">no data</span>
      </span>
    )
  }

  const hours = value.value
  const fractionOfReferenceDay = Math.min(Math.max(hours / REFERENCE_DAY_HOURS, 0), 1)
  const hand = polar(HAND_LENGTH, fractionOfReferenceDay * 360)

  return (
    <span className={styles.clock}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Day length: ${formatValue(hours)} ${value.unit}`}
      >
        <circle className={styles.clockRing} cx={CENTER} cy={CENTER} r={RADIUS} />
        {TICK_ANGLES.map((angle) => {
          const outer = polar(RADIUS, angle)
          const inner = polar(RADIUS - TICK_LENGTH, angle)
          return <line key={angle} className={styles.clockTick} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
        })}
        <line className={styles.clockHand} x1={CENTER} y1={CENTER} x2={hand.x} y2={hand.y} />
        <circle className={styles.clockPivot} cx={CENTER} cy={CENTER} r={1.75} />
      </svg>
      <span className={styles.readout}>
        <span className={styles.label}>{layer.name}</span>{' '}
        <span className={styles.value} aria-live="polite">
          {formatValue(hours)} <span className={styles.unit}>{value.unit}</span>
        </span>
      </span>
    </span>
  )
}
