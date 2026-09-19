import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from './checkpoints'
import * as fisheyeModule from './fisheye'
import { Timeline } from './Timeline'
import { createSymlogScale, type TimeWindow } from './scale'

// Spies through to the real implementation (the ADR-021 markers test below only needs to inspect
// what Timeline calls fisheyeScale with, not to change its behaviour) — every other test in this
// file exercises the genuine lens.
vi.mock('./fisheye', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fisheye')>()
  return { ...actual, fisheyeScale: vi.fn(actual.fisheyeScale) }
})

// jsdom does not implement requestAnimationFrame; the fisheye lens's own settle loop only needs
// it to exist (the scale animation is exercised by scale.test.ts via blendScales directly, and
// the scale itself is a prop here).
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
const FULL_DOMAIN_SCALE = createSymlogScale(FULL_DOMAIN)

const events: TimelineEvent[] = [
  { id: 'e1', label: 'Big event', tMin: 2.5e8, tMax: 2.52e8, importance: 1, description: '', citation: '' },
]

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: false, baseRate: 0.1, speed: 1, mode: 'scenes', ...overrides }
}

const checkpoints: TimelineCheckpoint[] = [{ id: 'pleistocene-steppe', t: 20000, label: 'Pleistocene steppe' }]

describe('<Timeline>', () => {
  it('renders the formatted current time and transport controls', () => {
    render(
      <Timeline
        t={4.567e9}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
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
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ playing: false })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
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
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ speed: 1 })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '8' } })
    expect(onPlaybackChange).toHaveBeenCalledWith(playback({ speed: 8 }))
  })

  it('switches playback.mode via the Scenes/Steady toggle (ADR-016)', () => {
    const onPlaybackChange = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ mode: 'scenes' })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    // The group's accessible name comes from a *visible* "Playback mode" label above the buttons,
    // not a same-text `aria-label` repeating what the label already says — `getByRole` finding it
    // by that name is proof the visible label and the group are actually associated
    // (`aria-labelledby`), not merely both present.
    expect(screen.getByText('Playback mode')).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Playback mode' })
    expect(within(group).getByText('Scenes').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByText('Steady'))
    expect(onPlaybackChange).toHaveBeenCalledWith(playback({ mode: 'steady' }))
  })

  it('shows the rate readout only while playing and ratePerSecond is given', () => {
    const { rerender } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ playing: false })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
        ratePerSecond={4e7}
      />,
    )
    expect(screen.queryByText(/Myr\/s/)).toBeNull()

    rerender(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ playing: true })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
        ratePerSecond={4e7}
      />,
    )
    expect(screen.getByText('≈ 40 Myr/s')).toBeTruthy()
  })

  it('shows the "time compressed" marker only when timeCompressed is true (ADR-029)', () => {
    const { rerender } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ playing: true, mode: 'steady' })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    expect(screen.queryByText('Time compressed')).toBeNull()

    rerender(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ playing: true, mode: 'steady' })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
        timeCompressed
      />,
    )
    expect(screen.getByText('Time compressed')).toBeTruthy()
  })

  it('keeps the "time compressed" marker\'s live region mounted across the toggle (re-review fix, ADR-029)', () => {
    // A single playthrough can cross the floor threshold several times in quick succession
    // (`TimeCompressedBadge`'s own doc comment) — unmounting/remounting a `role="status"` region
    // that often both re-announces it more erratically than a live region is meant to and shifts
    // its neighbours. The marker must stay the same node throughout, only its content/visibility
    // toggling.
    const props = {
      t: 0,
      scaleKind: 'symlog' as const,
      scale: FULL_DOMAIN_SCALE,
      sectionId: 'earth' as const,
      events,
      playback: playback({ playing: true, mode: 'steady' }),
      onScrub: vi.fn(),
      onScaleKindChange: vi.fn(),
      onPlaybackChange: vi.fn(),
      onOpenCluster: vi.fn(),
      onSelectSection: vi.fn(),
    }
    const { rerender } = render(<Timeline {...props} />)
    const marker = screen.getByRole('status')
    expect(marker.getAttribute('data-visible')).toBe('false')
    expect(marker.textContent).toBe('')

    rerender(<Timeline {...props} timeCompressed />)
    expect(screen.getByRole('status')).toBe(marker) // same node — never unmounted
    expect(marker.getAttribute('data-visible')).toBe('true')
    expect(marker.textContent).toBe('Time compressed')

    rerender(<Timeline {...props} timeCompressed={false} />)
    expect(screen.getByRole('status')).toBe(marker)
    expect(marker.getAttribute('data-visible')).toBe('false')
    expect(marker.textContent).toBe('')
  })

  it('shows a "Scale" label and a Symlog/Linear segmented control, and calls onScaleKindChange on click (follow-up pass item 1)', () => {
    const onScaleKindChange = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={onScaleKindChange}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    // The group's accessible name is the visible "Scale" label itself (`aria-labelledby`, user
    // report 2026-09-15 — this used to carry a separate, same-meaning `aria-label="Timeline
    // scale"` alongside a merely decorative "Scale" span with no accessibility relationship to
    // the group at all), so finding it by that name proves the two are actually associated.
    expect(screen.getByText('Scale')).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Scale' })
    const symlogButton = within(group).getByText('Symlog')
    const linearButton = within(group).getByText('Linear')
    expect(symlogButton.getAttribute('aria-pressed')).toBe('true')
    expect(linearButton.getAttribute('aria-pressed')).toBe('false')
    // Both options carry a short explanation of what they mean (item 1's ask), not just a label.
    expect(symlogButton.getAttribute('title')).toMatch(/logarithmic/i)
    expect(linearButton.getAttribute('title')).toMatch(/proportional/i)

    fireEvent.click(linearButton)
    expect(onScaleKindChange).toHaveBeenCalledWith('linear')
  })

  it('does not step to an event: with no scenes in range the transport button is inert', () => {
    const onScrub = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback()}
        onScrub={onScrub}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('steps to a scene via the back transport button, ignoring a nearer event', () => {
    const onScrub = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        checkpoints={checkpoints}
        playback={playback()}
        onScrub={onScrub}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(onScrub).toHaveBeenCalledWith(checkpoints[0]!.t)
  })

  it('gives the back/forward transport buttons a hover tooltip that matches their accessible name', () => {
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Back to previous scene').getAttribute('title')).toMatch(/^Back to previous scene/)
    expect(screen.getByLabelText('Forward to next scene').getAttribute('title')).toMatch(/^Forward to next scene/)
  })

  it('steps to the nearest checkpoint via ArrowLeft when it is nearer than any event', () => {
    const onScrub = vi.fn()
    const { container } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        checkpoints={checkpoints}
        playback={playback()}
        onScrub={onScrub}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    fireEvent.keyDown(container.firstChild as Element, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenCalledWith(checkpoints[0]!.t)
  })

  it('renders a checkpoint pip that scrubs exactly to its own t, not the track pointer position', () => {
    const onScrub = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        checkpoints={checkpoints}
        playback={playback()}
        onScrub={onScrub}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    const pip = screen.getByLabelText(/Pleistocene steppe/)
    fireEvent.pointerDown(pip, { pointerId: 1 })
    fireEvent.click(pip)
    // Exactly one scrub, straight to the checkpoint's own t — the track's own pointer-driven
    // scrub (which would otherwise also fire from the bubbled pointerdown, landing on
    // whatever jsdom's zero-size bounding rect resolves to) must never also fire.
    expect(onScrub).toHaveBeenCalledTimes(1)
    expect(onScrub).toHaveBeenCalledWith(checkpoints[0]!.t)
  })

  it('renders the sound control as the leading item in controls-core, before the nav buttons', () => {
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
        sound={<button type="button" data-testid="sound-slot">sound</button>}
      />,
    )
    const core = screen.getByTestId('timeline-controls-core')
    expect(core.contains(screen.getByTestId('sound-slot'))).toBe(true)
    expect(core.firstElementChild).toBe(screen.getByTestId('sound-slot'))
  })

  it.each([
    ['[', 'down'],
    ['-', 'down'],
    [']', 'up'],
    ['=', 'up'],
  ] as const)('steps playback speed %s via the %s shortcut (follow-up pass item 3)', (key, direction) => {
    const onPlaybackChange = vi.fn()
    const { container } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        playback={playback({ speed: 2 })}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    fireEvent.keyDown(container.firstChild as Element, { key })
    expect(onPlaybackChange).toHaveBeenCalledWith(playback({ speed: direction === 'up' ? 4 : 1 }))
  })

  it('leaves the current section on Escape when no overlay is open', () => {
    const onSelectSection = vi.fn()
    const { container } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="cenozoic"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={onSelectSection}
      />,
    )
    fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).toHaveBeenCalledWith('earth')
  })

  it('leaves Escape to the chart dock/globe instead of also leaving the section while overlayOpen (re-review fix)', () => {
    const onSelectSection = vi.fn()
    const { container } = render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="cenozoic"
        events={events}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={onSelectSection}
        overlayOpen
      />,
    )
    fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).not.toHaveBeenCalled()
    // Backspace has no overlay binding, so it keeps working even while overlayOpen.
    fireEvent.keyDown(container.firstChild as Element, { key: 'Backspace' })
    expect(onSelectSection).toHaveBeenCalledWith('earth')
  })

  it('builds the density-adaptive lens markers from every checkpoint and event range endpoint (ADR-021)', () => {
    const spy = fisheyeModule.fisheyeScale as unknown as ReturnType<typeof vi.fn>
    spy.mockClear()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={FULL_DOMAIN_SCALE}
        sectionId="earth"
        events={events}
        checkpoints={checkpoints}
        playback={playback()}
        onScrub={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
        onSelectSection={vi.fn()}
      />,
    )
    expect(spy).toHaveBeenCalled()
    const markers = spy.mock.calls.at(-1)![3] as number[]
    const expected = [
      FULL_DOMAIN_SCALE.toUnit(events[0]!.tMin),
      FULL_DOMAIN_SCALE.toUnit(events[0]!.tMax),
      FULL_DOMAIN_SCALE.toUnit(checkpoints[0]!.t),
    ].sort((a, b) => a - b)
    expect(markers).toEqual(expected)
  })
})
