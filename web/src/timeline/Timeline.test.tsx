import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from './checkpoints'
import * as fisheyeModule from './fisheye'
import { Timeline } from './Timeline'
import { createSymlogScale } from './scale'

vi.mock('./fisheye', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fisheye')>()
  return { ...actual, fisheyeScale: vi.fn(actual.fisheyeScale) }
})

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SCALE = createSymlogScale([0, EARTH_FORMATION])
const events: TimelineEvent[] = [{ id: 'e1', label: 'Big event', tMin: 2.5e8, tMax: 2.52e8, importance: 1, description: '', citation: '' }]
const checkpoints: TimelineCheckpoint[] = [{ id: 'pleistocene-steppe', t: 20000, label: 'Pleistocene steppe' }]

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: false, baseRate: 0.1, speed: 1, yearsPerSecond: 10, mode: 'scenes', ...overrides }
}

function renderTimeline(overrides: Partial<ComponentProps<typeof Timeline>> = {}) {
  const props: ComponentProps<typeof Timeline> = {
    t: 0,
    scaleKind: 'symlog',
    scale: SCALE,
    sectionId: 'earth',
    events,
    playback: playback(),
    onScrub: vi.fn(),
    onScaleKindChange: vi.fn(),
    onPlaybackChange: vi.fn(),
    onOpenCluster: vi.fn(),
    onSelectSection: vi.fn(),
    ...overrides,
  }
  const result = render(<Timeline {...props} />)
  const keyDown = (key: string) => fireEvent.keyDown(result.container.firstChild as Element, { key })
  return { ...result, props, keyDown }
}

describe('<Timeline>', () => {
  it('toggles play/pause', () => {
    const { props } = renderTimeline()
    fireEvent.click(screen.getByLabelText('Play'))
    expect(props.onPlaybackChange).toHaveBeenCalledWith(playback({ playing: true }))
  })

  it("steps the active mode's rate from the picker and the rate shortcuts", () => {
    const scenes = renderTimeline({ playback: playback({ speed: 1 }) })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Playback speed' }), { key: 'ArrowUp' })
    expect(scenes.props.onPlaybackChange).toHaveBeenCalledWith(playback({ speed: 2 }))
    cleanup()
    const steady = renderTimeline({ playback: playback({ mode: 'steady', yearsPerSecond: 10 }) })
    steady.keyDown(']')
    expect(steady.props.onPlaybackChange).toHaveBeenCalledWith(playback({ mode: 'steady', yearsPerSecond: 20 }))
  })

  it('switches playback mode and scale kind from their labelled groups', () => {
    const { props } = renderTimeline()
    const mode = screen.getByRole('group', { name: 'Playback mode' })
    expect(within(mode).getByText('Scenes').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(mode).getByText('Steady'))
    expect(props.onPlaybackChange).toHaveBeenCalledWith(playback({ mode: 'steady' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Scale' })).getByText('Linear'))
    expect(props.onScaleKindChange).toHaveBeenCalledWith('linear')
  })

  it('steps to scenes, never events, from the transport button and ArrowLeft', () => {
    const inert = renderTimeline()
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(inert.props.onScrub).not.toHaveBeenCalled()
    cleanup()
    const { props, keyDown } = renderTimeline({ checkpoints })
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(props.onScrub).toHaveBeenLastCalledWith(20000)
    vi.mocked(props.onScrub).mockClear()
    keyDown('ArrowLeft')
    expect(props.onScrub).toHaveBeenCalledWith(20000)
  })

  it('scrubs a checkpoint pip exactly to its own t, once', () => {
    const { props } = renderTimeline({ checkpoints })
    const pip = screen.getByLabelText(/Pleistocene steppe/)
    fireEvent.pointerDown(pip, { pointerId: 1 })
    fireEvent.click(pip)
    expect(props.onScrub).toHaveBeenCalledTimes(1)
    expect(props.onScrub).toHaveBeenCalledWith(20000)
  })

  it('leaves Escape to an open overlay but still leaves the section on Backspace', () => {
    const { props, keyDown } = renderTimeline({ sectionId: 'cenozoic', overlayOpen: true })
    keyDown('Escape')
    expect(props.onSelectSection).not.toHaveBeenCalled()
    keyDown('Backspace')
    expect(props.onSelectSection).toHaveBeenCalledWith('earth')
  })

  it('marks the rate readout floored and announces it from a live region that stays mounted', () => {
    const { rerender, props } = renderTimeline({ playback: playback({ playing: true, mode: 'steady' }), ratePerSecond: 250 })
    const readout = screen.getByText('250 yr/s').parentElement!
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    rerender(<Timeline {...props} rateFloored />)
    expect(screen.getByRole('status')).toBe(status)
    expect(readout.getAttribute('data-floored')).toBe('true')
    expect(status.textContent).not.toBe('')
  })

  it('feeds every checkpoint and event endpoint to the lens as a marker', () => {
    const spy = fisheyeModule.fisheyeScale as unknown as ReturnType<typeof vi.fn>
    spy.mockClear()
    renderTimeline({ checkpoints })
    const markers = spy.mock.calls.at(-1)![3] as number[]
    expect(markers).toEqual([SCALE.toUnit(2.5e8), SCALE.toUnit(2.52e8), SCALE.toUnit(20000)].sort((a, b) => a - b))
  })
})
