'use client'

/** The previous/next sibling-section buttons (user ask, 2026-09-18: moved onto the scrub track
 *  itself, at the far edges of the selected era section's own range) — "the era range" is
 *  literally the track's own left and right ends: when a section is selected the track always
 *  shows that section's window across its full width (ADR-024; there is no free zoom or pan), so
 *  `‹` at the left (oldest) edge stepping to the older sibling and `›` at the right (newest) edge
 *  stepping to the newer one continues the same oldest-to-newest orientation the track already
 *  draws in, rather than reading as two buttons bolted onto an unrelated breadcrumb — where they
 *  lived before this pass (`SectionBreadcrumb.tsx`'s own history).
 *
 *  Resolves targets through the exact functions the keyboard shortcuts use —
 *  `sections.ts`'s `previousSiblingStep`/`continuationSection` — and reports through the same
 *  `onSelectSection` every other section-navigation control calls; this is not a second
 *  selection mechanism. `Timeline.tsx` computes each `target` itself (the same two calls) and
 *  places one `<SectionEdgeButton>` on either side of whatever it needs to flank — the scrub
 *  track on a wide viewport, the play/back/forward transport on a phone-portrait one — since a
 *  single shared CSS Grid is what lets one `grid-area` reassignment move a real DOM node between
 *  those two positions per breakpoint (`Timeline.module.css`'s own `.timeline` doc comment) where
 *  this component's own previous shape — one wrapper owning both buttons plus everything they
 *  flank as `children` — could not: a grid item's `grid-area` only repositions a *direct* child
 *  of the grid, never something nested inside another element's own wrapper.
 *
 *  Kept `disabled`, not removed, when the move has nowhere to go — at either end of the tree's
 *  first/last branch — so neither row's width ever jumps, matching the convention the
 *  breadcrumb's own up/root buttons used before they were removed. */

import type { SectionId } from '../sections'
import { NEXT_SECTION_KEY_HINT, PREVIOUS_SECTION_KEY_HINT } from '../keyboard'
import styles from './SectionEdgeNav.module.css'

export interface SectionEdgeTarget {
  id: SectionId
  label: string
}

interface SectionEdgeButtonProps {
  edge: 'previous' | 'next'
  target: SectionEdgeTarget | undefined
  onSelectSection: (id: SectionId) => void
}

export function SectionEdgeButton({ edge, target, onSelectSection }: SectionEdgeButtonProps) {
  const isPrevious = edge === 'previous'
  const glyph = isPrevious ? '‹' : '›'
  const verb = isPrevious ? 'Previous' : 'Next'
  const hint = isPrevious ? PREVIOUS_SECTION_KEY_HINT : NEXT_SECTION_KEY_HINT
  const noTarget = isPrevious ? 'No previous section' : 'No next section'

  return (
    <button
      type="button"
      className={styles.edgeButton}
      data-edge={edge}
      disabled={target === undefined}
      aria-label={target === undefined ? noTarget : `${verb} section: ${target.label}`}
      title={target === undefined ? noTarget : `${verb}: ${target.label} (${hint})`}
      onClick={() => target !== undefined && onSelectSection(target.id)}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}
