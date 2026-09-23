'use client'

/**
 * A small inline SVG trend line for a scalar layer: the story so far, from the layer's own start
 * up to `t`. Both axes grow with `t`: x spans linear time from the layer's oldest sample to `t`
 * (never less than `MIN_SPAN_FRACTION` of the domain, so the first moments don't stretch a
 * handful of years across the whole width), and y spans linearly from zero to the largest value
 * reached so far. The playhead is therefore always the trace's right end, and the curve's shape
 * shows how steeply the value has risen relative to its own history.
 *
 * Nothing draws before the domain starts. Where the layer has no record (a declared gap, ADR-027)
 * the line breaks rather than bridging. Past the domain's newest sample the last value is held,
 * the same "data simply ends, hold" reading `ScalarReadout` gives.
 */

import { memo } from 'react'

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { HUD_READOUT_THROTTLE_MS, useThrottledValue } from '@/lib/useThrottledValue'
import styles from './hud.module.css'

const VIEW_WIDTH = 200
const VIEW_HEIGHT = 36
const PAD = 3
/** One sample per viewBox unit of trace: the finest detail the sparkline can show. */
const SAMPLE_COUNT = VIEW_WIDTH - 2 * PAD
const MIN_SPAN_FRACTION = 0.025

export interface SparklineProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

interface Point {
  t: GeoTime
  value: number
}

/** The `[oldest, newest]` time window the x-axis spans at `t`, or `null` before the domain. */
export function sparklineWindow(timeDomain: readonly [GeoTime, GeoTime], t: GeoTime): [GeoTime, GeoTime] | null {
  const [newest, oldest] = timeDomain
  if (t > oldest) return null
  const minSpan = (oldest - newest) * MIN_SPAN_FRACTION
  return [oldest, Math.min(t, oldest - minSpan)]
}

/** Throttles `t` (see `useThrottledValue`'s own doc comment) before handing off to the memoised
 *  body below, so playback's per-frame `t` writes only re-run the resample a few times a second,
 *  not every frame. */
export function Sparkline({ layer, t }: SparklineProps) {
  const throttledT = useThrottledValue(t, HUD_READOUT_THROTTLE_MS)
  return <SparklineBody layer={layer} t={throttledT} />
}

const SparklineBody = memo(function SparklineBody({ layer, t }: SparklineProps) {
  const axis = sparklineWindow(layer.timeDomain, t)
  const [from, to] = axis ?? [1, 0]
  const newestSampled = layer.timeDomain[0]
  const sampleHeld = (at: GeoTime) => layer.sample(Math.max(at, newestSampled))

  const segments: Point[][] = []
  let current: Point[] = []
  let max = 0
  let min = 0
  if (axis !== null) {
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      // Clamped to `t` so the trace never runs past the playhead while the window is held at its
      // minimum span.
      const sampleT = Math.max(from + (i / SAMPLE_COUNT) * (to - from), t)
      const v = sampleHeld(sampleT)
      if (v === null) {
        if (current.length > 1) segments.push(current)
        current = []
      } else {
        current.push({ t: sampleT, value: v.value })
        max = Math.max(max, v.value)
        min = Math.min(min, v.value)
      }
      if (sampleT === t) break
    }
  }
  if (current.length > 1) segments.push(current)

  const span = max - min || 1
  const x = (at: GeoTime): number => PAD + ((from - at) / (from - to)) * (VIEW_WIDTH - 2 * PAD)
  const y = (value: number): number => VIEW_HEIGHT - PAD - ((value - min) / span) * (VIEW_HEIGHT - 2 * PAD)

  const playheadValue = axis === null ? null : sampleHeld(t)

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`${layer.name} sparkline`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {segments.map((seg) => seg.map((p) => `${x(p.t)},${y(p.value)}`).join(' ')).map((points, i) => (
        <g key={i}>
          <polyline className={styles.sparkHalo} points={points} />
          <polyline className={styles.sparkLine} points={points} />
        </g>
      ))}
      {playheadValue !== null && <circle className={styles.sparkDot} cx={x(t)} cy={y(playheadValue.value)} r={2.25} />}
    </svg>
  )
})
