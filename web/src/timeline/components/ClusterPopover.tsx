'use client'

/** The member-list popover a checkpoint cluster marker opens on click/tap (ADR-021, replacing
 *  the window-framing `onFrameCluster` zoom used before zoom was removed). Anchored to the
 *  cluster's own displayed `u`, clamped to the track's own left/right edge the same way a pip's
 *  hover preview is (`anchorEdge` in `ScrubTrack`). Owns no state of its own — `onSelect`
 *  scrubs and closes, `onClose` alone just closes; `ScrubTrack` is the source of truth for which
 *  cluster (if any) is open.
 *
 *  Keyboard accessible (brief §3): focus lands here the instant it opens, Tab/Shift+Tab is
 *  trapped within its own focusable elements (the close button, then each member row) rather
 *  than leaking out to the rest of the page while the dialog is open, and Escape closes it.
 *  Whichever element had focus before the popover opened (typically the cluster button that
 *  triggered it) regains focus once it closes, on every close path — Escape, a member
 *  selection, the × button, or `ScrubTrack`'s own "press elsewhere dismisses it" branch — since
 *  all of them unmount this component and focus is restored from that one effect cleanup.
 *
 *  The trap/restore mechanics themselves are `@/lib/focusTrap`'s `useFocusTrap`, shared with
 *  `shell/Panel`. This stays a distinct component because its content (a member list) and
 *  anchoring (relative to the cluster's own track position, not a centred/bottom-sheet dialog)
 *  don't fit `Panel`'s shape. */

import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { useFocusTrap } from '@/lib/focusTrap'
import type { GeoTime } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { formatGeoTime } from '../format'
import styles from './ClusterPopover.module.css'

export type AnchorEdge = 'start' | 'end' | null

interface ClusterPopoverProps {
  members: readonly TimelineCheckpoint[]
  /** 0..1, the cluster marker's own displayed position — same space as every other `u` this
   *  package positions against. */
  anchorU: number
  /** The track edge the popover pins to instead of centring on `anchorU`, so it never runs past
   *  the track's own bounds; null to centre. */
  edge: AnchorEdge
  onSelect: (t: GeoTime) => void
  onClose: () => void
}

export function ClusterPopover({ members, anchorU, edge, onSelect, onClose }: ClusterPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Focus entry/restore + Tab-cycling (brief §3): focus lands here the moment it opens, so
  // Escape and Tab work immediately without a separate click into the popover first, and on
  // unmount (every close path — Escape, a member selection, the × button, or a press elsewhere
  // on the track — routes through `ScrubTrack` unmounting this component) focus returns to
  // whatever triggered the popover (the cluster button) rather than being dropped to `<body>`.
  // This popover's own focusable elements are buttons only (the close button, then each member
  // row), so the default selector is narrowed.
  const handleTab = useFocusTrap(rootRef, { focusableSelector: 'button' })

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    handleTab(e)
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      data-cluster-popover
      aria-label={`${members.length} scenes`}
      tabIndex={-1}
      className={`${styles.popover} ${edge === null ? '' : styles[edge]}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      // Only a centred popover takes the inline `left`: it would override `.start`/`.end`.
      style={edge === null ? { left: `${anchorU * 100}%` } : undefined}
    >
      <div className={styles.header}>
        <span className={styles.count}>{members.length} scenes</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          {'×'}
        </button>
      </div>
      <ul className={styles.list}>
        {members.map((member) => (
          <li key={member.id}>
            <button type="button" className={styles.item} onClick={() => onSelect(member.t)}>
              <span className={styles.itemTime}>{formatGeoTime(member.t)}</span>
              <span className={styles.itemLabel}>{member.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
