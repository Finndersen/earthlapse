import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTimeStore } from '@/store/time'
import { eraNameForTime, formatGeoTime } from '@/timeline'

import { FeedbackLink } from './FeedbackLink'

const initialStoreState = useTimeStore.getState()

beforeEach(() => {
  useTimeStore.setState(initialStoreState, true)
})

afterEach(() => {
  cleanup()
})

function getLink(): HTMLAnchorElement {
  return screen.getByRole('link', { name: /report a bug or give feedback/i })
}

describe('FeedbackLink', () => {
  it('starts as a bare new-issue link, unprefilled until interacted with — never rebuilt per render', () => {
    render(<FeedbackLink />)
    expect(getLink().getAttribute('href')).toBe('https://github.com/Finndersen/earthview/issues/new')
  })

  it('opens in a new tab without exposing window.opener', () => {
    render(<FeedbackLink />)
    const link = getLink()
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('prefills title and a bug label, and leads the body with a blank section for the reporter before the diagnostics', () => {
    render(<FeedbackLink />)
    fireEvent.click(getLink())
    const url = new URL(getLink().getAttribute('href')!)
    expect(url.searchParams.get('title')).toBe('Bug report')
    expect(url.searchParams.get('labels')).toBe('bug')
    const body = url.searchParams.get('body')!
    expect(body.indexOf('What happened')).toBeLessThan(body.indexOf('Diagnostics'))
  })

  it('builds the diagnostic body from the store state at click time, not at render time', () => {
    render(<FeedbackLink />)

    // Changed after mount: a stale, render-time-computed URL would still show the pre-render
    // values here — the whole point of deferring the build to the click itself.
    useTimeStore.setState({
      t: 1.5e8,
      sectionId: 'mesozoic',
      playback: { playing: true, baseRate: 0.02, speed: 4, yearsPerSecond: 5000, mode: 'steady' },
    })

    fireEvent.click(getLink())
    const body = new URL(getLink().getAttribute('href')!).searchParams.get('body')!
    expect(body).toContain(`t: 150000000 (${formatGeoTime(1.5e8)})`)
    expect(body).toContain(`Era: ${eraNameForTime(1.5e8)}`)
    expect(body).toContain('Section: mesozoic')
    expect(body).toContain('Playback: playing, mode=steady, speed=4x, steady=5000 yr/s')
    expect(body).toContain('Globe: collapsed')
  })

  it('reports the globe as expanded once the store says so', () => {
    render(<FeedbackLink />)
    useTimeStore.setState({ globeExpanded: true })
    fireEvent.click(getLink())
    const body = new URL(getLink().getAttribute('href')!).searchParams.get('body')!
    // jsdom has no Globe/Map toggle button mounted here (Globe itself isn't rendered by this
    // test), so the view mode reads as unknown rather than throwing.
    expect(body).toContain('Globe: expanded (unknown view)')
  })

  it('also refreshes the href on mousedown, so a middle-click — which never fires "click" — still opens a prefilled link', () => {
    render(<FeedbackLink />)
    useTimeStore.setState({ t: 42 })
    fireEvent.mouseDown(getLink())
    const body = new URL(getLink().getAttribute('href')!).searchParams.get('body')!
    expect(body).toContain(`t: 42 (${formatGeoTime(42)})`)
  })

  it('includes viewport, device pixel ratio and user agent', () => {
    render(<FeedbackLink />)
    fireEvent.click(getLink())
    const body = new URL(getLink().getAttribute('href')!).searchParams.get('body')!
    expect(body).toContain(`Viewport: ${window.innerWidth}x${window.innerHeight}, devicePixelRatio=${window.devicePixelRatio}`)
    expect(body).toContain(`User agent: ${navigator.userAgent}`)
  })
})
