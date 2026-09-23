import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimeStore } from '@/store/time'

import { OnboardingTour } from './OnboardingTour'
import { TOUR_STEPS } from './steps'
import { getServerTourOpenToken, getTourOpenToken, setOnboardingTourOpen } from './visibility'

/** Stand-ins for the controls the steps anchor to, carrying the same `data-testid`s and
 *  accessible names the real app's do — the tour resolves its targets from the live DOM. */
function mountAnchors(): void {
  const host = document.createElement('div')
  host.innerHTML = `
    <div data-testid="globe-expand"></div>
    <div data-testid="era-shortcuts"></div>
    <div data-testid="timeline-track-stack"></div>
    <div data-testid="timeline-controls-core"><button type="button" aria-label="Play"></button></div>
    <button type="button" aria-label="About & credits"></button>
  `
  document.body.appendChild(host)
}

/** A minimal `MediaQueryList` stand-in matching only queries containing one of `matching`. */
function mockMatchMedia(...matching: string[]): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: matching.some((fragment) => query.includes(fragment)),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function card(): HTMLElement {
  return screen.getByTestId('onboarding-card')
}

function clickNext(times: number): void {
  for (let i = 0; i < times; i += 1) fireEvent.click(screen.getByTestId('onboarding-next'))
}

const initialStoreState = useTimeStore.getState()

beforeEach(() => {
  setOnboardingTourOpen(false)
  window.localStorage.clear()
  useTimeStore.setState(initialStoreState, true)
  mountAnchors()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OnboardingTour', () => {
  it('is closed before mounting, so prerendered HTML and first paint agree', () => {
    expect(getTourOpenToken()).toBe(0)
    expect(getServerTourOpenToken()).toBe(0)
  })

  it('opens on a storage miss and when storage is unreadable', () => {
    render(<OnboardingTour />)
    expect(card()).toBeTruthy()
    cleanup()
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    render(<OnboardingTour />)
    expect(card()).toBeTruthy()
  })

  it('stays closed once the seen flag is stored', () => {
    window.localStorage.setItem('earthtime.onboarding.seen', 'true')
    render(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('is a focused dialog named by its step title, spotlighting its control, with Skip but no Back', () => {
    render(<OnboardingTour />)
    const dialog = screen.getByRole('dialog', { name: TOUR_STEPS[0]!.title })
    expect(document.activeElement).toBe(dialog)
    expect(screen.getByText('1 of 5')).toBeTruthy()
    expect(screen.getByTestId('onboarding-spotlight')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('advances to the era step and back', () => {
    render(<OnboardingTour />)
    clickNext(2)
    expect(screen.getByText('3 of 5')).toBeTruthy()
    const copy = card().textContent ?? ''
    for (const name of ['Dinosaurs', 'Mesozoic', 'Humans', 'Holocene']) expect(copy).toContain(name)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('2 of 5')).toBeTruthy()
  })

  it.each([
    ['skipped', () => fireEvent.click(screen.getByTestId('onboarding-skip'))],
    ['dismissed with Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['completed', () => clickNext(TOUR_STEPS.length)],
  ])('never reappears once %s, leaving the store untouched', (_label, dismiss) => {
    const first = render(<OnboardingTour />)
    dismiss()
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
    expect(useTimeStore.getState()).toEqual(initialStoreState)
    first.unmount()
    render(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('ends on the keyboard-shortcuts step on desktop and drops it on a phone', () => {
    mockMatchMedia()
    render(<OnboardingTour />)
    expect(card().textContent).toContain('Click play')
    clickNext(4)
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
    cleanup()
    mockMatchMedia('max-width: 760px')
    render(<OnboardingTour />)
    expect(card().textContent).toContain('Tap play')
    clickNext(3)
    expect(screen.getByText('4 of 4')).toBeTruthy()
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('reopens at step one on demand, including after a skip', () => {
    render(<OnboardingTour />)
    clickNext(2)
    act(() => setOnboardingTourOpen(true))
    expect(screen.getByText('1 of 5')).toBeTruthy()
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    act(() => setOnboardingTourOpen(true))
    expect(screen.getByText('1 of 5')).toBeTruthy()
  })
})
