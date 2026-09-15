'use client'

/**
 * A small inline SVG trend line for a scalar layer, sampled across the full span of `scale`
 * in warped x, with a playhead marker. Where the layer has no data (outside its domain) the
 * line simply stops — the absent region is empty, never drawn as a false zero.
 */

import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { clampUnit } from '../format'
import styles from './hud.module.css'

const SAMPLE_COUNT = 96
const VIEW_WIDTH = 200
const VIEW_HEIGHT = 36
const PAD = 3
/** A series whose max/min reaches this ratio is plotted on a log axis. On a linear axis CO₂'s
 *  ~7,000 ppm Cambrian peak squashes the 277 -> 427 ppm industrial rise into under a pixel. */
const LOG_AXIS_MIN_RATIO = 10

function axisTransform(values: number[]): (value: number) => number {
  if (values.length === 0) return (value) => value
  const min = Math.min(...values)
  const max = Math.max(...values)
  return min > 0 && max / min >= LOG_AXIS_MIN_RATIO ? Math.log : (value) => value
}

export interface SparklineProps {
  layer: Layer<ScalarValue>
  t: GeoTime
  scale: TimeScale
}

interface Point {
  u: number
  value: number
}

export function Sparkline({ layer, t, scale }: SparklineProps) {
  const samples: Array<Point | null> = []
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT
    const v = layer.sample(scale.fromUnit(u))
    samples.push(v === null ? null : { u, value: v.value })
  }

  const values = samples.flatMap((p) => (p === null ? [] : [p.value]))
  const toAxis = axisTransform(values)
  const axisValues = values.map(toAxis)
  const min = axisValues.length > 0 ? Math.min(...axisValues) : 0
  const max = axisValues.length > 0 ? Math.max(...axisValues) : 1
  const span = max - min || 1

  const x = (u: number): number => PAD + u * (VIEW_WIDTH - 2 * PAD)
  const y = (value: number): number => VIEW_HEIGHT - PAD - ((toAxis(value) - min) / span) * (VIEW_HEIGHT - 2 * PAD)

  const segments: Point[][] = []
  let current: Point[] = []
  for (const p of samples) {
    if (p === null) {
      if (current.length > 1) segments.push(current)
      current = []
    } else {
      current.push(p)
    }
  }
  if (current.length > 1) segments.push(current)

  const playheadU = clampUnit(scale.toUnit(t))
  const playheadValue = layer.sample(t)

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`${layer.name} sparkline`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {segments.map((seg, i) => (
        <polyline key={i} className={styles.sparkLine} points={seg.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')} />
      ))}
      <line className={styles.sparkPlayhead} x1={x(playheadU)} x2={x(playheadU)} y1={0} y2={VIEW_HEIGHT} />
      {playheadValue !== null && (
        <circle className={styles.sparkDot} cx={x(playheadU)} cy={y(playheadValue.value)} r={2.25} />
      )}
    </svg>
  )
}
