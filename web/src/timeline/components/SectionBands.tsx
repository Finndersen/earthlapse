'use client'

/** The era-section band strip under the axis (ADR-024, amended by follow-up pass item 7 and the
 *  re-review fix below). It shows the selected section's children as clickable bands, laid out
 *  against the same fisheye-distorted `scale` the track and ruler use, so a band's edges line up
 *  with the boundary ages above them.
 *
 *  Bands too narrow for their true proportional share get a minimum width fit to their
 *  `abbreviation` (`layoutSectionBands`), redistributed from wider siblings — a label is never
 *  hidden, only shortened. Thin connector lines, confined to a slim band along the strip's own
 *  bottom edge (re-review fix, 2026-09-15 — they used to span the full height and cut straight
 *  through the label text they sit behind), fan out from a widened band's shared boundary down
 *  to where that boundary actually sits on the drawn scale, so the true proportions stay legible
 *  even once the bands themselves have been redrawn for legibility.
 *
 *  When even the sum of every band's own required floor width doesn't fit the strip,
 *  `layoutSectionBands` reports a `contentWidthPx` wider than the measured strip instead of
 *  shrinking any band below its floor (re-review fix, 2026-09-15 — see that module's own doc
 *  comment); this component makes the strip horizontally scrollable in that case, at
 *  `contentWidthPx`, rather than ever rendering a band narrower than its label needs.
 *
 *  The band holding the playhead carries `aria-current="time"` and the accent colour. A leaf
 *  section has nothing to split into, so it shows its own name and range instead.
 *
 *  `data-section-bands` on the `<nav>` (focusable via `tabIndex={-1}`) is where `Timeline` puts
 *  focus back after a band or breadcrumb click unmounts the element that had it. */

import { useMemo } from 'react'

import type { GeoTime, TimeScale } from '@/types/layer'

import { formatTimeRange } from '../format'
import { layoutSectionBands, type SectionBandLayout } from '../sectionLayout'
import { childSectionAt, childSections, sectionById, type SectionId } from '../sections'
import { useTrackWidth } from '../useTrackWidth'
import { clampUnit } from '../util'
import styles from './SectionBands.module.css'

interface SectionBandsProps {
  sectionId: SectionId
  t: GeoTime
  scale: TimeScale
  onSelectSection: (id: SectionId) => void
}

interface BoundaryConnector {
  /** Where this boundary truly sits on `scale`, as a strip-relative percentage. */
  truePercent: number
  /** Where it was redrawn to once narrow bands were widened, as a strip-relative percentage. */
  renderedPercent: number
}

/** A boundary connector is only worth drawing once the redraw has moved it further than layout
 *  jitter/float rounding would — a fraction of a percent of the strip. */
const CONNECTOR_EPSILON_PERCENT = 0.3

/** The strip's internal boundaries (between consecutive bands; the two outer edges are always
 *  0% and 100% by construction, so never worth a connector) whose rendered position was moved
 *  from where the boundary truly sits on `scale` by more than `CONNECTOR_EPSILON_PERCENT`.
 *
 *  Only meaningful when every band's `left`/`width` are fractions of the same fixed width
 *  `scale.toUnit` itself is drawn across — i.e. the non-scrollable case (re-review fix,
 *  2026-09-15: caught while verifying the scrollable-strip fix above, before it shipped). Once
 *  the strip scrolls (`contentWidthPx > stripWidthPx`), a band's rendered position is a fraction
 *  of the wider scrollable content, not of the fixed track above it that `scale.toUnit` maps
 *  against, so the two percentages are no longer in the same coordinate space and a "connector"
 *  between them would be meaningless (potentially pointing off-screen, into the scrolled-away
 *  part of the strip). `SectionBands` skips calling this in that case. */
function boundaryConnectors(bands: readonly SectionBandLayout[], scale: TimeScale): BoundaryConnector[] {
  const connectors: BoundaryConnector[] = []
  for (let i = 0; i < bands.length - 1; i++) {
    const truePercent = clampUnit(scale.toUnit(bands[i]!.section.window[0])) * 100
    const renderedPercent = (bands[i]!.left + bands[i]!.width) * 100
    if (Math.abs(truePercent - renderedPercent) > CONNECTOR_EPSILON_PERCENT) connectors.push({ truePercent, renderedPercent })
  }
  return connectors
}

export function SectionBands({ sectionId, t, scale, onSelectSection }: SectionBandsProps) {
  const [ref, widthPx] = useTrackWidth<HTMLElement>()
  const section = sectionById(sectionId)
  const children = childSections(sectionId)
  const { bands, contentWidthPx } = useMemo(() => layoutSectionBands(children, scale, widthPx), [children, scale, widthPx])
  // Only when every band's own floor doesn't fit the measured strip (`sectionLayout.ts`'s doc
  // comment) — the ordinary case renders `contentWidthPx === widthPx` and this is a no-op both
  // for the inline width (100%, same as omitting it) and for the CSS `overflow-x` it enables.
  const scrollable = contentWidthPx > widthPx
  // No connectors while scrollable — see `boundaryConnectors`'s own doc comment for why they'd
  // be meaningless (a different coordinate space) rather than merely redundant there.
  const connectors = useMemo(() => (scrollable ? [] : boundaryConnectors(bands, scale)), [bands, scale, scrollable])
  const currentId = childSectionAt(sectionId, t)?.id

  return (
    <nav ref={ref} className={styles.strip} aria-label={`Sections of ${section.label}`} tabIndex={-1} data-section-bands>
      {children.length === 0 ? (
        <p className={styles.leaf}>
          {section.label} · {formatTimeRange(section.window)}
        </p>
      ) : (
        <div className={styles.track} data-scrollable={scrollable} style={{ width: scrollable ? `${contentWidthPx}px` : '100%' }}>
          {connectors.length > 0 && (
            <svg className={styles.connectors} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {connectors.map((c, i) => (
                <line key={i} x1={c.truePercent} y1="0" x2={c.renderedPercent} y2="100" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
          <ul className={styles.bands}>
            {bands.map(({ section: band, left, width, labelForm }) => (
              <li key={band.id} className={styles.band} style={{ left: `${left * 100}%`, width: `${width * 100}%` }}>
                <button
                  type="button"
                  className={styles.bandButton}
                  aria-current={band.id === currentId ? 'time' : undefined}
                  aria-label={`${band.label}, ${formatTimeRange(band.window)}`}
                  title={`${band.label} · ${formatTimeRange(band.window)}`}
                  onClick={() => onSelectSection(band.id)}
                >
                  <span className={styles.label}>{labelForm === 'full' ? band.label : band.abbreviation}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}
