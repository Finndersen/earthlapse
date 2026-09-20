'use client'

/**
 * The first-visit tour (IMPLEMENTATION § Backlog — onboarding): four steps ringing the controls
 * a viewer cannot work out by looking, with Skip available from the first one.
 *
 * It points at controls and never drives them. Nothing in this package imports `store/time.ts`,
 * so the tour cannot start playback, expand the globe, move `t` or change the selected section —
 * a viewer who skips at step one lands on exactly the still, paused view they would have had
 * without it. It advances only on an explicit press: no timer advances a step or dismisses the
 * tour, and nothing here fades on inactivity.
 *
 * The persisted flag is read in an effect, never during render, so the prerendered HTML of this
 * static export and the first client paint agree: `visibility.ts`'s server snapshot is always
 * "closed".
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useIsCompactViewport } from '@/lib/useIsCompactViewport'
import { useReducedMotion } from '@/lib/useReducedMotion'

import { placeCallout, type Callout } from './callout'
import styles from './OnboardingTour.module.css'
import { TOUR_STEPS } from './steps'
import { hasSeenTour } from './storage'
import { useAnchorMeasurement } from './useAnchorMeasurement'
import { getServerTourOpenToken, getTourOpenToken, setOnboardingTourOpen, subscribeTourOpen } from './visibility'

function dismiss(): void {
  setOnboardingTourOpen(false)
}

export function OnboardingTour() {
  const openToken = useSyncExternalStore(subscribeTourOpen, getTourOpenToken, getServerTourOpenToken)

  useEffect(() => {
    if (!hasSeenTour()) setOnboardingTourOpen(true)
  }, [])

  // Mounted only while open and keyed on the open token, so the step index resets and focus
  // moves in on every open — including one that finds the tour already on screen.
  return openToken > 0 ? <TourOverlay key={openToken} onDismiss={dismiss} /> : null
}

interface TourOverlayProps {
  onDismiss: () => void
}

function TourOverlay({ onDismiss }: TourOverlayProps) {
  const compact = useIsCompactViewport()
  const reducedMotion = useReducedMotion()
  const [stepIndex, setStepIndex] = useState(0)
  const step = TOUR_STEPS[stepIndex]!
  const { rect, viewport } = useAnchorMeasurement(step.selector)

  const cardRef = useRef<HTMLDivElement>(null)
  const [callout, setCallout] = useState<Callout | null>(null)
  const titleId = useId()
  const bodyId = useId()

  // Placed from the card's own rendered box, before paint, so a step never shows at one position
  // and then jumps to another. The card's width is fixed in CSS, so its height at that width is
  // settled by the time this runs.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null || rect === null) return
    const box = card.getBoundingClientRect()
    setCallout(placeCallout(rect, { width: box.width, height: box.height }, viewport))
  }, [rect, viewport, step.id])

  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  // Window-level, not the card's own `onKeyDown`: Escape has to skip the tour wherever focus has
  // wandered to. `shell/Panel` and `ClusterPopover` stop Escape propagating while either is open,
  // so a dialog over the tour still closes itself first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  // Transitions are enabled only once the first placement has painted, so the card and ring never
  // animate in from the corner they were first laid out at.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    setSettled(true)
  }, [])

  // Announced on a step change only: the dialog's own accessible name is already read when focus
  // lands on it as it opens, and focus deliberately stays on Next afterwards so the tour can be
  // stepped through without tabbing back each time.
  const [announcement, setAnnouncement] = useState('')
  const announcedOnceRef = useRef(false)
  useEffect(() => {
    if (!announcedOnceRef.current) {
      announcedOnceRef.current = true
      return
    }
    setAnnouncement(`Step ${stepIndex + 1} of ${TOUR_STEPS.length}: ${step.title}`)
  }, [stepIndex, step.title])

  const isLastStep = stepIndex === TOUR_STEPS.length - 1

  return (
    <div className={styles.root} data-testid="onboarding-tour" data-settled={settled} data-reduced-motion={reducedMotion}>
      {rect !== null && (
        <div
          className={styles.ring}
          data-shape={step.shape}
          data-testid="onboarding-spotlight"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={styles.card}
        data-side={callout?.side ?? 'below'}
        data-testid="onboarding-card"
        style={callout === null ? undefined : { left: callout.left, top: callout.top }}
      >
        <p className={styles.counter}>{`${stepIndex + 1} of ${TOUR_STEPS.length}`}</p>
        <h2 id={titleId} className={styles.title}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {compact ? step.body.compact : step.body.wide}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} data-testid="onboarding-skip" onClick={onDismiss}>
            Skip
          </button>
          <div className={styles.advance}>
            {stepIndex > 0 && (
              <button type="button" className={styles.secondary} onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              data-testid="onboarding-next"
              onClick={() => (isLastStep ? onDismiss() : setStepIndex(stepIndex + 1))}
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
        <span className={styles.visuallyHidden} role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
    </div>
  )
}
