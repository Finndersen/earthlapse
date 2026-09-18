'use client'

/**
 * Full-width chart docked to the timeline: it takes the *same* `TimeScale` the timeline
 * itself is using, so the value under the playhead sits directly above it rather than being
 * independently computed. Renders the uncertainty band wherever the layer carries `bounds`.
 * Whether it is shown at all is the caller's state (the HUD sparkline opens it); the chart
 * only offers a way to close itself, so opening a chart is always a single gesture.
 *
 * The y-axis is log or linear per `../chartAxis`'s `axisTransform` — the same data-driven
 * ratio test `Sparkline` already used, applied here too so the full-size chart never contradicts
 * the sparkline that opened it. See that module's doc comment for why (population's ~1,600x
 * range is the motivating case). Whichever axis is chosen, the printed min/max stay in raw
 * units — `axisTransform` only ever changes where a value lands on the plot, never how it's
 * labelled — and a log axis says so inline (`chartAxisScale`) so the shape can't be misread.
 *
 * Unlike `Sparkline` (which simply stops drawing at `t`, 2026-09-18's first re-review), this
 * chart is opened deliberately to inspect the data, so hiding the not-yet-reached portion
 * outright would make the axis jump around as `t` moves and leave the chart unreadable at an
 * early `t` (a chart with almost nothing on it). Instead the reached portion draws at full
 * weight (`chartLine`/`chartArea`/`chartBand`) and the rest draws as a faint, fill-less "ghost"
 * (`chartLineGhost` — thin, low-opacity, no area wash, no band) that shares its boundary point
 * with the solid line so the two visually join with no gap, giving a stable "you are here, this
 * is what has happened so far, this is what's coming" reading (2026-09-18, second re-review: "my
 * idea... was for them to grow over time, not be fully visible upfront" — the sparkline was the
 * primary target, but leaving this fully solid at every `t` would repeat the same complaint
 * here). A genuine no-record gap (ADR-027) reads as a real break either way — a `null` sample
 * still ends a segment outright (see `flushLine`/`flushBand` below) before the reached/future
 * split below ever runs, so an absence (a gap: no line, reached or not) never gets confused with
 * a faint-but-present ghost line (a future point: not real data yet, but not a data hole either).
 */

import { useEffect } from 'react'

import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { axisTransform } from '../chartAxis'
import { clampUnit, formatScalarValue } from '../format'
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
  onClose: () => void
}

interface ChartPoint {
  u: number
  t: GeoTime
  value: number
  lower: number | null
  upper: number | null
}

/**
 * Splits one continuous (gap-free) run of points into its already-reached prefix and its
 * not-yet-reached remainder, sharing the boundary point between both so the solid and ghost
 * lines touch with no visual gap. Points run in ascending `u`, i.e. descending `t` (oldest
 * first) — playback runs oldest -> newest, so everything from the start up to the first point
 * newer than `t` is reached.
 */
function splitAtPlayhead(segment: ChartPoint[], t: GeoTime): { reached: ChartPoint[]; future: ChartPoint[] } {
  const splitIndex = segment.findIndex((p) => p.t < t)
  if (splitIndex === -1) return { reached: segment, future: [] }
  if (splitIndex === 0) return { reached: [], future: segment }
  return { reached: segment.slice(0, splitIndex), future: segment.slice(splitIndex - 1) }
}

export function LayerChart({ layer, t, scale, onClose }: LayerChartProps) {
  // Escape closes the chart from anywhere — scoped to this listener's own lifetime (mounted
  // only while the chart is open, per the caller), so it never competes with the timeline's
  // own keydown handling, which is a React handler on the timeline's root and only fires
  // while focus is inside it (see `timeline/keyboard.ts`).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const samples: Array<ChartPoint | null> = []
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT
    const sampleT = scale.fromUnit(u)
    const v = layer.sample(sampleT)
    samples.push(v === null ? null : { u, t: sampleT, value: v.value, lower: v.bounds?.[0] ?? null, upper: v.bounds?.[1] ?? null })
  }

  const presentValues = samples.flatMap((p) => (p === null ? [] : [p.value, p.lower ?? p.value, p.upper ?? p.value]))
  const min = presentValues.length > 0 ? Math.min(...presentValues) : 0
  const max = presentValues.length > 0 ? Math.max(...presentValues) : 1
  // Same ratio-driven log/linear policy as `Sparkline` (`../chartAxis`'s doc comment has the
  // full justification): a series spanning enough orders of magnitude — population's ~1,600x
  // between its oldest and newest samples chief among them — gets a log axis so its whole
  // history's shape is visible, not just a spike at the present. `min`/`max` above stay in raw
  // units for the printed axis labels below; only the plotted position runs through `toAxis`.
  const { toAxis, isLog } = axisTransform(presentValues)
  const axisMin = toAxis(min)
  const axisMax = toAxis(max)
  const span = axisMax - axisMin || 1

  const x = (u: number): number => PAD_X + u * (VIEW_WIDTH - 2 * PAD_X)
  const y = (value: number): number => VIEW_HEIGHT - PAD_Y - ((toAxis(value) - axisMin) / span) * (VIEW_HEIGHT - 2 * PAD_Y)

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

  // Reached (full weight) vs. not-yet-reached (ghost) halves of each gap-free run — see this
  // file's own doc comment. Bands are dropped entirely past the playhead rather than ghosted:
  // an uncertainty range is itself a claim about a value, which is exactly what a not-yet-
  // reached point must not assert.
  const reachedLineSegments = lineSegments.map((seg) => splitAtPlayhead(seg, t).reached).filter((seg) => seg.length > 1)
  const futureLineSegments = lineSegments.map((seg) => splitAtPlayhead(seg, t).future).filter((seg) => seg.length > 1)
  const reachedBandSegments = bandSegments.map((seg) => splitAtPlayhead(seg, t).reached).filter((seg) => seg.length > 1)

  const playheadU = clampUnit(scale.toUnit(t))
  const playheadValue = layer.sample(t)
  const unit = playheadValue?.unit ?? ''
  // "no data" outside the layer's whole domain, "no record" inside it but in a declared gap
  // (ADR-027) — the only other reason `sample()` returns null there, mirroring ScalarReadout.
  const inDomain = t >= layer.timeDomain[0] && t <= layer.timeDomain[1]

  return (
    <div className={styles.chart} data-testid="layer-chart" data-layer-id={layer.id}>
      <button type="button" className={styles.chartClose} onClick={onClose} aria-label={`Close ${layer.name} chart`}>
        <span className={styles.chartCloseGlyph} aria-hidden="true">
          {'✕'}
        </span>
        <span className={styles.chartCloseLabel}>Close</span>
      </button>
      <div className={styles.chartHeader}>
        <span className={styles.label}>{layer.name}</span>
        <span className={styles.chartValue}>
          {playheadValue === null
            ? inDomain
              ? 'no record'
              : 'no data'
            : `${formatScalarValue(playheadValue.value, playheadValue.unit)} ${playheadValue.unit}`}
        </span>
      </div>
      <div className={styles.chartPlot}>
        {/* Stretched non-uniformly (`preserveAspectRatio="none"`) so x spans exactly the
            timeline's width and the playhead lines up with the timeline's own. */}
        <svg
          className={styles.chartSvg}
          data-testid="layer-chart-svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={isLog ? `${layer.name} chart, log scale` : `${layer.name} chart`}
        >
          {/* Area wash and band are only ever drawn for the reached portion — filling ahead of
              the playhead would itself read as "there is a value here", the same overclaim a
              ghost line's own "no fill" rule exists to avoid (this file's own doc comment). */}
          {reachedLineSegments.map((seg, i) => {
            const top = seg.map((p) => `${x(p.u)},${y(p.value)}`)
            const base = [`${x(seg[seg.length - 1]!.u)},${VIEW_HEIGHT}`, `${x(seg[0]!.u)},${VIEW_HEIGHT}`]
            return <polygon key={i} className={styles.chartArea} points={[...top, ...base].join(' ')} />
          })}
          {reachedBandSegments.map((seg, i) => {
            const upperPath = seg.map((p) => `${x(p.u)},${y(p.upper ?? p.value)}`)
            const lowerPath = [...seg].reverse().map((p) => `${x(p.u)},${y(p.lower ?? p.value)}`)
            return <polygon key={i} className={styles.chartBand} points={[...upperPath, ...lowerPath].join(' ')} />
          })}
          {futureLineSegments.map((seg, i) => (
            <polyline key={i} className={styles.chartLineGhost} points={seg.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')} />
          ))}
          {reachedLineSegments.map((seg, i) => (
            <polyline key={i} className={styles.chartLine} points={seg.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')} />
          ))}
          <line className={styles.chartPlayhead} x1={x(playheadU)} x2={x(playheadU)} y1={0} y2={VIEW_HEIGHT} />
        </svg>
        {presentValues.length > 0 && (
          <>
            <span className={`${styles.chartAxis} ${styles.chartAxisMax}`} aria-hidden="true">
              {formatScalarValue(max, unit)} {unit}
              {/* Labelled whenever the axis is log, not just for population: readers must never
                  have to guess the curve's real shape from an unmarked axis. */}
              {isLog && <span className={styles.chartAxisScale}> · log scale</span>}
            </span>
            <span className={`${styles.chartAxis} ${styles.chartAxisMin}`} aria-hidden="true">
              {formatScalarValue(min, unit)} {unit}
            </span>
          </>
        )}
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
    </div>
  )
}
