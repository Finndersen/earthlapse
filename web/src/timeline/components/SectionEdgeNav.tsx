'use client'

/** Flanks the scrub track, ruler and section-band strip — passed in as `children`, kept
 *  together so all three measure and draw against the exact same (narrowed) width and stay
 *  pixel-aligned with each other — with the previous/next sibling-section buttons, at the far
 *  left and right edges of the selected era section's own range (user ask, 2026-09-18). "The
 *  era range" is literally the track's own left and right ends: when a section is selected the
 *  track always shows that section's window across its full width (ADR-024; there is no free
 *  zoom or pan), so `‹` at the left (oldest) edge stepping to the older sibling and `›` at the
 *  right (newest) edge stepping to the newer one continues the same oldest-to-newest orientation
 *  the track already draws in, rather than reading as two buttons bolted onto an unrelated
 *  breadcrumb — where they lived before this pass (`SectionBreadcrumb.tsx`'s own history).
 *
 *  Resolves targets through the exact functions the keyboard shortcuts (and, formerly, the
 *  breadcrumb buttons) use — `sections.ts`'s `previousSiblingStep`/`continuationSection` — and
 *  reports through the same `onSelectSection` every other section-navigation control calls; this
 *  is not a second selection mechanism.
 *
 *  `.stack` (the scrub track, ruler and band strip together) is inset horizontally by
 *  `SectionEdgeNav.module.css`'s own reserved gutter on each side — real width, not visual
 *  overlap, so the three children measure and draw genuinely narrower (`useTrackWidth`'s
 *  `ResizeObserver`, unchanged), exactly as they would at a narrower viewport. Each button then
 *  lives entirely inside its own gutter, `position: absolute` within `.row`: because it never
 *  shares horizontal space with the track/ruler/band strip, it can never overlap the scrub hit
 *  area, an axis tick label or an event dot regardless of its own vertical position, and dragging
 *  to either literal edge of the (now narrower) track is untouched — there is no shared hit area
 *  for a drag gesture and a button click to ever contend over. Being `position: absolute` also
 *  means the button's own box never contributes to `.row`'s height, so sizing it generously (the
 *  2026-09-18 refinement pass: "larger icons") costs the bottom chrome nothing.
 *
 *  Vertically (the same refinement pass — "moved down... to be in between the timeline and era
 *  header lines"), each button is centred on the real boundary between the scrub track's own box
 *  and the section-band strip beneath it — the same band the ruler's numeric ticks occupy — via
 *  `SectionEdgeNav.module.css`'s `--track-box-height`/`--stack-row-gap`/`--ticks-height`, which
 *  mirror the fixed pixel heights `ScrubTrack.module.css`'s `.hitArea` and `AxisTicks.module.css`'s
 *  `.ticks` already declare (see that module's own doc comment for the exact sum) rather than a
 *  hand-picked offset: none of those three rows scales with viewport width, so neither does this
 *  anchor, and it stays clear of both the axis labels above it and the era-band labels below it —
 *  including at the narrow end of the tree, since the horizontal gutter above already rules out
 *  colliding with either the first/last band or the edge tick labels regardless of the vertical
 *  overlap a taller button reaches into. Keeping the two calculations in sync (this module's CSS
 *  and the two it mirrors) is the one thing a future change to either row's own height must also
 *  update — flagged here rather than left implicit, the same convention `ScrubTrack.tsx`'s own
 *  `_PX` constants (mirroring a CSS module's pixel values it can't import directly) already uses.
 *
 *  Kept `disabled`, not removed, when the move has nowhere to go — at either end of the tree's
 *  first/last branch — so the row's width never jumps, matching the convention the breadcrumb's
 *  own up/root buttons used before they were removed. */

import type { ReactNode } from 'react'

import { NEXT_SECTION_KEY_HINT, PREVIOUS_SECTION_KEY_HINT } from '../keyboard'
import { continuationSection, previousSiblingStep, type SectionId } from '../sections'
import styles from './SectionEdgeNav.module.css'

interface SectionEdgeNavProps {
  sectionId: SectionId
  onSelectSection: (id: SectionId) => void
  children: ReactNode
}

export function SectionEdgeNav({ sectionId, onSelectSection, children }: SectionEdgeNavProps) {
  const previous = previousSiblingStep(sectionId)
  const next = continuationSection(sectionId)

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.edgeButton}
        data-edge="previous"
        disabled={previous === undefined}
        aria-label={previous === undefined ? 'No previous section' : `Previous section: ${previous.label}`}
        title={previous === undefined ? 'No previous section' : `Previous: ${previous.label} (${PREVIOUS_SECTION_KEY_HINT})`}
        onClick={() => previous !== undefined && onSelectSection(previous.id)}
      >
        <span aria-hidden="true">{'‹'}</span>
      </button>
      <div className={styles.stack}>{children}</div>
      <button
        type="button"
        className={styles.edgeButton}
        data-edge="next"
        disabled={next === undefined}
        aria-label={next === undefined ? 'No next section' : `Next section: ${next.label}`}
        title={next === undefined ? 'No next section' : `Next: ${next.label} (${NEXT_SECTION_KEY_HINT})`}
        onClick={() => next !== undefined && onSelectSection(next.id)}
      >
        <span aria-hidden="true">{'›'}</span>
      </button>
    </div>
  )
}
