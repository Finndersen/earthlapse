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
  it('is closed before anything mounts, so the prerendered HTML and the first client paint agree', () => {
    expect(getTourOpenToken()).toBe(0)
    expect(getServerTourOpenToken()).toBe(0)
  })

  it('opens on a storage miss', () => {
    render(<OnboardingTour />)
    expect(card()).toBeTruthy()
  })

  it('opens when reading localStorage throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    render(<OnboardingTour />)
    expect(card()).toBeTruthy()
  })

  it('stays closed once the flag is stored', () => {
    window.localStorage.setItem('earthtime.onboarding.seen', 'true')
    render(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('offers Skip from the very first step', () => {
    render(<OnboardingTour />)
    expect(screen.getByText('1 of 5')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip')).toBeTruthy()
  })

  it('never reappears after a skip at step one', () => {
    const first = render(<OnboardingTour />)
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(screen.queryByTestId('onboarding-card')).toBeNull()

    first.unmount()
    render(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('never reappears after the last step is completed', () => {
    const first = render(<OnboardingTour />)
    clickNext(TOUR_STEPS.length - 1)
    expect(screen.getByText('5 of 5')).toBeTruthy()
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.queryByTestId('onboarding-card')).toBeNull()

    first.unmount()
    render(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('dismisses on Escape from anywhere on the page', () => {
    render(<OnboardingTour />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
    expect(window.localStorage.getItem('earthtime.onboarding.seen')).toBe('true')
  })

  it('steps forward and back without leaving the step list', () => {
    render(<OnboardingTour />)
    clickNext(2)
    expect(screen.getByText('3 of 5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('2 of 5')).toBeTruthy()
  })

  it('offers no Back control on the first step', () => {
    render(<OnboardingTour />)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('leaves playback, t, the section and the globe exactly as it found them', () => {
    render(<OnboardingTour />)
    clickNext(TOUR_STEPS.length - 1)
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(useTimeStore.getState()).toEqual(initialStoreState)
  })

  it('leaves playback paused when skipped at step one', () => {
    render(<OnboardingTour />)
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(useTimeStore.getState().playback.playing).toBe(false)
  })

  it('names both era nicknames and both geological units it aliases', () => {
    render(<OnboardingTour />)
    clickNext(2)
    const copy = card().textContent ?? ''
    for (const name of ['Dinosaurs', 'Mesozoic', 'Humans', 'Holocene']) expect(copy).toContain(name)
  })

  it('rings the control each step describes', () => {
    render(<OnboardingTour />)
    expect(screen.getByTestId('onboarding-spotlight')).toBeTruthy()
  })

  it('is a dialog named by its step title, with focus moved into it', () => {
    render(<OnboardingTour />)
    const dialog = screen.getByRole('dialog', { name: TOUR_STEPS[0]!.title })
    expect(dialog).toBe(card())
    expect(document.activeElement).toBe(dialog)
  })

  it('says "click" on a pointer-sized viewport', () => {
    mockMatchMedia()
    render(<OnboardingTour />)
    expect(card().textContent).toContain('Click play')
  })

  it('says "tap" on a phone-sized viewport', () => {
    mockMatchMedia('max-width: 760px')
    render(<OnboardingTour />)
    expect(card().textContent).toContain('Tap play')
  })

  it('ends on a step pointing at About for keyboard shortcuts, on a pointer-sized viewport', () => {
    mockMatchMedia()
    render(<OnboardingTour />)
    clickNext(4)
    expect(screen.getByText('5 of 5')).toBeTruthy()
    expect(card().textContent).toContain('Keyboard shortcuts')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
  })

  it('drops the About/keyboard-shortcuts step entirely on a phone-sized viewport', () => {
    mockMatchMedia('max-width: 760px')
    render(<OnboardingTour />)
    clickNext(3)
    expect(screen.getByText('4 of 4')).toBeTruthy()
    expect(card().textContent).toContain('The globe opens')
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
  })

  it('restarts at step one when opened again while already on screen', () => {
    render(<OnboardingTour />)
    clickNext(2)
    expect(screen.getByText('3 of 5')).toBeTruthy()

    act(() => setOnboardingTourOpen(true))
    expect(screen.getByText('1 of 5')).toBeTruthy()
  })

  it('reopens on demand for the visual-QA harness, which never reloads the page', () => {
    render(<OnboardingTour />)
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(screen.queryByTestId('onboarding-card')).toBeNull()

    act(() => setOnboardingTourOpen(true))
    expect(screen.getByText('1 of 5')).toBeTruthy()
  })
})
