'use client'

/**
 * The expanded view of the HUD sparklines, shown inside a `Panel`: each chosen layer's whole
 * record rather than the story so far, with its uncertainty band, labelled axes, the playhead, and
 * a hover readout. The part playback has reached draws at full weight and the rest as a faint
 * line, so the chart stays readable at any `t` without presenting what lies ahead as already
 * reached.
 *
 * Toggles choose which layers are drawn, over one time axis spanning all of them. Each layer keeps
 * its own colour and its own value axis (the first chosen on the left, the second on the right),
 * since their units share nothing. The chart shows the whole span or zooms to a recent window,
 * with each value axis refitted to what is in view.
 */

import { useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { defaultRange, niceTicks, recentWindowsFor, sampleCurve, splitAtT, timeAxis, windowDomain } from '../chartGeometry'
import type { ChartCurve, ChartPoint } from '../chartGeometry'
import { axisUnit, formatScalarValue } from '../format'
import { HUD_READOUT_THROTTLE_MS, useThrottledValue } from '@/lib/useThrottledValue'
import styles from './LayerChart.module.css'

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 240
/** About one sample per pixel of the dialog's widest plot. */
const SAMPLE_COUNT = 480
/** Series colours by the layer's position in `layers`, so a layer keeps its colour whatever else is shown. */
const SERIES_CLASSES = [styles.series0, styles.series1, styles.series2]

export interface LayerChartProps {
  /** Every layer the chart can show, in toggle order. */
  layers: readonly Layer<ScalarValue>[]
  /** The layer shown when the chart opens. */
  initialLayerId: string
  t: GeoTime
}

/** `null` is the whole span; a number is the last that many years. */
type ChartRange = number | null

function rangeLabel(range: ChartRange): string {
  return range === null ? 'All' : `${range.toLocaleString('en-US')} yr`
}

interface Series {
  layer: Layer<ScalarValue>
  className: string
  unit: string
  curve: ChartCurve
  y: (value: number) => number
}

/** `[newest, oldest]` covering every domain in `domains`. */
function unionDomain(domains: readonly (readonly [GeoTime, GeoTime])[]): [GeoTime, GeoTime] {
  return [Math.min(...domains.map((d) => d[0])), Math.max(...domains.map((d) => d[1]))]
}

export function LayerChart({ layers, initialLayerId, t }: LayerChartProps) {
  const throttledT = useThrottledValue(t, HUD_READOUT_THROTTLE_MS)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set([initialLayerId]))
  /** `'auto'` follows `defaultRange` until a range is picked; a toggle returns to it. */
  const [chosenRange, setRange] = useState<ChartRange | 'auto'>('auto')
  const [hoverU, setHoverU] = useState<number | null>(null)

  const selected = useMemo(() => layers.filter((layer) => selectedIds.has(layer.id)), [layers, selectedIds])
  const span = useMemo(() => unionDomain(selected.map((layer) => layer.timeDomain)), [selected])
  const windows = recentWindowsFor(span)
  const range =
    chosenRange === 'auto'
      ? defaultRange(windows, selected.map((layer) => layer.timeDomain[1] - layer.timeDomain[0]))
      : chosenRange !== null && windows.includes(chosenRange)
        ? chosenRange
        : null
  const shown = useMemo(() => windowDomain(span, range), [span, range])
  const axis = useMemo(() => timeAxis(shown), [shown])

  const series: Series[] = useMemo(
    () =>
      selected.map((layer) => {
        const curve = sampleCurve(layer, axis, SAMPLE_COUNT)
        const [vMin, vMax] = curve.valueRange ?? [0, 1]
        return {
          layer,
          className: SERIES_CLASSES[layers.indexOf(layer) % SERIES_CLASSES.length]!,
          unit: layer.sample(layer.timeDomain[0])?.unit ?? '',
          curve,
          y: (value: number) => VIEW_HEIGHT - ((value - vMin) / (vMax - vMin || 1)) * VIEW_HEIGHT,
        }
      }),
    [selected, layers, axis],
  )

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next.size === 0 ? current : next
    })
    setRange('auto')
  }

  const x = (u: number) => u * VIEW_WIDTH
  const playheadT = Math.min(Math.max(throttledT, span[0]), span[1])
  const playheadU = axis.toUnit(playheadT)
  const playheadInView = throttledT <= shown[1]
  const readingT = hoverU === null ? (throttledT <= span[1] ? playheadT : null) : axis.fromUnit(hoverU)

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverU(rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : null)
  }

  const [leftAxis, rightAxis] = series

  return (
    <div className={styles.chart} data-testid="layer-chart" data-layer-ids={selected.map((layer) => layer.id).join(' ')}>
      <div className={styles.header}>
        {layers.length > 1 && (
          <div className={styles.toggle} role="group" aria-label="Datasets">
            {layers.map((layer, i) => (
              <button
                key={layer.id}
                type="button"
                className={SERIES_CLASSES[i % SERIES_CLASSES.length]}
                aria-pressed={selectedIds.has(layer.id)}
                onClick={() => toggle(layer.id)}
              >
                <span className={styles.swatch} aria-hidden="true" />
                {layer.name}
              </button>
            ))}
          </div>
        )}
        <div className={styles.toggle} role="group" aria-label="Range">
          {[null, ...windows].map((option) => (
            <button key={option ?? 'all'} type="button" aria-pressed={range === option} onClick={() => setRange(option)}>
              {rangeLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.reading} data-testid="layer-chart-reading">
        {readingT === null ? (
          <span className={styles.readingTime}>Not yet reached</span>
        ) : (
          <>
            <span className={styles.readingTime}>{formatGeoTime(readingT)}</span>
            {series.map((s) => {
              const value = readingT <= s.layer.timeDomain[1] ? s.layer.sample(Math.max(readingT, s.layer.timeDomain[0])) : null
              return (
                <span key={s.layer.id} className={`${styles.readingValue} ${s.className}`}>
                  {value === null ? 'no record' : `${formatScalarValue(value.value, s.unit)} ${s.unit}`}
                </span>
              )
            })}
          </>
        )}
      </p>

      <div className={styles.frame}>
        <ValueAxis series={leftAxis} side="left" />
        <div className={styles.plot} onPointerMove={onPointerMove} onPointerLeave={() => setHoverU(null)}>
          {/* Stretched to the plot box, so text and the dots live in HTML above it rather than
              being squashed with it. */}
          <svg
            className={styles.svg}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${selected.map((layer) => layer.name).join(' and ')} chart`}
          >
            {axis.ticks().map(({ t: tick }) => (
              <line key={tick} className={styles.grid} x1={x(axis.toUnit(tick))} x2={x(axis.toUnit(tick))} y1={0} y2={VIEW_HEIGHT} />
            ))}
            {series.map((s) => (
              <SeriesPaths key={s.layer.id} series={s} t={throttledT} x={x} />
            ))}
            {playheadInView && <line className={styles.playhead} x1={x(playheadU)} x2={x(playheadU)} y1={0} y2={VIEW_HEIGHT} />}
            {hoverU !== null && <line className={styles.hover} x1={x(hoverU)} x2={x(hoverU)} y1={0} y2={VIEW_HEIGHT} />}
          </svg>
          {playheadInView &&
            series.map((s) => {
              const value = throttledT <= s.layer.timeDomain[1] ? s.layer.sample(Math.max(throttledT, s.layer.timeDomain[0])) : null
              return (
                value !== null && (
                  <span
                    key={s.layer.id}
                    className={`${styles.dot} ${s.className}`}
                    style={{ left: `${playheadU * 100}%`, top: `${(s.y(value.value) / VIEW_HEIGHT) * 100}%` }}
                  />
                )
              )
            })}
        </div>
        <ValueAxis series={rightAxis} side="right" />
        <div className={styles.timeTicks} aria-hidden="true">
          {axis.ticks().map((tick, i, ticks) => (
            <span key={tick.t} data-minor={(ticks.length > 4 && i % 2 === 1) || undefined} style={{ left: `${axis.toUnit(tick.t) * 100}%`, transform: `translateX(${tickLabelShift(axis.toUnit(tick.t))}%)` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SeriesPaths({ series, t, x }: { series: Series; t: GeoTime; x: (u: number) => number }) {
  const { y } = series
  const linePoints = (run: ChartPoint[]) => run.map((p) => `${x(p.u)},${y(p.value)}`).join(' ')
  const split = series.curve.runs.map((run) => splitAtT(run, t))
  const reached = split.map((s) => s.reached).filter((run) => run.length > 1)
  const ahead = split.map((s) => s.ahead).filter((run) => run.length > 1)
  return (
    <g className={series.className} data-layer-id={series.layer.id}>
      {reached.flatMap(bandRuns).map((run, i) => (
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
    </g>
  )
}

/** One value axis in its series' colour: a vertical title naming the layer and its unit, and
 *  bare-number tick labels; an empty gutter when no series uses it. */
function ValueAxis({ series, side }: { series: Series | undefined; side: 'left' | 'right' }) {
  const range = series?.curve.valueRange ?? null
  if (series === undefined || range === null) return <div className={side === 'left' ? styles.valueAxisEmpty : undefined} aria-hidden="true" />
  const unit = axisUnit(range[1], series.unit)
  const ticks = niceTicks(range[0], range[1], 4).map((value) => ({ value, label: String(Number((value / unit.divisor).toPrecision(12))) }))
  const title = unit.label === '' ? series.layer.name : `${series.layer.name}, ${unit.label}`
  return (
    <div className={`${styles.valueAxis} ${side === 'left' ? styles.valueAxisLeft : styles.valueAxisRight} ${series.className}`} aria-hidden="true">
      <span className={styles.axisTitle}>{title}</span>
      {/* The labels are absolutely placed, so the gutter is sized to the longest one. */}
      <div className={styles.valueTicks} style={{ minWidth: `${Math.max(...ticks.map((tick) => tick.label.length))}ch` }}>
        {ticks.map((tick) => (
          <span key={tick.value} style={{ top: `${(series.y(tick.value) / VIEW_HEIGHT) * 100}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
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
