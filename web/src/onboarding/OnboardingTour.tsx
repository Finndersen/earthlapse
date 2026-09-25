'use client'

/**
 * The tours (IMPLEMENTATION § Backlog — onboarding): steps ringing the controls a viewer cannot
 * work out by looking, with Skip available from the first one.
 *
 * - `OnboardingTour`, on the first visit: four steps on every viewport; a fifth, pointing at
 *   About for the keyboard shortcuts list, only where there is a keyboard
 *   (`TourStep.desktopOnly`, `steps.ts`).
 * - `GlobeTour`, the first time the globe is expanded, once the first tour is out of the way.
 *
 * Nothing in this package imports `store/time.ts`. The first tour points at controls and never
 * drives them, so a viewer who skips at step one lands on exactly the view they would have had
 * without it. The globe tour's empires step is the one exception, and it goes through the host:
 * `onJumpToEmpires` moves `t` into the empire layer's range when the viewer is outside it,
 * because a step about empires over a globe with none on it would describe nothing. A tour
 * advances only on an explicit press: no timer advances a step or dismisses it, and nothing
 * here fades on inactivity.
 *
 * The persisted flag is read in an effect, never during render, so the prerendered HTML of this
 * static export and the first client paint agree: `visibility.ts`'s server snapshot is always
 * "closed".
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { useIsCompactViewport } from '@/lib/useIsCompactViewport'
import { useReducedMotion } from '@/lib/useReducedMotion'

import { placeCallout, type Callout } from './callout'
import styles from './OnboardingTour.module.css'
import { GLOBE_TOUR_JUMP_LEAD, GLOBE_TOUR_STEPS, TOUR_STEPS, type TourStep, type TourStepId } from './steps'
import { hasSeenTour } from './storage'
import { useAnchorMeasurement } from './useAnchorMeasurement'
import { getServerTourOpenToken, globeTour, mainTour } from './visibility'

function dismiss(): void {
  mainTour.setOpen(false)
}

function dismissGlobeTour(): void {
  globeTour.setOpen(false)
}

export function OnboardingTour() {
  const openToken = useSyncExternalStore(mainTour.subscribe, mainTour.getToken, getServerTourOpenToken)

  useEffect(() => {
    if (!hasSeenTour()) mainTour.setOpen(true)
  }, [])

  // Mounted only while open and keyed on the open token, so the step index resets and focus
  // moves in on every open — including one that finds the tour already on screen.
  return openToken > 0 ? <TourOverlay key={openToken} allSteps={TOUR_STEPS} onDismiss={dismiss} /> : null
}

export interface GlobeTourProps {
  expanded: boolean
  /** Whether the empire layer draws at the current `t`. */
  empiresInDomain: boolean
  /** Moves `t` to the moment `GLOBE_TOUR_JUMP_LEAD` names. */
  onJumpToEmpires: () => void
}

export function GlobeTour({ expanded, empiresInDomain, onJumpToEmpires }: GlobeTourProps) {
  const openToken = useSyncExternalStore(globeTour.subscribe, globeTour.getToken, getServerTourOpenToken)
  const mainOpen = useSyncExternalStore(mainTour.subscribe, mainTour.getToken, getServerTourOpenToken) > 0

  // Waits for the first tour to close, so the two never stack — including a viewer who opens the
  // globe from the first tour's own globe step. The token is read live: the first tour's own
  // mount effect may have opened it earlier in this same commit, after `mainOpen` was read.
  useEffect(() => {
    if (expanded && mainTour.getToken() === 0 && !hasSeenTour('globe')) globeTour.setOpen(true)
  }, [expanded, mainOpen])

  // Collapsing the globe mid-tour leaves every anchor gone, so it ends the tour. Only an open
  // tour: dismissing records it as seen, and a globe that has never been opened hasn't shown it.
  useEffect(() => {
    if (!expanded && globeTour.getToken() > 0) dismissGlobeTour()
  }, [expanded])

  // Read through refs so `onStepEnter` stays one stable function: `t` changes every playback
  // frame, and a new callback would re-run the overlay's step-entry effect each time.
  const inDomainRef = useRef(empiresInDomain)
  const jumpRef = useRef(onJumpToEmpires)
  useEffect(() => {
    inDomainRef.current = empiresInDomain
    jumpRef.current = onJumpToEmpires
  })
  const onStepEnter = useMemo(
    () =>
      (id: TourStepId): string | undefined => {
        if (id !== 'globe-empires' || inDomainRef.current) return undefined
        jumpRef.current()
        return GLOBE_TOUR_JUMP_LEAD
      },
    [],
  )

  return openToken > 0 && expanded ? (
    <TourOverlay key={openToken} allSteps={GLOBE_TOUR_STEPS} onDismiss={dismissGlobeTour} onStepEnter={onStepEnter} escapeFirst />
  ) : null
}

interface TourOverlayProps {
  allSteps: readonly TourStep[]
  onDismiss: () => void
  /** Called as each step is shown; a returned string leads that step's copy from then on. */
  onStepEnter?: (id: TourStepId) => string | undefined
  /** Take Escape before anything else listening on the window, so dismissing the tour doesn't
   *  also collapse the expanded globe underneath it. */
  escapeFirst?: boolean
}

function TourOverlay({ allSteps, onDismiss, onStepEnter, escapeFirst = false }: TourOverlayProps) {
  const compact = useIsCompactViewport()
  const reducedMotion = useReducedMotion()
  // `desktopOnly` steps (keyboard shortcuts, via About) drop out on a compact viewport, where
  // there is no keyboard to describe — computed once per mount, not re-filtered mid-tour, so the
  // step list a viewer is stepping through can't change size out from under them.
  const steps = useMemo(() => allSteps.filter((s) => !s.desktopOnly || !compact), [allSteps, compact])
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]!
  const { rect, viewport } = useAnchorMeasurement(step.selector)

  const [leads, setLeads] = useState<Partial<Record<TourStepId, string>>>({})
  useEffect(() => {
    const lead = onStepEnter?.(step.id)
    if (lead !== undefined) setLeads((current) => ({ ...current, [step.id]: lead }))
  }, [onStepEnter, step.id])
  const lead = leads[step.id]

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
      if (event.key !== 'Escape') return
      if (escapeFirst) event.stopImmediatePropagation()
      onDismiss()
    }
    window.addEventListener('keydown', onKeyDown, { capture: escapeFirst })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: escapeFirst })
  }, [onDismiss, escapeFirst])

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
    setAnnouncement(`Step ${stepIndex + 1} of ${steps.length}: ${step.title}`)
  }, [stepIndex, step.title])

  const isLastStep = stepIndex === steps.length - 1

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
        <p className={styles.counter}>{`${stepIndex + 1} of ${steps.length}`}</p>
        <h2 id={titleId} className={styles.title}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {lead === undefined ? '' : `${lead} `}
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
