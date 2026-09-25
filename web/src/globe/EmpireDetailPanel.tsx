'use client'

/**
 * An empire lineage's detail card (ADR-059), opened by clicking (or tapping twice) its territory
 * or label on the expanded globe. It sits on `EventDock`, where the event detail card docks, and
 * replaces that card rather than stacking on it; `Experience.tsx` owns which one is open.
 *
 * Unlike an event card it never moves `t` on opening. Everything shown is derived from the
 * lineage summary and `t`: the member active now is highlighted in the succession, and the area
 * chart's playhead follows the timeline. Only "Jump to peak" moves `t`, through `onJumpTo`.
 */

import { useId, useMemo } from 'react'

import { EventDock } from '@/events/components/EventDock'
import { formatGeoTime } from '@/timeline'
import type { GeoTime } from '@/types/layer'

import styles from './EmpireDetailPanel.module.css'
import { empireColour } from './empireStyle'
import { formatEmpireArea, formatEmpireSpan, lineageAreaAt, memberAt, type EmpireLineageSummary } from './empires'

export interface EmpireRelatedEvent {
  id: string
  label: string
}

export interface EmpireDetailPanelProps {
  summary: EmpireLineageSummary
  t: GeoTime
  /** The lineage's events that exist in the published event list, in the lineage's order. */
  relatedEvents: readonly EmpireRelatedEvent[]
  onClose: () => void
  /** Opens an event's card in this panel's place. */
  onOpenEvent: (eventId: string) => void
  /** Moves the timeline to `t`. */
  onJumpTo: (t: GeoTime) => void
}

/** The English Wikipedia URL for an article title. */
function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

const CHART_WIDTH = 240
const CHART_HEIGHT = 48
const CHART_PAD = 3

interface AreaChart {
  points: string
  x: (t: GeoTime) => number
  y: (areaKm2: number) => number
}

/** The lineage's summed area as a step line, oldest at the left, zero to the peak bottom to top. */
function areaChart(summary: EmpireLineageSummary): AreaChart {
  const [newest, oldest] = summary.span
  const x = (t: GeoTime): number => CHART_PAD + ((oldest - t) / (oldest - newest || 1)) * (CHART_WIDTH - 2 * CHART_PAD)
  const y = (areaKm2: number): number => CHART_HEIGHT - CHART_PAD - (areaKm2 / (summary.peak.areaKm2 || 1)) * (CHART_HEIGHT - 2 * CHART_PAD)
  const points = summary.area.flatMap((step) => [`${x(step.tStart)},${y(step.areaKm2)}`, `${x(step.tEnd)},${y(step.areaKm2)}`]).join(' ')
  return { points, x, y }
}

export function EmpireDetailPanel({ summary, t, relatedEvents, onClose, onOpenEvent, onJumpTo }: EmpireDetailPanelProps) {
  const successionId = useId()
  const eventsId = useId()
  const { lineage, members, peak, span } = summary
  const colour = empireColour(lineage.colourSlot)
  const chart = useMemo(() => areaChart(summary), [summary])
  const active = useMemo(() => memberAt(summary, t), [summary, t])
  const areaNow = useMemo(() => lineageAreaAt(summary, t), [summary, t])
  const inSpan = span[0] < t && t <= span[1]

  return (
    <EventDock
      title={lineage.name}
      onClose={onClose}
      fit="content"
      testId="empire-detail"
      header={
        <p className={styles.span}>
          <span aria-hidden="true" className={styles.swatch} style={{ background: colour }} />
          {formatEmpireSpan(span[1], span[0])}
        </p>
      }
    >
      <div className={styles.body}>
        <div className={styles.column}>
          <p className={styles.description}>{lineage.description}</p>
          <figure className={styles.chart}>
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              width="100%"
              role="img"
              aria-label={`${lineage.name}: territory over time, peak ${formatEmpireArea(peak.areaKm2)} in ${formatGeoTime(peak.tStart)}`}
              className={styles.chartSvg}
            >
              <polyline className={styles.chartLine} points={chart.points} style={{ stroke: colour }} />
              <circle className={styles.chartPeak} cx={(chart.x(peak.tStart) + chart.x(peak.tEnd)) / 2} cy={chart.y(peak.areaKm2)} r={2.25} />
              {inSpan && (
                <>
                  <line className={styles.chartPlayhead} x1={chart.x(t)} x2={chart.x(t)} y1={CHART_PAD} y2={CHART_HEIGHT - CHART_PAD} />
                  <circle className={styles.chartDot} cx={chart.x(t)} cy={chart.y(areaNow)} r={2.25} />
                </>
              )}
            </svg>
            <figcaption className={styles.chartCaption}>
              <span>
                Peak {formatEmpireArea(peak.areaKm2)} · {formatGeoTime(peak.tStart)}
              </span>
              {inSpan && <span>Now {areaNow > 0 ? formatEmpireArea(areaNow) : 'no territory'}</span>}
            </figcaption>
          </figure>
        </div>

        <div className={styles.column}>
          <section aria-labelledby={successionId}>
            <h3 id={successionId} className={styles.heading}>
              Succession
            </h3>
            <ol className={styles.members}>
              {members.map((member) => {
                const current = active?.member === member.member
                return (
                  <li key={member.member} className={styles.member} data-current={current || undefined} aria-current={current || undefined}>
                    <span aria-hidden="true" className={styles.memberTick} style={current ? { background: colour } : undefined} />
                    {member.wikipedia !== null ? (
                      <a
                        className={styles.memberLabel}
                        href={wikipediaUrl(member.wikipedia)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${member.label} on Wikipedia`}
                      >
                        {member.label}
                      </a>
                    ) : (
                      <span className={styles.memberLabel}>{member.label}</span>
                    )}
                    <span className={styles.memberSpan}>{formatEmpireSpan(member.tStart, member.tEnd)}</span>
                  </li>
                )
              })}
            </ol>
          </section>

          {relatedEvents.length > 0 && (
            <section className={styles.events} aria-labelledby={eventsId}>
              <h3 id={eventsId} className={styles.heading}>
                Events
              </h3>
              <ul className={styles.eventList}>
                {relatedEvents.map((event) => (
                  <li key={event.id}>
                    <button type="button" className={styles.eventLink} onClick={() => onOpenEvent(event.id)}>
                      {event.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.footerButton} onClick={() => onJumpTo(peak.tStart)}>
          <span className={styles.footerHint}>Jump to peak ›</span>
          <span className={styles.footerTitle}>{formatGeoTime(peak.tStart)}</span>
        </button>
        {active !== null && active.wikipedia !== null && (
          <a
            className={styles.footerButton}
            data-align="end"
            href={wikipediaUrl(active.wikipedia)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${active.label} on Wikipedia (opens in a new tab)`}
          >
            <span className={styles.footerHint}>Wikipedia ↗</span>
            <span className={styles.footerTitle}>{active.label}</span>
          </a>
        )}
      </div>
    </EventDock>
  )
}
