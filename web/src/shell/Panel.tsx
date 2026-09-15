'use client'

/**
 * The one shared floating dialog for this app (W-followup Track C, item 5/12's shared-primitive
 * requirement): focus trap, Escape, focus restore, click-outside, a phone bottom-sheet layout
 * below 760px, and exactly one polite open announcement. Used today by the About & credits
 * panel (`ShellLayout`); build any future panel-shaped UI — the event detail popout, and
 * `ClusterPopover` — the two now share one focus-trap implementation (`@/lib/focusTrap`'s
 * `useFocusTrap`, re-review fix 2026-09-15) rather than each carrying its own copy;
 * `ClusterPopover` stays a second *component* (its member-list content and track-relative
 * anchoring don't fit `Panel`'s dialog-with-a-heading shape), just not a second bespoke trap.
 *
 * ## API
 *
 * Mount `<Panel>` only while it should be open — the caller owns the open/closed boolean and
 * conditionally renders it, the same contract `ClusterPopover` already uses elsewhere in this
 * codebase. Mounting is what captures the previously-focused element and moves focus in;
 * unmounting is what restores it. `Panel` never reads or writes playback state or `t` — it is
 * pure chrome around whatever `children` renders, so opening one never pauses or seeks
 * anything by itself (a caller that wants "opening pauses playback" does that itself, as a
 * direct user action, alongside setting the boolean that mounts the panel).
 *
 * - `label` — the dialog's accessible name (wired via `aria-labelledby`, onto `title` if given
 *   or `label` itself otherwise — see the `title` bullet below) and the text of the one polite
 *   "<label> opened" announcement. Required even when `title` supplies a visible heading, so
 *   the announcement always has real words to say.
 * - `title` — the visible heading, if it should read differently from `label` (e.g. `label`
 *   carries a full sentence for screen readers, `title` a short heading for sighted users).
 *   Defaults to `label`.
 * - `onClose` — called on Escape, a click/tap outside the panel, or the panel's own × button.
 *   Fired at most once per gesture; the caller decides what "closed" means (unmount, or flip a
 *   boolean that will unmount it).
 * - `initialFocusRef` — element to focus on open instead of the panel's own root (e.g. a close
 *   button, or the first meaningful control). Defaults to the panel root, which is always
 *   focusable (`tabIndex={-1}`) so focus always lands somewhere inside.
 * - `className` — composed onto the panel surface for per-use sizing/positioning; the shared
 *   appearance (backdrop, surface colour, radius, phone bottom-sheet) always applies.
 * - `children` — the panel's own content, scrollable if it overflows the panel's max height.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'

import { useFocusTrap } from '@/lib/focusTrap'

import styles from './Panel.module.css'

export interface PanelProps {
  label: string
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
}

/** How long to hold the live region empty before filling it (re-review fix, 2026-09-15): most
 *  screen readers don't announce text a container already holds the instant it appears — an
 *  `aria-live="polite"` region has to actually *change* after mount to fire. A short delay
 *  after the dialog's own focus-entry announcement (its `aria-labelledby` name, read the moment
 *  focus lands) keeps the two from talking over each other. */
const ANNOUNCEMENT_DELAY_MS = 150

export function Panel({ label, title, onClose, children, initialFocusRef, className = '' }: PanelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const handleTab = useFocusTrap(rootRef, { initialFocusRef })

  // Exactly one polite announcement per open ("<label> opened"), distinct from the dialog's own
  // `aria-labelledby` name read on focus entry. Starts empty and is filled after a short delay
  // (see `ANNOUNCEMENT_DELAY_MS`) rather than rendered with its text already in place, so
  // assistive tech that only announces a live region's *changes* actually hears it.
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setAnnouncement(`${label} opened`), ANNOUNCEMENT_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [label])

  // Focus trap: Tab/Shift+Tab cycles within the panel's own focusable elements instead of
  // leaking out to the rest of the page while it's open. Escape closes.
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
      className={styles.backdrop}
      // A click, not a pointerdown (re-review fix, 2026-09-15): on a touch screen the browser
      // still synthesises a `click` after `pointerdown`/`pointerup`, and a `pointerdown`-driven
      // close has already unmounted the backdrop by then, so that synthetic click falls through
      // onto whatever now sits under the same finger — a "ghost tap" that could press About &
      // credits, reopen another panel from a feed card, or fight Play. Checking
      // `e.target === e.currentTarget` (true only for the backdrop itself, never a bubbled click
      // from inside `.panel`) means the panel surface needs no `stopPropagation` of its own
      // either — a click that started inside it never reaches this check as the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.panel} ${className}`}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title ?? label}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            {'×'}
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        <span className={styles.visuallyHidden} role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
    </div>
  )
}
