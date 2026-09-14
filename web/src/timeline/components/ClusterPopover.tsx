'use client'

/** The member-list popover a checkpoint cluster marker opens on click/tap (ADR-021, replacing
 *  the window-framing `onFrameCluster` zoom used before zoom was removed). Anchored to the
 *  cluster's own displayed `u`, clamped to the track's own left/right edge the same way a pip's
 *  hover preview is (`previewAnchorClass` in `ScrubTrack`). Owns no state of its own — `onSelect`
 *  scrubs and closes, `onClose` alone just closes; `ScrubTrack` is the source of truth for which
 *  cluster (if any) is open.
 *
 *  Keyboard accessible (brief §3): focus lands here the instant it opens, Tab/Shift+Tab is
 *  trapped within its own focusable elements (the close button, then each member row) rather
 *  than leaking out to the rest of the page while the dialog is open, and Escape closes it.
 *  Whichever element had focus before the popover opened (typically the cluster button that
 *  triggered it) regains focus once it closes, on every close path — Escape, a member
 *  selection, the × button, or `ScrubTrack`'s own "press elsewhere dismisses it" branch — since
 *  all of them unmount this component and focus is restored from that one effect cleanup. */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { GeoTime } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { formatGeoTime } from '../format'
import styles from './ClusterPopover.module.css'

interface ClusterPopoverProps {
  members: readonly TimelineCheckpoint[]
  /** 0..1, the cluster marker's own displayed position — same space as every other `u` this
   *  package positions against. */
  anchorU: number
  /** `''`, `styles.start` or `styles.end` — which edge (if any) the popover anchors to instead
   *  of centring, so it never clips past the track's own bounds. Computed by the caller
   *  (`ScrubTrack`), which already has this logic for pip previews. */
  edgeAnchorClass: string
  onSelect: (t: GeoTime) => void
  onClose: () => void
}

export function ClusterPopover({ members, anchorU, edgeAnchorClass, onSelect, onClose }: ClusterPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Keyboard accessible (brief §3): focus lands here the moment it opens, so Escape and Tab work
  // immediately without a separate click into the popover first — and, on close (Escape, a member
  // selection, the × button, or a press elsewhere on the track dismissing it), focus returns to
  // whatever triggered the popover (the cluster button) rather than being dropped to `<body>`.
  // Every close path routes through `ScrubTrack` unmounting this component, so a single effect
  // cleanup — not a per-handler callback — is the one place that needs to restore it.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rootRef.current?.focus()
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [])

  // Focus trap: Tab/Shift+Tab cycles through the popover's own focusable elements (the close
  // button, then each member row) rather than letting focus leave the still-open dialog.
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = rootRef.current?.querySelectorAll<HTMLElement>('button') ?? []
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === rootRef.current) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${members.length} scenes`}
      tabIndex={-1}
      className={`${styles.popover} ${edgeAnchorClass}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      style={{ left: `${anchorU * 100}%` }}
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
