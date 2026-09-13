'use client'

/**
 * A small inline SVG trend line for a scalar layer, sampled across the full span of `scale`
 * in warped x, with a playhead marker. Where the layer has no data (outside its domain) the
 * line simply stops — the absent region is empty, never drawn as a false zero.
 */

import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { clampUnit } from '../format'

const SAMPLE_COUNT = 96
const VIEW_WIDTH = 200
const VIEW_HEIGHT = 36
const PAD = 3

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
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 1
  const span = max - min || 1

  const x = (u: number): number => PAD + u * (VIEW_WIDTH - 2 * PAD)
  const y = (value: number): number => VIEW_HEIGHT - PAD - ((value - min) / span) * (VIEW_HEIGHT - 2 * PAD)

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
        <polyline
          key={i}
          points={seg.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
        />
      ))}
      <line
        x1={x(playheadU)}
        x2={x(playheadU)}
        y1={0}
        y2={VIEW_HEIGHT}
        stroke="rgba(255,255,255,0.45)"
        strokeWidth={1}
      />
      {playheadValue !== null && <circle cx={x(playheadU)} cy={y(playheadValue.value)} r={1.75} fill="currentColor" />}
    </svg>
  )
}
