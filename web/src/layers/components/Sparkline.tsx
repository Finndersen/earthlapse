'use client'

/**
 * A small inline SVG trend line for a scalar layer, with a playhead marker. Where the layer has
 * no data (outside its domain) the line simply stops — the absent region is empty, never drawn
 * as a false zero.
 *
 * The x-axis is warped over `layer.timeDomain` itself, NOT `scale`'s own domain (2026-09-18
 * re-review: population's sparkline was rendering as barely more than a single dot). `scale` is
 * only read for its `kind`, to build a same-kind scale windowed to the layer — every caller in
 * this codebase passes the app's one shared full-Earth-domain scale (`FULL_DOMAIN_SYMLOG_SCALE`)
 * here, so this component previously sampled every layer against 4.6 Gyr regardless of how much
 * of that the layer's own data actually covers. That's a coincidence-only fit for CO2 (570 Myr —
 * 84% of the full domain's own warped width) and a near-total failure for population (12,015 yr —
 * under 6% of it): of 97 evenly-spaced full-domain samples, only 5 landed inside population's
 * domain at all, and every one of them predates 1450 BP — the entire industrial-era-to-present
 * explosion, the whole reason the shape is interesting, fell between two adjacent samples and
 * was never drawn. No sample density fixes that; the samples have to be windowed to the layer's
 * own domain in the first place. Rescoped this way, population goes from 5 unusable points to 95
 * well-distributed ones spanning its full ~1,345x range (verified against the real published
 * data) — `LayerChart` keeps sharing the timeline's own scale unchanged (that's load-bearing:
 * "the value under the playhead sits directly above it", its own doc comment), since it is
 * explicitly a view docked to whatever window the timeline is currently showing, not a
 * self-contained peek the way this component is.
 */

import { createLinearScale, createSymlogScale } from '@/timeline'
import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { axisTransform } from '../chartAxis'
import { clampUnit } from '../format'
import styles from './hud.module.css'

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
  const layerScale = scale.kind === 'linear' ? createLinearScale(layer.timeDomain) : createSymlogScale(layer.timeDomain)

  const samples: Array<Point | null> = []
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT
    const v = layer.sample(layerScale.fromUnit(u))
    samples.push(v === null ? null : { u, value: v.value })
  }

  const values = samples.flatMap((p) => (p === null ? [] : [p.value]))
  const { toAxis } = axisTransform(values)
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

  // Clamped to the layer's own domain edge when `t` sits outside it — the same "this reading
  // doesn't apply right now" reading `ScalarReadout`'s "no data" already gives that case.
  const playheadU = clampUnit(layerScale.toUnit(t))
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
