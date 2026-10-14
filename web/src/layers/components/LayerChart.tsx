'use client'

/**
 * The expanded view of a HUD sparkline, shown inside a `Panel`: the layer's whole record rather
 * than the story so far, with its uncertainty band, labelled axes, the playhead, and a hover
 * readout. The part playback has reached draws at full weight and the rest as a faint line, so
 * the chart stays readable at any `t` without presenting what lies ahead as already reached.
 *
 * It shows the whole record or zooms to a recent window (since the last glacial maximum, the Common
 * Era, the industrial era), with the value axis refitted to what is in view.
 */

import { useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { niceTicks, recentWindowsFor, sampleCurve, splitAtT, timeAxis, windowDomain } from '../chartGeometry'
import type { ChartPoint } from '../chartGeometry'
import { formatScalarValue } from '../format'
import { HUD_READOUT_THROTTLE_MS, useThrottledValue } from '@/lib/useThrottledValue'
import styles from './LayerChart.module.css'

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 240
/** Enough to resolve a glacial cycle across a log axis spanning nine decades of age. */
const SAMPLE_COUNT = 480

export interface LayerChartProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

/** `null` is the whole record; a number is the last that many years. */
type ChartRange = number | null

function rangeLabel(range: ChartRange): string {
  return range === null ? 'All' : `${range.toLocaleString('en-US')} yr`
}

export function LayerChart({ layer, t }: LayerChartProps) {
  const throttledT = useThrottledValue(t, HUD_READOUT_THROTTLE_MS)
  const [range, setRange] = useState<ChartRange>(null)
  const [hoverU, setHoverU] = useState<number | null>(null)

  const shown = useMemo(() => windowDomain(layer.timeDomain, range), [layer.timeDomain, range])
  const axis = useMemo(() => timeAxis(shown), [shown])
  const curve = useMemo(() => sampleCurve(layer, axis, SAMPLE_COUNT), [layer, axis])
  const [vMin, vMax] = curve.valueRange ?? [0, 1]

  const x = (u: number) => u * VIEW_WIDTH
  const y = (value: number) => VIEW_HEIGHT - ((value - vMin) / (vMax - vMin || 1)) * VIEW_HEIGHT
  const linePoints = (run: ChartPoint[]) => run.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')

  const split = curve.runs.map((run) => splitAtT(run, throttledT))
  const reached = split.map((s) => s.reached).filter((run) => run.length > 1)
  const ahead = split.map((s) => s.ahead).filter((run) => run.length > 1)
  const bands = reached.flatMap((run) => bandRuns(run))

  const [newest, oldest] = layer.timeDomain
  const playheadT = Math.min(Math.max(throttledT, newest), oldest)
  const playheadValue = throttledT <= oldest ? layer.sample(playheadT) : null
  const playheadU = axis.toUnit(playheadT)
  const playheadInView = throttledT <= shown[1]

  const hoverT = hoverU === null ? null : axis.fromUnit(hoverU)
  const hoverValue = hoverT === null ? null : layer.sample(hoverT)
  const unit = layer.sample(newest)?.unit ?? ''
  const valueTicks =
    curve.valueRange === null ? [] : niceTicks(vMin, vMax, 4).map((value) => ({ value, label: formatScalarValue(value, unit) }))

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverU(rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : null)
  }

  return (
    <div className={styles.chart} data-testid="layer-chart" data-layer-id={layer.id}>
      <div className={styles.header}>
        <span className={styles.reading} data-testid="layer-chart-reading">
          {hoverT !== null ? (
            <>
              <span className={styles.readingTime}>{formatGeoTime(hoverT)}</span>
              {hoverValue === null ? ' no record' : ` ${formatScalarValue(hoverValue.value, unit)} ${unit}`}
            </>
          ) : playheadValue !== null ? (
            <>
              <span className={styles.readingTime}>{formatGeoTime(playheadT)}</span>
              {` ${formatScalarValue(playheadValue.value, unit)} ${unit}`}
            </>
          ) : (
            <span className={styles.readingTime}>Not yet reached</span>
          )}
        </span>
        <div className={styles.rangeToggle} role="group" aria-label="Range">
          {[null, ...recentWindowsFor(layer.timeDomain)].map((option) => (
            <button key={option ?? 'all'} type="button" aria-pressed={range === option} onClick={() => setRange(option)}>
              {rangeLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.frame}>
        {/* The labels are absolutely placed, so the gutter is sized to the longest one. */}
        <div className={styles.valueTicks} style={{ minWidth: `${Math.max(...valueTicks.map((tick) => tick.label.length), 2)}ch` }} aria-hidden="true">
          {valueTicks.map((tick) => (
            <span key={tick.value} style={{ top: `${(y(tick.value) / VIEW_HEIGHT) * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div className={styles.plot} onPointerMove={onPointerMove} onPointerLeave={() => setHoverU(null)}>
          {/* Stretched to the plot box, so text and the dot live in HTML above it rather than
              being squashed with it. */}
          <svg className={styles.svg} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${layer.name} chart`}>
            {axis.ticks().map(({ t: tick }) => (
              <line key={tick} className={styles.grid} x1={x(axis.toUnit(tick))} x2={x(axis.toUnit(tick))} y1={0} y2={VIEW_HEIGHT} />
            ))}
            {bands.map((run, i) => (
              <polygon
                key={i}
                className={styles.band}
                points={[...run.map((p) => `${x(p.u)},${y(p.upper!)}`), ...[...run].reverse().map((p) => `${x(p.u)},${y(p.lower!)}`)].join(' ')}
              />
            ))}
            {ahead.map((run, i) => (
              <polyline key={i} className={styles.ghost} points={linePoints(run)} />
            ))}
            {reached.map((run, i) => (
              <polyline key={i} className={styles.line} data-testid="layer-chart-line" points={linePoints(run)} />
            ))}
            {playheadInView && <line className={styles.playhead} x1={x(playheadU)} x2={x(playheadU)} y1={0} y2={VIEW_HEIGHT} />}
            {hoverU !== null && <line className={styles.hover} x1={x(hoverU)} x2={x(hoverU)} y1={0} y2={VIEW_HEIGHT} />}
          </svg>
          {playheadValue !== null && playheadInView && (
            <span className={styles.dot} style={{ left: `${playheadU * 100}%`, top: `${(y(playheadValue.value) / VIEW_HEIGHT) * 100}%` }} />
          )}
        </div>
        <div className={styles.timeTicks} aria-hidden="true">
          {axis.ticks().map((tick) => (
            <span key={tick.t} style={{ left: `${axis.toUnit(tick.t) * 100}%`, transform: `translateX(${tickLabelShift(axis.toUnit(tick.t))}%)` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {unit !== '' && <p className={styles.unitNote}>Values in {unit}</p>}
    </div>
  )
}

/** A time label's horizontal anchor: centred on its tick, but kept inside the plot at either end. */
function tickLabelShift(u: number): number {
  if (u > 0.94) return -100
  if (u < 0.06) return 0
  return -50
}

/** The sub-runs of `run` where every point carries both bounds. */
function bandRuns(run: ChartPoint[]): ChartPoint[][] {
  const out: ChartPoint[][] = []
  let current: ChartPoint[] = []
  for (const p of run) {
    if (p.lower !== null && p.upper !== null) current.push(p)
    else {
      if (current.length > 1) out.push(current)
      current = []
    }
  }
  if (current.length > 1) out.push(current)
  return out
}
