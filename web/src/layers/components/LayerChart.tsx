'use client'

/**
 * Full-width chart docked to the timeline: it takes the *same* `TimeScale` the timeline
 * itself is using, so the value under the playhead sits directly above it rather than being
 * independently computed. Renders the uncertainty band wherever the layer carries `bounds`.
 * Collapsed to a title bar by default — the expand toggle is local UI state, not part of the
 * `t` model, so it does not affect purity of anything in `@/layers`.
 */

import { useState } from 'react'

import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { clampUnit, formatValue } from '../format'
import styles from './hud.module.css'

const SAMPLE_COUNT = 240
const VIEW_WIDTH = 600
const VIEW_HEIGHT = 120
const PAD_X = 0
const PAD_Y = 10

export interface LayerChartProps {
  layer: Layer<ScalarValue>
  t: GeoTime
  scale: TimeScale
}

interface ChartPoint {
  u: number
  value: number
  lower: number | null
  upper: number | null
}

export function LayerChart({ layer, t, scale }: LayerChartProps) {
  const [expanded, setExpanded] = useState(false)

  const samples: Array<ChartPoint | null> = []
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT
    const v = layer.sample(scale.fromUnit(u))
    samples.push(v === null ? null : { u, value: v.value, lower: v.bounds?.[0] ?? null, upper: v.bounds?.[1] ?? null })
  }

  const presentValues = samples.flatMap((p) => (p === null ? [] : [p.value, p.lower ?? p.value, p.upper ?? p.value]))
  const min = presentValues.length > 0 ? Math.min(...presentValues) : 0
  const max = presentValues.length > 0 ? Math.max(...presentValues) : 1
  const span = max - min || 1

  const x = (u: number): number => PAD_X + u * (VIEW_WIDTH - 2 * PAD_X)
  const y = (value: number): number => VIEW_HEIGHT - PAD_Y - ((value - min) / span) * (VIEW_HEIGHT - 2 * PAD_Y)

  const lineSegments: ChartPoint[][] = []
  const bandSegments: ChartPoint[][] = []
  let currentLine: ChartPoint[] = []
  let currentBand: ChartPoint[] = []

  const flushLine = (): void => {
    if (currentLine.length > 1) lineSegments.push(currentLine)
    currentLine = []
  }
  const flushBand = (): void => {
    if (currentBand.length > 1) bandSegments.push(currentBand)
    currentBand = []
  }

  for (const p of samples) {
    if (p === null) {
      flushLine()
      flushBand()
      continue
    }
    currentLine.push(p)
    if (p.lower !== null && p.upper !== null) {
      currentBand.push(p)
    } else {
      flushBand()
    }
  }
  flushLine()
  flushBand()

  const playheadU = clampUnit(scale.toUnit(t))
  const playheadValue = layer.sample(t)

  return (
    <div className={styles.chart}>
      <button type="button" className={styles.chartToggle} onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {layer.name} — {playheadValue === null ? 'no data' : `${formatValue(playheadValue.value)} ${playheadValue.unit}`}
        <span className={styles.chartHint} aria-hidden="true">
          {expanded ? 'hide chart' : 'show chart'}
        </span>
      </button>
      {expanded && (
        <div className={styles.chartPlot}>
          {/* Stretched non-uniformly (`preserveAspectRatio="none"`) so x spans exactly the
              timeline's width and the playhead lines up with the timeline's own. */}
          <svg
            className={styles.chartSvg}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${layer.name} chart`}
          >
            {bandSegments.map((seg, i) => {
              const upperPath = seg.map((p) => `${x(p.u)},${y(p.upper ?? p.value)}`)
              const lowerPath = [...seg].reverse().map((p) => `${x(p.u)},${y(p.lower ?? p.value)}`)
              return <polygon key={i} className={styles.chartBand} points={[...upperPath, ...lowerPath].join(' ')} />
            })}
            {lineSegments.map((seg, i) => (
              <polyline key={i} className={styles.chartLine} points={seg.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')} />
            ))}
            <line className={styles.chartPlayhead} x1={x(playheadU)} x2={x(playheadU)} y1={0} y2={VIEW_HEIGHT} />
          </svg>
          {playheadValue !== null && (
            <span
              className={styles.chartDot}
              style={{
                left: `${(x(playheadU) / VIEW_WIDTH) * 100}%`,
                top: `${(y(playheadValue.value) / VIEW_HEIGHT) * 100}%`,
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
