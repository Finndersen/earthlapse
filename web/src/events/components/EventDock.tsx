'use client'

/**
 * The docked, non-modal surface both event overlays share — `EventBrowser`'s list and
 * `EventDetailPanel`'s card — so moving between them never moves the surface itself. It sits
 * above the timeline (`useTimelineBottomInset` measures the real gap, on desktop and the phone
 * layout alike) with no backdrop: nothing outside its own box is inert, and the timeline below
 * stays visible and scrubbable. That is why it is not `shell/Panel`, which is modal (a
 * full-viewport backdrop, a focus trap, click-outside to close).
 *
 * `fit="fill"` takes the whole height above the timeline (the list); `fit="content"` is only as
 * tall as its content, resting on the timeline, never taller than `fill` (the card).
 *
 * Escape closes it from a capture-phase `window` listener that stops the event there, so the
 * expanded globe's own window-level Escape (and the timeline's section climb) never also fire:
 * one press closes one thing. Focus moves in on mount — to `initialFocusRef` when given, else the
 * surface itself — and returns on unmount to whatever held it before, if that is still on the
 * page. Tab is not trapped, so it can reach the timeline below.
 */

import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'

import { useTimelineBottomInset } from '../useTimelineBottomInset'
import styles from './EventDock.module.css'

export interface EventDockProps {
  title: string
  onClose: () => void
  fit: 'fill' | 'content'
  /** A back button before the title, e.g. from an event's card to the list. */
  back?: { label: string; onBack: () => void }
  /** Header content under the title row, outside the scrolling body. */
  header?: ReactNode
  children: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  testId: string
}

export function EventDock({ title, onClose, fit, back, header, children, initialFocusRef, testId }: EventDockProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bottomInset = useTimelineBottomInset()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(initialFocusRef?.current ?? rootRef.current)?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
    // Mount and unmount only: a new `initialFocusRef` mid-life must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return (
    <div
      ref={rootRef}
      className={styles.dock}
      style={{ '--dock-bottom-inset': `${bottomInset}px` } as CSSProperties}
      data-fit={fit}
      tabIndex={-1}
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          {back && (
            <button type="button" className={styles.back} aria-label={back.label} title={back.label} onClick={back.onBack}>
              {'‹'}
            </button>
          )}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            {'×'}
          </button>
        </div>
        {header}
      </div>
      {children}
    </div>
  )
}
