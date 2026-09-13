'use client'

/**
 * A small clock face whose hand sweeps to reflect the sampled day length, plus the numeric
 * reading (e.g. "21.9 h"). This is a rendering of `layer.sample(t)` only — the hand position
 * illustrates *how long* a day was at `t` against a fixed 24-hour reference sweep; it is not
 * a live wall clock.
 */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatValue } from '../format'

const SIZE = 64
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 4
const HAND_LENGTH = RADIUS - 6
const REFERENCE_DAY_HOURS = 24

export interface DayLengthClockProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

export function DayLengthClock({ layer, t }: DayLengthClockProps) {
  const value = layer.sample(t)

  if (value === null) {
    return <span>no data</span>
  }

  const hours = value.value
  const fractionOfReferenceDay = Math.min(Math.max(hours / REFERENCE_DAY_HOURS, 0), 1)
  const angleDegrees = fractionOfReferenceDay * 360 - 90
  const angleRadians = (angleDegrees * Math.PI) / 180
  const handX = CENTER + HAND_LENGTH * Math.cos(angleRadians)
  const handY = CENTER + HAND_LENGTH * Math.sin(angleRadians)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Day length: ${formatValue(hours)} ${value.unit}`}
      >
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.4} />
        <line x1={CENTER} y1={CENTER} x2={handX} y2={handY} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <circle cx={CENTER} cy={CENTER} r={1.5} fill="currentColor" />
      </svg>
      <span>
        {formatValue(hours)} {value.unit}
      </span>
    </span>
  )
}
