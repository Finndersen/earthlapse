import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimelineEvent } from '@/types/layer'

import { Timeline } from './Timeline'
import type { TimeWindow } from './scale'

// jsdom does not implement requestAnimationFrame; useAnimatedScale only needs it to not
// throw synchronously during render (the animation itself is exercised by scale.test.ts via
// blendScales directly, not by driving real frames here).
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

const events: TimelineEvent[] = [
  { id: 'e1', label: 'Big event', tMin: 2.5e8, tMax: 2.52e8, importance: 1, description: '', citation: '' },
]

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: false, baseRate: 0.1, speed: 1, ...overrides }
}

describe('<Timeline>', () => {
  it('renders the formatted current time and transport controls', () => {
    render(
      <Timeline
        t={4.567e9}
        window={FULL_DOMAIN}
        scaleKind="symlog"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onWindowChange={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
      />,
    )
    expect(screen.getByText('4.57 Ga')).toBeTruthy()
    expect(screen.getByLabelText('Play')).toBeTruthy()
  })

  it('toggles playback.playing via the play/pause button', () => {
    const onPlaybackChange = vi.fn()
    render(
      <Timeline
        t={0}
        window={FULL_DOMAIN}
        scaleKind="symlog"
        events={events}
        playback={playback({ playing: false })}
        onScrub={vi.fn()}
        onWindowChange={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Play'))
    expect(onPlaybackChange).toHaveBeenCalledWith(playback({ playing: true }))
  })

  it('changes speed via the speed selector', () => {
    const onPlaybackChange = vi.fn()
    render(
      <Timeline
        t={0}
        window={FULL_DOMAIN}
        scaleKind="symlog"
        events={events}
        playback={playback({ speed: 1 })}
        onScrub={vi.fn()}
        onWindowChange={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '8' } })
    expect(onPlaybackChange).toHaveBeenCalledWith(playback({ speed: 8 }))
  })

  it('calls onScaleKindChange when the symlog/linear toggle is clicked', () => {
    const onScaleKindChange = vi.fn()
    render(
      <Timeline
        t={0}
        window={FULL_DOMAIN}
        scaleKind="symlog"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onWindowChange={vi.fn()}
        onScaleKindChange={onScaleKindChange}
        onPlaybackChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('symlog'))
    expect(onScaleKindChange).toHaveBeenCalledWith('linear')
  })

  it('jumps to a neighbouring event via the forward transport button', () => {
    const onScrub = vi.fn()
    render(
      <Timeline
        t={0}
        window={FULL_DOMAIN}
        scaleKind="symlog"
        events={events}
        playback={playback()}
        onScrub={onScrub}
        onWindowChange={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Back to previous event'))
    expect(onScrub).toHaveBeenCalledWith((events[0]!.tMin + events[0]!.tMax) / 2)
  })
})
