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
  const body = () => new URL(getLink().getAttribute('href')!).searchParams.get('body')!

  it('is a bare new-issue link in a new tab until interacted with', () => {
    render(<FeedbackLink />)
    expect(getLink().getAttribute('href')).toBe('https://github.com/Finndersen/earthview/issues/new')
    expect(getLink().getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('prefills a bug report from the store state at click time', () => {
    render(<FeedbackLink />)
    useTimeStore.setState({
      t: 1.5e8,
      sectionId: 'mesozoic',
      globeExpanded: true,
      playback: { playing: true, baseRate: 0.02, speed: 4, yearsPerSecond: 5000, mode: 'steady' },
    })
    fireEvent.click(getLink())
    const url = new URL(getLink().getAttribute('href')!)
    expect(url.searchParams.get('labels')).toBe('bug')
    expect(body().indexOf('What happened')).toBeLessThan(body().indexOf('Diagnostics'))
    expect(body()).toContain(`t: 150000000 (${formatGeoTime(1.5e8)})`)
    expect(body()).toContain(`Era: ${eraNameForTime(1.5e8)}`)
    expect(body()).toContain('Section: mesozoic')
    expect(body()).toContain('Playback: playing, mode=steady, speed=4x, steady=5000 yr/s')
    expect(body()).toContain('Globe: expanded')
  })

  it('refreshes on mousedown too, for a middle-click', () => {
    render(<FeedbackLink />)
    useTimeStore.setState({ t: 42 })
    fireEvent.mouseDown(getLink())
    expect(body()).toContain(`t: 42 (${formatGeoTime(42)})`)
  })
})
